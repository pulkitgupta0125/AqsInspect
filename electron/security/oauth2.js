const axios = require("axios");
const { URLSearchParams } = require("url");

function buildAuthorizationUrl({
  authUrl,
  clientId,
  redirectUri,
  scope = "openid profile email",
  state = "",
  responseType = "code",
  extraParams = {}
}) {
  if (!authUrl || !clientId || !redirectUri) {
    throw new Error("OAuth2 authorization URL requires authUrl, clientId, and redirectUri.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope,
    state,
    ...extraParams
  });

  return `${authUrl.replace(/\/$/, "")}?${params.toString()}`;
}

async function exchangeAuthorizationCode({
  tokenUrl,
  clientId,
  clientSecret,
  code,
  redirectUri
}) {
  if (!tokenUrl || !clientId || !clientSecret || !code || !redirectUri) {
    throw new Error("OAuth2 token exchange requires tokenUrl, clientId, clientSecret, code, and redirectUri.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }

  const res = await axios.post(tokenUrl, body.toString(), {
    headers
  });

  return res.data;
}

async function refreshToken({
  tokenUrl,
  clientId,
  clientSecret,
  refreshToken
}) {
  if (!tokenUrl || !clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth2 refresh requires tokenUrl, clientId, clientSecret, and refreshToken.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }

  const res = await axios.post(tokenUrl, body.toString(), {
    headers
  });

  return res.data;
}

async function validateToken({
  accessToken,
  introspectionUrl,
  clientId,
  clientSecret
}) {
  if (!accessToken) {
    return { valid: false, error: "Access token is missing" };
  }

  if (!introspectionUrl) {
    return { valid: true, error: null, note: "No introspection URL configured; token validity inferred by presence." };
  }

  try {
    const body = new URLSearchParams({
      token: accessToken,
      client_id: clientId || "",
      client_secret: clientSecret || ""
    });

    const res = await axios.post(introspectionUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    return { valid: !!res.data?.active, payload: res.data };
  } catch (err) {
    return { valid: false, error: err.message || "OAuth2 validation failed" };
  }
}

module.exports = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshToken,
  validateToken
};
