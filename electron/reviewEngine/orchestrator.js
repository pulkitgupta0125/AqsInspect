/**
 * Review Orchestrator Module
 * Coordinates file discovery, classification, 2-pass analysis (static + LLM),
 * and report generation with map-reduce consolidation for large repos
 */

const fs = require("fs");
const { promisify } = require("util");
const fileDiscovery = require("./fileDiscovery");
const fileClassifier = require("./fileClassifier");
const staticAnalyzer = require("./staticAnalyzer");
const ruleEngine = require("./ruleEngine");
const { buildLLMPrompt } = require("./prompts");

const readfileAsync = promisify(fs.readFile);

// Cache structure: { filePath: { hash, review } }
const reviewCache = {};

function hashContent(content) {
  // Simple hash for caching (in production, use crypto.createHash)
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();

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

function buildLLMRequest(file, fileContent, llmConfig) {
  const prompt = buildLLMPrompt(file.category || "generic", fileContent, file.path, file.size);
  const provider = (llmConfig.provider || "azure").toLowerCase();
  const temperature = typeof llmConfig.temperature === "number" ? llmConfig.temperature : 0.2;
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ];

  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${llmConfig.apiKey}`,
        "Content-Type": "application/json"
      },
      body: {
        model: llmConfig.model,
        messages,
        temperature,
        max_tokens: 1200
      }
    };
  }

  const endpoint = String(llmConfig.endpoint || "").replace(/\/$/, "");
  const apiVersion = llmConfig.apiVersion || "2024-02-15-preview";
  return {
    url: `${endpoint}/openai/deployments/${llmConfig.model}/chat/completions?api-version=${apiVersion}`,
    headers: {
      "api-key": llmConfig.apiKey,
      "Content-Type": "application/json"
    },
    body: {
      messages,
      temperature,
      max_tokens: 1200
    }
  };
}

/**
 * Phase 1: Discovery & Classification
 */
async function discoverAndClassifyRepo(repoRoot, maxFiles = 1000) {
  const files = await fileDiscovery.discoverFiles(repoRoot, maxFiles);
  const classified = await fileClassifier.classifyMultiple(files, repoRoot);
  const grouped = fileClassifier.groupByCategory(classified);

  return {
    allFiles: classified,
    grouped,
    stats: {
      totalFiles: classified.length,
      byCategoryCount: Object.fromEntries(
        Object.entries(grouped).map(([cat, files]) => [cat, files.length])
      )
    }
  };
}

/**
 * Phase 2: Static Analysis (fast, no LLM)
 */
async function runStaticAnalysis(files, progressCallback = null) {
  const results = [];
  const totalFindings = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (progressCallback) {
      progressCallback({
        phase: "static",
        processed: i + 1,
        total: files.length,
        currentFile: file.path
      });
    }

    const result = await staticAnalyzer.staticAnalyzeFile(file);
    results.push(result);

    if (result.findings && result.findings.length > 0) {
      totalFindings.push(...result.findings.map((f) => ({ ...f, file })));
    }
  }

  return { results, findings: totalFindings };
}

async function runRuleAnalysis(files, progressCallback = null) {
  const results = [];
  const totalFindings = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (progressCallback) {
      progressCallback({
        phase: "rules",
        processed: i + 1,
        total: files.length,
        currentFile: file.path
      });
    }

    const content = await readfileAsync(file.fullPath, "utf-8");
    const findings = ruleEngine.evaluateRulesForFile(file, [], content);
    results.push({ file, findings });

    if (findings && findings.length > 0) {
      totalFindings.push(...findings.map((f) => ({ ...f, file })));
    }
  }

  return { results, findings: totalFindings };
}

/**
 * Phase 3: LLM Review (per-category prompts)
 * Calls the configured LLM using category-specific prompts for each file.
 */
async function prepareLLMReviewBatch(
  files,
  llmConfig,
  llmPostFunction,
  progressCallback = null
) {
  const findings = [];
  const errors = [];

  const grouped = fileClassifier.groupByCategory(files);
  let fileIndex = 0;
  const totalFiles = files.length;

  for (const [category, categoryFiles] of Object.entries(grouped)) {
    for (const file of categoryFiles) {
      fileIndex++;

      if (progressCallback) {
        progressCallback({
          phase: "llm",
          processed: fileIndex,
          total: totalFiles,
          currentFile: file.path,
          category
        });
      }

      try {
        const content = await readfileAsync(file.fullPath, "utf-8");
        const hash = hashContent(content);

        if (reviewCache[file.path] && reviewCache[file.path].hash === hash) {
          findings.push({
            file,
            findings: reviewCache[file.path].review.findings,
            cached: true
          });
          continue;
        }

        if (file.size > 10 * 1024) {
          findings.push({
            file,
            findings: [
              {
                severity: "Info",
                confidence: 1.0,
                title: "File too large for LLM review",
                explanation: `File size ${file.size} bytes exceeds 10KB limit. Review via static analysis only.`,
                ruleId: "SYS_FILE_TOO_LARGE",
                recommendation: "Split into smaller modules or use static analysis findings"
              }
            ],
            cached: false
          });
          continue;
        }

        const { url, headers, body } = buildLLMRequest(file, content, llmConfig);
        const res = await llmPostFunction(url, body, headers);
        const contentResponse = res?.data?.choices?.[0]?.message?.content || "";
        const parsed = extractJson(contentResponse);

        if (!parsed || !Array.isArray(parsed.findings)) {
          findings.push({
            file,
            findings: [
              {
                severity: "Info",
                confidence: 0.4,
                title: "LLM review returned invalid JSON",
                explanation:
                  "The LLM response could not be parsed into structured findings. Please retry with a smaller file or adjust the model configuration.",
                ruleId: "SYS_LLM_PARSE_ERROR",
                recommendation: "Verify the LLM model and prompt configuration."
              }
            ],
            raw: contentResponse,
            cached: false
          });
          continue;
        }

        const fileFindings = parsed.findings.map((finding) => ({
          ...finding,
          file
        }));

        reviewCache[file.path] = {
          hash,
          review: { findings: fileFindings, summary: parsed.summary || {} }
        };

        findings.push({
          file,
          findings: fileFindings,
          summary: parsed.summary || {},
          cached: false
        });
      } catch (e) {
        errors.push({ file, error: e.message });
      }
    }
  }

  return { findings, errors };
}

/**
 * Phase 4: Consolidation & Report Generation
 */
function generateReport(staticFindings, llmFindings, ruleFindings, repoStats) {
  const allFindings = [];

  // Merge static findings
  for (const staticResult of staticFindings.results || []) {
    if (staticResult.findings) {
      allFindings.push(
        ...staticResult.findings.map((f) => ({
          ...f,
          source: "static",
          file: staticResult.file
        }))
      );
    }
  }

  // Merge LLM findings
  for (const llmResult of llmFindings.findings || []) {
    if (llmResult.findings) {
      allFindings.push(
        ...llmResult.findings.map((f) => ({
          ...f,
          source: "llm",
          file: llmResult.file
        }))
      );
    }
  }

  // Merge rule engine findings
  for (const ruleResult of ruleFindings.results || []) {
    if (ruleResult.findings) {
      allFindings.push(
        ...ruleResult.findings.map((f) => ({
          ...f,
          source: "rule",
          file: ruleResult.file
        }))
      );
    }
  }

  // Aggregate statistics
  const severityCounts = { Blocker: 0, Major: 0, Minor: 0, Info: 0 };
  const risksByFile = {};
  const topIssues = [];

  for (const finding of allFindings) {
    const sev = finding.severity || "Info";
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;

    const fileName = finding.file?.path || "unknown";
    if (!risksByFile[fileName]) {
      risksByFile[fileName] = [];
    }
    risksByFile[fileName].push(finding);

    // Track top issues
    if (sev === "Blocker" || sev === "Major") {
      topIssues.push({
        title: finding.title,
        file: fileName,
        severity: sev,
        ruleId: finding.ruleId
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    repository: repoStats,
    summary: {
      totalFiles: repoStats.stats?.totalFiles || 0,
      filesReviewed: llmFindings.findings?.length || 0,
      totalFindings: allFindings.length,
      severityCounts,
      overallScore: calculateOverallScore(severityCounts),
      riskLevel: calculateRiskLevel(severityCounts)
    },
    byFile: risksByFile,
    topIssues: topIssues.slice(0, 20),
    findings: allFindings,
    categories: repoStats.stats?.byCategoryCount || {},
    recommendations: generateRecommendations(allFindings)
  };
}

function calculateOverallScore(severityCounts) {
  // Score calculation: Blockers -50, Majors -20, Minors -5, Info 0
  // Max 100, min 0
  const blockerPenalty = (severityCounts.Blocker || 0) * 50;
  const majorPenalty = (severityCounts.Major || 0) * 20;
  const minorPenalty = (severityCounts.Minor || 0) * 5;

  const score = Math.max(0, 100 - blockerPenalty - majorPenalty - minorPenalty);
  return Math.round(score);
}

function calculateRiskLevel(severityCounts) {
  if (severityCounts.Blocker > 0) return "Critical";
  if (severityCounts.Major > 2) return "High";
  if (severityCounts.Major > 0) return "Medium";
  if (severityCounts.Minor > 5) return "Low";
  return "Minimal";
}

function generateRecommendations(findings) {
  const recommendations = [];
  const ruleIds = new Set();

  for (const finding of findings) {
    if (finding.ruleId && !ruleIds.has(finding.ruleId)) {
      ruleIds.add(finding.ruleId);
      recommendations.push({
        ruleId: finding.ruleId,
        title: finding.title,
        priority: finding.severity,
        occurrences: findings.filter((f) => f.ruleId === finding.ruleId).length,
        suggestion: finding.recommendation || "Review and remediate as needed"
      });
    }
  }

  return recommendations
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 15);
}

/**
 * Main orchestration function
 */
async function reviewRepository(repoRoot, options = {}) {
  const { maxFiles = 1000, progressCallback = null, llmPostFunction = null } =
    options;

  try {
    // Phase 1: Discovery & Classification
    if (progressCallback) {
      progressCallback({ phase: "discovery", status: "starting" });
    }
    const repo = await discoverAndClassifyRepo(repoRoot, maxFiles);

    if (progressCallback) {
      progressCallback({
        phase: "discovery",
        status: "complete",
        stats: repo.stats
      });
    }

    // Phase 2: Static Analysis
    if (progressCallback) {
      progressCallback({ phase: "static", status: "starting" });
    }
    const staticResults = await runStaticAnalysis(
      repo.allFiles,
      progressCallback
    );

    if (progressCallback) {
      progressCallback({ phase: "static", status: "complete" });
    }

    // Phase 2b: Rule Engine
    if (progressCallback) {
      progressCallback({ phase: "rules", status: "starting" });
    }
    const ruleResults = await runRuleAnalysis(repo.allFiles, progressCallback);
    if (progressCallback) {
      progressCallback({ phase: "rules", status: "complete" });
    }

    // Phase 3: LLM Review (if LLM function provided)
    let llmResults = { findings: [] };
    if (llmPostFunction) {
      if (progressCallback) {
        progressCallback({ phase: "llm", status: "starting" });
      }
      llmResults = await prepareLLMReviewBatch(
        repo.allFiles,
        options.llmConfig || {},
        llmPostFunction,
        progressCallback
      );
      if (progressCallback) {
        progressCallback({ phase: "llm", status: "complete" });
      }
    }

    // Phase 4: Report Generation
    const report = generateReport(staticResults, llmResults, ruleResults, repo);

    return {
      success: true,
      report,
      phases: {
        discovery: repo,
        static: staticResults,
        llm: llmResults
      }
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      report: null
    };
  }
}

module.exports = {
  discoverAndClassifyRepo,
  runStaticAnalysis,
  prepareLLMReviewBatch,
  generateReport,
  reviewRepository,
  calculateOverallScore,
  calculateRiskLevel,
  generateRecommendations
};
