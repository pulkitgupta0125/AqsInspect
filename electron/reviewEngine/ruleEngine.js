/**
 * Hybrid Rule Engine
 * Combines deterministic enterprise rules with AI review decisions.
 * Loads rules dynamically from the rules directory and runs them.
 */
const fs = require('fs');
const path = require('path');
const store = require('../configStore');
const rulesStore = require('./rulesStore');


function evaluateRulesForFile(file, findings = [], content = "", prFiles = []) {
  const cfg = (store && typeof store.getConfig === 'function') ? store.getConfig() : {};
  if (cfg?.mcp?.mode === "ai-only") {
    return [];
  }
  const normalizedCategory = String(file.category || "other").toLowerCase();
  const allRules = rulesStore.loadAllRules();
  const approvedRules = allRules.filter(r => r.approved === true);
  const fileFindings = [];

  const corePath = String((cfg?.ifs?.corePath || cfg?.ifsCorePath) || "").trim();
  const customerPath = String((cfg?.ifs?.customerPath || cfg?.ifsCustomerPath) || "").trim();

  const databaseCategories = ["plsql", "views", "db_script", "api", "entity"];
  for (const rule of approvedRules) {
    // Check category compatibility
    if (rule.category !== "all" && rule.category !== normalizedCategory) {
      continue;
    }

    // Exclude database-specific rules from non-database files
    if (rule.classification === "ORACLE" && !databaseCategories.includes(normalizedCategory)) {
      continue;
    }

    try {
      // Generic regex pattern evaluation
      if (rule.pattern && content) {
        try {
          const regex = new RegExp(rule.pattern, "i");
          const hasPattern = regex.test(content);

          const triggerAlert = (rule.alertOnMissing && !hasPattern) || (!rule.alertOnMissing && hasPattern);

          if (triggerAlert) {
            fileFindings.push({
              severity: rule.severity || "Major",
              confidence: 0.85,
              title: rule.title,
              explanation: rule.description,
              ruleId: rule.id,
              recommendation: rule.recommendation || "Follow IFS guidelines to remediate.",
              lineRange: null,
              matchText: null,
              classification: rule.classification || "IFS_ERP",
              subcategory: rule.subcategory,
              tags: rule.tags
            });
          }
        } catch (regexError) {
          console.warn(`Invalid regex pattern in rule ${rule.id}: ${rule.pattern}`);
        }
      }
    } catch (err) {
      console.error(`Error evaluating rule ${rule.id}:`, err.message);
    }
  }

  return fileFindings;
}

function validatePRImpact(prDetails = {}, ifsMetadata = {}) {
  const findings = [];
  const cfg = (store && typeof store.getConfig === 'function') ? store.getConfig() : {};
  if (cfg?.mcp?.mode === "ai-only") {
    return { findings, impact: null };
  }

  const impact = {
    riskLevel: "Medium",
    impactedAreas: ["Repository", "IFS Integration"],
    summary: prDetails && prDetails.id ? `PR ${prDetails.id} has been reviewed with ${prDetails.status || "unknown"} status.` : "PR details not available."
  };

  if (prDetails && prDetails.status === "open") {
    impact.riskLevel = "High";
  }

  return { findings, impact };
}

module.exports = {
  evaluateRulesForFile,
  validatePRImpact
};
