# IFS AQS AI Review Engine - Architecture

## Overview

The review engine is an enterprise-grade code analysis system for IFS Cloud and IFS Applications. It performs **repository-wide analysis** with **IFS-specific file type detection** and **2-pass review** (static + LLM).

## Backward Compatibility

✅ **All existing features preserved:**
- `review:run` (PR diff analysis) works unchanged
- Settings, UI, repo browsing, diff viewer unaffected
- New `review:repo` handler available for full-repo analysis
- IPC contracts extended (new handler added to preload.js)

## Architecture

### Components

```
electron/
├── reviewEngine/
│   ├── index.js                 # Main exports
│   ├── fileDiscovery.js         # Phase 1: Find all repo files
│   ├── fileClassifier.js        # Phase 2: Categorize by IFS type
│   ├── staticAnalyzer.js        # Phase 3a: Pass-1 linting (no LLM)
│   ├── prompts.js               # Specialized prompts per file type
│   └── orchestrator.js          # Phase 3b-4: LLM review + consolidation
├── ipcHandlers.js               # (EXTENDED) Added review:repo handler
└── preload.js                   # (EXTENDED) Added reviewRepository API
```

### Data Flow

```
[Frontend Request: repoPath]
         ↓
[Phase 1: File Discovery] → Scans repo, respects .gitignore
         ↓
[Phase 2: Classification] → Detects IFS file types (.plsql, .views, .projection, etc.)
         ↓
[Phase 3a: Static Analysis] → Fast rule-based checks (naming, basics, no LLM)
         ↓
[Phase 3b: LLM Review] → Per-file-type specialized prompts with context
         ↓
[Phase 4: Consolidation] → Map-reduce findings, generate report
         ↓
[Report with per-file + summary + recommendations]
```

## Module Documentation

### 1. **fileDiscovery.js** - Repository Traversal

**Responsibility**: Safely traverse filesystem, discover all relevant files.

**Key Functions:**
- `discoverFiles(repoRoot, maxFiles=5000)` - Traverses repo, respects ignore patterns
- `loadIgnoreList(repoRoot)` - Loads .gitignore + applies defaults
- `shouldIgnore(filePath, patterns)` - Checks if file should be skipped

**Features:**
- Respects `.gitignore` patterns
- Excludes build artifacts (node_modules, dist, bin, obj, etc.)
- Prevents deep recursion (max depth 15)
- Safe error handling (skips unreadable files)
- Returns file metadata: path, size, mtime, extension

**Output:**
```javascript
[
  { path: "src/utils.plsql", fullPath: "...", size: 2048, extension: ".plsql" },
  ...
]
```

---

### 2. **fileClassifier.js** - IFS Type Detection

**Responsibility**: Categorize files by IFS purpose (PL/SQL, Aurena, Config, etc.).

**IFS File Categories:**
- `plsql` - .plsql, .plsvc (stored procedures)
- `views` - .views (Oracle view definitions)
- `db_script` - .cdb, .cre, .ins, .upg (DDL scripts)
- `projection` - .projection (Aurena projections)
- `client` - .client, .fragment (Aurena client components)
- `entity` - .entity (IFS entity definitions)
- `report` - .report, .xsl (report definitions)
- `config` - .xml configs, connectConfig
- `forms` - .cs, .designer.cs, .resx (Apps10 forms)
- `api` - .api, .apy (API definitions)
- `other` - Unrecognized files

**Classification Heuristics:**
1. Direct extension match (fastest)
2. Complex extension pattern (e.g., `.designer.cs`)
3. Content inspection for `.xml` files (looks for connectConfig, projection, entity tags)
4. SQL pattern detection for `.sql`/`.txt` files

**Key Functions:**
- `classifyFile(filePath, fullPath)` - Classifies single file with confidence
- `classifyMultiple(files)` - Batch classification
- `groupByCategory(files)` - Returns `{ category: [files...] }`

