/**
 * Multi-Agent Digital Workers Module
 * Implements:
 * 1. Delegator Agent: Coordinates tasks and aggregates responses.
 * 2. Source Code Analyzer Agent: Identifies context, file type, and target version.
 * 3. Rules Creator & Validator Agent: Selects and checks context-specific rules.
 * 4. AQS Reviewer Agent: Runs code review using dense caveman prompting.
 * 5. Feedback & Suggestion Agent: Appends recommendations and maps Oracle errors.
 */

const fs = require("fs");
const path = require("path");
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
function selectAndValidateRules(context, content, file, prFiles = []) {
  const allRules = rulesStore.loadAllRules();
  const relevantRules = allRules.filter(
    (r) => r.approved && (r.category === "all" || r.category === context.category)
  );

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
 * Prunes unchanged context from large source files to minimize token load and speed up LLM processing.
 * Keeps the first 150 lines, the last 50 lines, and a 40-line context window around any modified lines.
 */
function pruneFileContext(content, patch, maxLines = 800) {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) return content;

  // Parse patch to find modified/added lines
  const patchLines = (patch || "").split(/\r?\n/)
    .filter(l => l.startsWith("+") && !l.startsWith("+++"))
    .map(l => l.substring(1).trim())
    .filter(l => l.length > 6); // Ignore short fragments

  if (patchLines.length === 0) {
    return content;
  }

  const keepIndices = new Set();

  // Always keep first 150 lines (global declarations, package headers)
  for (let i = 0; i < Math.min(150, lines.length); i++) {
    keepIndices.add(i);
  }

  // Always keep last 50 lines (file endings)
  for (let i = Math.max(0, lines.length - 50); i < lines.length; i++) {
    keepIndices.add(i);
  }

  for (let i = 0; i < lines.length; i++) {
    const lineTrimmed = lines[i].trim();
    if (lineTrimmed.length > 6) {
      if (patchLines.some(pl => lineTrimmed.includes(pl) || pl.includes(lineTrimmed))) {
        // Keep 40 lines around the match
        for (let j = Math.max(0, i - 40); j <= Math.min(lines.length - 1, i + 40); j++) {
          keepIndices.add(j);
        }
      }
    }
  }

  // Assemble pruned content
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
 * Agent 4: AQS Reviewer Agent (Uses Caveman Prompting)
 */
async function runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction, coreContent = "") {
  if (!llmPostFunction) {
    return [];
  }

  // Scrub secrets
  const cleanContent = redactSecrets(content);
  const patchContent = file.patch || "";

  // Prune unchanged context from large files (>800 lines) to optimize speed & LLM tokens
  const prunedCleanContent = pruneFileContext(cleanContent, patchContent, 800);
  const prunedCoreContent = pruneFileContext(coreContent, patchContent, 800);

  const system = `You are an AI Technical Code Reviewer with over 25 years of experience in IFS development and consulting, serving as a senior expert in the IFS R&D department. You have deep, authoritative knowledge of all IFS Applications versions released to date and their underlying technologies. You are intimately familiar with IFS’s Marble modeling language, Oracle PL/SQL, and all other relevant file types and artifacts in the IFS ecosystem.

Your primary objective is to perform thorough code reviews acting as an orchestrator of specialized review agents:
1. Security Agent: Detect SQL injection, secrets, dynamic SQL exposure, authorization/validation flaws.
2. Performance Agent: Detect row-by-row loops (DML inside loops), database context-switching, unoptimized loops.
3. Code Quality Agent: Detect naming convention violations, readability and comment problems.
4. Architecture Agent: Ensure layer architecture (Cust/Extension layer rather than Core layer modifications) is adhered to.
5. API Contract Agent: Ensure Marble/Projection contract consistency and correct component references.

AQS compliance is always the top priority. When reviewing code or technical artifacts provided by a user, you will:
* Identify and explain any violations of IFS AQS Coding Standards: You detect deviations from official IFS coding guidelines and precisely identify which rules or best practices are not followed. For example, this includes naming conventions, architectural layering, transaction handling, error logging standards, etc., as defined by IFS AQS.
* Spot code quality issues: This includes poor structure, inadequate modularization, readability problems, improper layering or placement of logic, hard-coded values, misuse of IFS frameworks/APIs, or any non-standard coding patterns that would concern an IFS R&D reviewer.
* Detect performance inefficiencies: Highlight queries or code blocks that may cause slow performance or scalability issues in an IFS context (such as unoptimized SQL, missing indexes, extraneous database calls, inefficient loops, or expensive operations in hot paths).
* Identify potential security vulnerabilities: Point out weaknesses like missing authorization checks, improper input validation (risk of SQL injection or other injection flaws), insecure data handling practices, or any usage of APIs that might compromise security in an IFS environment.
* Assess maintainability and clarity: Note if the code is hard to read or maintain due to issues like poor naming, lack of comments where necessary, overly complex logic, or other anti-patterns. Ensure the code is aligned with long-term maintainability and supportability best practices.
* Assess upgrade and cloud readiness: Warn about usage of deprecated APIs or patterns that might break in future IFS versions or conflict with IFS Cloud deployment models. Verify that the code follows patterns compatible with IFS Cloud guidelines (stateless design, proper use of extensibility frameworks, etc.) and highlight if something might hinder smooth upgrades or cloud transitions.

Understand the IFS layering concept: customizing files in the customer repository (e.g. adding _Cust suffix or layer = "Cust" decorations) is standard practice. Do NOT flag changes in customer solution files as "Core layer modifications". Flagging changes in the customer solution as "Core layer modified" is invalid.
Also, since you are reviewing a Pull Request that is currently open and has not yet been merged, do NOT flag referenced database files, script files, or CDB (.cdb) files as missing or "not found" under the customer solution path. New or modified files introduced in the PR will not yet be merged into the target paths on disk. Do not report missing or unresolved files for any artifacts currently being modified or introduced in this PR.

For every issue or observation you find, you must provide a clear and constructive explanation and solution. Output ONLY valid JSON containing the findings list. Do not output any other text or markdown block.`;

  const user = `Review the following code changes from the Customer Solution.
You are provided with:
1. The Core Solution reference code (baseline) to understand baseline syntax and correct layering.
2. The full Customer Solution code (customized and merged with PR changes) to serve as surrounding context for understanding syntax/semantics.
3. The Pull Request Diff/Patch showing the exact changes (additions/modifications) introduced in this PR.

CRITICAL REQUIREMENT: You must ONLY validate and review the modifications and additions introduced in the Pull Request Diff/Patch. Do NOT report findings, warnings, or violations for any code in the file that is not modified or added by this PR. Use the full Customer Solution code and Core baseline code strictly as context to understand the surrounding structure.

File Path: ${file.path}
Detected Language Type/Category: ${context.category.toUpperCase()} (Extension: ${file.extension || ""})
IFS Version Target: ${context.detectedVersion}
Rules to check: ${rules.ruleSummary}

[Core Solution Reference Code (Baseline - Always Correct and Verified)]
${prunedCoreContent ? `\`\`\`${context.category}\n${prunedCoreContent}\n\`\`\`` : "(No baseline core file was found for reference. Perform review based on general IFS standards.)"}

