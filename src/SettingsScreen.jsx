import { useEffect, useMemo, useState } from "react";

export default function SettingsScreen({ onBack }) {
  /* =============================
     STATE
  ============================= */
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("repo");

  // Repo settings
  const [repoType, setRepoType] = useState("github");
  const [github, setGithub] = useState({ token: "", owner: "", repo: "", baseUrl: "" });
  const [azure, setAzure] = useState({ org: "", project: "", repoIdOrName: "", pat: "", baseUrl: "", apiVersion: "7.1" });

  // LLM settings
  const [provider, setProvider] = useState("azure");
  const [llm, setLLM] = useState({
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2
  });

  const [ifs, setIfs] = useState({
    metadataUrl: "",
    odataUrl: "",
    restUrl: "",
    tenantId: ""
  });

  // optional local IFS core path for rule generation
  const [ifsCorePath, setIfsCorePath] = useState("");

  const [oauth2, setOAuth2] = useState({
    authUrl: "",
    tokenUrl: "",
    introspectionUrl: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    scope: "openid profile email",
    accessToken: "",
    refreshToken: "",
    grantType: "client_credentials",
    authCode: ""
  });

  const [email, setEmail] = useState({
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    from: "",
    to: "",
    replyTo: ""
  });

  const [mcp, setMcp] = useState({
    mode: "hybrid",
    enableImpactAnalysis: true
  });

  const [repoStatus, setRepoStatus] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [ifsStatus, setIfsStatus] = useState(null);
  const [ifsDebug, setIfsDebug] = useState(null);
  const [oauthStatus, setOAuthStatus] = useState(null);
  const [mcpStatus, setMcpStatus] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [tokenResult, setTokenResult] = useState(null);
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userEmailStatus, setUserEmailStatus] = useState(null);
  // const [mcpStatus, setMcpStatus] = useState(null);
  const [mcpLoading, setMcpLoading] = useState(false);

  /* =============================
     LOAD CONFIG
  ============================= */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();

        setRepoType(cfg?.repoType || "github");

        setGithub({
          token: cfg?.github?.token || cfg?.githubToken || "",
          owner: cfg?.github?.owner || "",
          repo: cfg?.github?.repo || "",
          baseUrl: cfg?.github?.baseUrl || ""
        });

        setAzure({
          org: cfg?.azure?.org || "",
          project: cfg?.azure?.project || "",
          repoIdOrName: cfg?.azure?.repoIdOrName || "",
          pat: cfg?.azure?.pat || "",
          baseUrl: cfg?.azure?.baseUrl || "",
          apiVersion: cfg?.azure?.apiVersion || "7.1"
        });

        if (cfg?.llm) {
          setLLM(cfg.llm);
          setProvider(cfg.llm.provider || "azure");
        }

        setIfs({
          metadataUrl: cfg?.ifs?.metadataUrl || "",
          odataUrl: cfg?.ifs?.odataUrl || "",
          restUrl: cfg?.ifs?.restUrl || "",
          tenantId: cfg?.ifs?.tenantId || "",
          clientId: cfg?.ifs?.clientId || "",
          clientSecret: cfg?.ifs?.clientSecret || "",
          accessToken: cfg?.ifs?.accessToken || ""
        });

        setIfsCorePath(cfg?.ifs?.corePath || cfg?.ifsCorePath || "");

        setOAuth2({
          authUrl: cfg?.oauth2?.authUrl || "",
          tokenUrl: cfg?.oauth2?.tokenUrl || "",
          introspectionUrl: cfg?.oauth2?.introspectionUrl || "",
          clientId: cfg?.oauth2?.clientId || "",
          clientSecret: cfg?.oauth2?.clientSecret || "",
          redirectUri: cfg?.oauth2?.redirectUri || "",
          scope: cfg?.oauth2?.scope || "openid profile email",
          accessToken: cfg?.oauth2?.accessToken || "",
          refreshToken: cfg?.oauth2?.refreshToken || "",
          grantType: "client_credentials",
          authCode: ""
        });

        setEmail({
          host: cfg?.email?.host || cfg?.smtp?.host || "",
          port: cfg?.email?.port || cfg?.smtp?.port || 587,
          secure: cfg?.email?.secure ?? cfg?.smtp?.secure ?? false,
          user: cfg?.email?.user || cfg?.smtp?.user || "",
          pass: cfg?.email?.pass || cfg?.smtp?.pass || "",
          from: cfg?.email?.from || cfg?.smtp?.from || "",
          to: cfg?.email?.to || cfg?.smtp?.to || "",
          replyTo: cfg?.email?.replyTo || cfg?.smtp?.replyTo || ""
        });

        setMcp({
          mode: cfg?.mcp?.mode || "hybrid",
          enableImpactAnalysis: cfg?.mcp?.enableImpactAnalysis !== false
        });
      } catch (err) {
        console.error("Failed to load config", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* =============================
     VERIFY GITHUB TOKEN
  ============================= */
  const verifyToken = async () => {
    setRepoStatus("Checking...");
    try {
      const result = await window.api.verifyGitHubToken(github.token);
      if (result.valid) {
        setRepoStatus(`✅ Valid (User: ${result.username})`);
      } else {
        setRepoStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      setRepoStatus("❌ Verification failed");
    }
  };

  /* =============================
     VERIFY LLM CONFIG
  ============================= */
  const verifyLLM = async () => {
    if (!llm?.apiKey) {
      setLlmStatus("❌ API key is missing");
      return;
    }

    if (provider === "azure" && !llm.endpoint) {
      setLlmStatus("❌ Azure endpoint required");
      return;
    }

    setLlmStatus("Checking...");

    try {
      const result = await window.api.verifyLLMConfig({ ...llm, provider });
      if (result.valid) {
        setLlmStatus("✅ LLM connection successful");
      } else {
        setLlmStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      setLlmStatus("❌ Verification failed");
    }
  };

  const verifyEmailSettings = async () => {
    setEmailStatus("Checking...");
    try {
      const result = await window.api.testSMTP({ ...email });
      if (result.ok) {
        setEmailStatus("✅ SMTP connection successful");
      } else {
        setEmailStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      setEmailStatus("❌ Verification failed");
    }
  };

  const verifyIFSConnection = async () => {
    setIfsStatus("Checking...");
    setIfsDebug(null);
    try {
      let currentOAuth2 = { ...oauth2 };

      if (!currentOAuth2.accessToken) {
        if (currentOAuth2.grantType === "client_credentials") {
          setIfsStatus("Requesting client credentials token...");
          const tokenResult = await window.api.requestOAuth2Token({
            grantType: currentOAuth2.grantType,
            tokenUrl: currentOAuth2.tokenUrl,
            clientId: currentOAuth2.clientId,
            clientSecret: currentOAuth2.clientSecret,
            scope: currentOAuth2.scope,
            redirectUri: currentOAuth2.redirectUri,
            authUrl: currentOAuth2.authUrl,
            code: currentOAuth2.authCode,
            refreshToken: currentOAuth2.refreshToken
          });

          if (!tokenResult?.ok) {
            setIfsStatus(`❌ ${tokenResult?.error || "Unable to request OAuth2 token"}`);
            return;
          }

          const newToken = {
            accessToken: tokenResult.tokenResponse?.access_token || currentOAuth2.accessToken,
            refreshToken: tokenResult.tokenResponse?.refresh_token || currentOAuth2.refreshToken
          };
          currentOAuth2 = { ...currentOAuth2, ...newToken };
          setOAuth2((prev) => ({ ...prev, ...newToken }));
        } else {
          setIfsStatus("❌ Access token is missing. Please request an OAuth2 token first.");
          return;
        }
      }

      const result = await window.api.verifyIFSConnection({ ...ifs, ...currentOAuth2 });
      if (result.ok) {
        setIfsStatus(`✅ Connected: ${result.meta.status} ${result.meta.contentType || ""}`);
        setIfsDebug(null);
      } else {
        setIfsStatus(`❌ ${result.error}`);
        if (result.debug) {
          setIfsDebug(result.debug);
        }
      }
    } catch (err) {
      setIfsStatus("❌ Verification failed");
      setIfsDebug(null);
    }
  };

  const verifyOAuth = async () => {
    setOAuthStatus("Checking...");
    try {
      const result = await window.api.verifyOAuth2Config(oauth2);
      if (result.ok) {
        setOAuthStatus("✅ OAuth2 configuration is valid");
      } else {
        setOAuthStatus(`❌ ${result.result?.error || result.error}`);
      }
    } catch (err) {
      setOAuthStatus("❌ Verification failed");
    }
  };

  const refreshMCPStatus = async () => {
    try {
      const response = await window.api.getMCPStatus();
      if (response?.ok) {
        setMcpStatus(response.status);
      } else {
        setMcpStatus({ error: response?.error || "Unable to fetch MCP status" });
      }
    } catch (err) {
      setMcpStatus({ error: err.message || "MCP status fetch failed" });
    }
  };

  const refreshAuditTrail = async () => {
    try {
      const response = await window.api.getAuditTrail();
      if (response?.ok) {
        setAuditTrail(response.audit || []);
      } else {
        setAuditTrail([{ type: "error", payload: response?.error || "Unable to fetch audit trail" }]);
      }
    } catch (err) {
      setAuditTrail([{ type: "error", payload: err.message || "Audit fetch failed" }]);
    }
  };

  const loadRules = async () => {
    setRulesLoading(true);
    try {
      const response = await window.api.listRules();
      if (response?.ok) {
        setRules(response.rules || []);
      } else {
        setRules([]);
      }
    } catch (err) {
      console.error('Failed to load rules:', err);
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  };

  const fetchUserEmail = async () => {
    setUserEmailStatus('Fetching...');
    try {
      const response = await window.api.getUserEmail({ repoType });
      if (response?.ok) {
        setUserEmail(response.email);
        setUserEmailStatus(`✅ ${response.email}`);
      } else {
        setUserEmailStatus(`❌ ${response?.error || 'Failed to fetch email'}`);
      }
    } catch (err) {
      setUserEmailStatus(`❌ ${err?.message || 'Failed to fetch email'}`);
    }
  };

  const verifyMCP = async () => {
    setMcpLoading(true);
    try {
      const response = await window.api.verifyMCP();
      if (response?.ok) {
        setMcpStatus(`✅ ${response.message || 'MCP Server is available'}`);
      } else {
        setMcpStatus(`⚠️ ${response?.message || response?.error || 'MCP not available'}`);
      }
    } catch (err) {
      setMcpStatus(`❌ ${err?.message || 'Failed to check MCP'}`);
    } finally {
      setMcpLoading(false);
    }
  };

  const requestOAuth2Token = async () => {
    setOAuthStatus("Requesting token...");
    try {
      const payload = {
        grantType: "client_credentials",
        tokenUrl: String(oauth2.tokenUrl || "").trim(),
        clientId: String(oauth2.clientId || "").trim(),
        clientSecret: String(oauth2.clientSecret || "").trim(),
        scope: String(oauth2.scope || "").trim()
      };

      const result = await window.api.requestOAuth2Token(payload);
      if (!result?.ok) {
        setOAuthStatus(`❌ ${result?.error || "Failed to request token"}`);
        return;
      }

      const newToken = {
        accessToken: result.tokenResponse?.access_token || oauth2.accessToken,
        refreshToken: result.tokenResponse?.refresh_token || oauth2.refreshToken
      };

      setOAuth2((prev) => ({ ...prev, ...newToken }));
      setTokenResult(result.tokenResponse);
      setOAuthStatus("✅ Token request succeeded");
    } catch (err) {
      setOAuthStatus("❌ Token request failed");
    }
  };

  /* =============================
     SAVE CONFIG
  ============================= */
  const saveConfig = async () => {
    try {
      setRepoStatus(null);

      // Validate
      if (repoType === "github") {
        if (!github.token || !github.owner || !github.repo) {
          setRepoStatus("❌ GitHub token + owner + repo are required");
          return;
        }
      }

      if (repoType === "azure") {
        if (!azure.org || !azure.project || !azure.repoIdOrName || !azure.pat) {
          setRepoStatus("❌ Azure org + project + repo + PAT are required");
          return;
        }
      }

      await window.api.saveConfig({
        repoType,
        github: { ...github, baseUrl: github.baseUrl || undefined },
        azure: { ...azure, baseUrl: azure.baseUrl || undefined },

        // migration-safe legacy key
        githubToken: github.token,

        llm: { ...llm, provider },
        email: {
          host: email.host,
          port: Number(email.port),
          secure: email.secure,
          user: email.user,
          pass: email.pass,
          from: email.from,
          to: email.to,
          replyTo: email.replyTo
        },
        ifs: {
          metadataUrl: ifs.metadataUrl,
          odataUrl: ifs.odataUrl,
          restUrl: ifs.restUrl,
          tenantId: ifs.tenantId,
          clientId: ifs.clientId,
          clientSecret: ifs.clientSecret,
          accessToken: ifs.accessToken
        ,
          corePath: ifsCorePath
        },
        oauth2: { ...oauth2 },
        mcp: { ...mcp }
      });

      alert("✅ Configuration saved");
    } catch (err) {
      console.error("Save failed", err);
      alert("❌ Failed to save config");
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Settings</h2>

      <button onClick={onBack}>⬅ Back</button>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        {[
          { key: "repo", label: "Repo" },
          { key: "llm", label: "LLM" },
          { key: "email", label: "Email" },
          { key: "ifs", label: "IFS ERP" },
          { key: "mcp", label: "MCP" },
          { key: "rules", label: "Rules" }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "8px 14px",
              background: activeTab === tab.key ? "#1c7ed6" : "#f4f4f4",
              color: activeTab === tab.key ? "white" : "black",
              border: "none",
              borderRadius: 6,
              cursor: "pointer"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 22 }}>
        {activeTab === "repo" && (
          <>
            <h3>Repository</h3>
            <select
              value={repoType}
              onChange={(e) => setRepoType(e.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 6 }}
            >
              <option value="github">GitHub</option>
              <option value="azure">Azure DevOps</option>
            </select>

            <div style={{ marginTop: 12 }}>
              {repoType === "github" && (
                <>
                  <input
                    type="password"
                    placeholder="GitHub Token"
                    value={github.token}
                    onChange={(e) => setGithub({ ...github, token: e.target.value })}
                    style={{ width: "100%", marginTop: 10 }}
                  />

                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <input
                      placeholder="Owner (org/user)"
                      value={github.owner}
                      onChange={(e) => setGithub({ ...github, owner: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <input
                      placeholder="Repo"
                      value={github.repo}
                      onChange={(e) => setGithub({ ...github, repo: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>

                  <input
                    placeholder="Base URL (optional, GitHub Enterprise)"
                    value={github.baseUrl}
                    onChange={(e) => setGithub({ ...github, baseUrl: e.target.value })}
                    style={{ width: "100%", marginTop: 10 }}
                  />
                </>
              )}

              {repoType === "azure" && (
                <>
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <input
                      placeholder="Organization"
                      value={azure.org}
                      onChange={(e) => setAzure({ ...azure, org: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <input
                      placeholder="Project"
                      value={azure.project}
                      onChange={(e) => setAzure({ ...azure, project: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>

                  <input
                    placeholder="Repository ID or Name"
                    value={azure.repoIdOrName}
                    onChange={(e) => setAzure({ ...azure, repoIdOrName: e.target.value })}
                    style={{ width: "100%", marginTop: 10 }}
                  />

                  <input
                    type="password"
                    placeholder="Azure DevOps PAT"
                    value={azure.pat}
                    onChange={(e) => setAzure({ ...azure, pat: e.target.value })}
                    style={{ width: "100%", marginTop: 10 }}
                  />

                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <input
                      placeholder="Base URL (optional)"
                      value={azure.baseUrl}
                      onChange={(e) => setAzure({ ...azure, baseUrl: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <input
                      placeholder="API Version"
                      value={azure.apiVersion}
                      onChange={(e) => setAzure({ ...azure, apiVersion: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>
                </>
              )}

              <div style={{ marginTop: 10 }}>
                <button onClick={verifyToken}>🔍 Verify Repo Settings</button>
                {repoStatus && <span style={{ marginLeft: 10 }}>{repoStatus}</span>}
              </div>
            </div>
          </>
        )}

        {activeTab === "llm" && (
          <>
            <h3>LLM Provider</h3>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 6 }}
            >
              <option value="azure">Azure OpenAI</option>
              <option value="openai">OpenAI (api.openai.com)</option>
            </select>

            <h3 style={{ marginTop: 20 }}>LLM Configuration</h3>
            {provider === "azure" && (
              <input
                placeholder="Azure Endpoint"
                value={llm.endpoint}
                onChange={(e) => setLLM({ ...llm, endpoint: e.target.value })}
                style={{ width: "100%", marginTop: 10 }}
              />
            )}

            <input
              type="password"
              placeholder="API Key"
              value={llm.apiKey}
              onChange={(e) => setLLM({ ...llm, apiKey: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <input
              placeholder="Model / Deployment Name"
              value={llm.model}
              onChange={(e) => setLLM({ ...llm, model: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <input
              type="number"
              step="0.1"
              placeholder="Temperature"
              value={llm.temperature}
              onChange={(e) => setLLM({ ...llm, temperature: Number(e.target.value) })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <div style={{ marginTop: 10 }}>
              <button onClick={verifyLLM}>🧪 Verify LLM</button>
              {llmStatus && <span style={{ marginLeft: 10 }}>{llmStatus}</span>}
            </div>
          </>
        )}

        {activeTab === "email" && (
          <>
            <h3>Email / SMTP</h3>
            <input
              placeholder="SMTP Host"
              value={email.host}
              onChange={(e) => setEmail({ ...email, host: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <input
                type="number"
                placeholder="Port"
                value={email.port}
                onChange={(e) => setEmail({ ...email, port: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <input
                  type="checkbox"
                  checked={email.secure}
                  onChange={(e) => setEmail({ ...email, secure: e.target.checked })}
                />
                Use TLS/SSL
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <input
                placeholder="SMTP Username"
                value={email.user}
                onChange={(e) => setEmail({ ...email, user: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                type="password"
                placeholder="SMTP Password"
                value={email.pass}
                onChange={(e) => setEmail({ ...email, pass: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>
            <input
              placeholder="From Address"
              value={email.from}
              onChange={(e) => setEmail({ ...email, from: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="To Address"
              value={email.to}
              onChange={(e) => setEmail({ ...email, to: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="Reply-To Address"
              value={email.replyTo}
              onChange={(e) => setEmail({ ...email, replyTo: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <div style={{ marginTop: 10 }}>
              <button onClick={verifyEmailSettings}>🔍 Verify SMTP</button>
              {emailStatus && <span style={{ marginLeft: 10 }}>{emailStatus}</span>}
            </div>
          </>
        )}

        {activeTab === "ifs" && (
          <>
            <h3>IFS / ERP Configuration</h3>
            <input
              placeholder="IFS Metadata URL (optional)"
              value={ifs.metadataUrl}
              onChange={(e) => setIfs({ ...ifs, metadataUrl: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <div style={{ marginTop: 6, padding: 10, background: "#eefcf0", borderRadius: 6, color: "#0f5132" }}>
              Optional explicit metadata endpoint. If automatic discovery fails, enter the full metadata URL here.
            </div>
            <input
              placeholder="IFS OData URL"
              value={ifs.odataUrl}
              onChange={(e) => setIfs({ ...ifs, odataUrl: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="IFS REST Base URL"
              value={ifs.restUrl}
              onChange={(e) => setIfs({ ...ifs, restUrl: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="Tenant ID"
              value={ifs.tenantId}
              onChange={(e) => setIfs({ ...ifs, tenantId: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <h4 style={{ marginTop: 18 }}>OAuth2 Token Settings</h4>
            <div style={{ marginTop: 6, padding: 10, background: "#eef2ff", borderRadius: 6, color: "#1e3a8a" }}>
              grant_type is fixed to <strong>client_credentials</strong>.
            </div>
            <input
              placeholder="Access Token URL"
              value={oauth2.tokenUrl}
              onChange={(e) => setOAuth2({ ...oauth2, tokenUrl: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="Client ID"
              value={oauth2.clientId}
              onChange={(e) => setOAuth2({ ...oauth2, clientId: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={oauth2.clientSecret}
              onChange={(e) => setOAuth2({ ...oauth2, clientSecret: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="Scope"
              value={oauth2.scope}
              onChange={(e) => setOAuth2({ ...oauth2, scope: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />
            <input
              placeholder="Access Token"
              value={oauth2.accessToken}
              onChange={(e) => setOAuth2({ ...oauth2, accessToken: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={requestOAuth2Token}>⚡ Generate / Refresh Token</button>
              <button onClick={verifyOAuth}>🔍 Verify OAuth2</button>
            </div>
            {oauthStatus && <div style={{ marginTop: 10 }}>{oauthStatus}</div>}
            {tokenResult && (
              <pre style={{ marginTop: 10, maxHeight: 180, overflowY: "auto", background: "#f9f9f9", padding: 10 }}>
                {JSON.stringify(tokenResult, null, 2)}
              </pre>
            )}
            <div style={{ marginTop: 10 }}>
              <button onClick={verifyIFSConnection}>🔍 Verify IFS Connection</button>
              {ifsStatus && <span style={{ marginLeft: 10 }}>{ifsStatus}</span>}
            </div>
            <div style={{ marginTop: 18 }}>
              <h4>IFS Core Local Path (optional)</h4>
              <input
                placeholder="Local path to IFS core solution (for rule generation)"
                value={ifsCorePath}
                onChange={(e) => setIfsCorePath(e.target.value)}
                style={{ width: "100%", marginTop: 6 }}
              />
              <div style={{ marginTop: 6, fontSize: 12 }} className="muted">
                Optional: provide the path where your IFS core/source is downloaded. The MCP engine will attempt to
                load contextual rules (e.g., expected .cdb artifacts) from this location.
              </div>
            </div>
            {ifsDebug && (
              <div style={{ marginTop: 10, padding: 10, background: "#fff3cd", borderRadius: 6, fontSize: "0.85em" }}>
                <strong>Debug Info:</strong>
                {ifsDebug.requestUrl && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Request URL:</strong> {ifsDebug.requestUrl}
                  </div>
                )}
                {ifsDebug.requestHeaders && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Headers:</strong>
                    <pre style={{ background: "#fff", padding: 6, marginTop: 4, border: "1px solid #ddd", borderRadius: 3, overflow: "auto", maxHeight: 100 }}>
                      {JSON.stringify(ifsDebug.requestHeaders, null, 2)}
                    </pre>
                  </div>
                )}
                {ifsDebug.responseStatus && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Response Status:</strong> {ifsDebug.responseStatus}
                  </div>
                )}
                {ifsDebug.responseData && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Response Data:</strong>
                    <pre style={{ background: "#fff", padding: 6, marginTop: 4, border: "1px solid #ddd", borderRadius: 3, overflow: "auto", maxHeight: 120 }}>
                      {typeof ifsDebug.responseData === "string" ? ifsDebug.responseData : JSON.stringify(ifsDebug.responseData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "mcp" && (
          <>
            <h3>MCP Engine</h3>
            <select
              value={mcp.mode}
              onChange={(e) => setMcp({ ...mcp, mode: e.target.value })}
              style={{ width: "100%", padding: 8, marginTop: 6 }}
            >
              <option value="hybrid">Hybrid AI + Rule Engine</option>
              <option value="rules-only">Rules Only</option>
              <option value="ai-only">AI Only</option>
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={mcp.enableImpactAnalysis}
                onChange={(e) => setMcp({ ...mcp, enableImpactAnalysis: e.target.checked })}
              />
              Enable PR → ERP Impact Analysis
            </label>

            <div style={{ marginTop: 12 }}>
              <button onClick={refreshMCPStatus}>📡 Refresh MCP Status</button>
              <button onClick={refreshAuditTrail} style={{ marginLeft: 10 }}>
                🧾 Load Audit Trail
              </button>
              {mcpStatus && (
                <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                  <strong>MCP Status:</strong> {typeof mcpStatus === "string" ? mcpStatus : JSON.stringify(mcpStatus, null, 2)}
                </div>
              )}
              {auditTrail?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <strong>Audit Trail:</strong>
                  <pre style={{ maxHeight: 180, overflowY: "auto", background: "#f4f4f4", padding: 10 }}>
                    {JSON.stringify(auditTrail, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "rules" && (
          <>
            <h3>Review Rules</h3>
            <p>Manage and view all review rules including built-in and dynamic rules from IFS core.</p>
            
            <h4 style={{ marginTop: 18 }}>Available Rules</h4>
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={loadRules} disabled={rulesLoading}>
                {rulesLoading ? "Loading..." : "📋 Load All Rules"}
              </button>
              <span style={{ fontWeight: "bold", color: "#0b69ff" }}>Total Rules: {rules.length}</span>
            </div>

            {rules.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #ddd", borderRadius: 6, padding: 10 }}>
                  {rules.map((rule, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        marginBottom: 12, 
                        padding: 10, 
                        background: "#f9f9f9", 
                        borderRadius: 4, 
                        borderLeft: `4px solid ${rule.severity === 'Blocker' ? '#dc3545' : rule.severity === 'Major' ? '#ff9800' : '#28a745'}`
                      }}
                    >
                      <div style={{ fontWeight: "bold", marginBottom: 4 }}>
                        {rule.title} <span style={{ fontSize: "0.85em", color: "#666" }}>({rule.id})</span>
                      </div>
                      <div style={{ fontSize: "0.9em", color: "#666", marginBottom: 4 }}>
                        <span style={{ background: "#e3f2fd", padding: "2px 6px", borderRadius: 3, marginRight: 6 }}>
                          Severity: {rule.severity}
                        </span>
                        {rule.category && (
                          <span style={{ background: "#f3e5f5", padding: "2px 6px", borderRadius: 3 }}>
                            Category: {rule.category}
                          </span>
                        )}
                      </div>
                      {rule.description && (
                        <div style={{ fontSize: "0.85em", color: "#555" }}>
                          {rule.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h4 style={{ marginTop: 20 }}>User Email</h4>
            <p style={{ fontSize: "0.9em", color: "#666" }}>
              Fetch your email address from the repository to automatically populate review feedback recipients.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={fetchUserEmail}>🔄 Fetch My Email</button>
              {userEmail && (
                <input 
                  type="text" 
                  value={userEmail} 
                  readOnly
                  style={{ flex: 1, padding: "8px", minWidth: 200 }}
                />
              )}
            </div>
            {userEmailStatus && (
              <div style={{ marginTop: 8, fontSize: "0.9em" }}>{userEmailStatus}</div>
            )}

            <h4 style={{ marginTop: 20 }}>MCP Server Status</h4>
            <p style={{ fontSize: "0.9em", color: "#666" }}>
              Verify if the Model Context Protocol (MCP) server is available for advanced analysis features.
            </p>
            <div style={{ marginTop: 10 }}>
              <button onClick={verifyMCP} disabled={mcpLoading}>
                {mcpLoading ? "Checking..." : "🔍 Check MCP Server"}
              </button>
            </div>
            {mcpStatus && (
              <div style={{ marginTop: 8, fontSize: "0.9em", padding: 10, background: mcpStatus.includes("✅") ? "#d4edda" : "#fff3cd", borderRadius: 4 }}>
                {mcpStatus}
              </div>
            )}
          </>
        )}
      </div>

      <hr />

      {/* =============================
          SAVE
      ============================= */}
      <button onClick={saveConfig}>💾 Save Config</button>
    </div>
  );
}