**Output:**
```javascript
{
  path: "src/config.xml",
  category: "config",
  confidence: 0.95,
  hints: ["connectConfig"]
}
```

---

### 3. **staticAnalyzer.js** - Pass-1 Linting (No LLM)

**Responsibility**: Fast rule-based checks, syntax validation, IFS logical issues, and upgrade risks.

**Rule Categories:**

**PL/SQL Rules:**
- `MISSING_INIT_METHOD` - Procedure lacks General_SYS.Init_Method
- `DIRECT_TABLE_ACCESS` - Direct base table access (prefer views)
- `DML_IN_LOOP` - Performance risk from DML in loops
- `CURSOR_NAMING` - Cursors should use `c_` prefix
- `MULTI_LINE_COMMENT` - Avoid `/* */` style comments

**Syntax and Logical Validation:**
- `IFS_SYNTAX_001` - Mismatched BEGIN/END blocks
- `IFS_SYNTAX_002` - Missing semicolons after END
- `IFS_SYNTAX_003` - Unclosed string literals
- `IFS_SYNTAX_004` - Unclosed comment blocks
- `IFS_SYNTAX_005` - Invalid exception names
- `IFS_SYNTAX_006` - Missing procedure parameter modes
- `IFS_SYNTAX_007` - Invalid variable names starting with digits
- `IFS_SYNTAX_008` - Function missing RETURN statement
- `IFS_SYNTAX_009` - Invalid PRAGMA usage
- `IFS_LOGIC_001` - Potential null pointer dereference
- `IFS_LOGIC_002` - DML without explicit transaction control
- `IFS_LOGIC_003` - Exception raised without logging
- `IFS_LOGIC_004` - Sensitive operations without security checks
- `IFS_LOGIC_005` - Potential unclosed cursors
- `IFS_LOGIC_006` - Missing ROWCOUNT validation after DML
- `IFS_LOGIC_007` - Excessive hardcoded literals
- `IFS_LOGIC_008` - Data modification without audit logging

**IFS Coding Standards:**
- `IFS_STANDARDS_001` - Variable naming prefixes
- `IFS_STANDARDS_002` - Package body initialization section
- `IFS_STANDARDS_003` - Insufficient inline documentation
- `IFS_STANDARDS_004` - SELECT * usage
- `IFS_STANDARDS_005` - Deprecated IFS function usage

**Marble Syntax Validation:**
- `MARBLE_SYNTAX_001` - Unmatched braces
- `MARBLE_SYNTAX_002` - Missing semicolons in Marble attribute definitions
- `MARBLE_SYNTAX_003` - Unknown Marble type declarations
- `MARBLE_SYNTAX_004` - Methods without implementation bodies
- `MARBLE_SYNTAX_005` - Invalid access modifiers

**Key Functions:**
- `staticAnalyzeFile(file)` - Analyze one file, returns findings
- `analyzeFile(content, path, category)` - Content-based analysis
- `analyzePLSQL(content, path)` - PL/SQL-specific checks
- `validateFileContent(file, content)` - Syntax and logic validation

**Output:**
```javascript
{
  file: { path: "...", category: "plsql", ... },
  findings: [
    {
      ruleId: "IFS_PLSQL_001",
      severity: "Major",
      confidence: 0.85,
      title: "Missing General_SYS.Init_Method call",
      explanation: "...",
      line: null
    }
  ],
  error: null
}
```

---

### 4. **prompts.js** - Specialized Prompts per File Type

**Responsibility**: Provide category-specific LLM prompts with relevant rules.

**Prompt Templates:**
- `plsql` - PL/SQL best practices, naming, security, performance
- `views` - View design, security filters, data accuracy
- `projection` - Aurena entity sets, attributes, relationships
- `config` - Connection pooling, credentials, permissions
- `forms` - Apps10 form lifecycle, translation, upgrade
- `generic` - Fallback for unclassified files

