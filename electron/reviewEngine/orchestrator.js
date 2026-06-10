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

const ruleEngine = require("./ruleEngine");
const agents = require("./agents");
const configStore = require("../configStore");
const { normalizeSeverity } = require("./severityHelper");

const readfileAsync = promisify(fs.readFile);

// No local reviewCache or hashContent needed anymore

function getClassificationFallback(finding) {
  if (finding.classification && ["IFS_AQS", "ORACLE", "IFS_ERP"].includes(finding.classification)) {
    return finding.classification;
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

        findings.push({
          file,
          findings: fileFindings,
          summary: { score: 90 },
          cached: agentResult.cached || false
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

    const cfg = configStore.getConfig() || {};
    const isAiOnly = cfg?.mcp?.mode === "ai-only";
    const isRulesOnly = cfg?.mcp?.mode === "rules-only";

    let staticResults = { results: [], findings: [] };

    let ruleResults = { results: [], findings: [] };
    if (!isAiOnly) {
      if (progressCallback) {
        progressCallback({ phase: "rules", status: "starting" });
      }
      ruleResults = await runRuleAnalysis(repo.allFiles, progressCallback);
      if (progressCallback) {
        progressCallback({ phase: "rules", status: "complete" });
      }
    }

    let llmResults = { findings: [] };
    if (llmPostFunction && !isRulesOnly) {
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
  prepareLLMReviewBatch,
  generateReport,
  reviewRepository,
  calculateOverallScore,
  calculateRiskLevel,
  generateRecommendations
};
