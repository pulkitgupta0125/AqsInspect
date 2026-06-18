const fs = require("fs");
const path = require("path");

let app;
try {
  app = require("electron").app;
} catch (err) {
  app = null;
}

const MEMORY_FILE = path.join(
  app?.getPath ? app.getPath("userData") : process.cwd(),
  "reviews_memory.json"
);

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(MEMORY_FILE, "utf-8");
    return JSON.parse(data) || [];
  } catch (err) {
    console.error("Failed to load reviews memory:", err.message);
    return [];
  }
}

function saveMemory(memoryItems) {
  try {
    // Keep only the most recent 200 memory items
    const boundItems = memoryItems.slice(-200);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(boundItems, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write reviews memory:", err.message);
  }
}

function addReviewToMemory(filePath, codeSnippet, findings) {
  if (!codeSnippet || !findings || findings.length === 0) return;
  
  const memory = loadMemory();
  
  // Deduplicate: check if this code snippet is already stored
  const hash = String(codeSnippet).trim();
  const existingIdx = memory.findIndex(item => String(item.codeSnippet).trim() === hash);
  
  const newItem = {
    filePath: path.basename(filePath),
    codeSnippet,
    findings: findings.map(f => ({
      title: f.title,
      severity: f.severity,
      explanation: f.explanation,
      recommendation: f.recommendation,
      ruleId: f.ruleId
    })),
    timestamp: new Date().toISOString()
  };
  
  if (existingIdx >= 0) {
    memory[existingIdx] = newItem;
  } else {
    memory.push(newItem);
  }
  
  saveMemory(memory);
}

module.exports = {
  addReviewToMemory
};
