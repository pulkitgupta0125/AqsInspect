/**
 * Simplified Review Agents Module
 * Orchestrates prompt assembly, active LLM execution, and findings enhancement.
 */

const fs = require("fs");
const path = require("path");
const rulesStore = require("./rulesStore");
const { evaluateRulesForFile } = require("./ruleEngine");
const reviewCache = require("./reviewCache");
const memoryLayer = require("./memoryLayer");

/**
 * Redacts passwords, client secrets, API keys, and access tokens from text before sending to LLM.
 */
function redactSecrets(text) {
  if (!text) return text;
  return text
    .replace(/(password\s*=\s*['"])([^'"]+)(['"])/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/(<password[^>]*>)([^<]+)(<\/password>)/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/("password"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/(client_secret\s*=\s*['"])([^'"]+)(['"])/gi, '$1[REDACTED_SECRET]$3')
    .replace(/("client_secret"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED_SECRET]$3')
    .replace(/(api_key\s*=\s*['"])([^'"]+)(['"])/gi, '$1[REDACTED_KEY]$3')
    .replace(/("api_key"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED_KEY]$3')
    .replace(/(bearer\s+[A-Za-z0-9\-\._~\+\/]+=*)/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(basic\s+[A-Za-z0-9\-\._~\+\/]+=*)/gi, 'Basic [REDACTED_TOKEN]')
    .replace(/(pat\s*=\s*['"])([^'"]+)(['"])/gi, '$1[REDACTED_PAT]$3')
    .replace(/("pat"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED_PAT]$3');
}

/**
 * Source Code Analyzer Agent
 */
function analyzeSourceContext(file, content) {
  const ext = String(file.extension || "").toLowerCase();
  const cat = String(file.category || "").toLowerCase();

  const isApps10OrLower = ext === ".cs" || content.includes("Centura") || content.includes("FndAttribute") || content.includes("APF");
  const isCloud = ext === ".projection" || ext === ".client" || ext === ".marble" || content.includes("@Override") || content.includes("@Overtake");

  const detectedVersion = isApps10OrLower ? "Apps10 & Lower (IEE/C# client)" : isCloud ? "IFS Cloud (Aurena/Marble)" : "Hybrid/Unknown";

  return {
    category: cat || "generic",
    detectedVersion,
    isCloud,
    isApps10OrLower,
    lineCount: content.split("\n").length
  };
}

/**
 * Rules Selector Agent
 */
function selectAndValidateRules(context, content, file, prFiles = []) {
  const configStore = require("../configStore");
  const cfg = configStore.getConfig() || {};
  if (cfg?.mcp?.mode === "ai-only") {
    return {
      ruleCount: 0,
      ruleSummary: "None (AI Review Engine Only Mode)",
      rulesList: [],
      deterministicFindings: []
    };
  }

  const allRules = rulesStore.loadAllRules();
  const databaseCategories = ["plsql", "views", "db_script", "api", "entity"];
  const relevantRules = allRules.filter((r) => {
    if (!r.approved) return false;

    // Exclude database-specific rules from non-database files
    if (r.classification === "ORACLE" && !databaseCategories.includes(context.category)) {
      return false;
    }

    return r.category === "all" || r.category === context.category;
  });

  // Run deterministic rule evaluation
  const deterministicFindings = evaluateRulesForFile(file, [], content, prFiles);

  return {
    ruleCount: relevantRules.length,
    ruleSummary: relevantRules.map((r) => `${r.id}: ${r.title}`).join(", "),
    rulesList: relevantRules,
    deterministicFindings
  };
}

/**
 * Prunes unchanged context from large source files to minimize token load.
 */
function pruneFileContext(content, patch, maxLines = 800) {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) return content;

  const patchLines = (patch || "").split(/\r?\n/)
    .filter(l => l.startsWith("+") && !l.startsWith("+++"))
    .map(l => l.substring(1).trim())
    .filter(l => l.length > 6);

  if (patchLines.length === 0) {
    return content;
  }

  const keepIndices = new Set();

  for (let i = 0; i < Math.min(150, lines.length); i++) {
    keepIndices.add(i);
  }
  for (let i = Math.max(0, lines.length - 50); i < lines.length; i++) {
    keepIndices.add(i);
  }

  for (let i = 0; i < lines.length; i++) {
    const lineTrimmed = lines[i].trim();
    if (lineTrimmed.length > 6) {
      if (patchLines.some(pl => lineTrimmed.includes(pl) || pl.includes(lineTrimmed))) {
        for (let j = Math.max(0, i - 40); j <= Math.min(lines.length - 1, i + 40); j++) {
          keepIndices.add(j);
        }
      }
    }
  }

  const result = [];
  let inOmission = false;
  let omittedStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (keepIndices.has(i)) {
      if (inOmission) {
        const omittedCount = i - omittedStart;
        result.push(`\n---\n[... OMITTED ${omittedCount} LINES OF UNCHANGED SURROUNDING CONTEXT ...]\n---\n`);
        inOmission = false;
      }
      result.push(lines[i]);
    } else {
      if (!inOmission) {
        inOmission = true;
        omittedStart = i;
      }
    }
  }

  if (inOmission) {
    const omittedCount = lines.length - omittedStart;
    result.push(`\n---\n[... OMITTED ${omittedCount} LINES OF UNCHANGED SURROUNDING CONTEXT ...]\n---\n`);
  }

  return result.join("\n");
}

/**
 * AQS Reviewer Agent (Queries Active LLM)
 */
async function runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction, coreContent = "", prFiles = [], knowledgeContext = "") {
  if (!llmPostFunction) {
    return [];
  }

  const cleanContent = redactSecrets(content);
  const patchContent = file.patch || "";

  const provider = (llmConfig.provider || "azure").toLowerCase();
  const isPremiumModel = provider === "azure" || provider === "openai";
  const pruningLimit = isPremiumModel ? 2500 : 800;

  const prunedCleanContent = pruneFileContext(cleanContent, patchContent, pruningLimit);
  const prunedCoreContent = pruneFileContext(coreContent, patchContent, pruningLimit);

  // Load dynamic prompts from prompts.js
  const prompts = require("./prompts");
  const system = prompts.SYSTEM_PROMPT;
  const user = prompts.buildUserPrompt(
    prunedCleanContent,
    file.path,
    prunedCleanContent.length,
    context.category,
    rules.ruleSummary,
    prunedCoreContent,
    patchContent,
    knowledgeContext
  );

  try {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    let url;
    let headers;
    let body;

    if (provider === "openai") {
      url = "https://api.openai.com/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${llmConfig.apiKey}`,
        "Content-Type": "application/json"
      };
      body = {
        model: llmConfig.model,
        messages,
        temperature: llmConfig.temperature ?? 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      };
    } else if (provider === "ollama") {
      const endpoint = String(llmConfig.endpoint || "http://localhost:11434").replace(/\/$/, "");
      url = `${endpoint}/api/chat`;
      headers = {
        "Content-Type": "application/json"
      };
      body = {
        model: llmConfig.model,
        messages,
        stream: false,
        format: "json",
        options: {
          temperature: llmConfig.temperature ?? 0.2
        }
      };
    } else {
      // Azure
      const endpoint = String(llmConfig.endpoint || "").replace(/\/$/, "");
      const apiVersion = llmConfig.apiVersion || "2024-02-15-preview";
      url = `${endpoint}/openai/deployments/${llmConfig.model}/chat/completions?api-version=${apiVersion}`;
      headers = {
        "api-key": llmConfig.apiKey,
        "Content-Type": "application/json"
      };
      body = {
        messages,
        temperature: llmConfig.temperature ?? 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      };
    }

    const res = await llmPostFunction(url, body, headers);
    const textResponse = provider === "ollama" ? (res?.data?.message?.content || "") : (res?.data?.choices?.[0]?.message?.content || "");

    const parsed = extractJson(textResponse);
    return parsed?.findings || [];
  } catch (e) {
    console.error("AQS Reviewer Agent failed:", e.message);
    throw new Error(`AI Code Review Request failed: ${e.message}`);
  }
}

