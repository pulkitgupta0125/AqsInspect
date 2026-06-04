# AQSInspect1

AQSInspect1 is an Electron + React desktop application for AI-driven pull request review, IFS-specific repository analysis, and enterprise MCP validation.

## Configuration

The application persists settings in `config.json` under the Electron `userData` folder. Configuration is managed through the UI Settings screen, and the following integration blocks are supported:

- `github` / `azure` repository credentials
- `ifs` ERP integration settings
- `mcp` validation engine settings
- `oauth2` authentication settings
- `llm` AI provider settings

For full configuration and integration guidance, see `docs/CONFIGURATION.md`.

### Example `config.json`

```json
{
  "repoType": "github",
  "github": {
    "token": "ghp_...",
    "owner": "my-org",
    "repo": "my-repo",
    "baseUrl": "https://api.github.com"
  },
  "ifs": {
    "odataUrl": "https://ifs.example.com/odata",
    "restUrl": "https://ifs.example.com/api",
    "accessToken": "IFS_ACCESS_TOKEN",
    "basicAuthUser": "ifs_user",
    "basicAuthPassword": "ifs_password",
    "additionalHeaders": {
      "Custom-Header": "value"
    }
  },
  "mcp": {
    "mode": "hybrid"
  },
  "oauth2": {
    "authUrl": "https://login.example.com/oauth2/authorize",
    "tokenUrl": "https://login.example.com/oauth2/token",
    "introspectionUrl": "https://login.example.com/oauth2/introspect",
    "clientId": "my-client-id",
    "clientSecret": "my-client-secret",
    "accessToken": "oauth_access_token"
  },
  "llm": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

---

## IFS ERP Integration

The IFS integration enables enterprise-aware review and impact analysis by fetching metadata from IFS OData/REST endpoints.

### Supported integration paths

- `ifs.odataUrl` — base URL for IFS OData metadata, e.g. `https://ifs.example.com/odata`
- `ifs.restUrl` — optional REST endpoint base URL for custom IFS resources
- `ifs.accessToken` — bearer token for request authorization
- `ifs.basicAuthUser` / `ifs.basicAuthPassword` — optional basic auth credentials
- `ifs.additionalHeaders` — optional HTTP headers to include on each IFS request

### How it works

- `electron/integration/ifsOData.js` builds request headers and fetches metadata from `${odataUrl}/$metadata`
- Metadata is used by the MCP engine to validate PR impact and identify IFS-specific risks
- IFS connection can be verified through the Settings screen or via the IPC handler `mcp:verifyIFSConnection`

### Validation

The app verifies the endpoint by requesting `GET $metadata` and returning:

- `ok: true` when metadata is reachable
- `ok: false` when the endpoint fails or returns an error

### Recommended usage

1. Configure `ifs.odataUrl` and/or `ifs.restUrl`
2. Supply authentication via `accessToken` or Basic Auth
3. Test the connection from Settings
4. Use PR impact analysis once verified

---

## MCP Engine

The MCP (Model + Compliance Platform) engine is the enterprise analysis layer for pull request impact, IFS validation, and audit-ready reasoning.

### What MCP provides

- Hybrid validation combining AI review and rule-based risk checks
- PR impact analysis based on repository metadata and IFS metadata
- Audit trail recording of impact analysis events
- Configuration-driven mode selection

### Key modules

- `electron/mcpServer.js` — orchestrates MCP status, impact analysis, metadata retrieval, and verification
- `electron/reviewEngine/ruleEngine.js` — evaluates enterprise risk rules and IFS PR impacts
- `electron/extensions/audit.js` — records audit events for traceability

### Configuration

- `mcp.mode` — review mode; defaults to `hybrid`
  - `hybrid` — combine rule-based validation and AI-assisted reasoning
  - `rule-only` — run only deterministic MCP rules
  - `ai-only` — use only LLM review guidance

### MCP API

The renderer interacts with MCP through IPC handlers exposed by `electron/preload.js`:

- `api.getMCPStatus()` — returns current MCP readiness and configuration state
- `api.analyzePullRequestImpact(payload)` — runs PR impact analysis for the selected PR
- `api.fetchIFSMetadata()` — fetches IFS metadata to confirm endpoint availability
- `api.verifyOAuth2Config(config)` — validates OAuth2 credentials
- `api.verifyIFSConnection(config)` — verifies the IFS endpoint
- `api.getAuditTrail()` — retrieves recent MCP audit events

---

## MCP / OAuth2 Setup

OAuth2 is used to secure integration flows and validate access tokens for enterprise data sources.

### Required OAuth2 fields

- `oauth2.authUrl` — authorization endpoint
- `oauth2.tokenUrl` — token exchange endpoint
- `oauth2.clientId` — OAuth2 client identifier
- `oauth2.clientSecret` — OAuth2 client secret

### Optional OAuth2 fields

- `oauth2.introspectionUrl` — token introspection endpoint
- `oauth2.accessToken` — existing bearer token for validation

### How OAuth2 is validated

- `electron/mcpServer.js` calls `electron/security/oauth2.js`
- `oauth2.validateToken()` checks token presence and, if configured, posts to `introspectionUrl`
- If no `introspectionUrl` is provided, token validity is inferred by presence

### OAuth2 flows supported by the application

- Authorization code flow via `buildAuthorizationUrl()`
- Token exchange via `exchangeAuthorizationCode()`
- Refresh token flow via `refreshToken()`

### Example OAuth2 configuration

```json
"oauth2": {
  "authUrl": "https://login.example.com/oauth2/authorize",
  "tokenUrl": "https://login.example.com/oauth2/token",
  "introspectionUrl": "https://login.example.com/oauth2/introspect",
  "clientId": "my-client-id",
  "clientSecret": "my-client-secret",
  "accessToken": "eyJhbGci..."
}
```

### Best practices

- Use a dedicated OAuth2 client for the desktop application
- Store secrets in the Electron config store only when required by your environment
- Prefer token introspection to verify access tokens against your identity provider
- Keep `clientSecret` and `accessToken` private

---

## Notes

- `electron/configStore.js` performs a safe deep merge for `ifs`, `mcp`, and `oauth2` blocks
- Legacy GitHub token support is preserved through `githubToken` compatibility
- Settings screen updates are merged into existing config without overwriting unrelated blocks

If you need a separate `docs/CONFIGURATION.md` file instead of a root README, I can add that next.