**Key Functions:**
- `getPromptForCategory(category)` - Get template for file type
- `buildLLMPrompt(category, content, fileName, fileSize)` - Build full prompt

**Prompt Features:**
- JSON-only output enforcement
- Category-specific rules checklist
- Severity levels: Blocker/Major/Minor/Info
- Confidence scores (0-1)
- Rule IDs for tracking
- Minimal context to stay within token limits

**Example Output:**
```json
{
  "findings": [
    {
      "severity": "Blocker",
      "confidence": 0.95,
      "title": "Hardcoded credentials in config",
      "explanation": "...",
      "ruleId": "IFS_CONFIG_001",
      "recommendation": "Use environment variables or vault"
    }
  ],
  "summary": {
    "score": 65,
    "mainRisks": ["Security: credentials", "Deployment: missing grants"]
  }
}
```

---

### 5. **orchestrator.js** - Review Pipeline Coordinator

**Responsibility**: Orchestrate all phases, map-reduce consolidation, report generation.

**Main Function:**
```javascript
await reviewRepository(repoRoot, {
  maxFiles: 1000,
  progressCallback: (progress) => {},
  llmPostFunction: (url, body, headers) => {}
})
```

**Phase Implementation:**

**Phase 1: Discovery & Classification**
```javascript
const repo = await discoverAndClassifyRepo(repoRoot, maxFiles)
// Returns: { allFiles, grouped, stats }
```

**Phase 2: Static Analysis**
```javascript
const staticResults = await runStaticAnalysis(files, progressCallback)
// Returns: { results, findings }
```

**Phase 3: LLM Review**
```javascript
const llmResults = await prepareLLMReviewBatch(files, llmConfig, llmPostFunction)
// Returns: { findings, errors }
```

**Phase 2b: Rule Engine Validation**
```javascript
const ruleResults = await runRuleAnalysis(files)
// Returns: { results, findings }
```

**Phase 4: Report Generation**
```javascript
const report = generateReport(staticFindings, llmFindings, ruleResults, repoStats)
// Returns: comprehensive report
```

