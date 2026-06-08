/**
 * Hybrid Rule Engine
 * Combines deterministic enterprise rules with AI review decisions.
 * Loads rules dynamically from the rules directory and runs them.
 */
const fs = require('fs');
const path = require('path');
const store = require('../configStore');
const rulesStore = require('./rulesStore');
const { buildDynamicRulesFromIfsCore } = require('./dynamicRuleBuilder');

function evaluateRulesForFile(file, findings = [], content = "", prFiles = []) {
  const normalizedCategory = String(file.category || "other").toLowerCase();
  const allRules = rulesStore.loadAllRules();
  const approvedRules = allRules.filter(r => r.approved === true);
  const fileFindings = [];

  const cfg = (store && typeof store.getConfig === 'function') ? store.getConfig() : {};
  const corePath = String((cfg?.ifs?.corePath || cfg?.ifsCorePath) || "").trim();
  const customerPath = String((cfg?.ifs?.customerPath || cfg?.ifsCustomerPath) || "").trim();

  for (const rule of approvedRules) {
    // Check category compatibility
    if (rule.category !== "all" && rule.category !== normalizedCategory) {
      continue;
    }

    try {
      // 1. Custom evaluation for specific built-in rule IDs
      if (rule.id === "ARCH-001") {
        if (file.path) {
          const pathLower = file.path.toLowerCase().replace(/\\/g, '/');
          const hasCorePath = pathLower.startsWith('core/') || pathLower.includes('/core/');
          if (hasCorePath) {
            fileFindings.push({
              severity: rule.severity || "Blocker",
              confidence: 1.0,
              title: rule.title || "Core layer file modified in customer solution",
              explanation: `Core layer file ${file.path} was found in the customer solution repository. Modifying core layer files directly is prohibited.`,
              ruleId: rule.id,
              recommendation: rule.recommendation || "Move customizations to a Cust/Extension layer using overrides, events, or Custom Objects framework.",
              lineRange: null,
              matchText: file.path,
              classification: rule.classification || "IFS_AQS"
            });
          }
        }
        continue;
      }

      if (rule.id === "MCP_RULE_IFS_MISSING_CDB") {
        if (content) {
          const matches = Array.from(new Set((content.match(/([\w\-\/\\\.]+\.cdb)\b/gi) || [])));
          for (const m of matches) {
            let candidate = m.replace(/^[\\/]+/, "");
            // Clean git diff prefixes a/ and b/ if present
            if (/^[ab]\//i.test(candidate)) {
              candidate = candidate.substring(2);
            }
            
            let exists = false;
            
            // Check if present in the PR files (being introduced in the open PR!)
            if (prFiles && prFiles.length > 0) {
              const normCandidate = candidate.toLowerCase().replace(/\\/g, '/');
              const foundInPr = prFiles.some(pf => {
                let normPf = String(pf || "").toLowerCase().replace(/\\/g, '/');
                if (/^[ab]\//i.test(normPf)) {
                  normPf = normPf.substring(2);
                }
                return normPf === normCandidate || normPf.endsWith('/' + normCandidate);
              });
              if (foundInPr) {
                exists = true;
              }
            }
            
            // Check customer solution first (contains customized latest files)
            if (!exists && customerPath) {
              const fullCustomer = path.isAbsolute(candidate) ? candidate : path.join(customerPath, candidate);
              try {
                exists = fs.existsSync(fullCustomer);
              } catch (e) {
                exists = false;
              }
            }
            
            // Fallback to core standard solution
            if (!exists && corePath) {
              const fullCore = path.isAbsolute(candidate) ? candidate : path.join(corePath, candidate);
              try {
                exists = fs.existsSync(fullCore);
              } catch (e) {
                exists = false;
              }
            }

            if (!exists) {
              fileFindings.push({
                severity: rule.severity || "Blocker",
                confidence: 0.98,
                title: rule.title || "Missing referenced .cdb artifact",
                explanation: `Referenced CDB file ${m} was not found under configured Customer Solution path or IFS Core path. This may break runtime behavior.`,
                ruleId: rule.id,
                recommendation: rule.recommendation || "Ensure the referenced .cdb file is present in the Customer Solution or IFS Core solution.",
                lineRange: null,
                matchText: m,
                classification: rule.classification || "IFS_AQS"
              });
            }
          }
        }
        continue;
      }

      if (rule.id === "MCP_RULE_IFS_METADATA_MISSING") {
        // Handled at PR validation level, skip file-level alert
        continue;
      }

      // 2. Generic regex pattern evaluation
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
              classification: rule.classification || "IFS_ERP"
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

function mergeAIAndRuleFindings(aiFindings = [], ruleFindings = []) {
  const normalized = [...aiFindings];

  for (const ruleFinding of ruleFindings) {
    const duplicate = normalized.some(
      (finding) => finding.ruleId === ruleFinding.ruleId && finding.title === ruleFinding.title
    );
    if (!duplicate) {
      normalized.push(ruleFinding);
    }
  }

  return normalized;
}

function validatePRImpact(prDetails = {}, ifsMetadata = {}) {
  const findings = [];

  if (!prDetails || !prDetails.id) {
    findings.push({
      severity: "Blocker",
      confidence: 0.9,
      title: "Unable to resolve PR details",
      explanation: "The configured repository provider did not return valid PR metadata.",
      ruleId: "MCP_RULE_PR_DETAILS_MISSING",
      recommendation: "Verify repository connection settings and PR identifier.",
      lineRange: null,
      matchText: null,
      classification: "IFS_ERP"
    });
    return { findings, impact: null };
  }

  // Check if missing metadata rule is approved
  const allRules = rulesStore.loadAllRules();
  const metadataMissingRule = allRules.find(r => r.id === "MCP_RULE_IFS_METADATA_MISSING");
  
  if (metadataMissingRule?.approved && (!ifsMetadata || !ifsMetadata.data)) {
    findings.push({
      severity: metadataMissingRule.severity || "Info",
      confidence: 0.7,
      title: metadataMissingRule.title || "IFS metadata missing or unreachable",
      explanation: "No IFS OData metadata could be retrieved. PR impact analysis is limited to local code heuristics.",
      ruleId: "MCP_RULE_IFS_METADATA_MISSING",
      recommendation: metadataMissingRule.recommendation || "Verify IFS OData endpoint and credentials in Settings.",
      lineRange: null,
      matchText: null,
      classification: "IFS_ERP"
    });
  }

  const impact = {
    riskLevel: "Medium",
    impactedAreas: ["Repository", "IFS Integration"],
    summary: `PR ${prDetails.id} has been reviewed with ${prDetails.status || "unknown"} status.`
  };

  if (prDetails.status === "open") {
    impact.riskLevel = "High";
  }

  return { findings, impact };
}

module.exports = {
  evaluateRulesForFile,
  mergeAIAndRuleFindings,
  validatePRImpact
};
