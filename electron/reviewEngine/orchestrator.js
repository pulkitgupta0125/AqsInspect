/**
 * Review Orchestrator Module
 * Coordinates file discovery, classification, multi-agent review,
 * and report generation with map-reduce consolidation for large repos
 */

const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const fileDiscovery = require("./fileDiscovery");
const fileClassifier = require("./fileClassifier");
const staticAnalyzer = require("./staticAnalyzer");
const ruleEngine = require("./ruleEngine");
const agents = require("./agents");

const readfileAsync = promisify(fs.readFile);

// Cache structure: { filePath: { hash, review } }
const reviewCache = {};

function hashContent(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function getClassificationFallback(finding) {
  if (finding.classification && ["IFS_AQS", "ORACLE", "IFS_ERP"].includes(finding.classification)) {
    return finding.classification;
  }
  const ruleId = String(finding.ruleId || "").toUpperCase();
  const title = String(finding.title || "").toUpperCase();
  const explanation = String(finding.explanation || "").toUpperCase();

  if (
    ruleId.includes("AQS") ||
    ruleId.includes("INIT_METHOD") ||
    ruleId.includes("TABLE_ACCESS") ||
    ruleId.includes("CURSOR_NAMING") ||
    ruleId.includes("COMMENT") ||
    ruleId.includes("PLURAL") ||
    ruleId.includes("STANDARDS") ||
    ruleId.includes("OVERTAKE") ||
    ruleId.includes("UPGRADE") ||
    ruleId.includes("CDB") ||
    title.includes("INIT_METHOD") ||
    title.includes("NAMING CONVENTION") ||
    title.includes("OVERTAKE") ||
    title.includes("DOCUMENTATION") ||
    explanation.includes("INIT_METHOD")
  ) {
    return "IFS_AQS";
  }

  if (
    ruleId.includes("SYNTAX") ||
    ruleId.includes("DML_IN_LOOP") ||
    ruleId.includes("LOGIC_001") || 
    ruleId.includes("LOGIC_002") || 
    ruleId.includes("LOGIC_005") || 
    ruleId.includes("LOGIC_006") || 
    ruleId.includes("LOGIC_007") || 
    title.includes("SYNTAX") ||
    title.includes("SEMICOLON") ||
    title.includes("BEGIN/END") ||
    title.includes("UNCLOSED") ||
    title.includes("PRAGMA") ||
    title.includes("EXCEPTION") ||
    title.includes("LOOP") ||
    title.includes("NULL POINTER") ||
    title.includes("CURSOR")
  ) {
    return "ORACLE";
  }

  return "IFS_ERP";
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
 * Phase 3: Multi-Agent Review
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
          phase: "agents",
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

        if (file.size > 15 * 1024) {
          findings.push({
            file,
            findings: [
              {
                severity: "Info",
                confidence: 1.0,
                title: "File too large for LLM review",
                explanation: `File size ${file.size} bytes exceeds 15KB limit. Review via static analysis only.`,
                ruleId: "SYS_FILE_TOO_LARGE",
                recommendation: "Split into smaller modules or use static analysis findings",
                classification: "IFS_ERP"
              }
            ],
            cached: false
          });
          continue;
        }

        // Delegate code review to the Multi-Agent System
        const agentResult = await agents.delegateReview(file, content, llmConfig, llmPostFunction);
        const fileFindings = (agentResult.findings || []).map((finding) => ({
          ...finding,
          file
        }));

        reviewCache[file.path] = {
          hash,
          review: { findings: fileFindings, summary: { score: 90 } }
        };

        findings.push({
          file,
          findings: fileFindings,
          summary: { score: 90 },
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

  function normalizeSeverity(finding) {
    if (!finding) return "Info";
    const raw = String(finding.severity || finding.level || "").toLowerCase();
    const map = {
      blocker: "Blocker",
      critical: "Blocker",
      high: "Blocker",
      major: "Major",
      medium: "Major",
      minor: "Minor",
      low: "Minor",
      info: "Info",
      informational: "Info"
    };

    let norm = map[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Info");

    const text = `${finding.title || ""} ${finding.explanation || ""} ${finding.matchText || ""}`.toLowerCase();
    const criticalKeywords = [
      "divide by zero",
      "division by zero",
      "null pointer",
      "nullreference",
      "null reference",
      "runtime error",
      "uncaught exception",
      "syntax error",
      "missing cdb",
      "missing cdb file",
      "missing cdb artifact",
      "stack overflow",
      "segmentation fault"
    ];

    for (const kw of criticalKeywords) {
      if (text.includes(kw)) {
        norm = "Blocker";
        break;
      }
    }

    return norm;
  }

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

  // Enforce 3-tier sorting hierarchy
  allFindings.forEach(f => {
    f.classification = f.classification || getClassificationFallback(f);
  });

  const classificationOrder = {
    "IFS_AQS": 1,
    "ORACLE": 2,
    "IFS_ERP": 3
  };

  allFindings.sort((a, b) => {
    const valA = classificationOrder[a.classification] || 99;
    const valB = classificationOrder[b.classification] || 99;
    return valA - valB;
  });

  // Aggregate statistics
  const severityCounts = { Blocker: 0, Major: 0, Minor: 0, Info: 0 };
  const risksByFile = {};
  const topIssues = [];

  for (const finding of allFindings) {
    const sev = normalizeSeverity(finding);
    finding.severity = sev;
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;

    const fileName = finding.file?.path || "unknown";
    if (!risksByFile[fileName]) {
      risksByFile[fileName] = [];
    }
    risksByFile[fileName].push(finding);

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

    if (progressCallback) {
      progressCallback({ phase: "rules", status: "starting" });
    }
    const ruleResults = await runRuleAnalysis(repo.allFiles, progressCallback);
    if (progressCallback) {
      progressCallback({ phase: "rules", status: "complete" });
    }

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
