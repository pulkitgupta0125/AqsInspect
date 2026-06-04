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

function buildUrl(baseUrl, path = "") {
  if (!baseUrl) throw new Error("Base OData/REST URL is required.");
  return `${baseUrl.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
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

async function fetchMetadata(config = {}) {
  const metadataUrls = resolveMetadataUrls(config);
  if (!metadataUrls.length) {
    throw new Error("OData base URL or explicit metadataUrl is required for metadata discovery.");
  }
  let lastError = null;

  for (const url of metadataUrls) {
    const headers = buildHeaders(config);

    try {
      const res = await axios.get(url, {
        headers,
        timeout: 15000
      });

      return {
        url,
        status: res.status,
        contentType: res.headers["content-type"],
        data: res.data
      };
    } catch (err) {
      const error = new Error(err.message);
      error.requestUrl = url;
      error.requestHeaders = { ...headers, Authorization: headers.Authorization ? "[REDACTED]" : undefined };
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

async function fetchEntitySet(config = {}, entitySet, query = "") {
  if (!entitySet) {
    throw new Error("Entity set is required.");
  }

  const url = buildUrl(config.odataUrl, `${entitySet}${query ? `?${query.replace(/^\?/, "")}` : ""}`);
  const headers = buildHeaders(config);
  
  try {
    const res = await axios.get(url, {
      headers,
      timeout: 15000
    });

    return { url, status: res.status, data: res.data };
  } catch (err) {
    const error = new Error(err.message);
    error.requestUrl = url;
    error.requestHeaders = { ...headers, Authorization: headers.Authorization ? "[REDACTED]" : undefined };
    error.responseStatus = err.response?.status;
    error.responseData = err.response?.data;
    throw error;
  }
}

async function fetchRestResource(config = {}, resourcePath, params = {}) {
  if (!resourcePath) {
    throw new Error("REST resource path is required.");
  }

  const url = buildUrl(config.restUrl, resourcePath);
  const headers = buildHeaders(config);
  
  try {
    const res = await axios.get(url, {
      headers,
      params,
      timeout: 15000
    });

    return { url, status: res.status, data: res.data };
  } catch (err) {
    const error = new Error(err.message);
    error.requestUrl = url;
    error.requestHeaders = { ...headers, Authorization: headers.Authorization ? "[REDACTED]" : undefined };
    error.responseStatus = err.response?.status;
    error.responseData = err.response?.data;
    throw error;
  }
}

module.exports = {
  buildHeaders,
  buildUrl,
  fetchMetadata,
  fetchEntitySet,
  fetchRestResource
};
