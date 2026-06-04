/**
 * PL/SQL and IFS Syntax Validator
 * Performs syntactic analysis and IFS-specific code pattern validation
 * Reference: docs.ifs.com, IFS Community Best Practices
 */

const fs = require("fs");
const { promisify } = require("util");
const readfileAsync = promisify(fs.readFile);

/**
 * PL/SQL Syntax Validation
 */
function validatePLSQLSyntax(fileContent, filePath) {
  const findings = [];
  const lines = fileContent.split("\n");
  const upper = fileContent.toUpperCase();

  // Check 1: Unclosed blocks (BEGIN/END matching)
  const beginCount = (upper.match(/\bBEGIN\b/g) || []).length;
  const endCount = (upper.match(/\bEND\b/g) || []).length;

  if (beginCount !== endCount) {
    findings.push({
      severity: "Blocker",
      confidence: 0.9,
      title: "Mismatched BEGIN/END blocks",
      explanation: `Found ${beginCount} BEGIN statements but ${endCount} END statements. This will cause compilation errors.`,
      ruleId: "IFS_SYNTAX_001",
      line: null
    });
  }

  // Check 2: Missing semicolons at procedure/function end
  const procEndPattern = /END\s+[\w_]+\s*[;]?\s*$/gim;
  const lines_with_procedure_end = fileContent.split("\n").filter((line) => /END\s+\w+\s*$/i.test(line));
  const missing_semicolons = lines_with_procedure_end.filter((line) => !/;$/.test(line.trim()));

  if (missing_semicolons.length > 0) {
    findings.push({
      severity: "Major",
      confidence: 0.85,
      title: "Missing semicolons after END statement",
      explanation: `Found ${missing_semicolons.length} END statements without trailing semicolon. PL/SQL requires semicolon after procedure/function definition.`,
      ruleId: "IFS_SYNTAX_002",
      line: null
    });
  }

  // Check 3: Unclosed quotes (string literals)
  const singleQuotes = (fileContent.match(/'/g) || []).length;
  const doubleQuotes = (fileContent.match(/"/g) || []).length;

  if (singleQuotes % 2 !== 0) {
    findings.push({
      severity: "Blocker",
      confidence: 0.95,
      title: "Unclosed string literal (single quotes)",
      explanation: "Odd number of single quotes detected. String literals must be properly closed.",
      ruleId: "IFS_SYNTAX_003",
      line: null
    });
  }

  // Check 4: Unclosed comments (/* ... */)
  const openComments = (fileContent.match(/\/\*/g) || []).length;
  const closeComments = (fileContent.match(/\*\//g) || []).length;

  if (openComments !== closeComments) {
    findings.push({
      severity: "Blocker",
      confidence: 0.9,
      title: "Unclosed comment block",
      explanation: `Found ${openComments} comment opens but ${closeComments} comment closes. Comments must be properly terminated.`,
      ruleId: "IFS_SYNTAX_004",
      line: null
    });
  }

  // Check 5: Invalid exception handling syntax
  const exceptionPattern = /EXCEPTION\s+WHEN\s+(\w+)\s+THEN/gi;
  let match;
  const invalidExceptions = [];

  while ((match = exceptionPattern.exec(fileContent)) !== null) {
    const exceptionName = match[1].toUpperCase();
    // Valid IFS exceptions
    const validExceptions = [
      "NO_DATA_FOUND",
      "TOO_MANY_ROWS",
      "VALUE_ERROR",
      "DUP_VAL_ON_INDEX",
      "INVALID_CURSOR",
      "NOT_LOGGED_ON",
      "ACCESS_INTO_NULL",
      "OTHERS"
    ];

    if (!validExceptions.includes(exceptionName) && !exceptionName.startsWith("E_")) {
      invalidExceptions.push(exceptionName);
    }
  }

  if (invalidExceptions.length > 0) {
    findings.push({
      severity: "Major",
      confidence: 0.75,
      title: "Unrecognized exception names",
      explanation: `Found exceptions: ${invalidExceptions.join(", ")}. Verify these are valid PL/SQL exceptions or IFS custom exceptions (prefix E_).`,
      ruleId: "IFS_SYNTAX_005",
      line: null
    });
  }

  // Check 6: Procedure/Function parameter validation
  const procPattern = /CREATE\s+OR\s+REPLACE\s+(?:PROCEDURE|FUNCTION)\s+(\w+)\s*\(\s*([^)]*)\s*\)/gi;
  const procMatches = fileContent.matchAll(procPattern);

  for (const procMatch of procMatches) {
    const procName = procMatch[1];
    const params = procMatch[2];

    // Check for missing parameter mode (IN/OUT/IN OUT)
    const paramList = params.split(",").map((p) => p.trim()).filter((p) => p);

    for (const param of paramList) {
      // Should have IN, OUT, or IN OUT
      if (!/\b(IN|OUT|IN\s+OUT)\b/i.test(param)) {
        findings.push({
          severity: "Minor",
          confidence: 0.7,
          title: `Parameter mode missing in ${procName}`,
          explanation: `Parameter "${param.substring(0, 30)}" appears to lack explicit IN/OUT mode. Explicit modes improve code clarity.`,
          ruleId: "IFS_SYNTAX_006",
          line: null
        });
        break; // Report once per procedure
      }
    }
  }

  // Check 7: Variable declaration syntax
  const varDeclPattern = /(\w+)\s+([\w\.]+)\s*(?:;|:=|,)/g;
  const invalidVarDeclMatches = fileContent.match(/\b(\d+\w+)\s+/g); // Variables starting with numbers

  if (invalidVarDeclMatches && invalidVarDeclMatches.length > 0) {
    findings.push({
      severity: "Blocker",
      confidence: 0.95,
      title: "Invalid variable names (starting with numbers)",
      explanation: "PL/SQL variable names cannot start with numbers. Rename to follow naming conventions (e.g., v_count instead of 1_count).",
      ruleId: "IFS_SYNTAX_007",
      line: null
    });
  }

  // Check 8: Missing RETURN statement in functions
  const functionDefs = fileContent.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+\w+[^A-Z]*?END\s+\w+/gis) || [];
  for (const funcDef of functionDefs) {
    if (!/\bRETURN\b/i.test(funcDef)) {
      findings.push({
        severity: "Blocker",
        confidence: 0.9,
        title: "Function missing RETURN statement",
        explanation: "Functions must have at least one RETURN statement. Missing RETURN will cause compilation error.",
        ruleId: "IFS_SYNTAX_008",
        line: null
      });
      break;
    }
  }

  // Check 9: Pragma syntax validation
  const pragmaPattern = /PRAGMA\s+(\w+)\s*\((.*?)\);/gi;
  const validPragmas = ["EXCEPTION_INIT", "AUTONOMOUS_TRANSACTION", "RESTRICT_REFERENCES", "INLINE", "UDF"];

  while ((match = pragmaPattern.exec(fileContent)) !== null) {
    const pragmaName = match[1].toUpperCase();
    if (!validPragmas.includes(pragmaName)) {
      findings.push({
        severity: "Minor",
        confidence: 0.6,
        title: `Unrecognized PRAGMA: ${pragmaName}`,
        explanation: `PRAGMA ${pragmaName} is not a standard Oracle PL/SQL pragma. Verify it is valid for your IFS version.`,
        ruleId: "IFS_SYNTAX_009",
        line: null
      });
    }
  }

  return findings;
}

/**
 * IFS Logical Error Patterns
 */
function validateIFSLogicalErrors(fileContent, filePath) {
  const findings = [];
  const upper = fileContent.toUpperCase();

  // Check 1: Missing null checks before dereferencing
  const refPattern = /(\w+)\s*\.\s*(\w+)\s*(?:=|;)/gi;
  if (fileContent.match(refPattern)) {
    // Check if preceded by null check
    const lines = fileContent.split("\n");
    for (let i = 1; i < lines.length; i++) {
      if (refPattern.test(lines[i]) && !lines[i - 1].match(/IF\s+\w+\s+IS\s+NOT\s+NULL/i)) {
        findings.push({
          severity: "Major",
          confidence: 0.65,
          title: "Potential null pointer dereference",
          explanation:
            "Object property accessed without obvious null check. In IFS, always validate references before dereferencing to prevent runtime errors.",
          ruleId: "IFS_LOGIC_001",
          line: null
        });
        break;
      }
    }
  }

  // Check 2: Missing transaction control
  if (upper.includes("UPDATE") || upper.includes("DELETE") || upper.includes("INSERT")) {
    if (!upper.includes("COMMIT") && !upper.includes("ROLLBACK") && !upper.includes("AUTONOMOUS_TRANSACTION")) {
      findings.push({
        severity: "Major",
        confidence: 0.7,
        title: "DML without explicit transaction control",
        explanation:
          "INSERT/UPDATE/DELETE detected without COMMIT or ROLLBACK. Ensure transaction is properly managed (or use AUTONOMOUS_TRANSACTION if intentional).",
        ruleId: "IFS_LOGIC_002",
        line: null
      });
    }
  }

  // Check 3: Missing error logging before raising exception
  const raisePattern = /RAISE\s+(\w+)/gi;
  if (fileContent.match(raisePattern)) {
    // Check for Error_SYS.Record_General or similar logging before raise
    if (!upper.includes("ERROR_SYS") && !upper.includes("MESSAGE_SYS")) {
      findings.push({
        severity: "Minor",
        confidence: 0.6,
        title: "Exception raised without logging",
        explanation:
          "RAISE statement found but no IFS error logging (Error_SYS or Message_SYS). IFS best practice: log before raising for auditability.",
        ruleId: "IFS_LOGIC_003",
        line: null
      });
    }
  }

  // Check 4: Missing security authorization checks
  const sensitiveOps = ["DELETE", "DROP", "TRUNCATE", "ALTER"];
  for (const op of sensitiveOps) {
    if (fileContent.match(new RegExp(`\\b${op}\\b`, "gi"))) {
      if (!upper.includes("AUTHORIZE") && !upper.includes("PERMISSION") && !upper.includes("SECURITY")) {
        findings.push({
          severity: "Major",
          confidence: 0.75,
          title: `Sensitive operation (${op}) without apparent security check`,
          explanation: `${op} operation detected without obvious authorization check. IFS requires security validation for destructive operations.`,
          ruleId: "IFS_LOGIC_004",
          line: null
        });
        break;
      }
    }
  }

  // Check 5: Improper use of cursors (not closing)
  const cursorDeclPattern = /CURSOR\s+(\w+)/gi;
  const cursorMatches = fileContent.match(cursorDeclPattern) || [];
  if (cursorMatches.length > 0) {
    const closePattern = /CLOSE\s+/gi;
    const closeCount = (fileContent.match(closePattern) || []).length;

    if (closeCount < cursorMatches.length) {
      findings.push({
        severity: "Major",
        confidence: 0.7,
        title: "Potential unclosed cursors",
        explanation: `Found ${cursorMatches.length} cursor declarations but only ${closeCount} CLOSE statements. Unclosed cursors leak database resources.`,
        ruleId: "IFS_LOGIC_005",
        line: null
      });
    }
  }

  // Check 6: Missing ROWCOUNT validation after DML
  const dmlPattern = /(?:UPDATE|DELETE|INSERT)\s+[^;]+;/gi;
  if (fileContent.match(dmlPattern)) {
    if (!upper.includes("SQL%ROWCOUNT") && !upper.includes("ROW_COUNT")) {
      findings.push({
        severity: "Minor",
        confidence: 0.65,
        title: "DML executed without row count validation",
        explanation:
          "DML statements found but no SQL%ROWCOUNT check. Best practice: validate affected row count to ensure operation success.",
        ruleId: "IFS_LOGIC_006",
        line: null
      });
    }
  }

  // Check 7: Hardcoded literal values (potential data inconsistency)
  const hardcodedLiterals = fileContent.match(/'[A-Z0-9_]{3,}'|"[A-Z0-9_]{3,}"/g) || [];
  if (hardcodedLiterals.length > 5) {
    findings.push({
      severity: "Minor",
      confidence: 0.6,
      title: "Excessive hardcoded literals detected",
      explanation: `${hardcodedLiterals.length} hardcoded values found. Use constants or configuration tables for maintainability (IFS best practice).`,
      ruleId: "IFS_LOGIC_007",
      line: null
    });
  }

  // Check 8: Missing audit/logging calls
  if (upper.includes("INSERT") || upper.includes("UPDATE") || upper.includes("DELETE")) {
    if (!upper.includes("ACTIVITY_LOG") && !upper.includes("AUDIT") && !upper.includes("JOURNAL")) {
      findings.push({
        severity: "Minor",
        confidence: 0.6,
        title: "Data modification without apparent audit logging",
        explanation:
          "INSERT/UPDATE/DELETE detected without audit logging. IFS best practice: log all data modifications for compliance and debugging.",
        ruleId: "IFS_LOGIC_008",
        line: null
      });
    }
  }

  return findings;
}

/**
 * IFS-Specific Coding Standards Validation
 */
function validateIFSCodingStandards(fileContent, filePath) {
  const findings = [];
  const upper = fileContent.toUpperCase();

  // Check 1: Naming conventions (IFS uses v_variable, p_parameter, c_constant)
  const varPattern = /\bVARIABLE\s+(\w+)\s+/gi;
  const varsWithoutPrefix = fileContent.match(/\bVARIABLE\s+(?!v_|p_|c_|l_)(\w+)\s+/gi) || [];

  if (varsWithoutPrefix.length > 0) {
    findings.push({
      severity: "Minor",
      confidence: 0.7,
      title: "Variables not following IFS naming convention",
      explanation:
        "IFS variables should use prefixes: v_ (variable), p_ (parameter), c_ (cursor), l_ (local). Found variables without prefix.",
      ruleId: "IFS_STANDARDS_001",
      line: null
    });
  }

  // Check 2: Missing package body initialization
  if (upper.includes("CREATE OR REPLACE PACKAGE BODY")) {
    if (!upper.includes("BEGIN") || !upper.includes("END")) {
      findings.push({
        severity: "Minor",
        confidence: 0.6,
        title: "Package body without initialization section",
        explanation: "Package body should have BEGIN...END initialization section for package-level setup.",
        ruleId: "IFS_STANDARDS_002",
        line: null
      });
    }
  }

  // Check 3: Documentation (comments missing)
  const procedures = (fileContent.match(/PROCEDURE\s+\w+/gi) || []).length;
  const docComments = (fileContent.match(/--\s*\w+/g) || []).length;

  if (procedures > 2 && docComments < procedures) {
    findings.push({
      severity: "Minor",
      confidence: 0.6,
      title: "Insufficient inline documentation",
      explanation: `Found ${procedures} procedures but only ${docComments} comment lines. IFS requires clear documentation for maintenance.`,
      ruleId: "IFS_STANDARDS_003",
      line: null
    });
  }

  // Check 4: Performance: SELECT * usage
  if (fileContent.match(/SELECT\s+\*\s+FROM/gi)) {
    findings.push({
      severity: "Minor",
      confidence: 0.8,
      title: "SELECT * usage (performance risk)",
      explanation:
        "SELECT * is inefficient and fragile. Specify exact columns needed. IFS best practice: explicit column selection.",
      ruleId: "IFS_STANDARDS_004",
      line: null
    });
  }

  // Check 5: Using deprecated IFS functions
  const deprecatedFuncs = ["INTERPRET_BOOL_VAR", "GET_PERSON_INFO", "OLD_API_CALL"];
  for (const func of deprecatedFuncs) {
    if (fileContent.match(new RegExp(`\\b${func}\\b`, "gi"))) {
      findings.push({
        severity: "Major",
        confidence: 0.8,
        title: `Deprecated function used: ${func}`,
        explanation: `${func} is deprecated in modern IFS versions. Check docs.ifs.com for replacement.`,
        ruleId: "IFS_STANDARDS_005",
        line: null
      });
      break;
    }
  }

  return findings;
}

/**
 * Marble Language Syntax Validation
 */
function validateMarbleSyntax(fileContent, filePath) {
  const findings = [];
  const lines = fileContent.split("\n");

  // Check 1: Unmatched curly braces
  const openBraces = (fileContent.match(/\{/g) || []).length;
  const closeBraces = (fileContent.match(/\}/g) || []).length;

  if (openBraces !== closeBraces) {
    findings.push({
      severity: "Blocker",
      confidence: 0.95,
      title: "Unmatched Marble braces",
      explanation: `Found ${openBraces} opening braces but ${closeBraces} closing braces. Marble syntax requires matched brace pairs.`,
      ruleId: "MARBLE_SYNTAX_001",
      line: null
    });
  }

  // Check 2: Missing semicolons (Marble attribute definitions)
  const attributeLines = lines.filter((l) => /^\s*(public|private|protected)?\s*\w+\s+\w+\s*;?/.test(l));
  const missingSemicolons = attributeLines.filter((l) => !/;$/.test(l.trim()));

  if (missingSemicolons.length > 0) {
    findings.push({
      severity: "Major",
      confidence: 0.8,
      title: "Missing semicolons in Marble attribute definitions",
      explanation: `Marble attributes must end with semicolon. Found ${missingSemicolons.length} lines without semicolon.`,
      ruleId: "MARBLE_SYNTAX_002",
      line: null
    });
  }

  // Check 3: Invalid type declarations
  const validMarbleTypes = ["boolean", "integer", "decimal", "string", "date", "timestamp", "reference", "array"];
  const typePattern = /\b(\w+)\s+\w+\s*[;:=]/gi;

  for (const match of fileContent.matchAll(typePattern)) {
    const typeDecl = match[1].toLowerCase();
    if (
      !validMarbleTypes.includes(typeDecl) &&
      !typeDecl.match(/^\w+Collection$/) && // Collections
      !typeDecl.match(/^[A-Z]/) // Custom types (capitalized)
    ) {
      findings.push({
        severity: "Major",
        confidence: 0.7,
        title: `Unknown Marble type: ${typeDecl}`,
        explanation: `Type "${typeDecl}" is not a recognized Marble type. Verify spelling or that custom type is defined.`,
        ruleId: "MARBLE_SYNTAX_003",
        line: null
      });
      break;
    }
  }

  // Check 4: Method implementation completeness
  const methodDefs = (fileContent.match(/\bmethod\s+\w+\s*\(/gi) || []).length;
  const methodBodies = (fileContent.match(/\{[\s\S]*?\}/g) || []).length;

  if (methodDefs > methodBodies) {
    findings.push({
      severity: "Major",
      confidence: 0.75,
      title: "Method declarations without implementation bodies",
      explanation: `Found ${methodDefs} methods but only ${methodBodies} implementation bodies. All methods must have bodies in Marble.`,
      ruleId: "MARBLE_SYNTAX_004",
      line: null
    });
  }

  // Check 5: Invalid access modifiers
  const validModifiers = ["public", "private", "protected", "internal"];
  const modifierPattern = /\b(public|private|protected|internal|package|friend)\s+/gi;
  let match;

  while ((match = modifierPattern.exec(fileContent)) !== null) {
    const modifier = match[1].toLowerCase();
    if (!validModifiers.includes(modifier)) {
      findings.push({
        severity: "Minor",
        confidence: 0.7,
        title: `Invalid access modifier: ${modifier}`,
        explanation: `"${modifier}" is not a valid Marble access modifier. Use: public, private, protected, or internal.`,
        ruleId: "MARBLE_SYNTAX_005",
        line: null
      });
      break;
    }
  }

  return findings;
}

/**
 * Main validation entry point
 */
async function validateFileContent(file, contentOverride = null) {
  try {
    if (file.size > 5 * 1024 * 1024) {
      return { file, findings: [], error: "File too large" };
    }

    const content = contentOverride || (await readfileAsync(file.fullPath, "utf-8"));
    const findings = [];

    const extension = file.extension.toLowerCase();
    const isMarble = extension === ".marble" || extension === ".layout" || extension === ".form" || extension === ".ux";
    const isPLSQL =
      file.category === "plsql" || file.category === "views" || extension === ".plsql" || extension === ".sql";

    if (isPLSQL) {
      findings.push(...validatePLSQLSyntax(content, file.path));
      findings.push(...validateIFSLogicalErrors(content, file.path));
      findings.push(...validateIFSCodingStandards(content, file.path));
    }

    if (isMarble) {
      findings.push(...validateMarbleSyntax(content, file.path));
    }

    return { file, findings, error: null };
  } catch (e) {
    return { file, findings: [], error: e.message };
  }
}

module.exports = {
  validatePLSQLSyntax,
  validateIFSLogicalErrors,
  validateIFSCodingStandards,
  validateMarbleSyntax,
  validateFileContent
};
