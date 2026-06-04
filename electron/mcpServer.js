const { getProvider } = require("./providers");
const configStore = require("./configStore");
const ruleEngine = require("./reviewEngine/ruleEngine");
const ifsOData = require("./integration/ifsOData");
const oauth2 = require("./security/oauth2");
const audit = require("./extensions/audit");

function getConfig() {
  return configStore.getConfig();
}

function getStatus() {
  const cfg = getConfig();
  return {
    ready: !!cfg?.repoType,
    repoType: cfg?.repoType || "github",
    hasRepoCredentials: Boolean(cfg?.github?.token || cfg?.githubToken || cfg?.azure?.pat),
    ifsConfigured: Boolean(cfg?.ifs?.odataUrl || cfg?.ifs?.restUrl),
    oauth2Configured: Boolean(cfg?.oauth2?.clientId && cfg?.oauth2?.tokenUrl),
    mcpMode: cfg?.mcp?.mode || "hybrid",
    lastAudit: audit.summarizeAuditTrail({ limit: 5 })
  };
}

async function analyzePullRequestImpact({ prUrlOrId, repoType, repoSettings, ifsConfig, mcpConfig = {} }) {
  if (!prUrlOrId) {
    throw new Error("PR URL or ID is required for impact analysis.");
  }

  const provider = getProvider(repoType || "github");
  const prDetails = await provider.getPullRequestDetails({ prUrlOrId, repoSettings });

  let ifsMetadata = null;
  try {
    ifsMetadata = await ifsOData.fetchMetadata(ifsConfig || {});
  } catch (err) {
    ifsMetadata = { error: err.message };
  }

  const impactAnalysis = ruleEngine.validatePRImpact(prDetails, ifsMetadata);
  const auditEvent = audit.recordAuditEvent("pr-impact-analysis", {
    prUrlOrId,
    repoType,
    repoSettings: { provider: repoSettings ? "configured" : "missing" },
    ifsConfig: { configured: Boolean(ifsConfig?.odataUrl || ifsConfig?.restUrl) },
    mcpMode: mcpConfig.mode || "hybrid",
    impactSummary: impactAnalysis.impact
  });

  return {
    pr: prDetails,
    ifsMetadata,
    impact: impactAnalysis.impact,
    findings: impactAnalysis.findings,
    auditEvent,
    mode: mcpConfig.mode || "hybrid"
  };
}

async function fetchIFSMetadata(ifsConfig = {}) {
  return await ifsOData.fetchMetadata(ifsConfig);
}

async function verifyOAuth2(oauth2Config = {}) {
  if (!oauth2Config.clientId || !oauth2Config.clientSecret || !oauth2Config.tokenUrl) {
    return { valid: false, error: "OAuth2 configuration is incomplete." };
  }
  return await oauth2.validateToken({
    accessToken: oauth2Config.accessToken,
    introspectionUrl: oauth2Config.introspectionUrl,
    clientId: oauth2Config.clientId,
    clientSecret: oauth2Config.clientSecret
  });
}

async function verifyIFSConnection(ifsConfig = {}) {
  try {
    const meta = await fetchIFSMetadata(ifsConfig);
    return { ok: true, meta: { url: meta.url, status: meta.status, contentType: meta.contentType } };
  } catch (err) {
    const errorInfo = {
      ok: false,
      error: err.message || "Failed to connect to IFS endpoint",
      debug: {
        requestUrl: err.requestUrl,
        requestHeaders: err.requestHeaders,
        responseStatus: err.responseStatus,
        responseData: err.responseData
      }
    };
    return errorInfo;
  }
}

module.exports = {
  getStatus,
  analyzePullRequestImpact,
  fetchIFSMetadata,
  verifyOAuth2,
  verifyIFSConnection
};
