const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let app;
try {
  app = require("electron").app;
} catch (err) {
  app = null;
}

const CACHE_FILE = path.join(
  app?.getPath ? app.getPath("userData") : process.cwd(),
  "reviews_cache.json"
);

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return {};
  }
  try {
    const data = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(data) || {};
  } catch (err) {
    console.error("Failed to load reviews cache:", err.message);
    return {};
  }
}

function saveCache(cacheData) {
  try {
    // Keep size in check, delete oldest entries if keys exceed 500
    const keys = Object.keys(cacheData);
    if (keys.length > 500) {
      const excess = keys.length - 500;
      for (let i = 0; i < excess; i++) {
        delete cacheData[keys[i]];
      }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write reviews cache:", err.message);
  }
}

function getCombinedHash(code, llmConfig, rulesList) {
  const configStore = require("../configStore");
  const cfg = configStore.getConfig() || {};
  const mcpMode = cfg?.mcp?.mode || "hybrid";
  const useCoreReference = cfg?.mcp?.useCoreReference !== false;
  const enableKnowledgeBase = cfg?.mcp?.enableKnowledgeBase || false;
  const knowledgePath = cfg?.mcp?.knowledgePath || "";

  const llmPart = llmConfig ? JSON.stringify({
    provider: llmConfig.provider,
    model: llmConfig.model,
    endpoint: llmConfig.endpoint,
    temperature: llmConfig.temperature,
    apiVersion: llmConfig.apiVersion
  }) : "";
  
  const rulesPart = Array.isArray(rulesList) 
    ? rulesList.filter(r => r.approved).map(r => `${r.id}:${r.approved}`).sort().join(",")
    : "";

  let knowledgePart = "";
  if (enableKnowledgeBase && knowledgePath) {
    try {
      if (fs.existsSync(knowledgePath) && fs.statSync(knowledgePath).isDirectory()) {
        const files = fs.readdirSync(knowledgePath);
        const fileMeta = files.map(f => {
          const fp = path.join(knowledgePath, f);
          const stat = fs.statSync(fp);
          return `${f}:${stat.size}:${stat.mtimeMs}`;
        }).sort().join(",");
        knowledgePart = `kb:${enableKnowledgeBase}:${knowledgePath}:${fileMeta}`;
      } else {
        knowledgePart = `kb:${enableKnowledgeBase}:${knowledgePath}:invalid`;
      }
    } catch (err) {
      knowledgePart = `kb:${enableKnowledgeBase}:${knowledgePath}:error:${err.message}`;
    }
  } else {
    knowledgePart = `kb:${enableKnowledgeBase}:disabled`;
  }

  const combinedString = `${code || ""}|||${llmPart}|||${rulesPart}|||${mcpMode}|||${useCoreReference}|||${knowledgePart}`;
  return crypto.createHash("sha256").update(combinedString).digest("hex");
}

function getCachedReview(code, llmConfig, rulesList) {
  const hash = getCombinedHash(code, llmConfig, rulesList);
  const cache = loadCache();
  return cache[hash] || null;
}

function cacheReview(code, llmConfig, rulesList, reviewResult) {
  if (!code || !reviewResult) return;
  const hash = getCombinedHash(code, llmConfig, rulesList);
  const cache = loadCache();
  cache[hash] = {
    review: reviewResult,
    timestamp: new Date().toISOString()
  };
  saveCache(cache);
}

module.exports = {
  getCachedReview,
  cacheReview
};
