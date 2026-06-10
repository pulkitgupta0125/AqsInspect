const { ipcMain, app, shell, dialog, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { getProvider } = require("./providers"); // now resolves to electron/providers/index.js
const store = require("./configStore"); // exports.getConfig/getLLMConfig/saveLLMConfig in your current file
const mcpServer = require("./mcpServer");
const oauth2 = require("./security/oauth2");

// In-memory cache for PR details to avoid redundant API hits for multiple file reviews
const prDetailsCache = new Map();

// -----------------------------
// Config persistence (FULL MERGE)
// -----------------------------
const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");



function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (e) {
    console.error("❌ readConfigFile failed:", e.message);
    return {};
  }
}

function writeConfigFile(obj) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("❌ writeConfigFile failed:", e.message);
    return false;
  }
}

function mergeConfig(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    llm: {
      ...(existing.llm || {}),
      ...(incoming.llm || {})
    }
  };
}

// -----------------------------
// Helpers
// -----------------------------
function normalizeToken(input) {
  if (!input) return "";
  let t = String(input).trim();
  t = t.replace(/^token\s*:\s*/i, "");
  t = t.replace(/^bearer\s+/i, "");
  t = t.replace(/^token\s+/i, "");
  const m = t.match(/github_pat_[A-Za-z0-9_]+/);
  if (m) t = m[0];
  return t.trim();
}

function parsePullRequestUrl(prUrl) {
  const u = new URL(prUrl);
  const parts = u.pathname.split("/").filter(Boolean);

  if (parts.length < 4) throw new Error("Invalid PR URL format");
  const [owner, repo, pullWord, prNumStr] = parts;

  if (pullWord !== "pull" && pullWord !== "pulls") {
    throw new Error("PR URL must contain /pull/ or /pulls/");
  }

  const pull_number = Number(prNumStr);
  if (!Number.isFinite(pull_number)) throw new Error("Invalid PR number");

  const apiBase =
    u.hostname.toLowerCase() === "github.com"
      ? "https://api.github.com"
      : `${u.origin}/api/v3`;

  return { owner, repo, pull_number, apiBase };
}

function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",").map((s) => s.trim());
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();

  // direct JSON
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // strip ```json fences
  const fenced = trimmed.match(/```json([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  // find first {...}
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch (_) {}
  }

  return null;
}

function getLLMConfigSafe() {
  // Prefer your existing getLLMConfig if present
  if (typeof store.getLLMConfig === "function") return store.getLLMConfig();

  // fallback: read from config.json
  const cfg = readConfigFile();
  return cfg.llm || {};
}

function validateLLM(llm) {
  const provider = (llm.provider || "azure").toLowerCase();

  if (provider === "ollama") {
    if (!llm.endpoint) return "Ollama endpoint is missing";
    if (!llm.model) return "Ollama model is missing";
    return null;
  }

  if (!llm?.apiKey) return "API key is missing";

  if (provider === "azure") {
    if (!llm.endpoint) return "Azure endpoint is missing";
    if (!llm.model) return "Azure deployment name (model) is missing";
  } else if (provider === "openai") {
    if (!llm.model) return "OpenAI model is missing";
  } else {
    return "Unknown provider. Use 'azure', 'openai', or 'ollama'.";
  }
  return null;
}

function getAxiosErrorMessage(error) {
  if (!error) return "Unknown network error";
  if (error.response?.data?.error?.message) return String(error.response.data.error.message);
  if (error.response?.data?.message) return String(error.response.data.message);
  if (error.message) return String(error.message);
  return String(error);
}

async function postWithRetry(url, body, headers, attempts = 3, initialDelay = 600) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await axios.post(url, body, { headers });
    } catch (e) {
      const status = e?.response?.status;
      const msg = getAxiosErrorMessage(e);
      const shouldRetry = status === 429 || status === 502 || status === 503 || status === 504;

      lastError = new Error(`LLM request failed (${status || "unknown"}): ${msg}`);

      if (shouldRetry && attempt < attempts) {
        const delay = initialDelay * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }
  throw lastError;
}

function sanitizeLogConfig(config) {
  if (!config) return {};
  const safe = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      // Redact tokens, keys, secrets
      if (key.toLowerCase().includes('token') || 
          key.toLowerCase().includes('secret') || 
          key.toLowerCase().includes('key') ||
          key.toLowerCase().includes('password') ||
          key.toLowerCase().includes('pat')) {
        safe[key] = '***REDACTED***';
      } else {
        safe[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      safe[key] = sanitizeLogConfig(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

// -----------------------------
// IPC: App
// -----------------------------
ipcMain.handle("app:ping", async () => "pong from main");

// -----------------------------
// IPC: Config (the API your UI should use)
// -----------------------------
ipcMain.handle("config:get", async () => {
  // Your configStore.getConfig() reads the same config.json path; use it if available
  if (typeof store.getConfig === "function") return store.getConfig();
  return readConfigFile();
});

ipcMain.handle("config:save", async (_evt, data) => {
  const existing = readConfigFile();
  const merged = mergeConfig(existing, data || {});
  const ok = writeConfigFile(merged);
  return { ok };
});

ipcMain.handle("config:clear", async () => {
  try {
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Backward-compat: some older code in your repo used config:verify-token (kept)
ipcMain.handle("config:verify-token", async (_evt, token) => {
  const t = normalizeToken(token);
  if (!t) return { ok: false, message: "Token is required" };

  try {
    const res = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json"
      }
    });
    return { ok: true, user: res.data.login };
  } catch (e) {
    return { ok: false, message: e.response?.status === 401 ? "Invalid token" : e.message };
  }
});

// -----------------------------
// IPC: GitHub Token Verify (used by SettingsScreen.jsx)
// -----------------------------
ipcMain.handle("github:verify", async (_evt, payload) => {
  const token = typeof payload === "string" ? payload : payload?.repoSettings?.token;
  const t = normalizeToken(token);
  if (!t) return { valid: false, error: "Token is required" };

  const owner = payload?.repoSettings?.owner;
  const repo = payload?.repoSettings?.repo;
  const baseUrl = payload?.repoSettings?.baseUrl || "https://api.github.com";

  try {
    const cleanBaseUrl = String(baseUrl).trim().replace(/\/+$/, "");
    const url = owner && repo
      ? `${cleanBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      : `${cleanBaseUrl}/user`;

    const headers = {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "AQSInspect"
    };

    const res = await axios.get(url, { headers });
    if (owner && repo) {
      return { valid: true, repoName: res.data?.full_name || `${owner}/${repo}` };
    }
    return { valid: true, username: res.data?.login };
  } catch (e) {
    const errorMsg = e.response?.data?.message || e.message || "Unknown error";
    return { valid: false, error: e.response?.status === 401 ? "Invalid token" : errorMsg };
  }
});

ipcMain.handle("azure:verify", async (_evt, payload) => {
  const a = payload?.repoSettings || {};
  const org = a.org;
  const project = a.project;
  const repoIdOrName = a.repoIdOrName;
  const pat = a.pat;
  const baseUrl = a.baseUrl || "https://dev.azure.com";
  const apiVersion = a.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    return { valid: false, error: "Settings are incomplete (org/project/repo/PAT required)." };
  }

  try {
    const cleanBaseUrl = String(baseUrl).trim().replace(/\/+$/, "");
    const orgRoot = cleanBaseUrl.toLowerCase().endsWith("/" + org.toLowerCase())
      ? cleanBaseUrl
      : `${cleanBaseUrl}/${encodeURIComponent(org)}`;

    // Query pullrequests instead of repository metadata to ensure compatibility with repo names/IDs
    const url = `${orgRoot}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests?api-version=${encodeURIComponent(apiVersion)}&$top=1`;
    
    const headers = {
      Authorization: `Basic ${Buffer.from(`:${pat}`, 'utf8').toString('base64')}`,
      Accept: "application/json"
    };

    const res = await axios.get(url, { headers });
    if (res.status === 200) {
      return { valid: true, repoName: repoIdOrName };
    }
    return { valid: false, error: `Server returned status ${res.status}` };
  } catch (e) {
    const errorMsg = e.response?.data?.message || e.message || "Unknown error";
    return { valid: false, error: errorMsg };
  }
});

/* Helper to resolve Azure repository settings for multi-repository mode */
function getAzureSettings(cfg, payload) {
  if (payload?.repoSettings) {
    return payload.repoSettings;
  }
  if (cfg?.multiRepo && Array.isArray(cfg?.azureRepos) && cfg.azureRepos.length > 0) {
    if (payload?.customer) {
      const repo = cfg.azureRepos.find(r => r.customer === payload.customer);
      if (repo) return repo;
    }
    if (cfg.selectedCustomer) {
      const repo = cfg.azureRepos.find(r => r.customer === cfg.selectedCustomer);
      if (repo) return repo;
    }
    return cfg.azureRepos[0];
  }
  return cfg?.azure || {};
}

/* Helper to resolve GitHub repository settings for multi-repository mode */
function getGithubSettings(cfg, payload) {
  if (payload?.repoSettings) {
    return payload.repoSettings;
  }
  if (cfg?.multiRepoGithub && Array.isArray(cfg?.githubRepos) && cfg.githubRepos.length > 0) {
    if (payload?.customer) {
      const repo = cfg.githubRepos.find(r => r.customer === payload.customer);
      if (repo) return repo;
    }
    if (cfg.selectedCustomerGithub) {
      const repo = cfg.githubRepos.find(r => r.customer === cfg.selectedCustomerGithub);
      if (repo) return repo;
    }
    return cfg.githubRepos[0];
  }
  return cfg?.github || { token: cfg?.githubToken };
}