/**
 * Feedback Enhancement and Post-Filtering Agent
 */
function enhanceFeedbackAndOracleErrors(findings, fileCategory = "") {
  const { normalizeSeverity } = require("./severityHelper");
  const databaseCategories = ["plsql", "views", "db_script", "api", "entity"];
  const isDatabaseFile = databaseCategories.includes(String(fileCategory).toLowerCase());

  return findings
    .filter((f) => {
      if (!isDatabaseFile) {
        const title = String(f.title || "").toLowerCase();
        const explanation = String(f.explanation || "").toLowerCase();
        const ruleId = String(f.ruleId || "").toUpperCase();
        const classification = String(f.classification || "").toUpperCase();

        const isNullFinding = 
          ruleId === "DATA-001" || 
          title.includes("null comparison") || 
          title.includes("null pointer") || 
          explanation.includes("null comparison") || 
          explanation.includes("null pointer") ||
          explanation.includes("checking for nulls");

        if (isNullFinding) {
          const matchText = String(f.matchText || "").toLowerCase();
          const hasExplicitSqlNull = 
            matchText.includes("= null") || 
            matchText.includes("!= null") || 
            matchText.includes("<> null") || 
            explanation.includes("= null") || 
            explanation.includes("!= null") || 
            explanation.includes("<> null");

          if (!hasExplicitSqlNull) {
            console.log(`[Post-Filter] Discarding invalid null/oracle comparison finding on non-database file: ${f.title}`);
            return false;
          }
        }
      }
      return true;
    })
    .map((f) => {
      let rec = f.recommendation || "";
      let expl = f.explanation || "";
      const sev = normalizeSeverity(f);

      const text = `${f.title} ${expl}`.toLowerCase();
      
      if (text.includes("semicolon") || text.includes("end;")) {
        rec += " (Oracle error: PLS-00103: Encountered the symbol...)";
      } else if (text.includes("begin") && text.includes("end")) {
        rec += " (Oracle compilation error: PLS-00103: Mismatched BEGIN/END block)";
      } else if (text.includes("unrecognized exception") || text.includes("exception name")) {
        rec += " (Oracle error: PLS-00201: identifier must be declared)";
      } else if (text.includes("cursor") && text.includes("close")) {
        rec += " (Oracle resource leak risk: ORA-01000: maximum open cursors exceeded)";
      } else if (text.includes("init_method") || text.includes("missing init")) {
        rec += " (IFS Standard Violation: Transaction security context may not be initialized)";
      }

      return {
        ...f,
        severity: sev,
        explanation: expl,
        recommendation: rec
      };
    });
}

