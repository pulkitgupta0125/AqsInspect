# Configuration Guide

This document explains how to configure IFS ERP integration, the MCP engine, and OAuth2 support for AQSInspect1.

## Configuration Storage

AQSInspect1 stores settings in a `config.json` file located under the Electron user data folder. The application merges new settings with existing values safely, preserving unrelated configuration blocks.

The supported configuration sections are:

- `github` / `azure` for repository access
- `ifs` for IFS ERP integration
- `mcp` for MCP engine behavior
- `oauth2` for OAuth2 authentication settings
- `llm` for AI review provider settings

## Example Configuration

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
    "accessToken": "ifs-access-token",
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
    "accessToken": "oauth-access-token"
  },
  "llm": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

## IFS ERP Integration

The `ifs` settings enable enterprise-aware analysis by fetching metadata and resources from an IFS endpoint.

### Supported fields

- `ifs.odataUrl` — Base URL for IFS OData metadata requests.
- `ifs.restUrl` — Optional REST endpoint base URL for additional IFS resources.
- `ifs.accessToken` — Optional Bearer token for API authorization.
- `ifs.basicAuthUser` / `ifs.basicAuthPassword` — Optional credentials for basic auth.
- `ifs.additionalHeaders` — Optional custom HTTP headers for IFS requests.

### Behavior

- `electron/integration/ifsOData.js` builds request headers from the configured credentials.
- Metadata fetching uses `${odataUrl}/$metadata` to validate the IFS endpoint.
- The MCP engine consumes IFS metadata during PR impact analysis.

### Recommended setup

1. Enter `odataUrl` for your IFS environment.
2. Add `restUrl` if you need non-OData resource access.
3. Provide either `accessToken` or basic auth credentials.
4. Verify the connection using the app Settings screen.

## MCP Engine

The MCP engine is the enterprise validation layer used for PR impact analysis and IFS-aware compliance checks.

### Supported fields

- `mcp.mode` — Controls MCP execution mode.
  - `hybrid` — Combines deterministic rule validation with AI reasoning.
  - `rule-only` — Runs only rule-based checks.
  - `ai-only` — Runs only AI-driven review.

### What the MCP engine does

- Validates PR metadata and IFS integration readiness.
- Fetches IFS metadata when configured.
- Runs the rule engine to classify impact and risk.
- Records audit events for traceability.

### Key modules

- `electron/mcpServer.js` — MCP orchestration, status, and verification.
- `electron/reviewEngine/ruleEngine.js` — Rule evaluation and PR impact validation.
- `electron/extensions/audit.js` — Audit trail recording.

## OAuth2 Setup

The OAuth2 configuration section secures enterprise access and token verification.

### Required fields

- `oauth2.authUrl` — Authorization endpoint.
- `oauth2.tokenUrl` — Token exchange endpoint.
- `oauth2.clientId` — OAuth2 client identifier.
- `oauth2.clientSecret` — OAuth2 client secret.

### Optional fields

- `oauth2.introspectionUrl` — Token introspection endpoint.
- `oauth2.accessToken` — Bearer token to validate.

### Validation flow

- `electron/mcpServer.js` calls `electron/security/oauth2.js`.
- `oauth2.validateToken()` checks token presence and optionally introspects it.
- If `introspectionUrl` is missing, token validity is inferred from presence.

### Example OAuth2 config

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

- Use a dedicated OAuth2 application registration for AQSInspect1.
- Store `clientSecret` and access tokens securely.
- Prefer token introspection to validate token status.
- Do not share credentials across unrelated systems.

## Notes on Configuration Merge

`electron/configStore.js` performs a safe deep merge of incoming settings, preserving existing blocks for:

- `llm`
- `github`
- `azure`
- `ifs`
- `mcp`
- `oauth2`
- `extensions`

This ensures Settings updates do not overwrite unrelated configuration.