ipcMain.handle("repo:listPullRequests", async (_evt, payload) => {
  const { repoType, filters } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};

  const effectiveRepoType = (repoType || cfg.repoType || "github").toLowerCase();
  const repoSettings =
    effectiveRepoType === "azure"
      ? getAzureSettings(cfg, payload)
      : getGithubSettings(cfg, payload);

  try {
    console.log(`📋 Loading ${effectiveRepoType} PRs...`);
    console.log(`   Repo settings:`, { type: effectiveRepoType, ...sanitizeLogConfig(repoSettings) });
    console.log(`   Filters:`, filters);
    
    if (!repoSettings) {
      throw new Error(`No repository settings found for ${effectiveRepoType}`);
    }

    const provider = getProvider(effectiveRepoType);
    const prs = await provider.listPullRequests({ filters, repoSettings });
    console.log(`✅ Successfully loaded ${prs?.length || 0} PRs`);
    return { ok: true, prs };
  } catch (e) {
    const errorMsg = e?.message || e?.toString() || "Unknown error";
    console.error(`❌ listPullRequests failed for ${effectiveRepoType}:`, errorMsg);
    console.error(`   Full error:`, e);
    
    // Return more detailed error to help UI debugging
    return {
      ok: false,
      error: errorMsg || "Failed to load pull requests. Please verify repository settings.",
      details: {
        type: effectiveRepoType,
        message: errorMsg,
        code: e?.code || e?.response?.status,
      }
    };
  }
});


ipcMain.handle("repo:getPullRequestDetails", async (_evt, payload) => {
  const { repoType, prUrlOrId } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};

  const effectiveRepoType = (repoType || cfg.repoType || "github").toLowerCase();
  const repoSettings =
    effectiveRepoType === "azure"
      ? getAzureSettings(cfg, payload)
      : getGithubSettings(cfg, payload);

  try {
    const provider = getProvider(effectiveRepoType);
    const pr = await provider.getPullRequestDetails({ prUrlOrId, repoSettings });
    return { ok: true, pr };
  } catch (e) {
    console.error("getPullRequestDetails failed:", e?.message || e);
    return { ok: false, error: "Failed to load PR details." };
  }
});

ipcMain.handle("pr:performAction", async (_evt, payload) => {
  const { repoType, prUrlOrId, action } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};
  const effectiveRepoType = (repoType || cfg.repoType || "github").toLowerCase();
  const repoSettings =
    effectiveRepoType === "azure"
      ? getAzureSettings(cfg, payload)
      : getGithubSettings(cfg, payload);

  try {
    const provider = getProvider(effectiveRepoType);
    if (action === "accept" || action === "merge") {
      const result = await provider.mergePullRequest({ prUrlOrId, repoSettings });
      return { ok: true, result };
    }
    if (action === "reject" || action === "abandon" || action === "close") {
      const result = await provider.closePullRequest({ prUrlOrId, repoSettings });
      return { ok: true, result };
    }
    return { ok: false, error: "Unsupported PR action." };
  } catch (e) {
    console.error("pr:performAction failed:", e?.message || e);
    return { ok: false, error: e?.message || "Failed to perform PR action." };
  }
});

ipcMain.handle("app:openExternal", async (_evt, url) => {
  if (!url) return { ok: false, error: "URL is required" };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    console.error("openExternal failed:", e?.message || e);
    return { ok: false, error: e?.message || "Failed to open external URL." };
  }
});

