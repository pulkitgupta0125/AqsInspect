const fs = require('fs');
const path = require('path');

let app;
try {
  app = require('electron').app;
} catch (err) {
  app = null;
}

const RULES_DIR = path.join(
  app?.getPath ? app.getPath('userData') : process.cwd(),
  'rules'
);

function ensureRulesDir() {
  if (!fs.existsSync(RULES_DIR)) {
    fs.mkdirSync(RULES_DIR, { recursive: true });
  }
}

const BUILTIN_RULES = [
  {
    id: "ARCH-001",
    category: "all",
    severity: "Blocker",
    title: "Core layer file modified in customer solution",
    description: "Core layer files must not be modified in the customer repository. Use Cust/Extension layer.",
    recommendation: "Move customization to Cust/Extension layer using event actions, custom objects, or projection extensions. Remove core file from customer repository.",
    pattern: "", // Checked dynamically in ruleEngine.js
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "ARCH-002",
    category: "all",
    severity: "Blocker",
    title: "Customizations must use Cust/Extension layer",
    description: "Verify that customizations do not target the Core layer and set layer to 'Cust' or use extension naming.",
    recommendation: "Ensure package names end with '_Cust' or layer is explicitly set to 'Cust'.",
    pattern: "layer\\s*=\\s*(?!\"Cust\")[^;]+",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "ARCH-003",
    category: "all",
    severity: "Major",
    title: "Override preferred over Overtake for UI",
    description: "Overtake patterns are risky for upgrades. Preference is always to override existing components in Aurena/Marble.",
    recommendation: "Refactor overtake to a layered override or custom event if possible.",
    pattern: "overtake|override_",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "UPG-001",
    category: "plsql",
    severity: "Blocker",
    title: "No modifications to Foundation1 framework methods",
    description: "Modifications or custom hooks into Foundation1 framework (e.g. Fnd_Session_API) are prohibited.",
    recommendation: "Use standard APIs and custom events instead of modifying or overriding framework internals.",
    pattern: "\\b(Fnd_Session_API|Fnd_User_API|Fnd_Client_Session_API)\\b",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "UPG-003",
    category: "all",
    severity: "Major",
    title: "Avoid Oracle EE-exclusive features",
    description: "Oracle Enterprise Edition-exclusive features (such as partitioning, advanced compression) can break compatibility during online upgrades.",
    recommendation: "Use standard SQL features and indices. Consult database architect for approved partitioning.",
    pattern: "\\b(partition\\s+by|compress\\s+basic|compress\\s+for|parallel\\s+\\d+)\\b",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_ERP"
  },
  {
    id: "PERF-001",
    category: "views",
    severity: "Major",
    title: "No stored function calls in view definitions",
    description: "Using PL/SQL function calls inside SQL view SELECT statements causes serious performance issues due to context switching.",
    recommendation: "Join the underlying table/view directly or utilize custom indexing/materialized views.",
    pattern: "select\\s+.*\\b\\w+_api\\.\\w+",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "ORACLE"
  },
  {
    id: "PERF-004",
    category: "plsql",
    severity: "Major",
    title: "Use bulk operations for large datasets",
    description: "Database DML operations inside loops cause row-by-row processing overhead (Row-By-Agonizing-Row). Use bulk operations (BULK COLLECT, FORALL).",
    recommendation: "Refactor code to use FORALL or BULK COLLECT instead of row-by-row loops.",
    pattern: "for\\s+.*\\sin\\s+.*\\n[\\s\\S]{0,120}?\\b(insert|update|delete)\\b",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "ORACLE"
  },
  {
    id: "SEC-001",
    category: "plsql",
    severity: "Blocker",
    title: "Dynamic SQL must be approved",
    description: "EXECUTE IMMEDIATE and DBMS_SQL can expose the system to SQL injection. All dynamic SQL must be explicitly approved.",
    recommendation: "Use static SQL if possible, or ensure arguments are properly bound and sanitized.",
    pattern: "\\b(execute\\s+immediate|dbms_sql\\.execute)\\b",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "SEC-002",
    category: "plsql",
    severity: "Blocker",
    title: "General_SYS.Init_Method prohibited in .plsql files",
    description: "In IFS Cloud, initialization is generated automatically. Manual invocation of General_SYS.Init_Method in .plsql files is prohibited.",
    recommendation: "Remove manual General_SYS.Init_Method calls from .plsql files.",
    pattern: "general_sys\\.init_method",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "SEC-003",
    category: "all",
    severity: "Major",
    title: "No IFSAPP prefix on DB calls",
    description: "Hardcoding the schema prefix 'IFSAPP' is a security violation and restricts database portability.",
    recommendation: "Remove the 'ifsapp.' prefix; rely on schema search paths and synonym references.",
    pattern: "\\bifsapp\\.",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "NAME-001",
    category: "all",
    severity: "Minor",
    title: "Follow IFS naming standards",
    description: "Ensure objects, variables, cursors, and entity sets conform to IFS naming rules.",
    recommendation: "Check naming guidelines. Cursors should start with 'c_', local variables with 'v_' or 'l_', and entity sets should be plural.",
    pattern: "(cursor\\s+(?!c_)\\w+|entityset\\s+name=\"(?!.*s\"|.*ies\"|.*Service\")[^\"]+\")",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "DATA-001",
    category: "all",
    severity: "Major",
    title: "NULL comparisons must use IS NULL/IS NOT NULL",
    description: "Using standard comparison operators (= or !=) with NULL is invalid in SQL/PLSQL and always evaluates to NULL.",
    recommendation: "Change '= NULL' to 'IS NULL' and '!= NULL' to 'IS NOT NULL'.",
    pattern: "(=|!=|<>)\\s*null\\b",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "ORACLE"
  },
  {
    id: "DATA-002",
    category: "plsql",
    severity: "Major",
    title: "Global variables prohibited",
    description: "Declaring package-level global variables is prohibited as they persist across sessions and create state leaks.",
    recommendation: "Store state in context tables, temporary tables, or pass parameters explicitly.",
    pattern: "\\bg_\\w+\\s+\\w+;",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "CLOUD-001",
    category: "projection",
    severity: "Blocker",
    title: "Projection files must declare component and layer",
    description: "All Aurena projection files must declare their component and layer in the header definition.",
    recommendation: "Define component and layer attributes in the projection declaration block.",
    pattern: "", // Checked in ruleEngine / AI review
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_ERP"
  },
  {
    id: "I18N-001",
    category: "all",
    severity: "Minor",
    title: "String literals must not contain non-ASCII characters",
    description: "Hardcoded strings containing non-ASCII characters fail translation checks and localization pipeline rules.",
    recommendation: "Extract non-ASCII strings to translation files (.lng, .trs) or constant resources.",
    pattern: "[^\\x00-\\x7F]",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  },
  {
    id: "MCP_RULE_IFS_MISSING_CDB",
    category: "all",
    severity: "Blocker",
    title: "Referenced .cdb file missing in IFS core",
    description: "Detects references to .cdb artifacts and ensures they exist in the configured IFS customer or core paths.",
    recommendation: "Ensure the referenced .cdb file is present in the Customer Solution path or fall back to the Core path.",
    pattern: "([\\w\\-\\/\\\\\\.]+\\.cdb)",
    alertOnMissing: false,
    approved: true,
    source: "builtin",
    classification: "IFS_AQS"
  }
];

