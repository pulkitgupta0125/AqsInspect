/**
 * Multi-Agent Digital Workers Module
 * Implements:
 * 1. Delegator Agent: Coordinates tasks and aggregates responses.
 * 2. Source Code Analyzer Agent: Identifies context, file type, and target version.
 * 3. Rules Creator & Validator Agent: Selects and checks context-specific rules.
 * 4. AQS Reviewer Agent: Runs code review using dense caveman prompting.
 * 5. Feedback & Suggestion Agent: Appends recommendations and maps Oracle errors.
 */

const rulesStore = require("./rulesStore");
const { evaluateRulesForFile } = require("./ruleEngine");

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
 * Agent 2: Source Code Analyzer Agent
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
 * Agent 3: Rules Creator & Validator Agent
 */
function selectAndValidateRules(context, content, file) {
  const allRules = rulesStore.loadAllRules();
  const relevantRules = allRules.filter(
    (r) => r.approved && (r.category === "all" || r.category === context.category)
  );

  // Run deterministic rule evaluation
  const deterministicFindings = evaluateRulesForFile(file, [], content);

  return {
    ruleCount: relevantRules.length,
    ruleSummary: relevantRules.map((r) => `${r.id}: ${r.title}`).join(", "),
    rulesList: relevantRules,
    deterministicFindings
  };
}

/**
 * Agent 4: AQS Reviewer Agent (Uses Caveman Prompting)
 */
async function runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction) {
  if (!llmPostFunction) {
    return [];
  }

  // Scrub secrets
  const cleanContent = redactSecrets(content);

  // Caveman prompting style - highly compressed to reduce tokens
  const system = "Role: IFS AQS code reviewer. Target: " + context.detectedVersion + ". Order: 1st IFS AQS rules, 2nd Oracle errors, 3rd ERP. Output JSON only.";
  
  const user = `Review code.
File: ${file.path}
Target: ${context.detectedVersion}
Rules: ${rules.ruleSummary}
JSON Format:
{
  "findings": [
    {
      "severity": "Blocker"|"Major"|"Minor",
      "title": "Short title",
      "explanation": "Why issue",
      "recommendation": "How fix",
      "matchText": "code snippet",
      "line": 12,
      "ruleId": "IFS_XYZ",
      "classification": "IFS_AQS"|"ORACLE"|"IFS_ERP"
    }
  ]
}
Code:
${cleanContent}
`;

  try {
    const provider = (llmConfig.provider || "azure").toLowerCase();
    const endpoint = String(llmConfig.endpoint || "").replace(/\/$/, "");
    const apiVersion = llmConfig.apiVersion || "2024-02-15-preview";
    const temperature = typeof llmConfig.temperature === "number" ? llmConfig.temperature : 0.1;
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
        temperature,
        max_tokens: 1000
      };
    } else if (provider === "ollama") {
      url = `${endpoint}/api/chat`;
      headers = {
        "Content-Type": "application/json"
      };
      body = {
        model: llmConfig.model,
        messages,
        stream: false,
        options: {
          temperature
        }
      };
    } else {
      url = `${endpoint}/openai/deployments/${llmConfig.model}/chat/completions?api-version=${apiVersion}`;
      headers = {
        "api-key": llmConfig.apiKey,
        "Content-Type": "application/json"
      };
      body = {
        messages,
        temperature,
        max_tokens: 1000
      };
    }

    const res = await llmPostFunction(url, body, headers);
    const textResponse = provider === "ollama" ? (res?.data?.message?.content || "") : (res?.data?.choices?.[0]?.message?.content || "");

    const parsed = extractJson(textResponse);
    return parsed?.findings || [];
  } catch (e) {
    console.error("AQS Reviewer Agent failed:", e.message);
    return [];
  }
}

/**
 * Agent 5: Feedback & Suggestion Agent
 */
function enhanceFeedbackAndOracleErrors(findings) {
  return findings.map((f) => {
    let rec = f.recommendation || "";
    let expl = f.explanation || "";

    // Map common Oracle issues to specific PLS/ORA error hints
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
      explanation: expl,
      recommendation: rec
    };
  });
}

/**
 * Agent 1: Delegator Agent (Orchestrates all agents)
 */
async function delegateReview(file, content, llmConfig, llmPostFunction) {
  // Step 1: Analyze source code context (SourceCodeAnalyzerAgent)
  const context = analyzeSourceContext(file, content);

  // Step 2: Select and evaluate rules (RulesCreatorAgent)
  const rules = selectAndValidateRules(context, content, file);

  // Step 3: Run LLM code review (AQSReviewerAgent)
  let aiFindings = [];
  if (llmPostFunction) {
    aiFindings = await runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction);
  }

  // Merge deterministic and AI findings
  const merged = [];
  const addedIds = new Set();

  const allFindings = [...rules.deterministicFindings, ...aiFindings];

  for (const f of allFindings) {
    const key = `${f.ruleId || ""}:${f.title || ""}:${f.line || ""}`;
    if (!addedIds.has(key)) {
      addedIds.add(key);
      // Ensure classification matches hierarchy
      f.classification = f.classification || "IFS_ERP";
      merged.push(f);
    }
  }

  // Step 4: Map Oracle errors & enhance recommendations (FeedbackSuggestionAgent)
  const enhanced = enhanceFeedbackAndOracleErrors(merged);

  // Dynamically create and save unapproved rules from findings
  try {
    dynamicallyCreateRulesFromFindings(enhanced, file);
  } catch (err) {
    console.error("Failed to dynamically generate rules from findings:", err.message);
  }

  return {
    findings: enhanced,
    context,
    rules: {
      count: rules.ruleCount,
      summary: rules.ruleSummary
    }
  };
}

function escapeRegex(string) {
  if (!string) return "";
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function dynamicallyCreateRulesFromFindings(findings, file) {
  if (!findings || !findings.length) return;

  const allRules = rulesStore.loadAllRules();
  const existingIds = new Set(allRules.map(r => r.id));

  for (const f of findings) {
    if (f.ruleId === "SYS_FILE_TOO_LARGE") continue;

    // Generate a clean rule ID based on the finding's ruleId or title
    let ruleId = f.ruleId;
    if (!ruleId || ruleId === "null" || ruleId === "undefined") {
      const sanitizedTitle = String(f.title || "DYNAMIC")
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 30);
      ruleId = `DYNAMIC_RULE_${sanitizedTitle}`;
    } else if (!ruleId.startsWith("DYNAMIC_") && !ruleId.startsWith("MCP_") && !ruleId.startsWith("IFS_")) {
      ruleId = `DYNAMIC_${ruleId.toUpperCase()}`;
    }

    // If it doesn't already exist, create it as an unapproved dynamic rule template
    if (!existingIds.has(ruleId)) {
      const category = file.category || "all";
      const classification = f.classification || "IFS_ERP";
      const pattern = f.matchText ? escapeRegex(f.matchText) : "";

      const newRule = {
        id: ruleId,
        category: category,
        severity: f.severity || "Major",
        title: f.title || "Dynamic Validation Rule",
        description: f.explanation || "Automatically generated rule template from code review findings.",
        recommendation: f.recommendation || "Review the flagged code pattern.",
        pattern: pattern,
        alertOnMissing: false,
        approved: false, // User must approve in settings screen
        source: "dynamic_review",
        classification: classification
      };

      try {
        rulesStore.saveRule(newRule);
        existingIds.add(ruleId);
        console.log(`[Dynamic Rules] Created new rule candidate: ${ruleId}`);
      } catch (err) {
        console.error(`Failed to dynamically save rule ${ruleId}:`, err.message);
      }
    }
  }
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