function generateReportHtml(prDetails, aiReview) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const findings = Array.isArray(aiReview.findings) ? aiReview.findings : [];
  let blockerCount = 0;
  let majorCount = 0;
  let minorCount = 0;
  let infoCount = 0;

  findings.forEach(f => {
    const sev = String(f.severity || "info").toLowerCase();
    if (sev === "blocker" || sev === "critical") blockerCount++;
    else if (sev === "major" || sev === "warning") majorCount++;
    else if (sev === "minor") minorCount++;
    else infoCount++;
  });

  const groupedFindings = {};
  findings.forEach(f => {
    const fn = f.filename || "General Rules";
    if (!groupedFindings[fn]) groupedFindings[fn] = [];
    groupedFindings[fn].push(f);
  });

  const developer = prDetails.createdBy || prDetails.created_by || prDetails.created_by_login || prDetails.author || "Unknown Developer";
  const createdAt = prDetails.createdAt || prDetails.created_at || prDetails.created || "N/A";
  const score = aiReview.score !== undefined ? aiReview.score : (aiReview.summary?.score !== undefined ? aiReview.summary.score : "N/A");
  const scoreNum = Number(score);
  
  let scoreClass = "med";
  let scoreLabel = "Neutral";
  if (!isNaN(scoreNum)) {
    if (scoreNum >= 80) {
      scoreClass = "high";
      scoreLabel = "Good";
    } else if (scoreNum >= 50) {
      scoreClass = "med";
      scoreLabel = "Warning";
    } else {
      scoreClass = "low";
      scoreLabel = "Action Req.";
    }
  }

  // Generate HTML list of findings grouped by file
  let findingsHtml = "";
  Object.keys(groupedFindings).forEach(filename => {
    findingsHtml += `
      <div class="file-group">
        <div class="file-header">${esc(filename)}</div>
    `;
    
    groupedFindings[filename].forEach(f => {
      const sev = String(f.severity || "info").toLowerCase();
      const badgeClass = (sev === "blocker" || sev === "critical") ? "blocker" :
                         (sev === "major" || sev === "warning") ? "major" :
                         (sev === "minor") ? "minor" : "info";

      findingsHtml += `
        <div class="finding-card ${badgeClass}">
          <div class="finding-header">
            <span class="badge ${badgeClass}">${esc(f.severity || "info")}</span>
            <span class="finding-title">${esc(f.title || "Finding")}</span>
          </div>
          <div class="finding-body">${esc(f.explanation || "")}</div>
      `;

      if (f.matchText) {
        findingsHtml += `
          <div class="metadata-label" style="font-size:9px; margin-top:6px;">Matched Code Snippet</div>
          <pre class="code-block"><code>${esc(f.matchText)}</code></pre>
        `;
      }

      if (f.recommendation) {
        findingsHtml += `
          <div class="recommendation-box">
            <strong>💡 Suggestion:</strong> ${esc(f.recommendation)}
          </div>
        `;
      }

      findingsHtml += `</div>`; // Close finding-card
    });

    findingsHtml += `</div>`; // Close file-group
  });

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1f2937;
        margin: 30px;
        line-height: 1.5;
        background: #ffffff;
      }
      .header-banner {
        background: #0f172a;
        color: #ffffff;
        padding: 20px 24px;
        border-radius: 12px;
        margin-bottom: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .header-logo {
        font-size: 20px;
        font-weight: 800;
        color: #6366f1;
        letter-spacing: -0.5px;
      }
      .header-title-section {
        text-align: right;
      }
      .report-title {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
        color: #ffffff;
      }
      .report-subtitle {
        font-size: 10px;
        color: #94a3b8;
        margin: 3px 0 0 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 16px 20px;
        margin-bottom: 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .grid {
        display: flex;
        gap: 24px;
      }
      .grid-left {
        flex: 3;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px 24px;
      }
      .grid-right {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .metadata-item {
        display: flex;
        flex-direction: column;
      }
      .metadata-label {
        font-size: 10px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .metadata-value {
        font-size: 13px;
        font-weight: 500;
        color: #111827;
        margin-top: 2px;
        word-break: break-all;
      }
      .score-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 12px 24px;
        min-width: 100px;
      }
      .score-circle {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        font-weight: 800;
        color: #ffffff;
        margin-bottom: 4px;
        box-shadow: 0 3px 8px rgba(99,102,241,0.25);
      }
      .score-circle.high { background: #10b981; }
      .score-circle.med { background: #f59e0b; }
      .score-circle.low { background: #ef4444; }
      
      .score-label {
        font-size: 10px;
        font-weight: 700;
        color: #374151;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .severity-pills {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
      }
      .pill {
        flex: 1;
        text-align: center;
        padding: 8px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 12px;
      }
      .pill.blocker { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
      .pill.major { background: #ffedd5; color: #9a3412; border: 1px solid #fed7aa; }
      .pill.minor { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
      .pill.info { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
      
      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 12px;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .summary-text {
        font-size: 13px;
        color: #4b5563;
        line-height: 1.6;
      }
      .file-group {
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      .file-header {
        font-size: 12.5px;
        font-weight: 700;
        background: #f1f5f9;
        color: #334155;
        padding: 6px 12px;
        border-radius: 6px;
        font-family: 'JetBrains Mono', Consolas, monospace;
        margin-bottom: 10px;
        border: 1px solid #e2e8f0;
        word-break: break-all;
      }
      .finding-card {
        border: 1px solid #e5e7eb;
        border-left-width: 4px;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 10px;
        background: #ffffff;
        page-break-inside: avoid;
      }
      .finding-card.blocker { border-left-color: #ef4444; }
      .finding-card.major { border-left-color: #f59e0b; }
      .finding-card.minor { border-left-color: #3b82f6; }
      .finding-card.info { border-left-color: #6b7280; }
      
      .finding-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .badge {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .badge.blocker { background: #ef4444; color: #ffffff; }
      .badge.major { background: #f59e0b; color: #ffffff; }
      .badge.minor { background: #3b82f6; color: #ffffff; }
      .badge.info { background: #6b7280; color: #ffffff; }
      
      .finding-title {
        font-weight: 700;
        font-size: 13px;
        color: #111827;
      }
      .finding-body {
        font-size: 12.5px;
        color: #4b5563;
        line-height: 1.5;
      }
      .code-block {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 8px 12px;
        font-family: "JetBrains Mono", Consolas, monospace;
        font-size: 11px;
        overflow-x: auto;
        margin: 6px 0;
        white-space: pre;
        color: #0f172a;
      }
      .recommendation-box {
        background: #f0fdf4;
        border-left: 3px solid #22c55e;
        padding: 6px 12px;
        border-radius: 0 4px 4px 0;
        font-size: 12px;
        color: #15803d;
        margin-top: 6px;
      }
      .footer {
        text-align: center;
        font-size: 10px;
        color: #9ca3af;
        margin-top: 32px;
        border-top: 1px solid #e5e7eb;
        padding-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="header-banner">
      <div class="header-logo">🛡️ AQS Inspect</div>
      <div class="header-title-section">
        <h1 class="report-title">Pull Request Review Report</h1>
        <p class="report-subtitle">Enterprise Code Quality Analysis</p>
      </div>
    </div>

    <div class="card">
      <div class="grid">
        <div class="grid-left">
          <div class="metadata-item">
            <span class="metadata-label">Pull Request</span>
            <span class="metadata-value">#${esc(prDetails.number || prDetails.id || "N/A")}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Title</span>
            <span class="metadata-value">${esc(prDetails.title || "N/A")}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Developer</span>
            <span class="metadata-value">${esc(developer)}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Created At</span>
            <span class="metadata-value">${esc(createdAt)}</span>
          </div>
          <div class="metadata-item" style="grid-column: span 2;">
            <span class="metadata-label">PR Link</span>
            <span class="metadata-value" style="font-size:11px;"><a href="${esc(prDetails.html_url || prDetails.url || "")}">${esc(prDetails.html_url || prDetails.url || "View PR")}</a></span>
          </div>
        </div>
        <div class="grid-right">
          <div class="score-container">
            <div class="score-circle ${scoreClass}">${score}</div>
            <span class="score-label">${scoreLabel}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="severity-pills">
      <div class="pill blocker">🚨 Blocker: ${blockerCount}</div>
      <div class="pill major">⚠️ Major: ${majorCount}</div>
      <div class="pill minor">ℹ️ Minor: ${minorCount}</div>
      <div class="pill info">📋 Info: ${infoCount}</div>
    </div>

    <div class="card">
      <div class="section-title">Executive Summary</div>
      <div class="summary-text">${esc(aiReview.summary || "No summary available.")}</div>
    </div>

    <div class="section-title">Detailed Analysis Findings</div>
    ${findingsHtml || '<div class="summary-text" style="color: #22c55e;">✅ No quality warnings or blockers detected during code scan.</div>'}

    <div class="footer">
      Report generated by AQS Inspect Engine on ${new Date().toLocaleString()} • Confidential Enterprise Copy
    </div>
  </body>
  </html>`;
}

async function generatePdfBuffer(fullHtml) {
  const { BrowserWindow } = require('electron');
  const bw = new BrowserWindow({ width: 900, height: 1100, show: false, webPreferences: { offscreen: true } });
  await bw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
  // wait for content
  await new Promise((res) => setTimeout(res, 300));
  const pdfBuffer = await bw.webContents.printToPDF({ landscape: false, printBackground: true });
  try { bw.close(); } catch(_) {}
  return pdfBuffer;
}

ipcMain.handle("email:send", async (_evt, payload) => {
  const { subject, body, to, config, prDetails, aiReview } = payload || {};
  const smtpConfig = config || {};
  const fromAddress = smtpConfig.from || smtpConfig.user;

  if (smtpConfig.disabled) {
    return {
      ok: false,
      error: "Email sending is disabled in Settings."
    };
  }

  const recipient = prDetails?.creatorEmail;

  if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.pass) {
    return {
      ok: false,
      error: "Incomplete SMTP settings. Please configure host, port, username, and password."
    };
  }

  if (!recipient) {
    return {
      ok: false,
      error: "PR Creator email address could not be resolved. Email can only be sent to the PR Creator."
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: Number(smtpConfig.port),
      secure: Boolean(smtpConfig.secure),
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    await transporter.verify();

    const mailOptions = {
      from: `"AQS Inspect" <${fromAddress}>`, // Explicitly use the configured from address, masked
      to: recipient,
      subject,
      text: body
    };

    if (smtpConfig.cc) {
      mailOptions.cc = smtpConfig.cc;
    }

    // Generate HTML body and PDF attachment if details and review are provided
    if (prDetails && aiReview) {
      try {
        const fullHtml = generateReportHtml(prDetails, aiReview);
        const pdfBuffer = await generatePdfBuffer(fullHtml);
        
        mailOptions.html = fullHtml;
        mailOptions.attachments = [
          {
            filename: `AQS_Report_PR_${prDetails.id || prDetails.number || "Review"}.pdf`,
            content: pdfBuffer
          }
        ];
      } catch (err) {
        console.error("Failed to generate PDF attachment for email:", err.message);
      }
    }

    const info = await transporter.sendMail(mailOptions);

    return { ok: true, info: { messageId: info.messageId, envelope: info.envelope } };
  } catch (e) {
    console.error("email:send failed:", e?.message || e);
    return { ok: false, error: e?.message || "Failed to send email." };
  }
});

ipcMain.handle("email:test", async (_evt, smtpConfig) => {
  if (!smtpConfig?.host || !smtpConfig?.port || !smtpConfig?.user || !smtpConfig?.pass) {
    return { ok: false, error: "Incomplete SMTP settings. Please configure host, port, username, and password." };
  }

  const fromAddress = smtpConfig.from || smtpConfig.user;

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: Number(smtpConfig.port),
      secure: Boolean(smtpConfig.secure),
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    await transporter.verify();

    const mailOptions = {
      from: `"AQS Inspect" <${fromAddress}>`, // Explicitly use the configured from address (or username fallback), masked
      to: fromAddress, // Send test mail to oneself
      subject: "AQS Inspect - SMTP Test Email",
      text: "SMTP Configuration Verified Successfully."
    };

    if (smtpConfig.cc) {
      mailOptions.cc = smtpConfig.cc;
    }

    await transporter.sendMail(mailOptions);
    return { ok: true };
  } catch (e) {
    console.error("email:test failed:", e?.message || e);
    return { ok: false, error: e?.message || "Failed to verify SMTP settings." };
  }
});

ipcMain.handle('report:save', async (_evt, payload) => {
  const { defaultFilename, content } = payload || {};
  try {
    const res = await dialog.showSaveDialog({
      defaultPath: defaultFilename || 'review-report.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (res.canceled) return { ok: false, error: 'cancelled' };
    const filePath = res.filePath;
    fs.writeFileSync(filePath, String(content || ''), 'utf-8');
    return { ok: true, path: filePath };
  } catch (e) {
    console.error('report:save failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to save report' };
  }
});

ipcMain.handle('report:savePdf', async (_evt, payload) => {
  const { defaultFilename, content, prDetails, aiReview } = payload || {};
  try {
    const res = await dialog.showSaveDialog({
      defaultPath: defaultFilename ? defaultFilename.replace(/\.[^/.]+$/, "") + '.pdf' : 'review-report.pdf',
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (res.canceled) return { ok: false, error: 'cancelled' };
    const filePath = res.filePath;

    let fullHtml = "";

    if (prDetails && aiReview) {
      fullHtml = generateReportHtml(prDetails, aiReview);
    } else {
      // Minimal markdown -> HTML conversion (sufficient for report formatting)
      const md = String(content || '');
      const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Code fences -> pre
      html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${escapeHtml(code)}</code></pre>`);
      // Headings
      html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
      html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
      // Bold/italic
      html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
      html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
      // Lists
      html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
      html = html.replace(/(<li>[\s\S]*?<\/li>)(?!(<li>))/gim, '<ul>$1</ul>');
      // Links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>');
      // Paragraphs
      html = html
        .split(/\n\n+/)
        .map((p) => {
          if (/^<h\d>/.test(p) || /^<pre>/.test(p) || /^<ul>/.test(p)) return p;
          return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
        })
        .join('\n');

      fullHtml = `<!doctype html>
        <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; margin: 24px; color: #111; }
            pre { background:#f6f8fa; padding:12px; border-radius:6px; overflow:auto }
            code { font-family: monospace; }
            h1,h2,h3 { color: #0b69ff }
            ul { margin-left: 18px }
            table { border-collapse: collapse }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>`;
    }

    const bw = new BrowserWindow({ width: 900, height: 1100, show: false, webPreferences: { offscreen: true } });
    await bw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    // wait for content
    await new Promise((res) => setTimeout(res, 300));

    const pdfBuffer = await bw.webContents.printToPDF({ landscape: false, printBackground: true });
    const fs = require('fs');
    fs.writeFileSync(filePath, pdfBuffer);
    try { bw.close(); } catch(_) {}
    return { ok: true, path: filePath };
  } catch (e) {
    console.error('report:savePdf failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to save PDF' };
  }
});

ipcMain.handle("oauth2:requestToken", async (_evt, payload) => {
  const {
    tokenUrl,
    clientId,
    clientSecret,
    grantType,
    scope,
    redirectUri,
    code,
    refreshToken
  } = payload || {};

  const normalizedTokenUrl = String(tokenUrl || "").trim();
  const normalizedClientId = String(clientId || "").trim();
  const normalizedClientSecret = String(clientSecret || "").trim();
  const normalizedGrantType = String(grantType || "").trim();
  const normalizedScope = String(scope || "").trim();

  if (!normalizedTokenUrl || !normalizedClientId || !normalizedClientSecret || !normalizedGrantType) {
    return { ok: false, error: "OAuth2 token request requires token URL, client ID, client secret and grant type." };
  }

  try {
    let tokenResponse;

    if (normalizedGrantType === "client_credentials") {
      const bodyParams = {
        grant_type: "client_credentials",
        client_id: normalizedClientId,
        client_secret: normalizedClientSecret
      };

      if (normalizedScope) {
        bodyParams.scope = normalizedScope;
      }

      const body = new URLSearchParams(bodyParams);

      const res = await axios.post(tokenUrl, body.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });
      tokenResponse = res.data;
    } else if (grantType === "authorization_code") {
      if (!code || !redirectUri) {
        return { ok: false, error: "Authorization code grant requires code and redirect URI." };
      }
      tokenResponse = await oauth2.exchangeAuthorizationCode({
        tokenUrl,
        clientId,
        clientSecret,
        code,
        redirectUri
      });
    } else if (normalizedGrantType === "refresh_token") {
      if (!refreshToken) {
        return { ok: false, error: "Refresh token grant requires refresh token." };
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: normalizedClientId,
        client_secret: normalizedClientSecret
      });

      const authHeaders = normalizedClientId && normalizedClientSecret ? {
        Authorization: `Basic ${Buffer.from(`${normalizedClientId}:${normalizedClientSecret}`, "utf8").toString("base64")}`
      } : {};

      const res = await axios.post(tokenUrl, body.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...authHeaders
        }
      });
      tokenResponse = res.data;
    } else {
      return { ok: false, error: "Unsupported OAuth2 grant type." };
    }

    return { ok: true, tokenResponse };
  } catch (e) {
    console.error("oauth2:requestToken failed:", e?.response?.status, e?.response?.data || e?.message || e);
    const message = e?.response?.data?.error_description || e?.response?.data?.error || e?.message || "Failed to request OAuth2 token.";
    return { ok: false, error: message };
  }
});

// -----------------------------
// IPC: Fetch PR Diff (canonical handler for your app)
// -----------------------------

// -----------------------------
// Azure DevOps diff implementation (PAT auth)
// -----------------------------
function isAzureDevOpsPrUrl(prUrl) {
  try {
    const u = new URL(prUrl);
    const h = (u.hostname || "").toLowerCase();
    return h.includes("dev.azure.com") || h.includes("visualstudio.com");
  } catch {
    return false;
  }
}

function parseAzurePullRequestId(prUrl) {
  // Supports:
  // - Web URL:  https://dev.azure.com/org/project/_git/repo/pullrequest/123
  // - API URL:  https://dev.azure.com/org/project/_apis/git/repositories/{repo}/pullRequests/123
  // - Query:    ...?pullRequestId=123
  // - Numeric:  "123"
  const s = String(prUrl || "").trim();
  if (!s) return null;

  // Numeric-only input
  if (/^\d+$/.test(s)) return s;

  // Web form
  let m = s.match(/pullrequest\/(\d+)/i);
  if (m) return m[1];

  // API form (Azure REST often returns this)
  m = s.match(/pullrequests\/(\d+)/i);
  if (m) return m[1];

  // Query param form
  m = s.match(/[?&]pullRequestId=(\d+)/i);
  if (m) return m[1];

  return null;
}

function azureAuthHeaderFromPat(pat) {
  // Basic base64(":" + PAT)
  const b64 = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${b64}`;
}

function stripLeadingSlash(p) {
  const s = String(p || "");
  return s.startsWith("/") ? s.slice(1) : s;
}

async function azureGetJson(url, headers) {
  const res = await axios.get(url, { headers });
  return res.data;
}

async function azureGetItemText({ apiRoot, path, commitId, apiVersion, headers }) {
  // Azure DevOps Git Items API supports includeContent=true when requesting json.
  const qs = new URLSearchParams();
  qs.set("path", path);
  qs.set("includeContent", "true");
  qs.set("$format", "json");
  qs.set("versionDescriptor.version", commitId);
  qs.set("versionDescriptor.versionType", "commit");
  qs.set("api-version", apiVersion);

  const url = `${apiRoot}/items?${qs.toString()}`;
  try {
    const res = await axios.get(url, { headers });
    const data = res.data;
    if (typeof data === "string") return data;
    if (data && typeof data.content === "string") return data.content;
    return "";
  } catch {
    // Deleted/binary files may not return content
    return "";
  }
}

// Minimal Myers diff for line arrays -> operations
function myersOps(aLines, bLines, maxTotalLines = 20000) {
  const a = Array.isArray(aLines) ? aLines : [];
  const b = Array.isArray(bLines) ? bLines : [];

  if (a.length + b.length > maxTotalLines) {
    return { ops: null, tooLarge: true };
  }

  const N = a.length;
  const M = b.length;
  const max = N + M;

  let v = new Map();
  v.set(1, 0);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      const vKMinus = v.get(k - 1);
      const vKPlus = v.get(k + 1);

      if (k === -d || (k !== d && (vKMinus ?? -1) < (vKPlus ?? -1))) {
        x = vKPlus ?? 0;
      } else {
        x = (vKMinus ?? 0) + 1;
      }

      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);

      if (x >= N && y >= M) {
        // Backtrack to build ops
        let bx = N;
        let by = M;
        const ops = [];

        for (let bd = trace.length - 1; bd >= 0; bd--) {
          const vv = trace[bd];
          const bk = bx - by;
          let prevK;

          if (bk === -bd || (bk !== bd && (vv.get(bk - 1) ?? -1) < (vv.get(bk + 1) ?? -1))) {
            prevK = bk + 1;
          } else {
            prevK = bk - 1;
          }

          const prevX = vv.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          while (bx > prevX && by > prevY) {
            ops.push({ type: "equal", line: a[bx - 1] });
            bx--;
            by--;
          }

          if (bd === 0) break;

          if (bx === prevX) {
            ops.push({ type: "insert", line: b[by - 1] });
            by--;
          } else {
            ops.push({ type: "delete", line: a[bx - 1] });
            bx--;
          }
        }

        ops.reverse();
        return { ops, tooLarge: false };
      }
    }
  }

  return { ops: null, tooLarge: true };
}

function buildUnifiedPatchForFile(filePath, oldText, newText) {
  const oldLines = String(oldText ?? "").split(/\r?\n/);
  const newLines = String(newText ?? "").split(/\r?\n/);

  const { ops, tooLarge } = myersOps(oldLines, newLines);

  const p = stripLeadingSlash(filePath);
  const header = [
    `diff --git a/${p} b/${p}`,
    `--- a/${p}`,
    `+++ b/${p}`
  ];

  if (tooLarge || !ops) {
    const h = "@@ -1,0 +1,0 @@";
    const body = ["+[Large file diff omitted by AQS Inspect]"]; 
    return { patch: header.concat([h]).concat(body).join("\n"), additions: 0, deletions: 0 };
  }

  let additions = 0;
  let deletions = 0;
  const bodyLines = [];

  for (const op of ops) {
    if (op.type === "equal") bodyLines.push(" " + (op.line ?? ""));
    else if (op.type === "insert") {
      additions++;
      bodyLines.push("+" + (op.line ?? ""));
    } else if (op.type === "delete") {
      deletions++;
      bodyLines.push("-" + (op.line ?? ""));
    }
  }

  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;
  const h = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  return {
    patch: header.concat([h]).concat(bodyLines).join("\n"),
    additions,
    deletions
  };
}

async function fetchAzurePullRequestDiff({ prUrl, cfg, payload }) {
  const prId = parseAzurePullRequestId(prUrl);
  if (!prId) throw new Error("Azure PR ID not found in URL");

  const a = getAzureSettings(cfg, payload);
  const org = a.org;
  const project = a.project;
  const repoIdOrName = a.repoIdOrName;
  const pat = a.pat;
  const apiVersion = a.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure DevOps settings are incomplete (org/project/repo/PAT required). Please configure them in Settings.");
  }

  const baseUrlRaw = String(a.baseUrl || "https://dev.azure.com").trim().replace(/\/+$/, "");
  const orgRoot = baseUrlRaw.toLowerCase().endsWith("/" + org.toLowerCase())
    ? baseUrlRaw
    : `${baseUrlRaw}/${encodeURIComponent(org)}`;

  const apiRoot = `${orgRoot}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}`;
  const headers = {
    Authorization: azureAuthHeaderFromPat(pat),
    Accept: "application/json"
  };

  // PR details
  const prApiUrl = `${apiRoot}/pullRequests/${encodeURIComponent(prId)}?api-version=${encodeURIComponent(apiVersion)}`;
  const pr = await azureGetJson(prApiUrl, headers);

  const baseCommit = pr?.lastMergeTargetCommit?.commitId || pr?.lastMergeCommit?.commitId;
  const targetCommit = pr?.lastMergeSourceCommit?.commitId || pr?.lastMergeCommit?.commitId;

  if (!baseCommit || !targetCommit) {
    throw new Error("Unable to determine PR base/target commits from Azure DevOps response.");
  }

  // Diffs between commits: returns changed items list
  const diffQs = new URLSearchParams();
  diffQs.set("api-version", apiVersion);
  diffQs.set("baseVersion", baseCommit);
  diffQs.set("baseVersionType", "commit");
  diffQs.set("targetVersion", targetCommit);
  diffQs.set("targetVersionType", "commit");
  diffQs.set("$top", "2000");

  const diffsUrl = `${apiRoot}/diffs/commits?${diffQs.toString()}`;
  const diffs = await azureGetJson(diffsUrl, headers);
  const changes = Array.isArray(diffs?.changes) ? diffs.changes : [];

  const fileChanges = changes
    .map((c) => ({ path: c?.item?.path, changeType: c?.changeType || "edit", isFolder: c?.item?.isFolder }))
    .filter((c) => typeof c.path === "string" && c.path && !c.path.endsWith("/") && !c.isFolder);

  const MAX_FILES = 60;
  const limited = fileChanges.slice(0, MAX_FILES);

  const files = [];
  let unifiedDiff = "";

  for (const ch of limited) {
    const filePath = ch.path;
    const ct = String(ch.changeType || "edit").toLowerCase();

    const oldText = ct.includes("add") ? "" : await azureGetItemText({ apiRoot, path: filePath, commitId: baseCommit, apiVersion, headers });
    const newText = ct.includes("delete") ? "" : await azureGetItemText({ apiRoot, path: filePath, commitId: targetCommit, apiVersion, headers });

    const { patch, additions, deletions } = buildUnifiedPatchForFile(filePath, oldText, newText);

    const fileObj = {
      filename: stripLeadingSlash(filePath),
      status: ct.includes("add") ? "added" : ct.includes("delete") ? "removed" : "modified",
      additions,
      deletions,
      changes: additions + deletions,
      patch
    };

    files.push(fileObj);
    unifiedDiff += (unifiedDiff ? "\n\n" : "") + patch;
  }

  const state = String(pr?.status || "").toLowerCase();

  return {
    ok: true,
    apiBase: apiRoot,
    pr: {
      org,
      project,
      repo: repoIdOrName,
      number: Number(prId),
      title: pr?.title,
      state,
      html_url: pr?._links?.web?.href || pr?.url || prUrl,
      changed_files: files.length,
      additions: files.reduce((s, f) => s + (f.additions || 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
      createdBy: pr?.createdBy?.displayName || pr?.createdBy?.uniqueName || "unknown",
      creatorEmail: pr?.createdBy?.uniqueName && pr.createdBy.uniqueName.includes("@") ? pr.createdBy.uniqueName : "",
      createdAt: pr?.creationDate,
      description: pr?.description || "",
      sourceBranch: pr?.sourceRefName?.replace("refs/heads/", ""),
      targetBranch: pr?.targetRefName?.replace("refs/heads/", "")
    },
    filesCount: files.length,
    files,
    unifiedDiff
  };
}

async function listAllPullFiles(apiBase, owner, repo, pull_number, token) {
  let url = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100&page=1`;
  const all = [];

  while (url) {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "AQSInspect"
      }
    });

    if (Array.isArray(res.data)) all.push(...res.data);
    const link = res.headers?.link;
    url = getNextLink(link);
  }

  return all;
}

ipcMain.handle("pr:fetchDiff", async (_evt, payload) => {
  const { prUrl, token, repoType } = payload || {};
  if (!prUrl) throw new Error("PR URL is required");

  const cfg = store.getConfig ? store.getConfig() : readConfigFile();
  const inferred = isAzureDevOpsPrUrl(prUrl) ? "azure" : "github";
  const effectiveRepoType = String(repoType || cfg?.repoType || inferred || "github").toLowerCase();

  if (effectiveRepoType === "azure") {
    return await fetchAzurePullRequestDiff({ prUrl, cfg, payload });
  }

  // GitHub (existing behaviour)
  const ghSettings = getGithubSettings(cfg, payload);
  const t = normalizeToken(token || ghSettings?.token || cfg?.githubToken);
  if (!t) throw new Error("GitHub Token is missing. Please configure it in Settings.");

  const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);
  const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;

  const prRes = await axios.get(prApi, {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "AQSInspect"
    }
  });
  const pr = prRes.data;

  const filesRaw = await listAllPullFiles(apiBase, owner, repo, pull_number, t);
  const files = filesRaw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch || null
  }));

  let unifiedDiff = "";
  try {
    const diffRes = await axios.get(prApi, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "AQSInspect"
      }
    });
    unifiedDiff = String(diffRes.data || "");
  } catch {
    unifiedDiff = files
      .map((f) => `diff --git a/${f.filename} b/${f.filename}
${f.patch || ""}`)
      .join("\n");
  }

  let creatorEmail = "";
  const username = pr.user?.login;

  // 1. Fetch user profile (public email)
  if (username) {
    try {
      const userUrl = `${apiBase}/users/${username}`;
      const userRes = await axios.get(userUrl, {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AQSInspect"
        }
      });
      if (userRes.data?.email) {
        creatorEmail = userRes.data.email;
      }
    } catch (err) {
      console.warn("Failed to fetch user profile for PR creator email in fetchDiff:", err.message);
    }
  }

  // 2. Fetch repo commits by author (guarantees email belongs to verified commits of this user)
  if (!creatorEmail && username) {
    try {
      const authorCommitsUrl = `${apiBase}/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&per_page=5`;
      const authorCommitsRes = await axios.get(authorCommitsUrl, {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AQSInspect"
        }
      });
      const authorCommits = authorCommitsRes.data;
      if (Array.isArray(authorCommits)) {
        const foundCommit = authorCommits.find(c => c.author?.login?.toLowerCase() === username.toLowerCase() && c.commit?.author?.email);
        if (foundCommit) {
          creatorEmail = foundCommit.commit.author.email;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch author commits for PR creator email in fetchDiff:", err.message);
    }
  }

  // 3. Check PR commits (only matching author login)
  if (!creatorEmail && username) {
    try {
      const commitsUrl = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}/commits`;
      const commitsRes = await axios.get(commitsUrl, {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AQSInspect"
        }
      });
      const commits = commitsRes.data;
      if (Array.isArray(commits)) {
        const matchingCommit = commits.find(c => c.author?.login?.toLowerCase() === username.toLowerCase() && c.commit?.author?.email);
        if (matchingCommit) {
          creatorEmail = matchingCommit.commit.author.email;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch commits for PR creator email in fetchDiff:", err.message);
    }
  }

  return {
    ok: true,
    apiBase,
    pr: {
      owner,
      repo,
      number: pull_number,
      title: pr.title,
      state: pr.state,
      html_url: pr.html_url,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      createdBy: pr.user?.login || "unknown",
      creatorEmail: creatorEmail || "",
      createdAt: pr.created_at,
      description: pr.body || "",
      sourceBranch: pr.head?.ref,
      targetBranch: pr.base?.ref
    },
    filesCount: files.length,
    files,
    unifiedDiff
  };
});

// Backward compat: some earlier code used github:fetch-pr-diff
ipcMain.handle("github:fetch-pr-diff", async (_evt, payload) => {
  return ipcMain.emit ? await ipcMain.handle("pr:fetchDiff", _evt, payload) : await (async () => {
    // fallback: call same logic
    return await ipcMain._invokeHandler?.("pr:fetchDiff", _evt, payload);
  })();
});

// -----------------------------
// IPC: LLM Verify (Azure/OpenAI toggle)
// -----------------------------
ipcMain.handle("llm:verify", async (_evt, llmFromUi) => {
  const llm = llmFromUi || getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) return { valid: false, error: err };

  const provider = (llm.provider || "azure").toLowerCase();
  const temperature = typeof llm.temperature === "number" ? llm.temperature : 0.2;

  try {
    if (provider === "ollama") {
      const endpoint = String(llm.endpoint).replace(/\/$/, "");
      const res = await axios.post(
        `${endpoint}/api/chat`,
        {
          model: llm.model,
          messages: [{ role: "user", content: "test" }],
          stream: false
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
      if (res.status >= 200 && res.status < 300) return { valid: true };
      return { valid: false, error: `Unexpected status ${res.status}` };
    }

    if (provider === "openai") {
      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: llm.model,
          messages: [{ role: "user", content: "test" }],
          max_tokens: 5,
          temperature
        },
        {
          headers: {
            Authorization: `Bearer ${llm.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (res.status >= 200 && res.status < 300) return { valid: true };
      return { valid: false, error: `Unexpected status ${res.status}` };
    }

    // Azure
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    const apiVersion = llm.apiVersion || "2024-02-15-preview";
    const url = `${endpoint}/openai/deployments/${llm.model}/chat/completions?api-version=${apiVersion}`;

    const res = await axios.post(
      url,
      {
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
        temperature
      },
      {
        headers: {
          "api-key": llm.apiKey,
          "Content-Type": "application/json"
        }
      }
    );

    if (res.status >= 200 && res.status < 300) return { valid: true };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch (e) {
    return { valid: false, error: e.response?.data?.error?.message || e.message };
  }
});

ipcMain.handle("llm:listOpenAIModels", async (_evt, payload) => {
  const { apiKey } = payload || {};
  if (!apiKey) {
    return { ok: false, error: "API Key is missing" };
  }
  try {
    const res = await axios.get("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    if (res.status >= 200 && res.status < 300) {
      const models = (res.data?.data || [])
        .map(m => m.id)
        .filter(id => id.startsWith("gpt-"))
        .sort();
      return { ok: true, models };
    }
    return { ok: false, error: `Unexpected status code: ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.response?.data?.error?.message || e.message };
  }
});

ipcMain.handle("llm:listOllamaModels", async (_evt, payload) => {
  const { endpoint } = payload || {};
  if (!endpoint) {
    return { ok: false, error: "Ollama endpoint is missing" };
  }
  try {
    const cleanEndpoint = String(endpoint).replace(/\/$/, "");
    const res = await axios.get(`${cleanEndpoint}/api/tags`);
    if (res.status >= 200 && res.status < 300) {
      const models = (res.data?.models || [])
        .map(m => m.name)
        .sort();
      return { ok: true, models };
    }
    return { ok: false, error: `Unexpected status code: ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// -----------------------------
// IPC: Full AI Review Pipeline (Azure/OpenAI) using Multi-Agent Digital Workers
// -----------------------------
ipcMain.handle("review:run", async (_evt, payload) => {
  const llm = getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) throw new Error(err);

  const files = payload?.files || [];
  const rawDiff = payload?.unifiedDiff || "";
  
  // Scrub any sensitive credentials from input before sending to LLM
  const { redactSecrets } = require("./reviewEngine/agents");
  const unifiedDiff = redactSecrets(rawDiff);

  if (!unifiedDiff && !files.length) {
    throw new Error("No diff or files provided for AI review.");
  }

  const postFunc = async (url, body, headers) => {
    return await postWithRetry(url, body, headers, 3, 750);
  };

  const consolidatedFindings = [];

  // If per-file review is requested, run each file through the Multi-Agent Delegator
  if (files.length > 0) {
    const prFilesList = files.map(item => item.filename);

    for (const f of files) {
      if (!f.filename) continue;
      
      const fileClassifier = require("./reviewEngine/fileClassifier");
      const ext = path.extname(f.filename);
      const classification = await fileClassifier.classifyFile(f.filename, f.filename);
      const cat = classification.category;

      const mockFile = {
        path: f.filename,
        fullPath: f.filename,
        extension: ext,
        category: cat,
        size: 100,
        patch: f.patch || ""
      };

      const cfg = store && typeof store.getConfig === "function" ? store.getConfig() : {};

      // 1. Try to fetch full file content from remote PR (side = "new")
      let fileContent = "";
      let retrievedFullContent = false;
      if (payload?.prUrl) {
        try {
          fileContent = await fetchPRFileContentHelper({
            filename: f.filename,
            side: "new",
            prUrl: payload.prUrl,
            repoType: payload.repoType,
            token: payload.token
          }, cfg);
          retrievedFullContent = true;
        } catch (err) {
          console.warn(`[Review] Could not fetch full PR content for ${f.filename}:`, err.message);
        }
      }

      // 2. Fallback to local customer solution if remote fetch failed or wasn't run
      if (!retrievedFullContent && cfg?.ifs?.customerPath) {
        let cleanRelPath = f.filename;
        if (/^[ab]\//i.test(cleanRelPath)) {
          cleanRelPath = cleanRelPath.substring(2);
        }
        const fullLocal = path.join(cfg.ifs.customerPath, cleanRelPath);
        if (fs.existsSync(fullLocal)) {
          try {
            fileContent = fs.readFileSync(fullLocal, "utf-8");
            retrievedFullContent = true;
          } catch (err) {
            console.warn(`[Review] Failed to read local customer file ${fullLocal}:`, err.message);
          }
        }
      }

      // 3. Last resort fallback: use the patch/diff itself
      if (!retrievedFullContent) {
        fileContent = f.patch || "";
      }

      mockFile.size = fileContent.length;

      const agentResult = await require("./reviewEngine/agents").delegateReview(
        mockFile,
        fileContent,
        llm,
        postFunc,
        prFilesList
      );

      consolidatedFindings.push(...(agentResult.findings || []).map(finding => ({
        ...finding,
        filename: f.filename
      })));
    }
  } else {
    // Fallback: run on unified diff as a generic file
    const mockFile = {
      path: "PR_DIFF.diff",
      fullPath: "PR_DIFF.diff",
      extension: ".diff",
      category: "generic",
      size: unifiedDiff.length,
      patch: unifiedDiff
    };

    const agentResult = await require("./reviewEngine/agents").delegateReview(
      mockFile,
      unifiedDiff,
      llm,
      postFunc
    );

    consolidatedFindings.push(...(agentResult.findings || []));
  }

  // Live OData ERP connected validation is disabled per user request

  // Enforce 3-tier sorting: IFS_AQS -> ORACLE -> IFS_ERP
  const classificationOrder = { "IFS_AQS": 1, "ORACLE": 2, "IFS_ERP": 3 };
  consolidatedFindings.forEach(f => {
    if (!f.classification || !classificationOrder[f.classification]) {
      f.classification = "IFS_ERP";
    }
  });

  consolidatedFindings.sort((a, b) => {
    const valA = classificationOrder[a.classification] || 99;
    const valB = classificationOrder[b.classification] || 99;
    return valA - valB;
  });

  // Calculate score based on findings severity
  let high = 0, medium = 0, low = 0;
  consolidatedFindings.forEach(f => {
    const sev = String(f.severity || "info").toLowerCase();
    if (sev === "blocker" || sev === "critical" || sev === "high") high++;
    else if (sev === "major" || sev === "warning" || sev === "medium") medium++;
    else low++;
  });
  const score = Math.max(0, 100 - (high * 40 + medium * 15 + low * 5));

  return {
    score,
    severity: high > 0 ? "HIGH" : medium > 0 ? "MEDIUM" : "LOW",
    confidence: 0.9,
    findings: consolidatedFindings,
    fileReasoning: {}
  };
});

// -----------------------------
// IPC: Generate Auto-Fix for a single finding (Azure/OpenAI)
// -----------------------------
ipcMain.handle("fix:generate", async (_evt, payload) => {
  const llm = getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) throw new Error(err);

  const provider = (llm.provider || "azure").toLowerCase();
  const temperature = typeof llm.temperature === "number" ? llm.temperature : 0.1;

  const filename = payload?.filename || "";
  const matchText = payload?.matchText || "";
  const title = payload?.title || "";
  const explanation = payload?.explanation || "";
  const filePatch = payload?.filePatch || "";       
  const unifiedDiff = payload?.unifiedDiff || "";   

  if (!filename) throw new Error("filename is required");
  if (!filePatch && !unifiedDiff) throw new Error("No diff context provided");

  const system =
    "Role: IFS AQS Auto-fix agent. Provide clean code change. Output JSON only. No markdown.";

  const user = `Fix finding in: ${filename}
Title: ${title}
Explanation: ${explanation}
Match text: ${matchText}
Diff context:
${filePatch || unifiedDiff}

Return JSON Schema:
{
  "suggestedFix": "Corrected code snippet only",
  "fixPatch": "Unified diff patch for this file (optional)",
  "confidence": 0.9,
  "notes": "explanation of fix"
}
`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let url, headers, body;
  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${llm.apiKey}`, "Content-Type": "application/json" };
    body = { model: llm.model, messages, temperature };
  } else if (provider === "ollama") {
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    url = `${endpoint}/api/chat`;
    headers = { "Content-Type": "application/json" };
    body = { model: llm.model, messages, stream: false, options: { temperature } };
  } else {
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    const apiVersion = llm.apiVersion || "2024-02-15-preview";
    url = `${endpoint}/openai/deployments/${llm.model}/chat/completions?api-version=${apiVersion}`;
    headers = { "api-key": llm.apiKey, "Content-Type": "application/json" };
    body = { messages, temperature };
  }

  const res = await axios.post(url, body, { headers });
  const content = provider === "ollama" ? (res?.data?.message?.content || "") : (res?.data?.choices?.[0]?.message?.content || "");
  const parsed = extractJson(content);

  if (!parsed) {
    return {
      suggestedFix: "Unable to generate a structured fix. Try again.",
      fixPatch: "",
      confidence: 0.2,
      notes: "LLM returned non-JSON output",
      raw: content,
    };
  }

  return {
    suggestedFix: String(parsed.suggestedFix || ""),
    fixPatch: String(parsed.fixPatch || ""),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    notes: String(parsed.notes || ""),
  };
});

// -----------------------------
// IPC: Repository-Wide AI Review (NEW - Full Repo Analysis with File Type Detection)
// Analyzes entire repository with 2-pass review: static + LLM per-file-type
// Entry point: window.api.reviewRepository({ repoPath, maxFiles, mode })
// Returns: comprehensive report with per-file + consolidated findings
// Backward-compatible: doesn't affect existing review:run (diff-based) flow
// -----------------------------
ipcMain.handle("review:repo", async (_evt, payload) => {
  const orchestrator = require("./reviewEngine/orchestrator");

  const repoPath = payload?.repoPath || "";
  const maxFiles = typeof payload?.maxFiles === "number" ? payload.maxFiles : 500;
  const mode = String(payload?.mode || "full").toLowerCase(); // "full" or "static-only"

  if (!repoPath) throw new Error("repoPath is required for repository review");

  try {
    // Prepare LLM function if in "full" mode
    let llmPostFunc = null;
    if (mode === "full") {
      const llm = getLLMConfigSafe();
      const err = validateLLM(llm);
      if (err) throw new Error(`LLM not configured: ${err}`);

      llmPostFunc = async (url, body, headers) => {
        return await postWithRetry(url, body, headers, 3, 750);
      };
    }

    // Run orchestrated review
    const result = await orchestrator.reviewRepository(repoPath, {
      maxFiles,
      progressCallback: (progress) => {
        console.log(`[Review Progress] ${progress.phase}: ${progress.status || progress.processed}/${progress.total}`);
      },
      llmConfig: llm,
      llmPostFunction: llmPostFunc
    });

    if (!result.success) {
      throw new Error(result.error || "Repository review failed");
    }

    return {
      ok: true,
      report: result.report
    };
  } catch (e) {
    console.error("❌ review:repo failed:", e.message);
    return {
      ok: false,
      error: e.message || "Repository review failed"
    };
  }
});

ipcMain.handle("mcp:getStatus", async () => {
  return { ok: true, status: "disabled" };
});

ipcMain.handle("mcp:analyzeImpact", async () => {
  return {
    ok: true,
    result: {
      riskLevel: "Low",
      impactedAreas: [],
      summary: "MCP integration is disabled."
    }
  };
});

ipcMain.handle("mcp:fetchIFSMetadata", async () => {
  return { ok: false, error: "MCP integration is disabled." };
});

ipcMain.handle("mcp:verifyOAuth2", async () => {
  return { ok: false, error: "MCP integration is disabled." };
});

ipcMain.handle("mcp:verifyIFSConnection", async () => {
  return { ok: false, error: "MCP integration is disabled." };
});

ipcMain.handle("mcp:getAuditTrail", async () => {
  return { ok: true, audit: [] };
});

// =============================// ================= Full File Content (GitHub + Azure DevOps)
// Exposes renderer API: window.api.getFileContent({ filename, side, repoType, prUrl, selectedPrId })
// side: "new" (latest/head) | "old" (base)
// =============================
async function fetchPRFileContentHelper(payload, cfg) {
  const filename = String(payload?.filename || "").trim();
  const side = String(payload?.side || "new").toLowerCase(); // "new" | "old"
  const prUrl = String(payload?.prUrl || payload?.selectedPrId || "").trim();
  const repoTypeFromUi = String(payload?.repoType || "").toLowerCase();

  if (!filename) throw new Error("filename is required");
  if (!prUrl) throw new Error("prUrl (or selectedPrId) is required");

  // Infer repo type if not provided
  const inferredRepoType = isAzureDevOpsPrUrl(prUrl) ? "azure" : "github";
  const repoType = repoTypeFromUi || cfg?.repoType || inferredRepoType;

  // -------------------------
  // Azure DevOps
  // -------------------------
  if (repoType === "azure") {
    const a = getAzureSettings(cfg, payload);
    const org = a.org;
    const project = a.project;
    const repoIdOrName = a.repoIdOrName;
    const pat = a.pat;
    const apiVersion = a.apiVersion || "7.1";

    if (!org || !project || !repoIdOrName || !pat) {
      throw new Error("Azure DevOps settings are incomplete (org/project/repo/PAT required).");
    }

    const prId = parseAzurePullRequestId(prUrl);
    if (!prId) throw new Error("Azure PR ID not found in URL");

    const baseUrlRaw = String(a.baseUrl || "https://dev.azure.com").trim().replace(/\/+$/, "");
    const orgRoot = baseUrlRaw.toLowerCase().endsWith("/" + org.toLowerCase())
      ? baseUrlRaw
      : `${baseUrlRaw}/${encodeURIComponent(org)}`;

    const apiRoot = `${orgRoot}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}`;

    const headers = {
      Authorization: azureAuthHeaderFromPat(pat),
      Accept: "application/json",
    };

    // PR details to get commit ids (check cache first)
    const cacheKey = `azure:${apiRoot}:${prId}`;
    let prData;
    const now = Date.now();
    const cached = prDetailsCache.get(cacheKey);
    if (cached && (now - cached.timestamp < 300000)) {
      prData = cached.data;
    } else {
      const prApiUrl = `${apiRoot}/pullRequests/${encodeURIComponent(prId)}?api-version=${encodeURIComponent(apiVersion)}`;
      prData = await azureGetJson(prApiUrl, headers);
      if (prData) {
        prDetailsCache.set(cacheKey, { data: prData, timestamp: now });
      }
    }

    const baseCommit =
      prData?.lastMergeTargetCommit?.commitId || prData?.lastMergeCommit?.commitId;
    const headCommit =
      prData?.lastMergeSourceCommit?.commitId || prData?.lastMergeCommit?.commitId;

    if (!baseCommit || !headCommit) {
      throw new Error("Unable to determine PR base/head commits from Azure DevOps response.");
    }

    const commitId = side === "old" ? baseCommit : headCommit;

    // Azure items API path must start with '/'
    const path = filename.startsWith("/") ? filename : `/${filename}`;

    const text = await azureGetItemText({
      apiRoot,
      path,
      commitId,
      apiVersion,
      headers,
    });

    return text || "";
  }

  // -------------------------
  // GitHub
  // -------------------------
  {
    // Token + repo info
    const ghSettings = getGithubSettings(cfg, payload);
    const t = normalizeToken(payload?.token || ghSettings?.token || cfg?.githubToken);
    if (!t) throw new Error("GitHub Token is missing. Please configure it in Settings.");

    // Parse PR URL to get owner/repo/pr#
    const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);

    // Fetch PR details to get head/base SHA (check cache first)
    const cacheKey = `github:${owner}:${repo}:${pull_number}`;
    let prData;
    const now = Date.now();
    const cached = prDetailsCache.get(cacheKey);
    if (cached && (now - cached.timestamp < 300000)) {
      prData = cached.data;
    } else {
      const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;
      const prRes = await axios.get(prApi, {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AQSInspect",
        },
      });
      prData = prRes.data;
      if (prData) {
        prDetailsCache.set(cacheKey, { data: prData, timestamp: now });
      }
    }

    const baseSha = prData?.base?.sha;
    const headSha = prData?.head?.sha;

    if (!baseSha || !headSha) throw new Error("Unable to determine PR base/head SHA from GitHub response.");

    const ref = side === "old" ? baseSha : headSha;

    // GitHub contents API needs URL-encoded path
    const encodedPath = encodeURIComponent(filename).replace(/%2F/g, "/");
    const contentUrl = `${apiBase}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

    const contentRes = await axios.get(contentUrl, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "AQSInspect",
      },
    });

    const data = contentRes.data;

    // If it's a file, GitHub returns base64 content
    if (data && data.type === "file" && data.content) {
      const buff = Buffer.from(String(data.content).replace(/\n/g, ""), "base64");
      return buff.toString("utf8");
    }

    // If GitHub returns something else (e.g. directory)
    throw new Error("GitHub returned non-file content (path may be a directory or missing).");
  }
}

// =============================
// ================= Full File Content (GitHub + Azure DevOps)
// Exposes renderer API: window.api.getFileContent({ filename, side, repoType, prUrl, selectedPrId })
// side: "new" (latest/head) | "old" (base)
// =============================
ipcMain.handle("file:getContent", async (_evt, payload) => {
  const cfg = store.getConfig ? store.getConfig() : readConfigFile();
  return await fetchPRFileContentHelper(payload, cfg);
});

// ===========================
// Rules Management
// ===========================
ipcMain.handle('rules:list', async (_evt) => {
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    const allRules = rulesStore.loadAllRules();
    return { ok: true, rules: allRules, total: allRules.length };
  } catch (e) {
    console.error('rules:list failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to load rules' };
  }
});

