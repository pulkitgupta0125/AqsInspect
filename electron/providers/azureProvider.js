const { requestJson } = require("./http");
const { getCached, setCached } = require("./cache");

function authHeaderFromPat(pat) {
  // Basic base64(":"+PAT)
  const b64 = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${b64}`;
}

function mapAzureStatus(pr) {
  const st = (pr.status || "").toLowerCase();
  if (st === "active") return "open";
  if (st === "abandoned") return "closed";
  if (st === "completed") {
    // Prefer merged (Azure completed typically means merged)
    // If mergeStatus exists and indicates failure, treat as closed.
    const ms = (pr.mergeStatus || "").toLowerCase();
    if (ms && ms !== "succeeded") return "closed";
    return "merged";
  }
  return "closed";
}

async function listPullRequests({ filters, repoSettings }) {
  const cleanSettings = normalizeAzureSettings(repoSettings);
  const org = cleanSettings?.org;
  const project = cleanSettings?.project;
  const repoIdOrName = cleanSettings?.repoIdOrName;
  const pat = cleanSettings?.pat;
  const baseUrl = cleanSettings?.baseUrl || "https://dev.azure.com";
  const apiVersion = cleanSettings?.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure settings are incomplete (org/project/repoIdOrName/pat required).");
  }

  const statusUi = (filters?.status || "all").toLowerCase();
  const statusMap = {
    open: "active",
    merged: "completed",
    closed: "abandoned",
  };

  const azureStatus = statusUi === "all" ? null : statusMap[statusUi] || null;

  const createdFrom = filters?.createdFrom;
  const createdTo = filters?.createdTo;

  const cacheKey = { provider: "azure", baseUrl, org, project, repoIdOrName, statusUi, createdFrom, createdTo, createdBy: filters?.createdBy || "" };
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const headers = {
    Authorization: authHeaderFromPat(pat),
    Accept: "application/json",
  };

  let all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("api-version", apiVersion);
    if (azureStatus) qs.set("searchCriteria.status", azureStatus);

    // Date range
    if (createdFrom) qs.set("searchCriteria.minTime", new Date(createdFrom).toISOString());
    if (createdTo) qs.set("searchCriteria.maxTime", new Date(createdTo).toISOString());
    if (createdFrom || createdTo) qs.set("searchCriteria.queryTimeRangeType", "Created");

    qs.set("$top", String(top));
    qs.set("$skip", String(skip));

    const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests?${qs.toString()}`;

    const data = await requestJson(url, { headers });
    const items = data.value || [];
    all.push(...items);

    if (items.length < top) break;
    skip += top;
    if (skip > 5000) break; // safety
  }

  const createdByFilter = (filters?.createdBy || "").trim().toLowerCase();
  if (createdByFilter) {
    all = all.filter((pr) => {
      const name = (pr.createdBy?.displayName || pr.createdBy?.uniqueName || "").toLowerCase();
      return name.includes(createdByFilter);
    });
  }

  const norm = all.map((pr) => ({
    id: String(pr.pullRequestId),
    title: pr.title,
    url: pr._links?.web?.href || pr.url || "",
    createdAt: pr.creationDate,
    createdBy: pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
    status: mapAzureStatus(pr),
    description: pr.description || "",
  }));

  setCached(cacheKey, norm, 60_000);
  return norm;
}

