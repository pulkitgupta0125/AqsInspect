const { requestJson } = require("./http");
const { getCached, setCached } = require("./cache");

function normalizeStatus(item, requestedStatus) {
  // For GitHub Search issues: open/closed.
  // If we queried is:merged, treat as merged.
  if (requestedStatus === "merged") return "merged";
  if (item.state === "open") return "open";
  return "closed";
}

function buildSearchQuery({ owner, repo }, filters) {
  const parts = [`repo:${owner}/${repo}`, "is:pr"];

  const status = (filters?.status || "all").toLowerCase();
  if (status === "open") parts.push("is:open");
  else if (status === "closed") parts.push("is:closed");
  else if (status === "merged") parts.push("is:merged");

  const createdFrom = filters?.createdFrom;
  const createdTo = filters?.createdTo;
  if (createdFrom || createdTo) {
    const from = createdFrom || "*";
    const to = createdTo || "*";
    parts.push(`created:${from}..${to}`);
  }

  const createdBy = String(filters?.createdBy || "").trim();
  if (createdBy && createdBy.length > 0) {
    parts.push(`author:${createdBy}`);
  }

  return parts.join(" ");
}

async function listPullRequests({ filters, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required).");
  }

  const status = (filters?.status || "all").toLowerCase();
  const q = buildSearchQuery({ owner, repo }, filters);

  const cacheKey = { provider: "github", baseUrl, owner, repo, q };
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // GitHub Search Issues API
  const url = `${baseUrl}/search/issues?q=${encodeURIComponent(q)}&per_page=50&page=1`;

  const data = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const items = (data.items || []).map((it) => ({
    id: String(it.number),
    title: it.title,
    url: it.html_url,
    createdAt: it.created_at,
    createdBy: it.user?.login || "unknown",
    status: normalizeStatus(it, status),
    description: it.body || "",
  }));

  setCached(cacheKey, items, 60_000);
  return items;
}

async function getPullRequestDetails({ prUrlOrId, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required).");
  }

  // Accept numeric id or full URL
  let number = prUrlOrId;
  if (typeof prUrlOrId === "string" && prUrlOrId.includes("/pull/")) {
    const m = prUrlOrId.match(/\/pull\/(\d+)/);
    if (m) number = m[1];
  }
  if (!number) throw new Error("PR id/url invalid.");

  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  let creatorEmail = "";
  const username = pr.user?.login;

  // 1. Fetch user profile (public email)
  if (username) {
    try {
      const userUrl = `${baseUrl}/users/${username}`;
      const userProfile = await requestJson(userUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (userProfile && userProfile.email) {
        creatorEmail = userProfile.email;
      }
    } catch (err) {
      console.warn("Failed to fetch user profile for PR creator email:", err.message);
    }
  }

  // 2. Fetch repo commits by author (guarantees email belongs to verified commits of this user)
  if (!creatorEmail && username) {
    try {
      const authorCommitsUrl = `${baseUrl}/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&per_page=5`;
      const authorCommits = await requestJson(authorCommitsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (Array.isArray(authorCommits)) {
        const foundCommit = authorCommits.find(c => c.author?.login?.toLowerCase() === username.toLowerCase() && c.commit?.author?.email);
        if (foundCommit) {
          creatorEmail = foundCommit.commit.author.email;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch author commits for PR creator email:", err.message);
    }
  }

  // 3. Check PR commits (only matching author login)
  if (!creatorEmail && username) {
    try {
      const commitsUrl = `${baseUrl}/repos/${owner}/${repo}/pulls/${number}/commits`;
      const commits = await requestJson(commitsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (Array.isArray(commits)) {
        const matchingCommit = commits.find(c => c.author?.login?.toLowerCase() === username.toLowerCase() && c.commit?.author?.email);
        if (matchingCommit) {
          creatorEmail = matchingCommit.commit.author.email;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch commits for PR creator email:", err.message);
    }
  }

  return {
    id: String(pr.number),
    title: pr.title,
    url: pr.html_url,
    createdAt: pr.created_at,
    createdBy: pr.user?.login || "unknown",
    creatorEmail: creatorEmail || "",
    status: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed",
  };
}

async function mergePullRequest({ prUrlOrId, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required)."
    );
  }

  let number = prUrlOrId;
  if (typeof prUrlOrId === "string" && prUrlOrId.includes("/pull/")) {
    const m = prUrlOrId.match(/\/pull\/(\d+)/);
    if (m) number = m[1];
  }

  if (!number) {
    throw new Error("PR id/url invalid.");
  }

  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${number}/merge`;
  const result = await requestJson(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: { commit_title: `Merge PR #${number} via AQS Inspect`, merge_method: "merge" },
  });

  return { merged: true, sha: result.sha, message: result.message || "Pull request merged." };
}

async function closePullRequest({ prUrlOrId, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required)."
    );
  }

  let number = prUrlOrId;
  if (typeof prUrlOrId === "string" && prUrlOrId.includes("/pull/")) {
    const m = prUrlOrId.match(/\/pull\/(\d+)/);
    if (m) number = m[1];
  }

  if (!number) {
    throw new Error("PR id/url invalid.");
  }

  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${number}`;
  const result = await requestJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: { state: "closed" },
  });

  return { closed: true, message: result.message || "Pull request closed." };
}

module.exports = { listPullRequests, getPullRequestDetails, mergePullRequest, closePullRequest };