ipcMain.handle('rules:update', async (_evt, payload) => {
  const { rule } = payload || {};
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.saveRule(rule);
    return { ok: true };
  } catch (e) {
    console.error('rules:update failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to update rule' };
  }
});

ipcMain.handle('rules:approve', async (_evt, payload) => {
  const { ruleId, approvedStatus } = payload || {};
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.setRuleApproval(ruleId, approvedStatus);
    return { ok: true };
  } catch (e) {
    console.error('rules:approve failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to change approval' };
  }
});

ipcMain.handle('rules:approveAll', async (_evt) => {
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.approveAllRules();
    return { ok: true };
  } catch (e) {
    console.error('rules:approveAll failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to approve all rules' };
  }
});

ipcMain.handle('rules:disapproveAll', async (_evt) => {
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.disapproveAllRules();
    return { ok: true };
  } catch (e) {
    console.error('rules:disapproveAll failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to disapprove all rules' };
  }
});

ipcMain.handle('rules:buildFromCore', async () => {
  return { ok: false, error: 'Rules generation from Core Solution is disabled.' };
});

ipcMain.handle('rules:export', async (_evt) => {
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    const allRules = rulesStore.loadAllRules();
    
    const res = await dialog.showSaveDialog({
      defaultPath: 'aqs-rules-export.json',
      filters: [
        { name: 'JSON Rules', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (res.canceled) return { ok: false, error: 'cancelled' };
    const filePath = res.filePath;

    const formattedRules = allRules.map(r => {
      const severityLower = String(r.severity || "major").toLowerCase();
      return {
        rule_id: r.rule_id || r.id,
        title: r.title || "",
        description: r.description || "",
        layer: r.layer || (r.category === "projection" ? "Projection" : "all"),
        category: r.category || "all",
        subcategory: r.subcategory || "",
        severity: severityLower,
        approved: r.approved ?? true,
        source: r.source || "custom",
        pattern: r.pattern || "",
        alertOnMissing: r.alertOnMissing ?? false,
        classification: r.classification || "CUSTOM",
        applicable_versions: r.applicable_versions || ["ifs_cloud"],
        compliant_example: r.compliant_example || null,
        non_compliant_example: r.non_compliant_example || null,
        rationale: r.rationale || "",
        detection_logic: r.detection_logic || {
          method: "regex",
          pattern: r.pattern || "",
          file_types: r.category !== "all" ? [`.${r.category}`] : []
        },
        remediation: r.remediation || {
          steps: (r.recommendation || "").split(". ").filter(Boolean),
          estimated_effort: "trivial",
          automated_fix_available: false
        },
        tags: r.tags || [],
        related_rules: r.related_rules || [],
        compliance_exceptions: r.compliance_exceptions || null
      };
    });

    const exportData = {
      _schema_version: "1.0.0",
      _part_meta: {
        part_number: 1,
        total_parts: 1,
        part_title: "Exported Ruleset",
        categories_included: Array.from(new Set(allRules.map(r => r.category || "all"))),
        rules_in_part: allRules.length,
        rule_id_ranges: {}
      },
      _meta: {
        title: "AQS Inspect Exported Ruleset",
        description: "Exported ruleset from AQS Inspect static analysis dictionary",
        version: "1.0.0",
        last_updated: new Date().toISOString().split('T')[0],
        total_rules_all_parts: allRules.length,
        severity_model: {
          blocker: "Prevents deployment. Breaks transactions, security, or upgrade safety. Threshold: 0",
          critical: "High-risk defect requiring immediate fix. Threshold: 0, override allowed with approval",
          major: "Standards violation affecting maintainability/performance. Threshold: 10",
          minor: "Style/documentation issue. Threshold: 50",
          info: "Best practice recommendation. Threshold: unlimited"
        }
      },
      rules: formattedRules
    };

    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    return { ok: true, path: filePath };
  } catch (e) {
    console.error('rules:export failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to export rules' };
  }
});

ipcMain.handle('rules:import', async (_evt) => {
  try {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'JSON Rules', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (res.canceled) return { ok: false, error: 'cancelled' };
    const filePath = res.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const importedData = JSON.parse(content);

    let rulesList = [];
    if (importedData && Array.isArray(importedData.rules)) {
      rulesList = importedData.rules;
    } else if (Array.isArray(importedData)) {
      rulesList = importedData;
    } else if (importedData && typeof importedData === 'object') {
      rulesList = [importedData];
    }

    const rulesStore = require('./reviewEngine/rulesStore');
    let count = 0;

    for (const rule of rulesList) {
      const ruleId = rule.rule_id || rule.id;
      if (ruleId && rule.title) {
        let severity = rule.severity || "Major";
        if (typeof severity === 'string') {
          if (severity.toLowerCase() === 'blocker') severity = 'Blocker';
          else if (severity.toLowerCase() === 'critical') severity = 'Critical';
          else if (severity.toLowerCase() === 'major') severity = 'Major';
          else if (severity.toLowerCase() === 'minor') severity = 'Minor';
          else if (severity.toLowerCase() === 'info') severity = 'Info';
        }

        const cleanedRule = {
          id: String(ruleId).trim(),
          rule_id: String(ruleId).trim(),
          category: rule.category || "all",
          subcategory: rule.subcategory || "",
          layer: rule.layer || "all",
          severity: severity,
          title: String(rule.title).trim(),
          description: rule.description || "",
          recommendation: rule.remediation?.steps ? rule.remediation.steps.join(". ") : (rule.recommendation || ""),
          pattern: rule.pattern || (rule.detection_logic?.pattern || ""),
          alertOnMissing: rule.alertOnMissing ?? false,
          approved: rule.approved ?? true,
          source: rule.source && typeof rule.source === 'string' ? rule.source : (rule.source?.title || "imported"),
          classification: rule.classification || "CUSTOM",
          applicable_versions: rule.applicable_versions || ["ifs_cloud"],
          compliant_example: rule.compliant_example || null,
          non_compliant_example: rule.non_compliant_example || null,
          rationale: rule.rationale || "",
          detection_logic: rule.detection_logic || null,
          remediation: rule.remediation || null,
          tags: rule.tags || [],
          related_rules: rule.related_rules || [],
          compliance_exceptions: rule.compliance_exceptions || null
        };
        rulesStore.saveRule(cleanedRule);
        count++;
      }
    }

    return { ok: true, count };
  } catch (e) {
    console.error('rules:import failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to import rules' };
  }
});


ipcMain.handle('rules:delete', async (_evt, payload) => {
  const { ruleId } = payload || {};
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.deleteRule(ruleId);
    return { ok: true };
  } catch (e) {
    console.error('rules:delete failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to delete rule' };
  }
});

ipcMain.handle('rules:deleteAll', async (_evt) => {
  try {
    const rulesStore = require('./reviewEngine/rulesStore');
    rulesStore.deleteAllRules();
    return { ok: true };
  } catch (e) {
    console.error('rules:deleteAll failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to delete all rules' };
  }
});




// ===========================
// User Email Fetching
// ===========================
ipcMain.handle('user:getEmail', async (_evt, payload) => {
  const { repoType } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};
  
  try {
    if (repoType === 'azure' || !repoType) {
      // For Azure DevOps, fetch from current user
      const a = getAzureSettings(cfg, payload);
      if (!a.org || !a.pat) {
        return { ok: false, error: 'Azure DevOps settings incomplete' };
      }
      
      const headers = {
        Authorization: `Basic ${Buffer.from(`:${a.pat}`, 'utf8').toString('base64')}`,
        Accept: 'application/json'
      };
      
      let profileUrl = (a.baseUrl || 'https://dev.azure.com').replace(/\/+$/, '');
      if (profileUrl.includes('dev.azure.com') || profileUrl.includes('visualstudio.com')) {
        try {
          const u = new URL(profileUrl);
          const pathParts = u.pathname.split('/').filter(Boolean);
          if (pathParts.length === 0 && a.org) {
            profileUrl = `${profileUrl}/${encodeURIComponent(a.org)}`;
          }
        } catch (e) {
          // ignore
        }
      } else {
        try {
          const u = new URL(profileUrl);
          const tfsIdx = u.pathname.toLowerCase().indexOf('/tfs');
          if (tfsIdx !== -1) {
            profileUrl = `${u.origin}${u.pathname.substring(0, tfsIdx + 4)}`;
          } else {
            profileUrl = u.origin;
          }
        } catch (e) {
          // ignore
        }
      }

      const res = await axios.get(
        `${profileUrl}/_apis/profile/profiles/me?api-version=7.0`,
        { headers }
      );
      
      const email = res.data?.publicAlias || res.data?.emailAddress || res.data?.mail;
      if (!email) return { ok: false, error: 'Email not found in Azure profile' };
      return { ok: true, email };
    } else if (repoType === 'github') {
      const ghSettings = getGithubSettings(cfg, payload);
      const t = ghSettings?.token || cfg?.githubToken;
      if (!t) return { ok: false, error: 'GitHub token not configured' };
      
      const res = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: 'application/vnd.github+json'
        }
      });
      
      let email = res.data?.email;
      if (!email) {
        // GitHub may not expose primary email, fetch from emails endpoint
        const emailRes = await axios.get('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${t}`,
            Accept: 'application/vnd.github+json'
          }
        });
        
        const primary = (emailRes.data || []).find((e) => e.primary);
        email = primary?.email || (emailRes.data && emailRes.data[0]?.email);
      }
      
      if (!email) return { ok: false, error: 'Email not found in GitHub profile' };
      return { ok: true, email };
    }
    
    return { ok: false, error: 'Unknown repo type' };
  } catch (e) {
    console.error('user:getEmail failed:', e?.message || e);
    return { ok: false, error: e?.message || 'Failed to fetch user email' };
  }
});

