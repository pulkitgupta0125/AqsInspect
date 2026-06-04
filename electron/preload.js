const { contextBridge, ipcRenderer } = require('electron');

console.log('✅ PRELOAD START (stable)');

/* ✅ SINGLE SOURCE OF IPC CONTRACT */
contextBridge.exposeInMainWorld('api', {
  /* =============================
     CONFIG
  ============================= */
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  clearConfig: () => ipcRenderer.invoke('config:clear'),

  /* =============================
     GITHUB
  ============================= */
  fetchPullRequestDiff: (payload) =>
    ipcRenderer.invoke('pr:fetchDiff', payload),

  verifyGitHubToken: (token) =>
    ipcRenderer.invoke('github:verify', token),

  sendEmail: (payload) => ipcRenderer.invoke('email:send', payload),
  testSMTP: (payload) => ipcRenderer.invoke('email:test', payload),

  // Save review report to disk
  saveReport: (payload) => ipcRenderer.invoke('report:save', payload),
  // Save review report as PDF (renderer provides markdown; main process converts to PDF)
  saveReportPdf: (payload) => ipcRenderer.invoke('report:savePdf', payload),

  /* =============================
     LLM
  ============================= */
  runAIReview: (payload) =>
    ipcRenderer.invoke('review:run', payload),

  verifyLLMConfig: (llm) =>
    ipcRenderer.invoke('llm:verify', llm),

  /* =============================
     MCP / ERP INTEGRATION
  ============================= */
  getMCPStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  analyzePullRequestImpact: (payload) => ipcRenderer.invoke('mcp:analyzeImpact', payload),
  fetchIFSMetadata: () => ipcRenderer.invoke('mcp:fetchIFSMetadata'),
  verifyOAuth2Config: (config) => ipcRenderer.invoke('mcp:verifyOAuth2', config),
  verifyIFSConnection: (config) => ipcRenderer.invoke('mcp:verifyIFSConnection', config),
  requestOAuth2Token: (payload) => ipcRenderer.invoke('oauth2:requestToken', payload),
  getAuditTrail: () => ipcRenderer.invoke('mcp:getAuditTrail'),

  /* =============================
     REPOSITORY
  ============================= */
  listPullRequests: (payload) =>
    ipcRenderer.invoke('repo:listPullRequests', payload),

  getPullRequestDetails: (payload) =>
    ipcRenderer.invoke('repo:getPullRequestDetails', payload),
	
  generateFix: (payload) => ipcRenderer.invoke("fix:generate", payload),	
  
  reviewRepository: (payload) => ipcRenderer.invoke("review:repo", payload),

  getFileContent: (payload) => ipcRenderer.invoke("file:getContent", payload),
  performPRAction: (payload) => ipcRenderer.invoke("pr:performAction", payload),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),

  /* =============================
     RULES & USER
  ============================= */
  listRules: () => ipcRenderer.invoke('rules:list'),
  updateRules: (payload) => ipcRenderer.invoke('rules:update', payload),
  getUserEmail: (payload) => ipcRenderer.invoke('user:getEmail', payload),
  verifyMCP: () => ipcRenderer.invoke('mcp:verify'),

  /* =============================
     DEBUG (OPTIONAL)
  ============================= */
  ping: () => ipcRenderer.invoke('app:ping')
});