async function getPullRequestDetails({ prUrlOrId, repoSettings }) {
  const cleanSettings = normalizeAzureSettings(repoSettings);
  const org = cleanSettings?.org;
  const project = cleanSettings?.project;
  const repoIdOrName = cleanSettings?.repoIdOrName;
  const pat = cleanSettings?.pat;
  const baseUrl = cleanSettings?.baseUrl || "https://dev.azure.com";
  const apiVersion = cleanSettings?.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure settings are incomplete (org/project/repoIdOrName/pat required).");
  }

  const prId = extractAzurePrId(prUrlOrId);
  if (!prId) throw new Error("PR id/url invalid.");

  const headers = { Authorization: authHeaderFromPat(pat) };
  const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests/${encodeURIComponent(prId)}?api-version=${apiVersion}`;

  const pr = await requestJson(url, { headers });

  return {
    id: String(pr.pullRequestId),
    title: pr.title,
    url: pr._links?.web?.href || pr.url || "",
    createdAt: pr.creationDate,
    createdBy: pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
    creatorEmail: pr.createdBy?.uniqueName && pr.createdBy.uniqueName.includes("@") ? pr.createdBy.uniqueName : "",
    status: mapAzureStatus(pr),
  };
}

function extractAzurePrId(prUrlOrId) {
  if (!prUrlOrId) return null;
  const str = String(prUrlOrId).trim();
  
  if (/^\d+$/.test(str)) {
    return str;
  }
  
  const m =
    str.match(/(?:pullrequest|pullrequests)\/(\d+)/i) ||
    str.match(/[?&](?:pullRequestId|prId|pr|id)=(\d+)(?:&|$)/i);
  
  if (m) {
    return m[1];
  }
  
  if (str.includes(":") || str.includes("/")) {
    return null;
  }
  
  return str;
}

function normalizeAzureSettings(settings) {
  if (!settings) return settings;
  const result = { ...settings };
  
  const fields = ["org", "project", "repoIdOrName"];
  let urlToParse = null;
  
  for (const f of fields) {
    if (result[f] && typeof result[f] === "string" && (result[f].startsWith("http://") || result[f].startsWith("https://"))) {
      urlToParse = result[f];
      break;
    }
  }
  
  if (urlToParse) {
    try {
      const { URL } = require("url");
      const u = new URL(urlToParse);
      const host = u.hostname.toLowerCase();
      let org = "";
      let project = "";
      let repo = "";
      
      const pathParts = u.pathname.split("/").filter(Boolean);
      
      if (host === "dev.azure.com") {
        if (pathParts.length >= 1) org = pathParts[0];
        if (pathParts.length >= 2) project = pathParts[1];
        const gitIdx = pathParts.indexOf("_git");
        if (gitIdx !== -1 && pathParts.length > gitIdx + 1) {
          repo = pathParts[gitIdx + 1];
        } else if (pathParts.length >= 5 && pathParts[2] === "_apis" && pathParts[3] === "git" && pathParts[4] === "repositories" && pathParts.length > 5) {
          repo = pathParts[5];
        }
      } else if (host.endsWith(".visualstudio.com")) {
        org = host.split(".")[0];
        if (pathParts.length >= 1) project = pathParts[0];
        const gitIdx = pathParts.indexOf("_git");
        if (gitIdx !== -1 && pathParts.length > gitIdx + 1) {
          repo = pathParts[gitIdx + 1];
        } else if (pathParts.length >= 4 && pathParts[1] === "_apis" && pathParts[2] === "git" && pathParts[3] === "repositories" && pathParts.length > 4) {
          repo = pathParts[4];
        }
      }
      
      if (org) result.org = org;
      if (project) result.project = project;
      if (repo) result.repoIdOrName = repo;
    } catch (e) {
      console.warn("Failed to auto-parse Azure DevOps URL in settings:", e.message);
    }
  }
  
  if (result.org) result.org = String(result.org).trim().replace(/\/+$/, "");
  if (result.project) result.project = String(result.project).trim().replace(/\/+$/, "");
  if (result.repoIdOrName) result.repoIdOrName = String(result.repoIdOrName).trim().replace(/\/+$/, "");
  if (result.baseUrl) result.baseUrl = String(result.baseUrl).trim().replace(/\/+$/, "");
  
  return result;
}

async function updateAzurePullRequestStatus({ prUrlOrId, repoSettings, status }) {
  const cleanSettings = normalizeAzureSettings(repoSettings);
  const org = cleanSettings?.org;
  const project = cleanSettings?.project;
  const repoIdOrName = cleanSettings?.repoIdOrName;
  const pat = cleanSettings?.pat;
  const baseUrl = cleanSettings?.baseUrl || "https://dev.azure.com";
  const apiVersion = cleanSettings?.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure settings are incomplete (org/project/repoIdOrName/pat required).");
  }

  const prId = extractAzurePrId(prUrlOrId);
  if (!prId) {
    throw new Error("PR id/url invalid.");
  }

  const headers = {
    Authorization: authHeaderFromPat(pat),
    "Content-Type": "application/json",
  };

  const cleanBaseUrl = String(baseUrl).trim().replace(/\/+$/, "");
  const url = `${cleanBaseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests/${encodeURIComponent(prId)}?api-version=${apiVersion}`;

  const body = { status };
  if (status === "completed") {
    body.completionOptions = { mergeCommitMessage: `Merged by AQS Inspect`, deleteSourceBranch: false };
  }

  const result = await requestJson(url, { method: "PATCH", headers, body });
  return result;
}

async function mergePullRequest({ prUrlOrId, repoSettings }) {
  const result = await updateAzurePullRequestStatus({ prUrlOrId, repoSettings, status: "completed" });
  return { merged: true, message: result?.status || "Pull request marked completed.", details: result };
}

async function closePullRequest({ prUrlOrId, repoSettings }) {
  const result = await updateAzurePullRequestStatus({ prUrlOrId, repoSettings, status: "abandoned" });
  return { abandoned: true, message: result?.status || "Pull request abandoned.", details: result };
}

module.exports = {
  listPullRequests,
  getPullRequestDetails,
  mergePullRequest,
  closePullRequest,
  normalizeAzureSettings,
  extractAzurePrId
};