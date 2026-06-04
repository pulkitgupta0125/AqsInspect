/**
 * Hybrid Rule Engine
 * Combines deterministic enterprise rules with AI review decisions.
 * This module is the enterprise validation layer for MCP analysis.
 */

const DEFAULT_RULES = [
  {
    id: "MCP_RULE_PLSQL_INIT_METHOD",
    category: "plsql",
    severity: "Major",
    title: "Ensure General_SYS.Init_Method is invoked in PL/SQL custom methods.",
    description:
      "Public or protected PL/SQL methods should initialize the General_SYS context before business logic.",
    evaluate: ({ file, findings, content }) => {
      const result = [];
      if (!content || !content.toLowerCase().includes("general_sys.init_method")) {
        result.push({
          severity: "Major",
          confidence: 0.85,
          title: "Missing General_SYS.Init_Method call",
          explanation:
            "This PL/SQL file does not appear to invoke General_SYS.Init_Method, which is required for IFS safe initialization.",
          ruleId: "MCP_RULE_PLSQL_INIT_METHOD",
          recommendation: "Add General_SYS.Init_Method on all public/protected execution paths.",
          lineRange: null,
          matchText: null
        });
      }
      return result;
    }
  },
  {
    id: "MCP_RULE_DML_IN_LOOPS",
    category: "plsql",
    severity: "Major",
    title: "Avoid DML inside loops.",
    description: "Database DML operations within loops can cause performance and locking issues.",
    evaluate: ({ content }) => {
      const result = [];
      if (content && /for\s+.*\sin\s+.*\n[\s\S]{0,120}?\b(insert|update|delete)\b/i.test(content)) {
        result.push({
          severity: "Major",
          confidence: 0.8,
          title: "Potential DML inside a loop",
          explanation:
            "Detected a possible INSERT, UPDATE, or DELETE statement within a loop construct. This may cause performance issues in IFS.",
          ruleId: "MCP_RULE_DML_IN_LOOPS",
          recommendation: "Refactor the logic to perform bulk DML operations outside of loops when possible.",
          lineRange: null,
          matchText: null
        });
      }
      return result;
    }
  },
  {
    id: "MCP_RULE_IFS_METADATA_MISSING",
    category: "all",
    severity: "Info",
    title: "IFS metadata is unavailable.",
    description: "Analyze impact with IFS metadata when integration is configured.",
    evaluate: ({ ifsMetadata }) => {
      if (!ifsMetadata || !ifsMetadata.data) {
        return [
          {
            severity: "Info",
            confidence: 0.6,
            title: "IFS metadata missing or unreachable",
            explanation:
              "No IFS OData metadata could be retrieved. PR impact analysis will be based on repository heuristics only.",
            ruleId: "MCP_RULE_IFS_METADATA_MISSING",
            recommendation: "Verify IFS OData endpoint and credentials in Settings.",
            lineRange: null,
            matchText: null
          }
        ];
      }
      return [];
    }
  }
];

function evaluateRulesForFile(file, findings = [], content = "") {
  const normalizedCategory = String(file.category || "other").toLowerCase();
  let allFindings = [];

  for (const rule of DEFAULT_RULES) {
    if (rule.category === "all" || rule.category === normalizedCategory) {
      try {
        allFindings = allFindings.concat(rule.evaluate({ file, findings, content }));
      } catch (err) {
        // rule evaluation should not crash the review pipeline
      }
    }
  }

  return allFindings;
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
      matchText: null
    });
    return { findings, impact: null };
  }

  if (!ifsMetadata || !ifsMetadata.data) {
    findings.push(...evaluateRulesForFile({ category: "all" }, [], "", ifsMetadata));
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
  validatePRImpact,
  DEFAULT_RULES
};
