/**
 * Static Analyzer Module
 * Pass-1 linting: fast rule-based checks without LLM
 * Detects obvious issues: missing General_SYS.Init_Method, naming conventions, syntax errors, etc.
 */

const fs = require("fs");
const { promisify } = require("util");
const readfileAsync = promisify(fs.readFile);
const { FILE_CATEGORIES } = require("./fileClassifier");
const syntaxValidator = require("./syntaxValidator");

const RULE_IDS = {
  // PL/SQL rules
  MISSING_INIT_METHOD: "NAME-004",
  INIT_METHOD_PROHIBITED: "SEC-002",
  DIRECT_TABLE_ACCESS: "UPG-002",
  MISSING_SECURITY_CHECK: "SEC-001",
  DML_IN_LOOP: "PERF-004",
  CURSOR_NAMING: "NAME-001",
  MULTI_LINE_COMMENT: "NAME-001",

  // Aurena rules
  PROJECTION_NAMING: "NAME-001",
  ENTITY_SET_PLURAL: "NAME-001",

  // Config rules
  HARDCODED_CREDENTIALS: "SEC-001",
  MISSING_PERMISSION_GRANT: "SEC-001",

  // Forms rules
  NAMING_CONVENTION: "NAME-001",

  // General
  UPGRADE_RISK: "UPG-002",
  OVERTAKE_RISK: "ARCH-003"
};

const RULE_CLASSIFICATIONS = {
  [RULE_IDS.MISSING_INIT_METHOD]: "IFS_AQS",
  [RULE_IDS.INIT_METHOD_PROHIBITED]: "IFS_AQS",
  [RULE_IDS.DIRECT_TABLE_ACCESS]: "IFS_AQS",
  [RULE_IDS.MISSING_SECURITY_CHECK]: "IFS_AQS",
  [RULE_IDS.DML_IN_LOOP]: "ORACLE",
  [RULE_IDS.CURSOR_NAMING]: "IFS_AQS",
  [RULE_IDS.MULTI_LINE_COMMENT]: "IFS_AQS",
  [RULE_IDS.PROJECTION_NAMING]: "IFS_ERP",
  [RULE_IDS.ENTITY_SET_PLURAL]: "IFS_AQS",
  [RULE_IDS.HARDCODED_CREDENTIALS]: "IFS_ERP",
  [RULE_IDS.MISSING_PERMISSION_GRANT]: "IFS_ERP",
  [RULE_IDS.NAMING_CONVENTION]: "IFS_ERP",
  [RULE_IDS.UPGRADE_RISK]: "IFS_AQS",
  [RULE_IDS.OVERTAKE_RISK]: "IFS_AQS"
};