[Customer Solution Code (Customized - Full file content for context only)]
\`\`\`${context.category}
${prunedCleanContent}
\`\`\`

[Pull Request Diff/Patch (The ONLY target for validation and findings)]
\`\`\`diff
${patchContent ? patchContent : "(No patch content available. Review the file content directly.)"}
\`\`\`

Compare the changes in the Pull Request Diff/Patch against the core solution baseline (if available) and the full file context.
Highlight issues only. If there are no issues in the PR changes, return an empty findings array.
For every issue or observation in the PR changes, you must provide:
1. Issue (what & where): Description of problem and rule violation.
2. Impact (why it matters): Consequences of the issue (AQS rule violation, performance, security, upgrade blocker).
3. Fix (how to correct): Concrete recommendation to fix it.
4. IFS-Recommended Approach (best practice): Preferred IFS design pattern.

Output format MUST be valid JSON matching this schema:
{
  "findings": [
    {
      "severity": "Blocker" | "Major" | "Minor",
      "title": "Short descriptive title of the issue",
      "explanation": "Issue details + Impact: why it matters",
      "recommendation": "Fix description + IFS-Recommended Approach: best practice",
      "matchText": "Exact code snippet from the customized file",
      "line": 12,
      "ruleId": "Rule ID, e.g. SEC-002, PERF-004, etc.",
      "classification": "IFS_AQS" | "ORACLE" | "IFS_ERP"
    }
  ]
}`;

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
        max_tokens: 1000,
        response_format: { type: "json_object" }
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
        format: "json",
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
        max_tokens: 1000,
        response_format: { type: "json_object" }
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
async function delegateReview(file, content, llmConfig, llmPostFunction, prFiles = []) {
  // Step 1: Analyze source code context (SourceCodeAnalyzerAgent)
  const context = analyzeSourceContext(file, content);

  // Clean file path to find matching core file
  const configStore = require("../configStore");
  const cfg = configStore.getConfig() || {};
  const corePath = cfg?.ifs?.corePath || "";

  let cleanRelPath = file.path;
  if (/^[ab]\//i.test(cleanRelPath)) {
    cleanRelPath = cleanRelPath.substring(2);
  }

  let coreContent = "";
  if (corePath && cleanRelPath) {
    const fullCorePath = path.join(corePath, cleanRelPath);
    if (fs.existsSync(fullCorePath)) {
      try {
        coreContent = fs.readFileSync(fullCorePath, "utf-8");
      } catch (err) {
        console.warn(`Failed to read core file reference for ${cleanRelPath}:`, err.message);
      }
    }
  }

  // Step 2: Select and evaluate rules (RulesCreatorAgent)
  const rules = selectAndValidateRules(context, content, file, prFiles);

  // Step 3: Run LLM code review (AQSReviewerAgent)
  let aiFindings = [];
  if (llmPostFunction) {
    aiFindings = await runAQSReviewer(context, rules, content, file, llmConfig, llmPostFunction, coreContent);
  }

  // Hybrid AI + Rule Engine: Merge AI semantic findings and deterministic rule-based static analysis findings
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
  // Disabled rules generation per user request
  return;

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