function initializeDefaultRules() {
  ensureRulesDir();

  // Clean up old deprecated built-in rule files
  const deprecatedRuleIds = [
    "MCP_RULE_PLSQL_INIT_METHOD",
    "MCP_RULE_DML_IN_LOOPS",
    "IFS_PLSQL_002",
    "IFS_PLSQL_005",
    "IFS_PLSQL_006",
    "IFS_AURENA_002",
    "IFS_CONFIG_001",
    "IFS_UPGRADE_002",
    "IFS_UPGRADE_001",
    "IFS_PLSQL_001",
    "IFS_PLSQL_003",
    "IFS_PLSQL_004",
    "IFS_AURENA_001",
    "IFS_CONFIG_002",
    "IFS_FORMS_001"
  ];
  for (const depId of deprecatedRuleIds) {
    const depFile = path.join(RULES_DIR, `${depId}.json`);
    if (fs.existsSync(depFile)) {
      try {
        fs.unlinkSync(depFile);
      } catch (err) {
        console.warn(`Failed to clean up deprecated rule file ${depFile}:`, err.message);
      }
    }
  }

  // Write new built-in rules (always overwrite so modifications apply)
  for (const rule of BUILTIN_RULES) {
    const file = path.join(RULES_DIR, `${rule.id}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(rule, null, 2));
    } catch (err) {
      console.error(`Failed to write builtin rule ${rule.id}:`, err.message);
    }
  }
}

function loadAllRules() {
  ensureRulesDir();
  // Ensure default rules exist
  initializeDefaultRules();

  const rules = [];
  try {
    const files = fs.readdirSync(RULES_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(RULES_DIR, f), 'utf-8');
          const ruleObj = JSON.parse(content);
          if (ruleObj && ruleObj.id) {
            rules.push(ruleObj);
          }
        } catch (e) {
          console.error(`Error loading rule file ${f}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error("Failed to read rules directory:", err.message);
  }
  return rules;
}

function saveRule(rule) {
  if (!rule || !rule.id) throw new Error("Invalid rule payload");
  ensureRulesDir();
  const file = path.join(RULES_DIR, `${rule.id}.json`);
  fs.writeFileSync(file, JSON.stringify(rule, null, 2));
  return true;
}

function setRuleApproval(ruleId, approvedStatus) {
  ensureRulesDir();
  const file = path.join(RULES_DIR, `${ruleId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Rule ${ruleId} not found`);
  }
  const rule = JSON.parse(fs.readFileSync(file, 'utf-8'));
  rule.approved = Boolean(approvedStatus);
  fs.writeFileSync(file, JSON.stringify(rule, null, 2));
  return rule;
}

function approveAllRules() {
  const rules = loadAllRules();
  for (const r of rules) {
    r.approved = true;
    saveRule(r);
  }
  return true;
}

function disapproveAllRules() {
  const rules = loadAllRules();
  for (const r of rules) {
    r.approved = false;
    saveRule(r);
  }
  return true;
}

module.exports = {
  loadAllRules,
  saveRule,
  setRuleApproval,
  approveAllRules,
  disapproveAllRules,
  RULES_DIR
};
