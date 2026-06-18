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



function loadAllRules() {
  ensureRulesDir();

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

function deleteRule(ruleId) {
  ensureRulesDir();
  const file = path.join(RULES_DIR, `${ruleId}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  throw new Error(`Rule ${ruleId} not found`);
}

function deleteAllRules() {
  ensureRulesDir();
  const rules = loadAllRules();
  for (const r of rules) {
    const file = path.join(RULES_DIR, `${r.id}.json`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error(`Failed to delete rule file ${file}:`, err.message);
      }
    }
  }
  return true;
}

module.exports = {
  loadAllRules,
  saveRule,
  setRuleApproval,
  approveAllRules,
  disapproveAllRules,
  deleteRule,
  deleteAllRules,
  RULES_DIR
};