async function analyzePLSQL(fileContent, filePath) {
  const findings = [];
  const upper = fileContent.toUpperCase();

  // Check 1: General_SYS.Init_Method constraints (prohibited in .plsql, required in traditional .apy/.api)
  const isPlsqlExt = String(filePath || "").toLowerCase().endsWith(".plsql");
  if (isPlsqlExt) {
    if (upper.includes("GENERAL_SYS.INIT_METHOD")) {
      findings.push({
        ruleId: RULE_IDS.INIT_METHOD_PROHIBITED,
        severity: "Blocker",
        confidence: 0.95,
        title: "General_SYS.Init_Method prohibited in .plsql files",
        explanation: "General_SYS.Init_Method call detected in a .plsql file. In IFS Cloud, initialization is generated automatically; manual invocation is prohibited.",
        line: null,
        classification: RULE_CLASSIFICATIONS[RULE_IDS.INIT_METHOD_PROHIBITED]
      });
    }
  } else {
    if (!upper.includes("GENERAL_SYS.INIT_METHOD")) {
      if (
        upper.includes("CREATE OR REPLACE PROCEDURE") ||
        upper.includes("CREATE OR REPLACE FUNCTION")
      ) {
        findings.push({
          ruleId: RULE_IDS.MISSING_INIT_METHOD,
          severity: "Major",
          confidence: 0.85,
          title: "Missing General_SYS.Init_Method call",
          explanation: "Public or protected traditional PL/SQL methods must call General_SYS.Init_Method as the first statement for proper security context initialization.",
          line: null,
          classification: RULE_CLASSIFICATIONS[RULE_IDS.MISSING_INIT_METHOD]
        });
      }
    }
  }

  // Check 2: Direct table access
  const directTableMatches = fileContent.match(/FROM\s+\w+\s+(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER)/gi);
  if (directTableMatches && directTableMatches.length > 0) {
    const baseTablePattern = /FROM\s+([A-Z_][A-Z0-9_]*)\s+(?!.*(_INFO|_API|_VW))/gi;
    const baseMatches = fileContent.match(baseTablePattern);
    if (baseMatches && baseMatches.length > 0) {
      findings.push({
        ruleId: RULE_IDS.DIRECT_TABLE_ACCESS,
        severity: "Major",
        confidence: 0.6,
        title: "Possible direct base table access",
        explanation:
          "Prefer secured views (*_INFO) or standard APIs when available. Direct base table access may bypass security filters. Confirm this is intentional.",
        line: null,
        classification: RULE_CLASSIFICATIONS[RULE_IDS.DIRECT_TABLE_ACCESS]
      });
    }
  }

  // Check 3: DML in loops
  const hasLoop = upper.includes("FOR ") || upper.includes("WHILE ");
  if (hasLoop) {
    const dmlInLoop =
      fileContent.match(/FOR\s.*(?:INSERT|UPDATE|DELETE|MERGE)/) ||
      fileContent.match(/WHILE\s.*(?:INSERT|UPDATE|DELETE|MERGE)/i);
    if (dmlInLoop) {
      findings.push({
        ruleId: RULE_IDS.DML_IN_LOOP,
        severity: "Major",
        confidence: 0.7,
        title: "Potential DML in loop (performance risk)",
        explanation:
          "DML statements (INSERT, UPDATE, DELETE) inside loops can cause severe performance issues. Consider bulk operations or rewriting the logic.",
        line: null,
        classification: RULE_CLASSIFICATIONS[RULE_IDS.DML_IN_LOOP]
      });
    }
  }

  // Check 4: Multi-line comment style
  const multiLineComments = (fileContent.match(/\/\*[\s\S]*?\*\//g) || []).length;
  if (multiLineComments > 2) {
    findings.push({
      ruleId: RULE_IDS.MULTI_LINE_COMMENT,
      severity: "Minor",
      confidence: 0.7,
      title: "Excessive multi-line comments (/* */)",
      explanation:
        "IFS build/deployment may have issues with multi-line comments in certain contexts. Prefer single-line comments (--).",
      line: null,
      classification: RULE_CLASSIFICATIONS[RULE_IDS.MULTI_LINE_COMMENT]
    });
  }

  // Check 5: Naming conventions for cursors
  const cursorDecl = fileContent.match(/CURSOR\s+(\w+)/gi);
  if (cursorDecl) {
    const badCursors = cursorDecl.filter((c) => !c.match(/CURSOR\s+c_/i));
    if (badCursors.length > 0) {
      findings.push({
        ruleId: RULE_IDS.CURSOR_NAMING,
        severity: "Minor",
        confidence: 0.6,
        title: "Cursor naming convention (should use c_ prefix)",
        explanation:
          "IFS standard: cursor variables should be prefixed with 'c_' for clarity. Found cursors without this prefix.",
        line: null,
        classification: RULE_CLASSIFICATIONS[RULE_IDS.CURSOR_NAMING]
      });
    }
  }

  return findings;
}

async function analyzeProjection(fileContent, filePath) {
  const findings = [];
  const upper = fileContent.toUpperCase();

  if (!upper.includes("</entitySet")) {
    return findings;
  }

  const entitySetPattern = /<entitySet name="([^"]+)"/g;
  let match;
  while ((match = entitySetPattern.exec(fileContent)) !== null) {
    const name = match[1];
    if (!name.endsWith("s") && !name.endsWith("ies") && !name.endsWith("Service")) {
      findings.push({
        ruleId: RULE_IDS.ENTITY_SET_PLURAL,
        severity: "Minor",
        confidence: 0.6,
        title: `Entity set should be plural: "${name}"`,
        explanation:
          "Aurena entity sets should use plural names. Expected something like \"${name}s\".",
        line: null,
        classification: RULE_CLASSIFICATIONS[RULE_IDS.ENTITY_SET_PLURAL]
      });
    }
  }

  return findings;
}