/**
 * Delegator Agent (Entry point)
 */
async function delegateReview(file, content, llmConfig, llmPostFunction, prFiles = []) {
  const context = analyzeSourceContext(file, content);

  const configStore = require("../configStore");
  const cfg = configStore.getConfig() || {};
  const corePath = cfg?.ifs?.corePath || "";
  const useCoreReference = cfg?.mcp?.useCoreReference !== false;
  const enableKnowledgeBase = cfg?.mcp?.enableKnowledgeBase || false;
  const knowledgePath = cfg?.mcp?.knowledgePath || "";

  let cleanRelPath = file.path;
  if (/^[ab]\//i.test(cleanRelPath)) {
    cleanRelPath = cleanRelPath.substring(2);
  }

  let coreContent = "";
  if (useCoreReference && corePath && cleanRelPath) {
    const fullCorePath = path.join(corePath, cleanRelPath);
    if (fs.existsSync(fullCorePath)) {
      try {
        coreContent = fs.readFileSync(fullCorePath, "utf-8");
      } catch (err) {
        console.warn(`Failed to read core file reference for ${cleanRelPath}:`, err.message);
      }
    }
  }

  let knowledgeContext = "";
  if (enableKnowledgeBase && knowledgePath) {
    try {
      const { loadKnowledgeBase } = require("./knowledgeBaseParser");
      knowledgeContext = await loadKnowledgeBase(knowledgePath);
    } catch (err) {
      console.warn("Failed to load knowledge base files:", err.message);
    }
  }

  const rules = selectAndValidateRules(context, content, file, prFiles);

  // Check cache first
  const cached = reviewCache.getCachedReview(content, llmConfig, rules.rulesList);
  if (cached) {
    console.log(`[Cache Hit] Using cached review for ${file.path}`);
    return {
      ...cached.review,
      cached: true
    };
  }

  const isRulesOnly = cfg?.mcp?.mode === "rules-only";

  let aiFindings = [];
  if (llmPostFunction && (!isRulesOnly || (enableKnowledgeBase && knowledgeContext))) {
    aiFindings = await runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction, coreContent, prFiles, knowledgeContext);
  }

  const allFindings = [...aiFindings];
  if (rules.deterministicFindings && rules.deterministicFindings.length > 0) {
    for (const ruleFinding of rules.deterministicFindings) {
      const duplicate = allFindings.some(f => 
        (f.ruleId === ruleFinding.ruleId && String(f.line) === String(ruleFinding.line)) ||
        (f.title === ruleFinding.title && String(f.line) === String(ruleFinding.line))
      );
      if (!duplicate) {
        allFindings.push({
          ...ruleFinding,
          source: "rule"
        });
      }
    }
  }

  const merged = [];
  const addedIds = new Set();

  for (const f of allFindings) {
    const key = `${f.ruleId || ""}:${f.title || ""}:${f.line || ""}`;
    if (!addedIds.has(key)) {
      addedIds.add(key);
      f.classification = f.classification || "IFS_ERP";
      merged.push(f);
    }
  }

  const enhanced = enhanceFeedbackAndOracleErrors(merged, context.category);

  const result = {
    findings: enhanced,
    context,
    rules: {
      count: rules.ruleCount,
      summary: rules.ruleSummary
    },
    cached: false
  };

  reviewCache.cacheReview(content, llmConfig, rules.rulesList, result);
  memoryLayer.addReviewToMemory(file.path, content, enhanced);

  return result;
}


function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```json([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch (_) {}
  }
  return null;
}

module.exports = {
  delegateReview,
  analyzeSourceContext,
  selectAndValidateRules,
  runAQSReviewer,
  enhanceFeedbackAndOracleErrors,
  redactSecrets
};
