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

/**
 * Validates PR projections and entities against the connected IFS ERP (Read-Only)
 */
async function validatePRAgainstERP(prDetails, ifsConfig) {
  const erpFindings = [];
  if (!ifsConfig || (!ifsConfig.odataUrl && !ifsConfig.metadataUrl)) {
    return erpFindings;
  }

  try {
    // 1. Fetch metadata in a completely read-only request
    const metadata = await ifsOData.fetchMetadata(ifsConfig);
    const metadataStr = String(metadata?.data || "");

    const files = prDetails?.files || [];
    for (const f of files) {
      const filename = String(f.filename || "").toLowerCase();
      
      // Parse projection files (e.g. DemoCustomer.projection -> DemoCustomer)
      if (filename.endsWith(".projection")) {
        const baseName = path.basename(filename, ".projection");
        const cleanProjName = baseName.replace(/handling$/i, ""); // Common IFS naming

        // Check if metadata contains the projection reference
        const existsInMetadata = metadataStr.includes(baseName) || metadataStr.includes(cleanProjName);
        
        if (!existsInMetadata) {
          erpFindings.push({
            severity: "Warning",
            confidence: 0.85,
            title: "Projection not found in target ERP",
            explanation: `The projection '${baseName}' was not found in the connected IFS ERP metadata. If this is a new custom projection, ensure it is deployed first.`,
            ruleId: "ERP_VAL_PROJECTION_MISSING",
            recommendation: "Ensure this projection exists or is included in the deployment package before merging.",
            lineRange: null,
            matchText: f.filename,
            classification: "IFS_ERP"
          });
        }
      }

      // Check for C# form files (IEE Forms) - Warnings for IFS Cloud target
      if (filename.endsWith(".cs") && (filename.includes("designer.cs") || contentHasFormsHooks(f.patch))) {
        erpFindings.push({
          severity: "Major",
          confidence: 0.9,
          title: "Legacy C# Form committed",
          explanation: `File '${f.filename}' contains C# code. C# Forms are deprecated in IFS Cloud and only supported in Apps10 & lower.`,
          ruleId: "ERP_VAL_LEGACY_FORM",
          recommendation: "If target is IFS Cloud, rewrite this customization as an Aurena projection (.projection) and client (.client).",
          lineRange: null,
          matchText: f.filename,
          classification: "IFS_ERP"
        });
      }
    }
  } catch (err) {
    // Graceful fallback if ERP is unreachable
    console.warn("Could not query live ERP for PR validation:", err.message);
  }

  return erpFindings;
}

function contentHasFormsHooks(patch) {
  if (!patch) return false;
  const upper = patch.toUpperCase();
  return upper.includes("APF") || upper.includes("FNDATTRIBUTE") || upper.includes("WINDOW");
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
  
  // Expose live validation against connection settings
  const erpFindings = await validatePRAgainstERP(prDetails, ifsConfig);
  impactAnalysis.findings.push(...erpFindings);

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
  verifyIFSConnection,
  validatePRAgainstERP
};