// ===========================
// MCP Verification
// ===========================
ipcMain.handle('mcp:verify', async (_evt) => {
  return {
    ok: false,
    status: 'disabled',
    available: false,
    message: '❌ MCP Server is disabled'
  };
});

ipcMain.handle("review:saveFeedback", async (_evt, payload) => {
  const { findingKey, status } = payload || {};
  if (!findingKey || !status) {
    return { ok: false, error: "Missing required arguments" };
  }
  
  try {
    const fs = require('fs');
    const path = require('path');
    const userDataPath = app.getPath('userData');
    const feedbackFile = path.join(userDataPath, 'review_feedback.json');
    
    let feedbackDb = {};
    if (fs.existsSync(feedbackFile)) {
      try {
        feedbackDb = JSON.parse(fs.readFileSync(feedbackFile, 'utf-8'));
      } catch (e) {
        console.error("Failed to parse feedback DB:", e.message);
      }
    }
    
    feedbackDb[findingKey] = {
      status,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(feedbackFile, JSON.stringify(feedbackDb, null, 2));
    console.log(`[Feedback Loop] Saved feedback for key "${findingKey}": ${status}`);
    return { ok: true };
  } catch (err) {
    console.error("Failed to save review feedback:", err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("review:loadFeedback", async () => {
  try {
    const fs = require('fs');
    const path = require('path');
    const userDataPath = app.getPath('userData');
    const feedbackFile = path.join(userDataPath, 'review_feedback.json');
    
    if (fs.existsSync(feedbackFile)) {
      const content = fs.readFileSync(feedbackFile, 'utf-8');
      return { ok: true, feedback: JSON.parse(content) };
    }
    return { ok: true, feedback: {} };
  } catch (err) {
    console.error("Failed to load review feedback:", err.message);
    return { ok: false, error: err.message, feedback: {} };
  }
});