async function analyzeConfig(fileContent, filePath) {
  const findings = [];

  if (
    fileContent.includes("password") &&
    (fileContent.includes('value="') || fileContent.includes("'")) &&
    !fileContent.includes("${")
  ) {
    findings.push({
      ruleId: RULE_IDS.HARDCODED_CREDENTIALS,
      severity: "Blocker",
      confidence: 0.8,
      title: "Possible hardcoded credentials in config",
      explanation:
        "Configuration files should not contain hardcoded passwords or secrets. Use environment variables, vault, or key management services.",
      line: null,
      classification: RULE_CLASSIFICATIONS[RULE_IDS.HARDCODED_CREDENTIALS]
    });
  }

  if (fileContent.includes("permission") && !fileContent.includes("grant")) {
    findings.push({
      ruleId: RULE_IDS.MISSING_PERMISSION_GRANT,
      severity: "Major",
      confidence: 0.6,
      title: "Projection permission defined but no explicit grant",
      explanation:
        "If new projections or sensitive operations are added, ensure permission grants are defined. Review security requirements.",
      line: null,
      classification: RULE_CLASSIFICATIONS[RULE_IDS.MISSING_PERMISSION_GRANT]
    });
  }

  return findings;
}

async function analyzeFile(fileContent, filePath, category) {
  let findings = [];

  if (fileContent.includes("OVERTAKE") || fileContent.includes("override_")) {
    findings.push({
      ruleId: RULE_IDS.OVERTAKE_RISK,
      severity: "Major",
      confidence: 0.75,
      title: "Possible overtake pattern detected",
      explanation:
        "Direct 'overtake' patterns are considered upgrade-risky. Consider using layered customization, extensions, or configuration instead.",
      line: null,
      classification: RULE_CLASSIFICATIONS[RULE_IDS.OVERTAKE_RISK]
    });
  }

  switch (category) {
    case FILE_CATEGORIES.PLSQL:
    case FILE_CATEGORIES.VIEWS:
      findings = findings.concat(await analyzePLSQL(fileContent, filePath));
      break;
    case FILE_CATEGORIES.PROJECTION:
      findings = findings.concat(await analyzeProjection(fileContent, filePath));
      break;
    case FILE_CATEGORIES.CONFIG:
      findings = findings.concat(await analyzeConfig(fileContent, filePath));
      break;
  }

  return findings;
}

async function staticAnalyzeFile(file) {
  try {
    if (file.size > 5 * 1024 * 1024) {
      return { file, findings: [], error: "File too large" };
    }

    const content = await readfileAsync(file.fullPath, "utf-8");
    const findings = [];

    const standardFindings = await analyzeFile(content, file.path, file.category);
    findings.push(...standardFindings);

    const syntaxFindings = await syntaxValidator.validateFileContent(file, content);
    if (syntaxFindings.findings && syntaxFindings.findings.length > 0) {
      findings.push(...syntaxFindings.findings);
    }

    return { file, findings, error: null };
  } catch (e) {
    return { file, findings: [], error: e.message };
  }
}

module.exports = {
  staticAnalyzeFile,
  analyzeFile,
  analyzePLSQL,
  analyzeProjection,
  analyzeConfig,
  RULE_IDS
};
