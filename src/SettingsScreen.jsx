import { useEffect, useMemo, useState } from "react";

export default function SettingsScreen({ onBack }) {
  /* =============================
     STATE
     ============================= */
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("repo");

  // Repo settings
  const [repoType, setRepoType] = useState("github");
  const [github, setGithub] = useState({ token: "", owner: "", repo: "", baseUrl: "", enableAccept: true, enableReject: true });
  const [azure, setAzure] = useState({ org: "", project: "", repoIdOrName: "", pat: "", baseUrl: "", apiVersion: "7.1", enableAccept: true, enableReject: true });

  // Multi-repository settings
  const [multiRepo, setMultiRepo] = useState(false);
  const [azureRepos, setAzureRepos] = useState([]);
  const [multiRepoGithub, setMultiRepoGithub] = useState(false);
  const [githubRepos, setGithubRepos] = useState([]);
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [editingRepoIndex, setEditingRepoIndex] = useState(null);
  const [repoFormType, setRepoFormType] = useState("azure"); // "azure" or "github"
  const [tempRepo, setTempRepo] = useState({ customer: "", org: "", project: "", repoIdOrName: "", pat: "", baseUrl: "", apiVersion: "7.1", enableAccept: true, enableReject: true });

  // LLM settings
  const [provider, setProvider] = useState("azure");
  const [azureLlm, setAzureLlm] = useState({
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2,
    apiVersion: "2024-02-15-preview"
  });
  const [openaiLlm, setOpenaiLlm] = useState({
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2
  });
  const [ollamaLlm, setOllamaLlm] = useState({
    endpoint: "http://localhost:11434",
    model: "llama3",
    temperature: 0.2
  });

  // Hybrid settings states
  const [premiumProvider, setPremiumProvider] = useState("azure");
  const [hybridMaxLines, setHybridMaxLines] = useState(300);
  const [hybridMaxFiles, setHybridMaxFiles] = useState(1);
  const [hybridCheckSql, setHybridCheckSql] = useState(true);


  const [openaiModels, setOpenaiModels] = useState(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]);
  const [ollamaModels, setOllamaModels] = useState(["llama3", "mistral", "codellama", "phi3"]);
  const [detectingOpenai, setDetectingOpenai] = useState(false);
  const [detectingOllama, setDetectingOllama] = useState(false);
  const [showOpenaiCustom, setShowOpenaiCustom] = useState(false);
  const [showOllamaCustom, setShowOllamaCustom] = useState(false);

  const [ifs, setIfs] = useState({
    metadataUrl: "",
    odataUrl: "",
    restUrl: "",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    accessToken: ""
  });

  // Local IFS core + customer paths for rule generation & validation
  const [ifsCorePath, setIfsCorePath] = useState("");
  const [ifsCustomerPath, setIfsCustomerPath] = useState("");

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
    cc: ""
  });

  const [mcp, setMcp] = useState({
    mode: "hybrid",
    enableImpactAnalysis: true,
    useCoreReference: true,
    enableKnowledgeBase: false,
    knowledgePath: "",
    enableIfsDocsSearch: false,
    ifsDocsVersion: "26r1"
  });

  const [repoStatus, setRepoStatus] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [ifsStatus, setIfsStatus] = useState(null);
  const [ifsDebug, setIfsDebug] = useState(null);
  const [oauthStatus, setOAuthStatus] = useState(null);
  const [mcpStatus, setMcpStatus] = useState(null);
  const [analysingKB, setAnalysingKB] = useState(false);
  const [auditTrail, setAuditTrail] = useState([]);
  const [tokenResult, setTokenResult] = useState(null);
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [userEmail, setUserEmail] = useState('');
  const [userEmailStatus, setUserEmailStatus] = useState(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpVerifyStatus, setMcpVerifyStatus] = useState(null);
  const [testPrUrl, setTestPrUrl] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);

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
          baseUrl: cfg?.github?.baseUrl || "",
          enableAccept: cfg?.github?.enableAccept !== false,
          enableReject: cfg?.github?.enableReject !== false
        });

        setAzure({
          org: cfg?.azure?.org || "",
          project: cfg?.azure?.project || "",
          repoIdOrName: cfg?.azure?.repoIdOrName || "",
          pat: cfg?.azure?.pat || "",
          baseUrl: cfg?.azure?.baseUrl || "",
          apiVersion: cfg?.azure?.apiVersion || "7.1",
          enableAccept: cfg?.azure?.enableAccept !== false,
          enableReject: cfg?.azure?.enableReject !== false
        });

        setMultiRepo(cfg?.multiRepo || false);
        setAzureRepos(cfg?.azureRepos || []);
        setMultiRepoGithub(cfg?.multiRepoGithub || false);
        setGithubRepos(cfg?.githubRepos || []);

        if (cfg?.llm) {
          const rootLlm = cfg.llm || {};
          const activeProv = rootLlm.provider || "azure";
          const providers = rootLlm.providers || {};

          // Azure config
          const azureData = {
            endpoint: providers.azure?.endpoint || (activeProv === "azure" ? rootLlm.endpoint : "") || "",
            apiKey: providers.azure?.apiKey || (activeProv === "azure" ? rootLlm.apiKey : "") || "",
            model: providers.azure?.model || (activeProv === "azure" ? rootLlm.model : "gpt-4o-mini") || "gpt-4o-mini",
            temperature: providers.azure?.temperature ?? (activeProv === "azure" ? rootLlm.temperature : 0.2) ?? 0.2,
            apiVersion: providers.azure?.apiVersion || (activeProv === "azure" ? rootLlm.apiVersion : "2024-02-15-preview") || "2024-02-15-preview"
          };
          setAzureLlm(azureData);

          // OpenAI config
          const openaiData = {
            apiKey: providers.openai?.apiKey || (activeProv === "openai" ? rootLlm.apiKey : "") || "",
            model: providers.openai?.model || (activeProv === "openai" ? rootLlm.model : "gpt-4o-mini") || "gpt-4o-mini",
            temperature: providers.openai?.temperature ?? (activeProv === "openai" ? rootLlm.temperature : 0.2) ?? 0.2
          };
          setOpenaiLlm(openaiData);
          if (openaiData.model && !["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"].includes(openaiData.model)) {
            setOpenaiModels(prev => [...prev.filter(m => m !== openaiData.model), openaiData.model]);
          }

          // Ollama config
          const ollamaData = {
            endpoint: providers.ollama?.endpoint || (activeProv === "ollama" ? rootLlm.endpoint : "http://localhost:11434") || "http://localhost:11434",
            model: providers.ollama?.model || (activeProv === "ollama" ? rootLlm.model : "llama3") || "llama3",
            temperature: providers.ollama?.temperature ?? (activeProv === "ollama" ? rootLlm.temperature : 0.2) ?? 0.2
          };
          setOllamaLlm(ollamaData);
          if (ollamaData.model && !["llama3", "mistral", "codellama", "phi3"].includes(ollamaData.model)) {
            setOllamaModels(prev => [...prev.filter(m => m !== ollamaData.model), ollamaData.model]);
          }

          // Hybrid settings
          setPremiumProvider(rootLlm.premiumProvider || "azure");
          setHybridMaxLines(rootLlm.hybridMaxLines ?? 300);
          setHybridMaxFiles(rootLlm.hybridMaxFiles ?? 1);
          setHybridCheckSql(rootLlm.hybridCheckSql ?? true);

          setProvider(activeProv);
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
        setIfsCustomerPath(cfg?.ifs?.customerPath || cfg?.ifsCustomerPath || "");

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
          cc: cfg?.email?.cc || cfg?.smtp?.cc || "",
          disabled: cfg?.email?.disabled ?? cfg?.smtp?.disabled ?? false
        });

        setMcp({
          mode: cfg?.mcp?.mode || "hybrid",
          enableImpactAnalysis: cfg?.mcp?.enableImpactAnalysis !== false,
          useCoreReference: cfg?.mcp?.useCoreReference !== false,
          enableKnowledgeBase: cfg?.mcp?.enableKnowledgeBase || false,
          knowledgePath: cfg?.mcp?.knowledgePath || "",
          enableIfsDocsSearch: cfg?.mcp?.enableIfsDocsSearch || false,
          ifsDocsVersion: cfg?.mcp?.ifsDocsVersion || "26r1"
        });
      } catch (err) {
        console.error("Failed to load config", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeTab === "rules") {
      loadRules();
    }
  }, [activeTab]);

  /* =============================
     VERIFY GITHUB/AZURE TOKEN
     ============================= */
  const verifyToken = async () => {
    setRepoStatus("Checking repository connection...");
    try {
      const result = await window.api.verifyGitHubToken(github.token);
      if (result.valid) {
        setRepoStatus(`✅ Valid Token (User: ${result.username})`);
      } else {
        setRepoStatus(`❌ Verification failed: ${result.error}`);
      }
    } catch (err) {
      setRepoStatus("❌ Connection request failed");
    }
  };

  /* =============================
     MULTI-REPO AZURE/GITHUB HANDLERS
     ============================= */
  const openRepoForm = (repo = null, index = null, type = "azure") => {
    setRepoFormType(type);
    if (repo) {
      if (type === "azure") {
        setTempRepo({
          customer: repo.customer || "",
          org: repo.org || "",
          project: repo.project || "",
          repoIdOrName: repo.repoIdOrName || "",
          pat: repo.pat || "",
          baseUrl: repo.baseUrl || "",
          apiVersion: repo.apiVersion || "7.1",
          enableAccept: repo.enableAccept !== false,
          enableReject: repo.enableReject !== false
        });
      } else {
        setTempRepo({
          customer: repo.customer || "",
          owner: repo.owner || "",
          repo: repo.repo || "",
          token: repo.token || "",
          baseUrl: repo.baseUrl || "",
          enableAccept: repo.enableAccept !== false,
          enableReject: repo.enableReject !== false
        });
      }
      setEditingRepoIndex(index);
    } else {
      if (type === "azure") {
        setTempRepo({
          customer: "",
          org: "",
          project: "",
          repoIdOrName: "",
          pat: "",
          baseUrl: "",
          apiVersion: "7.1",
          enableAccept: true,
          enableReject: true
        });
      } else {
        setTempRepo({
          customer: "",
          owner: "",
          repo: "",
          token: "",
          baseUrl: "",
          enableAccept: true,
          enableReject: true
        });
      }
      setEditingRepoIndex(null);
    }
    setShowRepoForm(true);
    setRepoStatus(null);
  };

  const saveRepoForm = () => {
    if (repoFormType === "azure") {
      if (!tempRepo.customer || !tempRepo.org || !tempRepo.project || !tempRepo.repoIdOrName || !tempRepo.pat) {
        alert("⚠️ Customer Name, Azure Org, Project, Repository, and PAT are required fields.");
        return;
      }

      const isDuplicate = azureRepos.some((r, idx) => r.customer.toLowerCase() === tempRepo.customer.toLowerCase() && idx !== editingRepoIndex);
      if (isDuplicate) {
        alert("⚠️ A repository configuration for this customer name already exists.");
        return;
      }

      if (editingRepoIndex !== null) {
        setAzureRepos(prev => prev.map((r, idx) => idx === editingRepoIndex ? tempRepo : r));
      } else {
        setAzureRepos(prev => [...prev, tempRepo]);
      }
    } else {
      if (!tempRepo.customer || !tempRepo.owner || !tempRepo.repo || !tempRepo.token) {
        alert("⚠️ Customer Name, GitHub Owner, Repository, and Token are required fields.");
        return;
      }

      const isDuplicate = githubRepos.some((r, idx) => r.customer.toLowerCase() === tempRepo.customer.toLowerCase() && idx !== editingRepoIndex);
      if (isDuplicate) {
        alert("⚠️ A repository configuration for this customer name already exists.");
        return;
      }

      if (editingRepoIndex !== null) {
        setGithubRepos(prev => prev.map((r, idx) => idx === editingRepoIndex ? tempRepo : r));
      } else {
        setGithubRepos(prev => [...prev, tempRepo]);
      }
    }
    setShowRepoForm(false);
  };

  const deleteAzureRepo = (index) => {
    if (confirm(`Are you sure you want to delete repository for customer "${azureRepos[index].customer}"?`)) {
      setAzureRepos(prev => prev.filter((_, idx) => idx !== index));
    }
  };

  const deleteGithubRepo = (index) => {
    if (confirm(`Are you sure you want to delete repository for customer "${githubRepos[index].customer}"?`)) {
      setGithubRepos(prev => prev.filter((_, idx) => idx !== index));
    }
  };

  const verifyAzureRepoConnection = async (repo) => {
    setRepoStatus(`Testing connection for ${repo.customer}...`);
    try {
      const result = await window.api.verifyAzureConnection({ repoSettings: repo });
      if (result.valid) {
        setRepoStatus(`✅ Connection successful for ${repo.customer}! (Repository: ${result.repoName})`);
      } else {
        setRepoStatus(`❌ Connection failed for ${repo.customer}: ${result.error}`);
      }
    } catch (err) {
      setRepoStatus(`❌ Connection request failed for ${repo.customer}: ${err.message}`);
    }
  };

  const verifyGitHubRepoConnection = async (repo) => {
    setRepoStatus(`Testing connection for ${repo.customer}...`);
    try {
      const result = await window.api.verifyGitHubToken({ repoSettings: repo });
      if (result.valid) {
        setRepoStatus(`✅ Connection successful for ${repo.customer}! (Repository: ${result.repoName})`);
      } else {
        setRepoStatus(`❌ Connection failed for ${repo.customer}: ${result.error}`);
      }
    } catch (err) {
      setRepoStatus(`❌ Connection request failed for ${repo.customer}: ${err.message}`);
    }
  };

  const verifySingleAzureConnection = async () => {
    setRepoStatus("Checking repository connection...");
    try {
      const result = await window.api.verifyAzureConnection({ repoSettings: azure });
      if (result.valid) {
        setRepoStatus(`✅ Connection successful! (Repository: ${result.repoName})`);
      } else {
        setRepoStatus(`❌ Connection failed: ${result.error}`);
      }
    } catch (err) {
      setRepoStatus(`❌ Connection request failed: ${err.message}`);
    }
  };

  /* =============================
     VERIFY LLM CONFIG
     ============================= */
  const detectOpenaiModels = async () => {
    if (!openaiLlm.apiKey) {
      setLlmStatus("❌ API Key is required to detect OpenAI models.");
      return;
    }
    setDetectingOpenai(true);
    setLlmStatus("Detecting OpenAI models...");
    try {
      const res = await window.api.listOpenAIModels({ apiKey: openaiLlm.apiKey });
      if (res.ok) {
        setOpenaiModels(res.models);
        if (res.models.length > 0) {
          setOpenaiLlm(prev => ({ ...prev, model: res.models[0] }));
        }
        setLlmStatus("✅ OpenAI models detected successfully.");
      } else {
        setLlmStatus(`❌ Failed to detect OpenAI models: ${res.error}`);
      }
    } catch (err) {
      setLlmStatus(`❌ Error detecting OpenAI models: ${err.message}`);
    } finally {
      setDetectingOpenai(false);
    }
  };

  const detectOllamaModels = async () => {
    if (!ollamaLlm.endpoint) {
      setLlmStatus("❌ Ollama endpoint is required to detect models.");
      return;
    }
    setDetectingOllama(true);
    setLlmStatus("Detecting Ollama models...");
    try {
      const res = await window.api.listOllamaModels({ endpoint: ollamaLlm.endpoint });
      if (res.ok) {
        setOllamaModels(res.models);
        if (res.models.length > 0) {
          setOllamaLlm(prev => ({ ...prev, model: res.models[0] }));
        }
        setLlmStatus("✅ Ollama models detected successfully.");
      } else {
        setLlmStatus(`❌ Failed to detect Ollama models: ${res.error}`);
      }
    } catch (err) {
      setLlmStatus(`❌ Error detecting Ollama models: ${err.message}`);
    } finally {
      setDetectingOllama(false);
    }
  };

  const verifyLLM = async () => {
    const activeLlm = 
      provider === "azure" ? azureLlm :
      provider === "openai" ? openaiLlm :
      ollamaLlm;

    if (provider !== "ollama" && !activeLlm.apiKey) {
      setLlmStatus("❌ API key is missing");
      return;
    }

    if ((provider === "azure" || provider === "ollama") && !activeLlm.endpoint) {
      setLlmStatus(`❌ ${provider === "azure" ? "Azure" : "Ollama"} endpoint required`);
      return;
    }

    setLlmStatus("Testing LLM Connection...");

    try {
      const result = await window.api.verifyLLMConfig({ ...activeLlm, provider });
      if (result.valid) {
        setLlmStatus("✅ LLM Connection Successful");
      } else {
        setLlmStatus(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      setLlmStatus("❌ LLM Connection failed");
    }
  };

  /* =============================
     VERIFY EMAIL CONFIG
     ============================= */
  const verifyEmailSettings = async () => {
    setEmailStatus("Verifying SMTP configuration...");
    try {
      const result = await window.api.testSMTP({ ...email });
      if (result.ok) {
        setEmailStatus("✅ SMTP connection successful");
      } else {
        setEmailStatus(`❌ Connection failed: ${result.error}`);
      }
    } catch (err) {
      setEmailStatus("❌ SMTP request failed");
    }
  };

  /* =============================
     VERIFY IFS CONNECTION
     ============================= */
  const verifyIFSConnection = async () => {
    setIfsStatus("Verifying IFS connection...");
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
            setIfsStatus(`❌ OAuth Token Request Failed: ${tokenResult?.error || "Unknown Error"}`);
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
        setIfsStatus(`❌ Failed to connect: ${result.error}`);
        if (result.debug) {
          setIfsDebug(result.debug);
        }
      }
    } catch (err) {
      setIfsStatus("❌ IFS Connection request failed");
      setIfsDebug(null);
    }
  };

  /* =============================
     VERIFY OAUTH
     ============================= */
  const verifyOAuth = async () => {
    setOAuthStatus("Verifying OAuth2 details...");
    try {
      const result = await window.api.verifyOAuth2Config(oauth2);
      if (result.ok) {
        setOAuthStatus("✅ OAuth2 configuration is valid");
      } else {
        setOAuthStatus(`❌ Verification failed: ${result.result?.error || result.error}`);
      }
    } catch (err) {
      setOAuthStatus("❌ OAuth2 request failed");
    }
  };

  const analyseKB = async () => {
    if (!mcp.knowledgePath) {
      alert("⚠️ Knowledge Path is required to analyse the guidelines.");
      return;
    }
    setAnalysingKB(true);
    try {
      const result = await window.api.analyseKnowledgeBase({ knowledgePath: mcp.knowledgePath });
      if (result?.ok) {
        alert("✅ Knowledge base scanned successfully.");
      } else {
        alert(`ℹ️ Info: ${result?.error || "Failed to update guidelines."}`);
      }
    } catch (err) {
      alert(`❌ Error: ${err.message || "An unexpected error occurred."}`);
    } finally {
      setAnalysingKB(false);
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
        setUserEmailStatus(`✅ Resolved: ${response.email}`);
      } else {
        setUserEmailStatus(`❌ Failed: ${response?.error || 'Failed to fetch email'}`);
      }
    } catch (err) {
      setUserEmailStatus(`❌ Failed: ${err?.message || 'Failed to fetch email'}`);
    }
  };

  const verifyMCP = async () => {
    setMcpLoading(true);
    try {
      const response = await window.api.verifyMCP();
      if (response?.ok) {
        setMcpVerifyStatus(`✅ ${response.message || 'MCP Server is available'}`);
      } else {
        setMcpVerifyStatus(`⚠️ ${response?.message || response?.error || 'MCP not available'}`);
      }
    } catch (err) {
      setMcpVerifyStatus(`❌ Failed to query MCP: ${err?.message}`);
    } finally {
      setMcpLoading(false);
    }
  };

  const requestOAuth2Token = async () => {
    setOAuthStatus("Requesting token from server...");
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
        setOAuthStatus(`❌ OAuth Token Request Failed: ${result?.error || "Unknown Error"}`);
        return;
      }

      const newToken = {
        accessToken: result.tokenResponse?.access_token || oauth2.accessToken,
        refreshToken: result.tokenResponse?.refresh_token || oauth2.refreshToken
      };

      setOAuth2((prev) => ({ ...prev, ...newToken }));
      setTokenResult(result.tokenResponse);
      setOAuthStatus("✅ Token retrieved successfully");
    } catch (err) {
      setOAuthStatus("❌ OAuth Request Failed");
    }
  };

  /* =============================
     SAVE CONFIG
     ============================= */
  const saveConfig = async () => {
    try {
      setRepoStatus(null);

      // Validate Repo
      if (repoType === "github") {
        if (multiRepoGithub) {
          if (!githubRepos || githubRepos.length === 0) {
            setRepoStatus("❌ At least one GitHub repository configuration is required in multi-repository mode.");
            alert("⚠️ Please add at least one GitHub repository configuration.");
            return;
          }
        } else {
          if (!github.token || !github.owner || !github.repo) {
            setRepoStatus("❌ GitHub Token, Owner, and Repository are required fields.");
            alert("⚠️ Please fill in all required repository fields");
            return;
          }
        }
      }

      if (repoType === "azure") {
        if (multiRepo) {
          if (!azureRepos || azureRepos.length === 0) {
            setRepoStatus("❌ At least one Azure repository configuration is required in multi-repository mode.");
            alert("⚠️ Please add at least one Azure repository configuration.");
            return;
          }
        } else {
          if (!azure.org || !azure.project || !azure.repoIdOrName || !azure.pat) {
            setRepoStatus("❌ Azure Org, Project, Repository, and PAT are required fields.");
            alert("⚠️ Please fill in all required repository fields");
            return;
          }
        }
      }

      const existingConfig = await window.api.getConfig();
      const currentSelectedCustomer = existingConfig?.selectedCustomer;
      const activeCustomer = multiRepo && azureRepos.length > 0
        ? (azureRepos.some(r => r.customer === currentSelectedCustomer) ? currentSelectedCustomer : azureRepos[0].customer)
        : "";

      const defaultAzure = multiRepo && azureRepos.length > 0
        ? {
            org: azureRepos[0].org,
            project: azureRepos[0].project,
            repoIdOrName: azureRepos[0].repoIdOrName,
            pat: azureRepos[0].pat,
            baseUrl: azureRepos[0].baseUrl || undefined,
            apiVersion: azureRepos[0].apiVersion || "7.1",
            enableAccept: azureRepos[0].enableAccept !== false,
            enableReject: azureRepos[0].enableReject !== false
          }
        : { ...azure, baseUrl: azure.baseUrl || undefined };

      const currentSelectedCustomerGithub = existingConfig?.selectedCustomerGithub;
      const activeCustomerGithub = multiRepoGithub && githubRepos.length > 0
        ? (githubRepos.some(r => r.customer === currentSelectedCustomerGithub) ? currentSelectedCustomerGithub : githubRepos[0].customer)
        : "";

      const defaultGithub = multiRepoGithub && githubRepos.length > 0
        ? {
            token: githubRepos[0].token,
            owner: githubRepos[0].owner,
            repo: githubRepos[0].repo,
            baseUrl: githubRepos[0].baseUrl || undefined,
            enableAccept: githubRepos[0].enableAccept !== false,
            enableReject: githubRepos[0].enableReject !== false
          }
        : { ...github, baseUrl: github.baseUrl || undefined };

      await window.api.saveConfig({
        repoType,
        github: defaultGithub,
        azure: defaultAzure,
        multiRepo,
        azureRepos: azureRepos.map(r => ({
          customer: r.customer,
          org: r.org,
          project: r.project,
          repoIdOrName: r.repoIdOrName,
          pat: r.pat,
          baseUrl: r.baseUrl || undefined,
          apiVersion: r.apiVersion || "7.1",
          enableAccept: r.enableAccept !== false,
          enableReject: r.enableReject !== false
        })),
        selectedCustomer: activeCustomer,

        multiRepoGithub,
        githubRepos: githubRepos.map(r => ({
          customer: r.customer,
          owner: r.owner,
          repo: r.repo,
          token: r.token,
          baseUrl: r.baseUrl || undefined,
          enableAccept: r.enableAccept !== false,
          enableReject: r.enableReject !== false
        })),
        selectedCustomerGithub: activeCustomerGithub,

        // legacy compatibility
        githubToken: defaultGithub.token,

        llm: {
          provider,
          premiumProvider,
          hybridMaxLines: Number(hybridMaxLines),
          hybridMaxFiles: Number(hybridMaxFiles),
          hybridCheckSql,
          ...(provider === "azure" ? azureLlm : provider === "openai" ? openaiLlm : provider === "ollama" ? ollamaLlm : {}),
          providers: {
            azure: azureLlm,
            openai: openaiLlm,
            ollama: ollamaLlm
          }
        },
        email: {
          host: email.host,
          port: Number(email.port),
          secure: email.secure,
          user: email.user,
          pass: email.pass,
          from: email.from,
          cc: email.cc,
          disabled: email.disabled || false
        },
        ifs: {
          metadataUrl: ifs.metadataUrl,
          odataUrl: ifs.odataUrl,
          restUrl: ifs.restUrl,
          tenantId: ifs.tenantId,
          clientId: ifs.clientId,
          clientSecret: ifs.clientSecret,
          accessToken: ifs.accessToken,
          corePath: ifsCorePath,
          customerPath: ifsCustomerPath
        },
        oauth2: { ...oauth2 },
        mcp: { ...mcp }
      });

      alert("✅ Settings saved successfully!");
    } catch (err) {
      console.error("Save failed", err);
      alert("❌ Failed to save configuration settings");
    }
  };

  const TABS = [
    { key: "repo", label: "Repository Config", icon: "📦" },
    { key: "llm", label: "LLM Configuration", icon: "🧠" },
    { key: "email", label: "Email / SMTP", icon: "✉️" },
    { key: "ifs", label: "IFS ERP Integration", icon: "⚙️" },
    { key: "mcp", label: "MCP Engine & Test", icon: "📡" },
    { key: "rules", label: "Review Rules Dictionary", icon: "📋" }
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-app)', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Loading Settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      {/* Top Header */}
      <header className="topbar">
        <div className="topbar__left">
          <div className="topbar__logo">⚙️</div>
          <div className="topbar__title">
            <span className="brand">AQS Inspect Settings</span>
            <span className="subtitle" style={{ color: '#ffffff' }}>
              
              Configure Git providers, LLM configurations, ERP validation rules, and solution directories</span>

          </div>
        </div>
        <div className="topbar__actions" style={{ gap: '10px' }}>
          <button onClick={onBack} className="btn primary">
            ⬅ Back to Workspace
          </button>
          <button onClick={saveConfig} className="btn primary">
            💾 Save Settings
          </button>
        </div>
      </header>

      {/* Main Settings Body */}
      <div className="workarea" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Tabs Bar */}
        <aside className="sidebar" style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-dark)', background: 'var(--bg-sidebar)', padding: '12px 8px' }}>
          <div className="sidebar__title-wrap" style={{ padding: '4px 10px 12px 10px', borderBottom: '1px solid var(--border-dark)', marginBottom: '10px' }}>
            <span className="sidebar__title" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Config Sections</span>
          </div>
          <div className="sidebar-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`az-tree-row ${activeTab === tab.key ? 'active' : ''}`}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: activeTab === tab.key ? 'var(--accent-subtle)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: activeTab === tab.key ? '600' : '400',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <span style={{ fontSize: '16px' }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Right Tab Content Viewer */}
        <div className="settings-content" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* 1. REPO TAB */}
          {activeTab === "repo" && (
            <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>📦 Repository Configuration</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repository Platform</label>
                <select
                  className="input"
                  value={repoType}
                  onChange={(e) => setRepoType(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="github">GitHub</option>
                  <option value="azure">Azure DevOps</option>
                </select>
              </div>

              {repoType === "github" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '600' }}>
                      <input
                        type="checkbox"
                        id="enable-multi-repo-github"
                        checked={multiRepoGithub}
                        onChange={(e) => {
                          setMultiRepoGithub(e.target.checked);
                          setRepoStatus(null);
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      Enable Multi-Repository Mode (Multiple Customers)
                    </label>
                  </div>

                  {!multiRepoGithub ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GitHub Personal Access Token (PAT)</label>
                        <input
                          type="password"
                          className="input"
                          placeholder="ghp_..."
                          value={github.token}
                          onChange={(e) => setGithub({ ...github, token: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Organization / Owner</label>
                          <input
                            className="input"
                            placeholder="e.g. google"
                            value={github.owner}
                            onChange={(e) => setGithub({ ...github, owner: e.target.value })}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repository Name</label>
                          <input
                            className="input"
                            placeholder="e.g. antigravity"
                            value={github.repo}
                            onChange={(e) => setGithub({ ...github, repo: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Base URL (Optional — For GitHub Enterprise)</label>
                        <input
                          className="input"
                          placeholder="e.g. https://github.company.com/api/v3"
                          value={github.baseUrl}
                          onChange={(e) => setGithub({ ...github, baseUrl: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-dark)', paddingTop: '12px', marginTop: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Feature Controls</label>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              id="github-enable-accept"
                              checked={github.enableAccept !== false}
                              onChange={(e) => setGithub({ ...github, enableAccept: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Accept Pull Request
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              id="github-enable-reject"
                              checked={github.enableReject !== false}
                              onChange={(e) => setGithub({ ...github, enableReject: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Reject Pull Request
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dark)', paddingBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Configured Customer Repositories ({githubRepos.length})</span>
                        <button
                          onClick={() => openRepoForm(null, null, "github")}
                          className="btn primary"
                          style={{ padding: '6px 14px', fontSize: '12px', height: '32px' }}
                        >
                          ➕ Add Customer Repo
                        </button>
                      </div>

                      {githubRepos.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', border: '1px dashed var(--border-dark)', fontSize: '13px' }}>
                          No customer repositories configured yet. Click "Add Customer Repo" to configure one.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {githubRepos.map((repo, idx) => (
                            <div key={idx} className="panel" style={{ margin: 0, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-dark)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontWeight: '700', color: 'var(--accent-light)', fontSize: '14px' }}>{repo.customer}</span>
                                  {repo.enableAccept && <span className="badge" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--green)', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.05)' }}>Accept PR</span>}
                                  {repo.enableReject && <span className="badge" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--red)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>Reject PR</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Consolas, Monaco, monospace' }}>
                                  {repo.owner} / {repo.repo}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                  onClick={() => verifyGitHubRepoConnection(repo)}
                                  className="btn ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px', color: 'var(--text-secondary)' }}
                                >
                                  🔍 Test
                                </button>
                                <button
                                  onClick={() => openRepoForm(repo, idx, "github")}
                                  className="btn ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px' }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  onClick={() => deleteGithubRepo(idx)}
                                  className="btn danger ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px' }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {repoType === "azure" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '600' }}>
                      <input
                        type="checkbox"
                        id="enable-multi-repo"
                        checked={multiRepo}
                        onChange={(e) => {
                          setMultiRepo(e.target.checked);
                          setRepoStatus(null);
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      Enable Multi-Repository Mode (Multiple Customers)
                    </label>
                  </div>

                  {!multiRepo ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Azure DevOps Organization</label>
                          <input
                            className="input"
                            placeholder="e.g. my-org-name"
                            value={azure.org}
                            onChange={(e) => setAzure({ ...azure, org: e.target.value })}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Project Name</label>
                          <input
                            className="input"
                            placeholder="e.g. my-project-name"
                            value={azure.project}
                            onChange={(e) => setAzure({ ...azure, project: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repository ID or Name</label>
                        <input
                          className="input"
                          placeholder="e.g. my-repo"
                          value={azure.repoIdOrName}
                          onChange={(e) => setAzure({ ...azure, repoIdOrName: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Azure DevOps Personal Access Token (PAT)</label>
                        <input
                          type="password"
                          className="input"
                          placeholder="PAT token..."
                          value={azure.pat}
                          onChange={(e) => setAzure({ ...azure, pat: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Base URL (Optional)</label>
                          <input
                            className="input"
                            placeholder="e.g. https://dev.azure.com/my-org"
                            value={azure.baseUrl}
                            onChange={(e) => setAzure({ ...azure, baseUrl: e.target.value })}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Version</label>
                          <input
                            className="input"
                            value={azure.apiVersion}
                            onChange={(e) => setAzure({ ...azure, apiVersion: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-dark)', paddingTop: '12px', marginTop: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Feature Controls</label>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              id="azure-enable-accept"
                              checked={azure.enableAccept !== false}
                              onChange={(e) => setAzure({ ...azure, enableAccept: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Accept Pull Request
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              id="azure-enable-reject"
                              checked={azure.enableReject !== false}
                              onChange={(e) => setAzure({ ...azure, enableReject: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Reject/Abandon Pull Request
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dark)', paddingBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Configured Customer Repositories ({azureRepos.length})</span>
                        <button
                          onClick={() => openRepoForm(null)}
                          className="btn primary"
                          style={{ padding: '6px 14px', fontSize: '12px', height: '32px' }}
                        >
                          ➕ Add Customer Repo
                        </button>
                      </div>

                      {azureRepos.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', border: '1px dashed var(--border-dark)', fontSize: '13px' }}>
                          No customer repositories configured yet. Click "Add Customer Repo" to configure one.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {azureRepos.map((repo, idx) => (
                            <div key={idx} className="panel" style={{ margin: 0, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-dark)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontWeight: '700', color: 'var(--accent-light)', fontSize: '14px' }}>{repo.customer}</span>
                                  {repo.enableAccept && <span className="badge" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--green)', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.05)' }}>Accept PR</span>}
                                  {repo.enableReject && <span className="badge" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--red)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>Reject PR</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Consolas, Monaco, monospace' }}>
                                  {repo.org} / {repo.project} / {repo.repoIdOrName}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                  onClick={() => verifyAzureRepoConnection(repo)}
                                  className="btn ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px', color: 'var(--text-secondary)' }}
                                >
                                  🔍 Test
                                </button>
                                <button
                                  onClick={() => openRepoForm(repo, idx)}
                                  className="btn ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px' }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  onClick={() => deleteAzureRepo(idx)}
                                  className="btn danger ghost"
                                  style={{ padding: '0 12px', fontSize: '12px', height: '28px' }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Form Modal for Multi-Repo */}
              {showRepoForm && (
                <div className="ai-overlay" style={{ zIndex: 10000 }}>
                  <div className="ai-modal" style={{ width: 'min(550px, 92vw)', height: 'auto', maxHeight: '90vh', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', margin: 0, color: 'var(--text-primary)' }}>
                      {editingRepoIndex !== null ? '✏️ Edit Customer Repository' : '➕ Add Customer Repository'}
                    </h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', paddingRight: '4px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Customer Name / Identifier</label>
                        <input
                          className="input"
                          placeholder="e.g. Customer A"
                          value={tempRepo.customer}
                          onChange={(e) => setTempRepo({ ...tempRepo, customer: e.target.value })}
                        />
                      </div>

                      {repoFormType === "azure" ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Azure Organization</label>
                              <input
                                className="input"
                                placeholder="e.g. my-org"
                                value={tempRepo.org}
                                onChange={(e) => setTempRepo({ ...tempRepo, org: e.target.value })}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Project Name</label>
                              <input
                                className="input"
                                placeholder="e.g. my-project"
                                value={tempRepo.project}
                                onChange={(e) => setTempRepo({ ...tempRepo, project: e.target.value })}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repository ID or Name</label>
                            <input
                              className="input"
                              placeholder="e.g. my-repo"
                              value={tempRepo.repoIdOrName}
                              onChange={(e) => setTempRepo({ ...tempRepo, repoIdOrName: e.target.value })}
                            />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Personal Access Token (PAT)</label>
                            <input
                              type="password"
                              className="input"
                              placeholder="PAT token..."
                              value={tempRepo.pat}
                              onChange={(e) => setTempRepo({ ...tempRepo, pat: e.target.value })}
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Base URL (Optional)</label>
                              <input
                                className="input"
                                placeholder="e.g. https://dev.azure.com/my-org"
                                value={tempRepo.baseUrl}
                                onChange={(e) => setTempRepo({ ...tempRepo, baseUrl: e.target.value })}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Version</label>
                              <input
                                className="input"
                                value={tempRepo.apiVersion}
                                onChange={(e) => setTempRepo({ ...tempRepo, apiVersion: e.target.value })}
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GitHub Organization / Owner</label>
                              <input
                                className="input"
                                placeholder="e.g. google"
                                value={tempRepo.owner}
                                onChange={(e) => setTempRepo({ ...tempRepo, owner: e.target.value })}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repository Name</label>
                              <input
                                className="input"
                                placeholder="e.g. antigravity"
                                value={tempRepo.repo}
                                onChange={(e) => setTempRepo({ ...tempRepo, repo: e.target.value })}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Personal Access Token (PAT)</label>
                            <input
                              type="password"
                              className="input"
                              placeholder="ghp_..."
                              value={tempRepo.token}
                              onChange={(e) => setTempRepo({ ...tempRepo, token: e.target.value })}
                            />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Base URL (Optional — For GitHub Enterprise)</label>
                            <input
                              className="input"
                              placeholder="e.g. https://github.company.com/api/v3"
                              value={tempRepo.baseUrl}
                              onChange={(e) => setTempRepo({ ...tempRepo, baseUrl: e.target.value })}
                            />
                          </div>
                        </>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-dark)', paddingTop: '12px', marginTop: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Feature Controls</label>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              checked={tempRepo.enableAccept !== false}
                              onChange={(e) => setTempRepo({ ...tempRepo, enableAccept: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Accept Pull Request
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input
                              type="checkbox"
                              checked={tempRepo.enableReject !== false}
                              onChange={(e) => setTempRepo({ ...tempRepo, enableReject: e.target.checked })}
                              style={{ cursor: 'pointer' }}
                            />
                            Enable Reject/Abandon Pull Request
                          </label>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', borderTop: '1px solid var(--border-dark)', paddingTop: '12px' }}>
                      <button onClick={() => setShowRepoForm(false)} className="btn ghost" style={{ height: '36px' }}>Cancel</button>
                      <button onClick={saveRepoForm} className="btn primary" style={{ height: '36px' }}>Save Repo</button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {((repoType === "github" && !multiRepoGithub) || (repoType === "azure" && !multiRepo)) && (
                  <button onClick={repoType === "github" ? verifyToken : verifySingleAzureConnection} className="btn success">
                    🔍 Verify Repository Settings
                  </button>
                )}
                {repoStatus && <span style={{ fontSize: '13px', fontWeight: '500', color: repoStatus.includes('✅') ? 'var(--green)' : 'var(--red)' }}>{repoStatus}</span>}
              </div>
            </div>
          )}

          {/* 2. LLM TAB */}
          {activeTab === "llm" && (
            <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>🧠 AI / LLM Configuration</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>LLM Provider</label>
                <select
                  className="input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="azure">Azure OpenAI</option>
                  <option value="openai">OpenAI (Official API)</option>
                  <option value="ollama">Ollama (Local LLM)</option>
                </select>
              </div>

              {provider === "azure" && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Azure OpenAI Endpoint</label>
                    <input
                      className="input"
                      placeholder="https://your-resource.openai.azure.com/"
                      value={azureLlm.endpoint}
                      onChange={(e) => setAzureLlm({ ...azureLlm, endpoint: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Key</label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Enter Azure OpenAI API Key..."
                      value={azureLlm.apiKey}
                      onChange={(e) => setAzureLlm({ ...azureLlm, apiKey: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model / Deployment Name</label>
                      <input
                        className="input"
                        placeholder="e.g. gpt-4o-mini"
                        value={azureLlm.model}
                        onChange={(e) => setAzureLlm({ ...azureLlm, model: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Version</label>
                      <input
                        className="input"
                        placeholder="e.g. 2024-02-15-preview"
                        value={azureLlm.apiVersion}
                        onChange={(e) => setAzureLlm({ ...azureLlm, apiVersion: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '160px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input"
                      placeholder="e.g. 0.2"
                      value={azureLlm.temperature}
                      onChange={(e) => setAzureLlm({ ...azureLlm, temperature: Number(e.target.value) })}
                    />
                  </div>
                </>
              )}

              {provider === "openai" && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Key</label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Enter OpenAI API Key..."
                      value={openaiLlm.apiKey}
                      onChange={(e) => setOpenaiLlm({ ...openaiLlm, apiKey: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model / Deployment Name</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          className="input"
                          value={showOpenaiCustom ? "custom" : (openaiModels.includes(openaiLlm.model) ? openaiLlm.model : "custom")}
                          onChange={(e) => {
                            if (e.target.value === "custom") {
                              setShowOpenaiCustom(true);
                            } else {
                              setShowOpenaiCustom(false);
                              setOpenaiLlm({ ...openaiLlm, model: e.target.value });
                            }
                          }}
                          style={{ flex: 1 }}
                        >
                          {openaiModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="custom">Custom...</option>
                        </select>
                        <button
                          type="button"
                          onClick={detectOpenaiModels}
                          className="btn ghost"
                          disabled={detectingOpenai}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {detectingOpenai ? "Detecting..." : "Auto-Detect"}
                        </button>
                      </div>
                      {(showOpenaiCustom || !openaiModels.includes(openaiLlm.model)) && (
                        <input
                          className="input"
                          placeholder="Enter custom model name (e.g. gpt-4-32k)..."
                          value={openaiLlm.model}
                          onChange={(e) => setOpenaiLlm({ ...openaiLlm, model: e.target.value })}
                          style={{ marginTop: '4px' }}
                        />
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Temperature</label>
                      <input
                        type="number"
                        step="0.1"
                        className="input"
                        placeholder="e.g. 0.2"
                        value={openaiLlm.temperature}
                        onChange={(e) => setOpenaiLlm({ ...openaiLlm, temperature: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </>
              )}

              {provider === "ollama" && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ollama Local Endpoint</label>
                    <input
                      className="input"
                      placeholder="http://localhost:11434"
                      value={ollamaLlm.endpoint}
                      onChange={(e) => setOllamaLlm({ ...ollamaLlm, endpoint: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model Name</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          className="input"
                          value={showOllamaCustom ? "custom" : (ollamaModels.includes(ollamaLlm.model) ? ollamaLlm.model : "custom")}
                          onChange={(e) => {
                            if (e.target.value === "custom") {
                              setShowOllamaCustom(true);
                            } else {
                              setShowOllamaCustom(false);
                              setOllamaLlm({ ...ollamaLlm, model: e.target.value });
                            }
                          }}
                          style={{ flex: 1 }}
                        >
                          {ollamaModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="custom">Custom...</option>
                        </select>
                        <button
                          type="button"
                          onClick={detectOllamaModels}
                          className="btn ghost"
                          disabled={detectingOllama}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {detectingOllama ? "Detecting..." : "Auto-Detect"}
                        </button>
                      </div>
                      {(showOllamaCustom || !ollamaModels.includes(ollamaLlm.model)) && (
                        <input
                          className="input"
                          placeholder="Enter custom model name (e.g. llama3:8b)..."
                          value={ollamaLlm.model}
                          onChange={(e) => setOllamaLlm({ ...ollamaLlm, model: e.target.value })}
                          style={{ marginTop: '4px' }}
                        />
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Temperature</label>
                      <input
                        type="number"
                        step="0.1"
                        className="input"
                        placeholder="e.g. 0.2"
                        value={ollamaLlm.temperature}
                        onChange={(e) => setOllamaLlm({ ...ollamaLlm, temperature: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </>
              )}

              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={verifyLLM} className="btn success">🧪 Test LLM Connection</button>
                {llmStatus && <span style={{ fontSize: '13px', fontWeight: '500', color: llmStatus.includes('✅') ? 'var(--green)' : 'var(--red)' }}>{llmStatus}</span>}
              </div>
            </div>
          )}

          {/* 3. EMAIL TAB */}
          {activeTab === "email" && (
            <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>✉️ SMTP Email Settings</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SMTP Host</label>
                  <input
                    className="input"
                    placeholder="smtp.example.com"
                    value={email.host}
                    onChange={(e) => setEmail({ ...email, host: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Port</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="587"
                    value={email.port}
                    onChange={(e) => setEmail({ ...email, port: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="emailSecure"
                  checked={email.secure}
                  onChange={(e) => setEmail({ ...email, secure: e.target.checked })}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="emailSecure" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>Use Secure TLS/SSL connection</label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SMTP Username</label>
                  <input
                    className="input"
                    placeholder="user@example.com"
                    value={email.user}
                    onChange={(e) => setEmail({ ...email, user: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SMTP Password</label>
                  <input
                    type="password"
                    className="input"
                    placeholder="SMTP password..."
                    value={email.pass}
                    onChange={(e) => setEmail({ ...email, pass: e.target.value })}
                  />
                </div>
              </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>From Address (Optional)</label>
                  <input
                    className="input"
                    placeholder="sender@example.com (defaults to SMTP Username)"
                    value={email.from}
                    onChange={(e) => setEmail({ ...email, from: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CC Address (Optional)</label>
                  <input
                    className="input"
                    placeholder="cc@example.com"
                    value={email.cc || ""}
                    onChange={(e) => setEmail({ ...email, cc: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    id="emailDisabled"
                    checked={email.disabled || false}
                    onChange={(e) => setEmail({ ...email, disabled: e.target.checked })}
                  />
                  <label htmlFor="emailDisabled" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-primary)' }}>Disable Send Email Option</label>
                </div>
              </div>

              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={verifyEmailSettings} className="btn success">🔍 Verify SMTP Server</button>
                {emailStatus && <span style={{ fontSize: '13px', fontWeight: '500', color: emailStatus.includes('✅') ? 'var(--green)' : 'var(--red)' }}>{emailStatus}</span>}
              </div>
            </div>
          )}

          {/* 4. IFS TAB */}
          {activeTab === "ifs" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Core & Customer Solution Paths */}
              <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>📂 Local IFS Solution Directories</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Core Solution Local Path (Standard)</label>
                  <input
                    className="input"
                    placeholder="e.g. C:\IFS\CoreSolution"
                    value={ifsCorePath}
                    onChange={(e) => setIfsCorePath(e.target.value)}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Absolute path to the baseline/standard IFS product source files containing unmodified code.
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Customer Solution Local Path (Customized Overrides)</label>
                  <input
                    className="input"
                    placeholder="e.g. C:\IFS\CustomerSolution"
                    value={ifsCustomerPath}
                    onChange={(e) => setIfsCustomerPath(e.target.value)}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Absolute path to your customized customer solution containing files that override or extend the core solution.
                  </div>
                </div>

                <div style={{ padding: '12px 14px', background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '4px' }}>
                  <span style={{ fontSize: '16px' }}>💡</span>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                    <strong>Validation Overlay Logic</strong>: AQS Inspect combines these folders during file integrity checks. It searches the **Customer Solution** first to evaluate your latest customized files, then falls back to the standard **Core Solution** if no overrides exist.
                  </div>
                </div>
              </div>

              {/* IFS API Config */}
              <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>⚙️ IFS Cloud ERP API Endpoints</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>IFS OData Service URL</label>
                  <input
                    className="input"
                    placeholder="https://ifs-odata.company.com/main/odata/v2"
                    value={ifs.odataUrl}
                    onChange={(e) => setIfs({ ...ifs, odataUrl: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>IFS REST Base URL</label>
                  <input
                    className="input"
                    placeholder="https://ifs-rest.company.com/main/rest"
                    value={ifs.restUrl}
                    onChange={(e) => setIfs({ ...ifs, restUrl: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tenant ID</label>
                    <input
                      className="input"
                      placeholder="e.g. ifs-prod"
                      value={ifs.tenantId}
                      onChange={(e) => setIfs({ ...ifs, tenantId: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Explicit Metadata URL (Optional)</label>
                    <input
                      className="input"
                      placeholder="Endpoint metadata path..."
                      value={ifs.metadataUrl}
                      onChange={(e) => setIfs({ ...ifs, metadataUrl: e.target.value })}
                    />
                  </div>
                </div>

                <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginTop: '10px' }}>OAuth2 Client Credentials</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Access Token Endpoint</label>
                  <input
                    className="input"
                    placeholder="https://identity.company.com/oauth2/token"
                    value={oauth2.tokenUrl}
                    onChange={(e) => setOAuth2({ ...oauth2, tokenUrl: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Client ID</label>
                    <input
                      className="input"
                      placeholder="Client credentials client ID..."
                      value={oauth2.clientId}
                      onChange={(e) => setOAuth2({ ...oauth2, clientId: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Client Secret</label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Client credentials secret..."
                      value={oauth2.clientSecret}
                      onChange={(e) => setOAuth2({ ...oauth2, clientSecret: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Scope</label>
                    <input
                      className="input"
                      placeholder="default"
                      value={oauth2.scope}
                      onChange={(e) => setOAuth2({ ...oauth2, scope: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Access Token (Cached / Custom)</label>
                    <input
                      className="input"
                      placeholder="Bearer token value..."
                      value={oauth2.accessToken}
                      onChange={(e) => setOAuth2({ ...oauth2, accessToken: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button onClick={requestOAuth2Token} className="btn primary">⚡ Generate / Refresh Token</button>
                  <button onClick={verifyOAuth} className="btn">🔍 Verify OAuth2 Credentials</button>
                  <button onClick={verifyIFSConnection} className="btn success">📡 Verify Connection to IFS</button>
                </div>

                {oauthStatus && (
                  <div style={{ fontSize: '13px', fontWeight: '500', color: oauthStatus.includes('✅') ? 'var(--green)' : 'var(--red)', marginTop: '4px' }}>
                    OAuth: {oauthStatus}
                  </div>
                )}
                {ifsStatus && (
                  <div style={{ fontSize: '13px', fontWeight: '500', color: ifsStatus.includes('✅') ? 'var(--green)' : 'var(--red)' }}>
                    ERP: {ifsStatus}
                  </div>
                )}

                {tokenResult && (
                  <pre style={{ margin: '8px 0 0 0', maxHeight: 120, overflowY: 'auto', background: 'var(--bg-input)', border: '1px solid var(--border-dark)', padding: 10, borderRadius: 'var(--radius-md)', fontSize: '11px', fontFamily: 'JetBrains Mono', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(tokenResult, null, 2)}
                  </pre>
                )}

                {ifsDebug && (
                  <div style={{ marginTop: 10, padding: 12, background: 'rgba(227,179,65,0.08)', border: '1px solid rgba(227,179,65,0.25)', borderRadius: 'var(--radius-md)', fontSize: '12px' }}>
                    <strong style={{ color: 'var(--amber)' }}>Debug Response Info:</strong>
                    {ifsDebug.requestUrl && <div style={{ marginTop: 4 }}>URL: <code>{ifsDebug.requestUrl}</code></div>}
                    {ifsDebug.responseStatus && <div style={{ marginTop: 4 }}>Status: <code>{ifsDebug.responseStatus}</code></div>}
                    {ifsDebug.responseData && (
                      <pre style={{ background: 'var(--bg-input)', padding: 8, marginTop: 6, border: '1px solid var(--border-dark)', borderRadius: 4, overflow: 'auto', maxHeight: 100, fontFamily: 'JetBrains Mono', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {typeof ifsDebug.responseData === "string" ? ifsDebug.responseData : JSON.stringify(ifsDebug.responseData, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. MCP TAB */}
          {activeTab === "mcp" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>📡 MCP Rule Engine Configuration</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Rule Engine Mode</label>
                  <select
                    className="input"
                    value={mcp.mode}
                    onChange={(e) => setMcp({ ...mcp, mode: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="hybrid">Hybrid (Deterministic Rules + AI)</option>
                    <option value="rules-only">Deterministic Rules Only</option>
                    <option value="ai-only">AI Review Engine Only</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    id="impactAnalysis"
                    checked={mcp.enableImpactAnalysis}
                    onChange={(e) => setMcp({ ...mcp, enableImpactAnalysis: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="impactAnalysis" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>Enable PR → ERP metadata dependencies & impact analysis</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    id="useCoreReference"
                    checked={mcp.useCoreReference}
                    onChange={(e) => setMcp({ ...mcp, useCoreReference: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="useCoreReference" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>Intelligently use Core Solution files as reference standard / source of truth</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    id="enableKnowledgeBase"
                    checked={mcp.enableKnowledgeBase}
                    onChange={(e) => setMcp({ ...mcp, enableKnowledgeBase: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="enableKnowledgeBase" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>Enable Knowledge Base guidelines & review instructions</label>
                </div>

                {mcp.enableKnowledgeBase && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginLeft: '24px', marginTop: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Knowledge Path</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '620px' }}>
                      <input
                        className="input"
                        placeholder="e.g. C:\IFS\KnowledgeBase"
                        value={mcp.knowledgePath || ""}
                        onChange={(e) => setMcp({ ...mcp, knowledgePath: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={analyseKB}
                        className="btn primary"
                        disabled={analysingKB}
                        style={{ whiteSpace: 'nowrap', height: '38px', padding: '0 16px' }}
                      >
                        {analysingKB ? "Analyzing..." : "🔍 Analyse"}
                      </button>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Folder containing guidelines, checklist documents (PDF, Word, TXT, MD) to align review findings.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                      <input
                        type="checkbox"
                        id="enableIfsDocsSearch"
                        checked={mcp.enableIfsDocsSearch || false}
                        onChange={(e) => setMcp({ ...mcp, enableIfsDocsSearch: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor="enableIfsDocsSearch" style={{ fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
                        Enable dynamic on-demand web search on docs.ifs.com/techdocs
                      </label>
                    </div>

                    {mcp.enableIfsDocsSearch && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '24px', marginTop: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>IFS Tech Docs Version</label>
                        <input
                          className="input"
                          placeholder="e.g. 26r1"
                          value={mcp.ifsDocsVersion || "26r1"}
                          onChange={(e) => setMcp({ ...mcp, ifsDocsVersion: e.target.value })}
                          style={{ maxWidth: '200px' }}
                        />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Version sub-directory used for doc indexing (e.g. 26r1, 24r2).
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                  <button onClick={refreshMCPStatus} className="btn">📡 Refresh MCP Status</button>
                  <button onClick={verifyMCP} disabled={mcpLoading} className="btn primary">
                    {mcpLoading ? "Verifying..." : "🔍 Test MCP Server Connection"}
                  </button>
                  <button onClick={refreshAuditTrail} className="btn">🧾 Load Audit Trail</button>
                </div>

                {mcpVerifyStatus && (
                  <div style={{ padding: 12, background: mcpVerifyStatus.includes('✅') ? 'var(--green-soft)' : 'var(--amber-soft)', border: `1px solid ${mcpVerifyStatus.includes('✅') ? 'var(--green-border)' : 'var(--amber-border)'}`, borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: '500', color: mcpVerifyStatus.includes('✅') ? 'var(--green)' : 'var(--amber)' }}>
                    {mcpVerifyStatus}
                  </div>
                )}

                {mcpStatus && (
                  <pre style={{ maxHeight: 150, overflowY: 'auto', background: 'var(--bg-input)', border: '1px solid var(--border-dark)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: '11px', fontFamily: 'JetBrains Mono', color: 'var(--text-secondary)' }}>
                    {typeof mcpStatus === "string" ? mcpStatus : JSON.stringify(mcpStatus, null, 2)}
                  </pre>
                )}

                {auditTrail?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>System Audit Log:</strong>
                    <pre style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-input)', border: '1px solid var(--border-dark)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: '11px', fontFamily: 'JetBrains Mono', color: 'var(--text-secondary)' }}>
                      {JSON.stringify(auditTrail, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* PR LIVE VALIDATION TEST CONTAINER */}
              <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>🧪 Connected ERP Live Validation Scan</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Enter a Pull Request ID or direct PR URL below to run a mock validation scan against your local Core/Customer folders.
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    className="input"
                    placeholder="PR ID or URL (e.g. 752)"
                    value={testPrUrl}
                    onChange={(e) => setTestPrUrl(e.target.value)}
                  />
                  <button
                    onClick={async () => {
                      if (!testPrUrl) {
                        alert("⚠️ Please enter a Pull Request reference ID first");
                        return;
                      }
                      setTestLoading(true);
                      setTestResults(null);
                      try {
                        const res = await window.api.analyzePullRequestImpact({ prUrlOrId: testPrUrl });
                        if (res?.ok) {
                          setTestResults(res.result);
                        } else {
                          alert("❌ Analysis failed: " + (res?.error || "Unknown error"));
                        }
                      } catch (e) {
                        alert("❌ Failed: " + e.message);
                      } finally {
                        setTestLoading(false);
                      }
                    }}
                    disabled={testLoading}
                    className="btn primary"
                  >
                    {testLoading ? "Running validation scan..." : "🧪 Validate Code Integrity"}
                  </button>
                </div>

                {testResults && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>Validation Findings</h4>
                    {testResults.findings?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-dark)', borderRadius: 'var(--radius-md)', padding: '10px', background: 'var(--bg-input)' }}>
                        {testResults.findings.map((f, i) => (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: i < testResults.findings.length - 1 ? '1px solid var(--border-dark)' : 'none', paddingBottom: i < testResults.findings.length - 1 ? '8px' : 0, paddingTop: i > 0 ? '8px' : 0, fontSize: '12.5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                background: f.severity === "Blocker" || f.severity === "Critical" ? 'var(--red-soft)' : 'var(--amber-soft)',
                                color: f.severity === "Blocker" || f.severity === "Critical" ? 'var(--red)' : 'var(--amber)',
                                border: `1px solid ${f.severity === "Blocker" || f.severity === "Critical" ? 'var(--red-border)' : 'var(--amber-border)'}`,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: '700'
                              }}>{f.severity.toUpperCase()}</span>
                              <strong>{f.title}</strong>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', paddingLeft: '0', marginTop: '2px' }}>{f.explanation}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: 'var(--green)', padding: '10px 14px', background: 'var(--green-soft)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '8px' }}>
                        <span>✅</span>
                        <span>All checks passed successfully! Code changes are fully consistent with core and customer databases.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. RULES TAB */}
          {activeTab === "rules" && (
            <div className="panel" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border-dark)', paddingBottom: '10px', color: 'var(--text-primary)' }}>📋 Enterprise Review Rules Dictionary</h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0 }}>
                Manage the static and dynamic validation rules enforced during static code analysis. Dynamic rules are extracted from your local IFS core directory.
              </p>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    if (!ifsCorePath) {
                      alert("⚠️ Please configure the IFS Core Local Path first!");
                      return;
                    }
                    setRulesLoading(true);
                    try {
                      const res = await window.api.buildRulesFromCore({ corePath: ifsCorePath });
                      if (res?.ok) {
                        alert(`✅ Core scan completed! Extracted and saved ${res.count} dynamic rules.`);
                        loadRules();
                      } else {
                        alert("❌ Core scan failed: " + res?.error);
                      }
                    } catch (e) {
                      alert("❌ Scan request failed: " + e.message);
                    } finally {
                      setRulesLoading(false);
                    }
                  }}
                  disabled={rulesLoading}
                  className="btn primary"
                >
                  🔍 Build Rules Dictionary from Core Solution
                </button>
                <button
                  onClick={async () => {
                    setRulesLoading(true);
                    await window.api.approveAllRules();
                    alert("✅ All validation rules enabled");
                    loadRules();
                  }}
                  disabled={rulesLoading}
                  className="btn success"
                >
                  ✓ Enable All Rules
                </button>
                <button
                  onClick={async () => {
                    setRulesLoading(true);
                    await window.api.disapproveAllRules();
                    alert("❌ All validation rules disabled");
                    loadRules();
                  }}
                  disabled={rulesLoading}
                  className="btn danger"
                >
                  ✗ Disable All Rules
                </button>
                <button
                  onClick={async () => {
                    const confirm1 = window.confirm("⚠️ Are you sure you want to delete all rules in the registry?");
                    if (confirm1) {
                      const confirm2 = window.confirm("⚠️ This will permanently delete custom rules and remove built-in rules. Proceed?");
                      if (confirm2) {
                        setRulesLoading(true);
                        try {
                          const res = await window.api.deleteAllRules();
                          if (res?.ok) {
                            alert("✅ All rules deleted successfully!");
                            loadRules();
                          } else {
                            alert("❌ Failed to delete rules: " + res?.error);
                          }
                        } catch (e) {
                          alert("❌ Error: " + e.message);
                        } finally {
                          setRulesLoading(false);
                        }
                      }
                    }
                  }}
                  disabled={rulesLoading}
                  className="btn danger"
                  style={{ background: 'var(--red-soft)', color: 'var(--red)', border: '1px solid var(--red-border)' }}
                >
                  🗑 Delete All Rules
                </button>
                <button
                  onClick={async () => {
                    setRulesLoading(true);
                    try {
                      const res = await window.api.importRules();
                      if (res?.ok) {
                        alert(`✅ Successfully imported ${res.count} rules!`);
                        loadRules();
                      } else if (res?.error !== 'cancelled') {
                        alert("❌ Import failed: " + res?.error);
                      }
                    } catch (e) {
                      alert("❌ Import failed: " + e.message);
                    } finally {
                      setRulesLoading(false);
                    }
                  }}
                  disabled={rulesLoading}
                  className="btn primary"
                >
                  📥 Import Rules
                </button>
                <button
                  onClick={async () => {
                    setRulesLoading(true);
                    try {
                      const res = await window.api.exportRules();
                      if (res?.ok) {
                        alert("✅ Rules exported successfully!");
                      } else if (res?.error !== 'cancelled') {
                        alert("❌ Export failed: " + res?.error);
                      }
                    } catch (e) {
                      alert("❌ Export failed: " + e.message);
                    } finally {
                      setRulesLoading(false);
                    }
                  }}
                  disabled={rulesLoading}
                  className="btn"
                >
                  📤 Export Rules
                </button>
                <button
                  onClick={() => {
                    setEditingRuleId("new");
                    setEditFormData({
                      id: "",
                      title: "",
                      description: "",
                      recommendation: "",
                      severity: "Major",
                      category: "all",
                      pattern: "",
                      alertOnMissing: false,
                      approved: true,
                      source: "custom",
                      classification: "CUSTOM"
                    });
                  }}
                  disabled={rulesLoading}
                  className="btn"
                  style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent)' }}
                >
                  ➕ Create Custom Rule
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>Rules Registry</h4>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button onClick={loadRules} disabled={rulesLoading} className="btn ghost" style={{ height: '28px' }}>
                      {rulesLoading ? "Syncing..." : "🔄 Refresh Rules"}
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-light)' }}>Total Rules: {rules.length}</span>
                  </div>
                </div>

                {(rules.length > 0 || editingRuleId === "new") ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--border-dark)', padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)' }}>
                    {editingRuleId === "new" && (
                      <div
                        style={{
                          padding: '14px',
                          background: 'var(--bg-card)',
                          borderRadius: 'var(--radius-md)',
                          borderLeft: '4px solid var(--accent)',
                          border: '1px solid var(--border-dark)',
                          borderLeftWidth: '4px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                            ➕ Create New Custom Rule
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Rule ID (Unique, alphanumeric and hyphens/underscores only)</label>
                            <input
                              className="input"
                              placeholder="e.g. CUSTOM-001"
                              value={editFormData.id || ""}
                              onChange={(e) => setEditFormData({ ...editFormData, id: e.target.value })}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Rule Title</label>
                            <input
                              className="input"
                              placeholder="e.g. Avoid hardcoded temp directories"
                              value={editFormData.title || ""}
                              onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Description / Explanatory Text</label>
                            <textarea
                              className="input"
                              style={{ height: '60px', padding: '8px', resize: 'vertical' }}
                              placeholder="Detailed explanation of the rule..."
                              value={editFormData.description || ""}
                              onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Remediation Recommendation</label>
                            <input
                              className="input"
                              placeholder="e.g. Use ConfigStore or temporary folder variables instead."
                              value={editFormData.recommendation || ""}
                              onChange={(e) => setEditFormData({ ...editFormData, recommendation: e.target.value })}
                            />
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Severity Level</label>
                              <select
                                className="input"
                                value={editFormData.severity || "Major"}
                                onChange={(e) => setEditFormData({ ...editFormData, severity: e.target.value })}
                              >
                                <option value="Blocker">Blocker</option>
                                <option value="Major">Major</option>
                                <option value="Minor">Minor</option>
                                <option value="Info">Info</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Language / Category</label>
                              <input
                                className="input"
                                placeholder="e.g. plsql, javascript, all"
                                value={editFormData.category || "all"}
                                onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Regex Evaluation Pattern (Optional)</label>
                            <input
                              className="input"
                              style={{ fontFamily: "monospace" }}
                              placeholder="e.g. \\b(temp_dir|tmp)\\b"
                              value={editFormData.pattern || ""}
                              onChange={(e) => setEditFormData({ ...editFormData, pattern: e.target.value })}
                            />
                          </div>

                          <div style={{ display: "flex", gap: 8, marginTop: '4px' }}>
                            <button
                              onClick={async () => {
                                if (!editFormData.id || !editFormData.id.trim()) {
                                  alert("⚠️ Rule ID is required");
                                  return;
                                }
                                if (!/^[a-zA-Z0-9\-_]+$/.test(editFormData.id.trim())) {
                                  alert("⚠️ Rule ID must contain only alphanumeric characters, underscores, and hyphens");
                                  return;
                                }
                                const exists = rules.some(r => r.id.toLowerCase() === editFormData.id.trim().toLowerCase());
                                if (exists) {
                                  alert(`⚠️ A rule with ID '${editFormData.id.trim()}' already exists`);
                                  return;
                                }
                                if (!editFormData.title || !editFormData.title.trim()) {
                                  alert("⚠️ Rule Title is required");
                                  return;
                                }

                                setRulesLoading(true);
                                try {
                                  const res = await window.api.updateRule({ rule: { ...editFormData, id: editFormData.id.trim() } });
                                  if (res?.ok) {
                                    alert("New rule created successfully!");
                                    setEditingRuleId(null);
                                    loadRules();
                                  } else {
                                    alert("Failed to create rule: " + res?.error);
                                  }
                                } catch (err) {
                                  alert("Error creating rule: " + err.message);
                                } finally {
                                  setRulesLoading(false);
                                }
                              }}
                              className="btn primary"
                            >
                              Create Rule
                            </button>
                            <button onClick={() => setEditingRuleId(null)} className="btn ghost">Cancel</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {rules.map((rule, idx) => {
                      const isEditing = editingRuleId === rule.id;
                      const sevColor = rule.severity === 'Blocker' || rule.severity === 'Critical' ? 'var(--red)' : rule.severity === 'Major' || rule.severity === 'Warning' ? 'var(--amber)' : 'var(--green)';
                      
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '14px',
                            background: 'var(--bg-card)',
                            borderRadius: 'var(--radius-md)',
                            borderLeft: `4px solid ${sevColor}`,
                            border: '1px solid var(--border-dark)',
                            borderLeftWidth: '4px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          {isEditing ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                <strong>ID: {rule.id}</strong> (Source: {rule.source})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Rule Title</label>
                                <input
                                  className="input"
                                  value={editFormData.title || ""}
                                  onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Description / Explanatory Text</label>
                                <textarea
                                  className="input"
                                  style={{ height: '60px', padding: '8px', resize: 'vertical' }}
                                  value={editFormData.description || ""}
                                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Remediation Recommendation</label>
                                <input
                                  className="input"
                                  value={editFormData.recommendation || ""}
                                  onChange={(e) => setEditFormData({ ...editFormData, recommendation: e.target.value })}
                                />
                              </div>
                              
                              <div style={{ display: "grid", gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Severity Level</label>
                                  <select
                                    className="input"
                                    value={editFormData.severity || "Major"}
                                    onChange={(e) => setEditFormData({ ...editFormData, severity: e.target.value })}
                                  >
                                    <option value="Blocker">Blocker</option>
                                    <option value="Major">Major</option>
                                    <option value="Minor">Minor</option>
                                    <option value="Info">Info</option>
                                  </select>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Language / Category</label>
                                  <input
                                    className="input"
                                    value={editFormData.category || "all"}
                                    onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                                  />
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Regex Evaluation Pattern (Optional)</label>
                                <input
                                  className="input"
                                  style={{ fontFamily: "monospace" }}
                                  value={editFormData.pattern || ""}
                                  onChange={(e) => setEditFormData({ ...editFormData, pattern: e.target.value })}
                                />
                              </div>

                              <div style={{ display: "flex", gap: 8, marginTop: '4px' }}>
                                <button
                                  onClick={async () => {
                                    setRulesLoading(true);
                                    try {
                                      const res = await window.api.updateRule({ rule: editFormData });
                                      if (res?.ok) {
                                        alert("Rule registry updated successfully!");
                                        setEditingRuleId(null);
                                        loadRules();
                                      } else {
                                        alert("Failed to update rule: " + res?.error);
                                      }
                                    } catch (err) {
                                      alert("Error saving rule: " + err.message);
                                    } finally {
                                      setRulesLoading(false);
                                    }
                                  }}
                                  className="btn primary"
                                >
                                  Save Rule Changes
                                </button>
                                <button onClick={() => setEditingRuleId(null)} className="btn ghost">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: '10px' }}>
                                <div>
                                  <span style={{ fontWeight: "700", fontSize: "13.5px", color: 'var(--text-primary)' }}>{rule.title}</span>
                                  <span style={{ fontSize: "11px", color: 'var(--text-muted)', marginLeft: "8px" }}>({rule.id})</span>
                                </div>
                                <div style={{ display: "flex", gap: '6px', flexShrink: 0 }}>
                                  <button
                                    onClick={async () => {
                                      setRulesLoading(true);
                                      const nextStatus = !rule.approved;
                                      await window.api.approveRule({ ruleId: rule.id, approvedStatus: nextStatus });
                                      loadRules();
                                    }}
                                    className={`btn ${rule.approved ? 'success' : 'ghost'}`}
                                    style={{ padding: "3px 8px", fontSize: "11px", height: '24px' }}
                                  >
                                    {rule.approved ? "✓ Enabled" : "✗ Disabled"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingRuleId(rule.id);
                                      setEditFormData(rule);
                                    }}
                                    className="btn"
                                    style={{ padding: "3px 8px", fontSize: "11px", height: '24px' }}
                                  >
                                    ✎ Edit
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const confirmed = window.confirm(`Are you sure you want to delete the rule "${rule.title}" (${rule.id})?`);
                                      if (confirmed) {
                                        setRulesLoading(true);
                                        try {
                                          const res = await window.api.deleteRule({ ruleId: rule.id });
                                          if (res?.ok) {
                                            alert("Rule deleted successfully!");
                                            loadRules();
                                          } else {
                                            alert("Failed to delete rule: " + res?.error);
                                          }
                                        } catch (e) {
                                          alert("Error deleting rule: " + e.message);
                                        } finally {
                                          setRulesLoading(false);
                                        }
                                      }
                                    }}
                                    className="btn danger"
                                    style={{ padding: "3px 8px", fontSize: "11px", height: '24px', background: 'var(--red-soft)', color: 'var(--red)', border: '1px solid var(--red-border)' }}
                                  >
                                    🗑 Delete
                                  </button>
                                </div>
                              </div>
                              <div style={{ fontSize: "11px", display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                                <span style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', padding: "1px 6px", borderRadius: 3 }}>
                                  Severity: {rule.severity}
                                </span>
                                <span style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', padding: "1px 6px", borderRadius: 3 }}>
                                  Language: {rule.category || 'all'}
                                </span>
                                <span style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', padding: "1px 6px", borderRadius: 3 }}>
                                  Source: {rule.source}
                                </span>
                              </div>
                              {rule.description && (
                                <div style={{ fontSize: "12.5px", color: "var(--text-secondary)", marginTop: '6px', lineHeight: '1.4' }}>
                                  {rule.description}
                                </div>
                              )}
                              {rule.recommendation && (
                                <div style={{ fontSize: "12px", color: "var(--accent-light)", marginTop: '4px', fontStyle: 'italic' }}>
                                  💡 Recommendation: {rule.recommendation}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '30px', border: '1px dashed var(--border-dark)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No rules loaded in registry. Click refresh or import standard rules.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
