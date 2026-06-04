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
  MISSING_INIT_METHOD: "IFS_PLSQL_001",
  DIRECT_TABLE_ACCESS: "IFS_PLSQL_002",
  MISSING_SECURITY_CHECK: "IFS_PLSQL_003",
  DML_IN_LOOP: "IFS_PLSQL_004",
  CURSOR_NAMING: "IFS_PLSQL_005",
  MULTI_LINE_COMMENT: "IFS_PLSQL_006",

  // Aurena rules
  PROJECTION_NAMING: "IFS_AURENA_001",
  ENTITY_SET_PLURAL: "IFS_AURENA_002",

  // Config rules
  HARDCODED_CREDENTIALS: "IFS_CONFIG_001",
  MISSING_PERMISSION_GRANT: "IFS_CONFIG_002",

  // Forms rules
  NAMING_CONVENTION: "IFS_FORMS_001",

  // General
  UPGRADE_RISK: "IFS_UPGRADE_001",
  OVERTAKE_RISK: "IFS_UPGRADE_002"
};

async function analyzePLSQL(fileContent, filePath) {
  const findings = [];
  const lines = fileContent.split("\n");
  const upper = fileContent.toUpperCase();

  // Check 1: Missing General_SYS.Init_Method in public methods
  if (!upper.includes("GENERAL_SYS.INIT_METHOD")) {
    // Only flag if this looks like a PL/SQL source file (has CREATE OR REPLACE PROCEDURE/FUNCTION)
    if (
      upper.includes("CREATE OR REPLACE PROCEDURE") ||
      upper.includes("CREATE OR REPLACE FUNCTION")
    ) {
      findings.push({
        ruleId: RULE_IDS.MISSING_INIT_METHOD,
        severity: "Major",
        confidence: 0.85,
        title: "Missing General_SYS.Init_Method call",
        explanation:
          "Public/protected PL/SQL methods should call General_SYS.Init_Method as first statement (except in Init methods themselves). This is a critical IFS standard for initialization and security hooks.",
        line: null
      });
    }
  }

  // Check 2: Direct table access (heuristic: SELECT * FROM without _INFO suffix)
  const directTableMatches = fileContent.match(/FROM\s+\w+\s+(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER)/gi);
  if (directTableMatches && directTableMatches.length > 0) {
    // Look for base table patterns (without _INFO, _API, _VW)
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
        line: null
      });
    }
  }

  // Check 3: DML in loops (heuristic)
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
        line: null
      });
    }
  }

  // Check 4: Multi-line comment style (/* */ instead of --)
  const multiLineComments = (fileContent.match(/\/\*[\s\S]*?\*\//g) || []).length;
  if (multiLineComments > 2) {
    findings.push({
      ruleId: RULE_IDS.MULTI_LINE_COMMENT,
      severity: "Minor",
      confidence: 0.7,
      title: "Excessive multi-line comments (/* */)",
      explanation:
        "IFS build/deployment may have issues with multi-line comments in certain contexts. Prefer single-line comments (--).",
      line: null
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
        line: null
      });
    }
  }

  return findings;
}

async function analyzeProjection(fileContent, filePath) {
  const findings = [];
  const upper = fileContent.toUpperCase();

  // Check: Entity set pluralization
  if (!upper.includes("</entitySet")) {
    return findings; // Not a projection
  }

  // Look for singular entity set names (heuristic)
  const entitySetPattern = /<entitySet name="([^"]+)"/g;
  let match;
  while ((match = entitySetPattern.exec(fileContent)) !== null) {
    const name = match[1];
    // Simple heuristic: if doesn't end in 's' or 'ies', flag it
    if (!name.endsWith("s") && !name.endsWith("ies") && !name.endsWith("Service")) {
      findings.push({
        ruleId: RULE_IDS.ENTITY_SET_PLURAL,
        severity: "Minor",
        confidence: 0.6,
        title: `Entity set should be plural: "${name}"`,
        explanation:
          "Aurena entity sets should use plural names. Expected something like \"${name}s\".",
        line: null
      });
    }
  }

  return findings;
}

async function analyzeConfig(fileContent, filePath) {
  const findings = [];

  // Check 1: Hardcoded credentials
  if (
    fileContent.includes("password") &&
    (fileContent.includes('value="') || fileContent.includes("'")) &&
    !fileContent.includes("${") // Exclude templated values
  ) {
    findings.push({
      ruleId: RULE_IDS.HARDCODED_CREDENTIALS,
      severity: "Blocker",
      confidence: 0.8,
      title: "Possible hardcoded credentials in config",
      explanation:
        "Configuration files should not contain hardcoded passwords or secrets. Use environment variables, vault, or key management services.",
      line: null
    });
  }

  // Check 2: Missing permission grants
  if (fileContent.includes("permission") && !fileContent.includes("grant")) {
    findings.push({
      ruleId: RULE_IDS.MISSING_PERMISSION_GRANT,
      severity: "Major",
      confidence: 0.6,
      title: "Projection permission defined but no explicit grant",
      explanation:
        "If new projections or sensitive operations are added, ensure permission grants are defined. Review security requirements.",
      line: null
    });
  }

  return findings;
}

async function analyzeFile(fileContent, filePath, category) {
  let findings = [];

  // Always check for upgrade risks (generic)
  if (fileContent.includes("OVERTAKE") || fileContent.includes("override_")) {
    findings.push({
      ruleId: RULE_IDS.OVERTAKE_RISK,
      severity: "Major",
      confidence: 0.75,
      title: "Possible overtake pattern detected",
      explanation:
        "Direct 'overtake' patterns are considered upgrade-risky. Consider using layered customization, extensions, or configuration instead.",
      line: null
    });
  }

  // Category-specific analysis
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
    // Only analyze text-like files
    if (file.size > 5 * 1024 * 1024) {
      // Skip files > 5MB
      return { file, findings: [], error: "File too large" };
    }

    const content = await readfileAsync(file.fullPath, "utf-8");
    const findings = [];

    // Run standard analysis
    const standardFindings = await analyzeFile(content, file.path, file.category);
    findings.push(...standardFindings);

    // Run syntax validation (PL/SQL, Marble, etc.) using already-read content
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