**Report Structure:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "repository": {
    "allFiles": [...],
    "grouped": { "plsql": [...], "projection": [...], ... },
    "stats": { "totalFiles": 42, "byCategoryCount": {...} }
  },
  "summary": {
    "totalFiles": 42,
    "filesReviewed": 35,
    "totalFindings": 18,
    "severityCounts": { "Blocker": 1, "Major": 5, "Minor": 12, "Info": 0 },
    "overallScore": 72,
    "riskLevel": "High"
  },
  "byFile": {
    "src/config.xml": [ { ruleId, severity, ... } ],
    ...
  },
  "topIssues": [ { title, file, severity, ruleId }, ... ],
  "findings": [ { ...full findings... } ],
  "categories": { "plsql": 10, "config": 5, ... },
  "recommendations": [
    { ruleId, title, priority, occurrences, suggestion },
    ...
  ]
}
```

**Scoring:**
- Blockers: -50 points each
- Majors: -20 points each
- Minors: -5 points each
- Base: 100 points
- Floor: 0 points

**Risk Levels:**
- `Critical` - Any Blockers
- `High` - 2+ Majors
- `Medium` - 1 Major
- `Low` - 5+ Minors
- `Minimal` - No issues

---

## Frontend Integration (React)

### Usage Example

**In App.jsx or new component:**

```javascript
async function runRepoReview(repoPath) {
  try {
    setReviewLoading(true);
    const result = await window.api.reviewRepository({
      repoPath,
      maxFiles: 500,
      mode: "full" // or "static-only"
    });

    if (result.ok) {
      setRepoReport(result.report);
      setReviewMode("repo"); // Switch to repo view
    } else {
      setError(result.error);
    }
  } catch (e) {
    setError(e.message);
  } finally {
    setReviewLoading(false);
  }
}
```

### New UI Components (Recommended)

1. **RepoAnalysisPanel** - Start repo review, show progress
2. **RepoReportView** - Display findings by file, severity, category
3. **RecommendationsList** - Top issues and improvement suggestions
4. **RiskDashboard** - Overall score, risk level, statistics

---

## Configuration

### Enable Full Repo Review

In Settings, add:
```javascript
{
  llm: { ... },  // Existing LLM config (required for LLM mode)
  reviewSettings: {
    enableRepoAnalysis: true,
    defaultMaxFiles: 500,
    defaultMode: "full" // or "static-only"
  }
}
```

### Disable LLM (Static-Only Mode)

```javascript
await window.api.reviewRepository({
  repoPath: "/path/to/repo",
  mode: "static-only"  // Uses only static analyzer, no LLM
})
```

---

## Performance & Limits

| Parameter | Value | Notes |
|-----------|-------|-------|
| Max files | 5000 | Safety limit per repo |
| Max file size | 5 MB | Static analysis limit |
| LLM file size | 10 KB | Skip if > 10 KB |
| Max recursion depth | 15 | Prevent infinite loops |
| Traversal batch size | 100 files | Per-batch event loop yield |

---

## Error Handling

All functions return graceful error structures:

```javascript
{
  success: false,
  error: "Error message",
  report: null
}
```

**Common Errors:**
- `repoPath is required` - Missing path parameter
- `LLM not configured` - Missing API key/endpoint
- `File too large` - Skip files > 5 MB
- Network errors from LLM - Handled by postWithRetry (3 attempts, backoff)

---

## Caching (Future Enhancement)

Currently reads files fresh. Future enhancement:
```javascript
// Cache: { filePath: { hash, review } }
// Skip unchanged files between runs
```

---

## Backward Compatibility Notes

✅ **Preserved:**
- `review:run` handler (PR diff only)
- All existing IPC calls in preload.js
- UI layouts and components
- Settings storage
- GitHub/Azure integration

✅ **Extended (Non-Breaking):**
- Added `review:repo` handler (new)
- Added `reviewRepository` to preload.js (new)
- New `electron/reviewEngine/` directory (isolated)

---

## Testing

### Manual Testing Steps

1. **Setup**: Verify LLM config in Settings
2. **Static-Only**: `reviewRepository({ repoPath, mode: "static-only" })`
3. **Full Mode**: `reviewRepository({ repoPath, mode: "full" })`
4. **Check**: Verify findings, scores, recommendations in report
5. **Diff-Based**: Confirm `review:run` still works unchanged

### Test Repo Structure
```
test-repo/
├── src/
│   ├── config.xml          # IFS config file
│   ├── utils.plsql         # PL/SQL code
│   └── projection.xml      # Aurena projection
├── docs/
└── .gitignore
```

---

## Future Enhancements

- [ ] Caching layer (file hash → review)
- [ ] Streaming/chunking for large files
- [ ] Cancellation support
- [ ] Export to JSON/PDF
- [ ] Custom rule definitions
- [ ] Multi-version IFS rules (Cloud 25R2 vs Apps 10)
- [ ] Integration with version control history
- [ ] Trend analysis (reviews over time)

---

## Troubleshooting

**Issue**: "File too large"
- **Solution**: Files > 10 KB skip LLM review (static analysis only)

**Issue**: "LLM request failed (429)"
- **Solution**: Rate limiting. postWithRetry handles 3 attempts with backoff.

**Issue**: "Non-JSON output"
- **Solution**: LLM returned text instead of JSON. Check model and prompt.

**Issue**: Slow on large repos
- **Solution**: Reduce `maxFiles` or use `mode: "static-only"`

---

## References

- IFS Documentation: https://docs.ifs.com
- File type conventions: `.plsql`, `.views`, `.projection`, etc.
- Security patterns: General_SYS.Init_Method, row-level security
- Performance: Avoid loops with DML, use bulk operations
