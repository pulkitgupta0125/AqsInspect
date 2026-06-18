const axios = require("axios");

function buildHeaders(config = {}) {
  const headers = {
    Accept: "application/json"
  };

  if (config.accessToken) {
    headers.Authorization = `Bearer ${config.accessToken}`;
  }

  if (config.basicAuthUser && config.basicAuthPassword) {
    const token = Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`, "utf8").toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  if (config.additionalHeaders && typeof config.additionalHeaders === "object") {
    Object.assign(headers, config.additionalHeaders);
  }

  return headers;
}


function resolveMetadataUrls(config = {}) {
  const metadataUrl = String(config.metadataUrl || "").trim();
  const odataUrl = String(config.odataUrl || "").trim();

  if (metadataUrl) {
    if (metadataUrl.includes("$metadata")) {
      return [metadataUrl];
    }

    return [
      `${metadataUrl.replace(/\/$/, "")}/$metadata`,
      `${metadataUrl.replace(/\/$/, "")}/odata/$metadata`,
      `${metadataUrl.replace(/\/$/, "")}/OData/$metadata`
    ];
  }

  if (!odataUrl) {
    return [];
  }

  return [
    `${odataUrl.replace(/\/$/, "")}/$metadata`,
    `${odataUrl.replace(/\/$/, "")}/odata/$metadata`,
    `${odataUrl.replace(/\/$/, "")}/OData/$metadata`
  ];
}

async function refreshIfsToken(ifsConfig) {
  const tokenUrl = String(ifsConfig.tokenUrl || "").trim();
  const clientId = String(ifsConfig.clientId || "").trim();
  const clientSecret = String(ifsConfig.clientSecret || "").trim();
  const grantType = String(ifsConfig.grantType || "").trim();
  
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Cannot refresh token: configuration is incomplete (tokenUrl, clientId, clientSecret required).");
  }
  
  let tokenData = null;
  
  if (grantType === "client_credentials" || (!grantType && !ifsConfig.refreshToken)) {
    console.log("[OData] Refreshing OAuth2 token via client_credentials...");
    const bodyParams = {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    };
    if (ifsConfig.scope) {
      bodyParams.scope = ifsConfig.scope;
    }
    const body = new URLSearchParams(bodyParams);
    const res = await axios.post(tokenUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    tokenData = res.data;
  } else if (grantType === "refresh_token" || ifsConfig.refreshToken) {
    console.log("[OData] Refreshing OAuth2 token via refresh_token...");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: ifsConfig.refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });
    const authHeaders = {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`
    };
    const res = await axios.post(tokenUrl, body.toString(), {
      headers: authHeaders
    });
    tokenData = res.data;
  } else {
    throw new Error(`Unsupported grant type for auto-refresh: ${grantType}`);
  }
  
  if (!tokenData || !tokenData.access_token) {
    throw new Error("Token refresh response did not contain access_token.");
  }
  
  try {
    const configStore = require("../configStore");
    const cfg = configStore.getConfig() || {};
    cfg.oauth2 = {
      ...cfg.oauth2,
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
    };
    if (tokenData.refresh_token) {
      cfg.oauth2.refreshToken = tokenData.refresh_token;
    }
    configStore.saveConfig(cfg);
    console.log("[OData] OAuth2 token refreshed and saved successfully.");
  } catch (storeErr) {
    console.warn("[OData] Failed to save refreshed token to config store:", storeErr.message);
  }
  
  ifsConfig.accessToken = tokenData.access_token;
  ifsConfig.expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
  if (tokenData.refresh_token) {
    ifsConfig.refreshToken = tokenData.refresh_token;
  }
  
  return tokenData.access_token;
}

async function ensureValidToken(ifsConfig) {
  const expiresAt = ifsConfig.expiresAt || ifsConfig.expires_at;
  if (ifsConfig.accessToken && expiresAt && expiresAt > Date.now() + 60000) {
    return ifsConfig.accessToken;
  }
  return await refreshIfsToken(ifsConfig);
}

async function executeODataRequest(url, method = "GET", body = null, ifsConfig = {}) {
  let token = ifsConfig.accessToken;
  if (ifsConfig.tokenUrl && ifsConfig.clientId && ifsConfig.clientSecret) {
    try {
      token = await ensureValidToken(ifsConfig);
    } catch (err) {
      console.warn("[OData] Pre-request token refresh failed:", err.message);
    }
  }

  const headers = buildHeaders({ ...ifsConfig, accessToken: token });
  
  const axiosConfig = {
    method,
    url,
    headers,
    timeout: 15000,
    ...(body ? { data: body } : {})
  };

  try {
    return await axios(axiosConfig);
  } catch (err) {
    if (err.response?.status === 401 && ifsConfig.tokenUrl && ifsConfig.clientId && ifsConfig.clientSecret) {
      console.log("[OData] Request returned 401. Attempting automatic token refresh...");
      try {
        const refreshedToken = await refreshIfsToken(ifsConfig);
        const retryHeaders = buildHeaders({ ...ifsConfig, accessToken: refreshedToken });
        return await axios({
          ...axiosConfig,
          headers: retryHeaders
        });
      } catch (refreshErr) {
        console.error("[OData] Automatic token refresh failed:", refreshErr.message);
        throw err;
      }
    }
    throw err;
  }
}

async function fetchMetadata(config = {}) {
  const metadataUrls = resolveMetadataUrls(config);
  if (!metadataUrls.length) {
    throw new Error("OData base URL or explicit metadataUrl is required for metadata discovery.");
  }
  let lastError = null;

  for (const url of metadataUrls) {
    try {
      const res = await executeODataRequest(url, "GET", null, config);

      return {
        url,
        status: res.status,
        contentType: res.headers["content-type"],
        data: res.data
      };
    } catch (err) {
      const error = new Error(err.message);
      error.requestUrl = url;
      error.requestHeaders = { Accept: "application/json", Authorization: config.accessToken ? "[REDACTED]" : undefined };
      error.responseStatus = err.response?.status;
      error.responseData = err.response?.data;
      lastError = error;

      const isUnsupportedUrl = err.response?.status === 400 &&
        typeof err.response?.data === "object" &&
        (err.response.data?.error?.code === "ODP_UNSUPPORTED_URL" ||
         String(err.response.data?.error?.message || "").includes("Invalid URL"));

      if (!isUnsupportedUrl) {
        throw error;
      }
    }
  }

  throw lastError;
}

module.exports = {
  fetchMetadata
};
