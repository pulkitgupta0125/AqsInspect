const https = require("https");
const { URL } = require("url");

function makeHttpsRequest(url, { method = "GET", headers = {}, body } = {}, format = "json") {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "User-Agent": "AQS-Inspect",
          "Accept": format === "json" ? "application/json" : "text/plain",
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            const err = new Error(`HTTP ${status}: ${raw?.slice(0, 300)}`);
            err.statusCode = status;
            return reject(err);
          }
          if (format === "json") {
            try {
              resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
              reject(new Error("Failed to parse JSON response"));
            }
          } else {
            resolve(raw);
          }
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function requestJson(url, options = {}) {
  let lastError;
  const attempts = 3;
  const initialDelay = 500;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await makeHttpsRequest(url, options, "json");
    } catch (err) {
      lastError = err;
      const code = err.code || "";
      const status = err.statusCode || 0;
      const isTransient = code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "ECONNREFUSED" || status === 429 || (status >= 500 && status <= 599);
      if (isTransient && attempt < attempts) {
        const delay = initialDelay * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function requestText(url, options = {}) {
  let lastError;
  const attempts = 3;
  const initialDelay = 500;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await makeHttpsRequest(url, options, "text");
    } catch (err) {
      lastError = err;
      const code = err.code || "";
      const status = err.statusCode || 0;
      const isTransient = code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "ECONNREFUSED" || status === 429 || (status >= 500 && status <= 599);
      if (isTransient && attempt < attempts) {
        const delay = initialDelay * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

module.exports = { requestJson, requestText };