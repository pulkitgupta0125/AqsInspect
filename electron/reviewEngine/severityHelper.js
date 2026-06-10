/**
 * Severity Normalization Helper
 * Standardizes severity levels based on user-defined code review rules:
 * - Blocker: Compile failures, critical security exploits, mismatched blocks, unclosed strings/comments.
 * - Major: Core feature functional issues, financial calculation bugs, data corruption, key performance bottlenecks.
 * - Minor: Edge-case logic bugs, missing non-critical validation, formatting issues.
 * - Info: Naming conventions, style violations, logging improvements, cosmetic/typo, unused variables.
 */

function normalizeSeverity(finding) {
  if (!finding) return "Info";
  
  const raw = String(finding.severity || finding.level || "").toLowerCase();
  
  // Default raw mapping
  const map = {
    blocker: "Blocker",
    critical: "Blocker",
    high: "Blocker",
    major: "Major",
    medium: "Major",
    minor: "Minor",
    low: "Minor",
    info: "Info",
    informational: "Info",
    trivial: "Info"
  };

  let norm = map[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Info");

  const title = String(finding.title || "").toLowerCase();
  const explanation = String(finding.explanation || "").toLowerCase();
  const text = `${title} ${explanation} ${finding.matchText || ""}`.toLowerCase();
  const ruleId = String(finding.ruleId || "").toUpperCase();

  // 1. Info / Trivial Checks (naming conventions, style, cosmetic, unused variables, logging)
  const infoKeywords = [
    "naming", "convention", "prefix", "suffix", "plural", "plurality", 
    "style violation", "formatting", "cosmetic", "typo", "spelling",
    "unused variable", "unused parameter", "logging improvement", 
    "refactoring suggestion", "unused import", "extra spaces", "indentation",
    "comment style", "comment format", "excessive comments"
  ];
  
  // 2. Blocker Checks (compile/build errors, severe security, mismatched blocks, unclosed string/comment literals)
  const blockerKeywords = [
    "compile failure", "build failure", "compilation error", "compile error",
    "syntax error", "mismatched begin/end", "unclosed string", "unclosed comment",
    "missing semicolon", "authentication bypass", "auth bypass", "sql injection",
    "hardcoded credentials", "hardcoded password", "hardcoded api key", "hardcoded secret"
  ];

  // 3. Major Checks (financial calculation, wrong calculations, data inconsistency, incorrect result, performance degradation/leaks)
  const majorKeywords = [
    "calculation error", "wrong calculation", "data corruption", "data inconsistency",
    "incorrect result", "dml in loop", "dml inside loop", "performance degradation",
    "cursor leak", "unclosed cursor", "resource leak", "security check missing", "missing security check"
  ];

  // 4. Minor Checks (edge-case failure, slight formatting/logic imperfections, validation missing)
  const minorKeywords = [
    "edge case", "edge-case", "minor performance", "default value", 
    "validation missing", "missing validation"
  ];

  const isInfo = infoKeywords.some(kw => text.includes(kw)) ||
                 ruleId.includes("NAME") ||
                 title.includes("naming") ||
                 title.includes("plural") ||
                 title.includes("comment") ||
                 title.includes("unused") ||
                 title.includes("spelling") ||
                 title.includes("typo") ||
                 explanation.includes("naming") ||
                 explanation.includes("spelling");

  const isBlocker = blockerKeywords.some(kw => text.includes(kw)) ||
                    ruleId.includes("SYNTAX") ||
                    ruleId.includes("SEC-001") || 
                    title.includes("syntax") ||
                    title.includes("mismatched begin") ||
                    title.includes("unclosed") ||
                    title.includes("missing semicolon") ||
                    title.includes("hardcoded credentials") ||
                    title.includes("auth bypass") ||
                    title.includes("sql injection") ||
                    explanation.includes("syntax error") ||
                    explanation.includes("compile");

  const isMajor = majorKeywords.some(kw => text.includes(kw)) ||
                  ruleId.includes("PERF-004") ||
                  title.includes("calculation") ||
                  title.includes("dml in loop") ||
                  title.includes("cursor leak") ||
                  title.includes("data inconsistency") ||
                  title.includes("incorrect result") ||
                  explanation.includes("dml in loop") ||
                  explanation.includes("performance degradation");

  const isMinor = minorKeywords.some(kw => text.includes(kw)) ||
                  title.includes("minor") ||
                  title.includes("edge case") ||
                  explanation.includes("minor performance") ||
                  explanation.includes("validation missing");

  if (isBlocker) {
    norm = "Blocker";
  } else if (isMajor) {
    norm = "Major";
  } else if (isMinor) {
    norm = "Minor";
  } else if (isInfo) {
    norm = "Info";
  }

  return norm;
}

module.exports = {
  normalizeSeverity
};
