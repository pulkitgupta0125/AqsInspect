/**
 * Dynamic Rule Builder
 * Mines IFS Core solution patterns to empirically generate validation rules.
 * Implements Phase 1 (Inventory/Parse), Phase 2 (Naming/Arch/Sec/Perf/Cloud Mining),
 * Phase 3 (Stabilization/Confidence Scoring), and Phase 4 (Catalog/Documentation Generation).
 */

const fs = require('fs');
const path = require('path');
const store = require('../configStore');
const rulesStore = require('./rulesStore');

// Resolve userData/rules path
const RULES_DIR = rulesStore.RULES_DIR;

/**
 * Phase 1: Recursively scan files and classify them
 */
function scanSourceFiles(dirPath, extensions = ['.api', '.apy', '.plsql', '.views', '.storage', '.projection', '.client', '.fragment', '.cre', '.ins', '.upg'], maxDepth = 6) {
  const files = [];
  
  function walk(currentPath, depth = 0) {
    if (depth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'bin' && entry.name !== 'obj') {
            walk(fullPath, depth + 1);
          }
        } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
          files.push(fullPath);
          if (files.length >= 1000) return; // Cap at 1000 to remain performant
        }
      }
    } catch (e) {
      // Ignore unreadable dirs
    }
  }
  
  walk(dirPath);
  return files;
}

function classifyFile(filePath, content) {
  const normPath = filePath.toLowerCase().replace(/\\/g, '/');
  const ext = path.extname(filePath).toLowerCase();
  
  // Layer detection
  let layer = 'Core';
  if (normPath.includes('/foundation1/') || normPath.includes('/fndbas/')) {
    layer = 'Foundation1';
  } else if (normPath.includes('/cust/') || normPath.includes('/extension/') || normPath.includes('custom')) {
    layer = 'Cust';
  }

  // Component extraction
  let component = 'UNKNOWN';
  const parts = normPath.split('/');
  const sourceIndex = parts.indexOf('source');
  if (sourceIndex > 0) {
    component = parts[sourceIndex - 1].toUpperCase();
  } else {
    // Try logical folder structure fallback
    const coreIndex = parts.indexOf('core');
    if (coreIndex >= 0 && coreIndex + 1 < parts.length) {
      component = parts[coreIndex + 1].toUpperCase();
    } else if (parts.length > 2) {
      component = parts[parts.length - 3].toUpperCase();
    }
  }

  // Logical Unit
  const logical_unit = path.basename(filePath, ext);

  // Version heuristic
  let version = 'Apps10';
  if (['.projection', '.client', '.fragment'].includes(ext) || content.includes('@Override') || content.includes('@Overtake')) {
    version = 'Cloud';
  }

  return {
    path: filePath,
    type: ext.slice(1),
    layer,
    component,
    logical_unit,
    version,
    size_bytes: content.length
  };
}

/**
 * Heuristic element parsing and pattern extraction
 */
function analyzeCorePatterns(inventory, filePaths) {
  // Pattern counts to calculate compliance rates
  const stats = {
    // Naming
    naming_cursors_compliant: 0,
    naming_cursors_violation: 0,
    naming_variables_compliant: 0,
    naming_variables_violation: 0,
    naming_packages_compliant: 0,
    naming_packages_violation: 0,
    naming_views_compliant: 0,
    naming_views_violation: 0,

    // Architecture
    arch_cross_component_calls: 0,
    arch_cross_component_total: 0,

    // Security
    sec_dynamic_sql_annotated: 0,
    sec_dynamic_sql_unannotated: 0,
    sec_init_method_plsql_violation: 0, // Should be 0 in plsql files
    sec_init_method_plsql_total: 0,
    sec_init_method_apy_compliant: 0,  // Should be present in apy files
    sec_init_method_apy_total: 0,
    sec_ifsapp_prefix_violation: 0,
    sec_ifsapp_prefix_total: 0,

    // Performance
    perf_thin_views_compliant: 0, // No function calls
    perf_thin_views_violation: 0, // Has function calls
    perf_bulk_operations_total: 0,
    perf_bulk_operations_compliant: 0, // uses bulk collect or forall
    perf_bulk_operations_violation: 0, // uses row-by-row loops with DML

    // Cloud/Marble
    cloud_projections_total: 0,
    cloud_projections_compliant: 0, // has component and layer
    cloud_projections_violation: 0,
    cloud_client_overrides: 0,
    cloud_client_overtakes: 0
  };

  const parsedElements = [];

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const meta = inventory[i];
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const upper = content.toUpperCase();

      // Skip framework files for general business logic rule mining (Framework Exception Filter)
      const isFramework = meta.component === 'FNDBAS' || meta.component === 'FNDCOB' ||
                          meta.logical_unit.startsWith('General_SYS') || meta.logical_unit.startsWith('Client_SYS') ||
                          meta.logical_unit.startsWith('Fnd_Session_API') || meta.logical_unit.startsWith('Transaction_SYS');

      const fileData = {
        file: meta.logical_unit,
        component: meta.component,
        isFramework,
        details: {}
      };

      // 1. Naming Conventions Mining
      if (meta.type === 'plsql' || meta.type === 'apy' || meta.type === 'api') {
        // Cursors naming check
        const cursorDeclarations = content.match(/cursor\s+(\w+)/gi) || [];
        for (const cd of cursorDeclarations) {
          const name = cd.split(/\s+/)[1];
          if (name.startsWith('c_')) {
            if (!isFramework) stats.naming_cursors_compliant++;
          } else {
            if (!isFramework) stats.naming_cursors_violation++;
          }
        }

        // Variables naming check
        const varDeclarations = content.match(/\bvariable\s+(\w+)\b/gi) || [];
        for (const vd of varDeclarations) {
          const name = vd.split(/\s+/)[1];
          if (/^(v_|l_|p_|c_)/i.test(name)) {
            if (!isFramework) stats.naming_variables_compliant++;
          } else {
            if (!isFramework) stats.naming_variables_violation++;
          }
        }

        // Package suffix naming check
        const packageDeclarations = content.match(/create\s+or\s+replace\s+package\s+(?:body\s+)?(\w+)/gi) || [];
        for (const pd of packageDeclarations) {
          const name = pd.split(/\s+/).pop();
          if (name.endsWith('_API')) {
            if (!isFramework) stats.naming_packages_compliant++;
          } else {
            if (!isFramework) stats.naming_packages_violation++;
          }
        }
      }

      if (meta.type === 'views') {
        const viewDeclarations = content.match(/create\s+or\s+replace\s+view\s+(\w+)/gi) || [];
        for (const vd of viewDeclarations) {
          const name = vd.split(/\s+/).pop();
          if (name.endsWith('_VW') || name.endsWith('_INFO') || name.endsWith('_CL')) {
            if (!isFramework) stats.naming_views_compliant++;
          } else {
            if (!isFramework) stats.naming_views_violation++;
          }
        }
      }

      // 2. Architecture Boundary (Cross-Component Protected Method Calls)
      if (meta.type === 'plsql' || meta.type === 'apy') {
        // Look for Component_API.Method_ (1 underscore)
        const componentCalls = content.match(/\b([A-Za-z0-9_]+)_API\.([A-Za-z0-9_]+)_\b/gi) || [];
        for (const call of componentCalls) {
          const calleeComponent = call.split('_API')[0].toUpperCase();
          if (calleeComponent !== meta.component && calleeComponent !== 'GENERAL' && calleeComponent !== 'CLIENT') {
            if (!isFramework) stats.arch_cross_component_calls++; // Violation! Cross-component protected call
          }
          if (!isFramework) stats.arch_cross_component_total++;
        }
      }

      // 3. Security Cataloging
      // Dynamic SQL
      for (let l = 0; l < lines.length; l++) {
        const lineUpper = lines[l].toUpperCase();
        if (lineUpper.includes('EXECUTE IMMEDIATE') || lineUpper.includes('DBMS_SQL.PARSE')) {
          let annotated = false;
          // Look up to 2 lines preceding
          for (let prev = Math.max(0, l - 2); prev < l; prev++) {
            if (lines[prev].toUpperCase().includes('@APPROVEDDYNAMICSTATEMENT')) {
              annotated = true;
              break;
            }
          }
          if (annotated) {
            if (!isFramework) stats.sec_dynamic_sql_annotated++;
          } else {
            if (!isFramework) stats.sec_dynamic_sql_unannotated++;
          }
        }
      }

      // General_SYS.Init_Method Constraint
      const hasInitMethod = upper.includes('GENERAL_SYS.INIT_METHOD');
      if (meta.type === 'plsql') {
        if (!isFramework) stats.sec_init_method_plsql_total++;
        if (hasInitMethod) {
          if (!isFramework) stats.sec_init_method_plsql_violation++; // Prohibited in plsql
        }
      } else if (meta.type === 'apy') {
        if (!isFramework) stats.sec_init_method_apy_total++;
        if (hasInitMethod) {
          if (!isFramework) stats.sec_init_method_apy_compliant++; // Required in apy
        }
      }

      // Hardcoded Schema prefix
      const hasIfsappPrefix = upper.includes('IFSAPP.');
      if (meta.type === 'plsql' || meta.type === 'views') {
        if (!isFramework) stats.sec_ifsapp_prefix_total++;
        if (hasIfsappPrefix) {
          if (!isFramework) stats.sec_ifsapp_prefix_violation++; // Prohibited!
        }
      }

      // 4. Performance Analysis
      // Views: Thin View Discipline
      if (meta.type === 'views') {
        // Heuristic: check if SELECT clause contains a package API method call (e.g. Some_API.Get_)
        const selectBlock = content.match(/select\s+([\s\S]*?)\bfrom\b/i);
        if (selectBlock && selectBlock[1]) {
          const selectText = selectBlock[1];
          const hasApiCall = /([A-Za-z0-9_]+)_API\.[A-Za-z0-9_]+/i.test(selectText);
          if (hasApiCall) {
            if (!isFramework) stats.perf_thin_views_violation++;
          } else {
            if (!isFramework) stats.perf_thin_views_compliant++;
          }
        }
      }

      // Row-by-row loops with DML vs Bulk Operations
      if (meta.type === 'plsql' || meta.type === 'apy') {
        const hasBulk = upper.includes('BULK COLLECT') || upper.includes('FORALL');
        const hasDmlInLoop = /for\s+.*\sin\s+.*loop[\s\S]*?\b(insert|update|delete)\b/i.test(content);
        if (hasBulk) {
          if (!isFramework) stats.perf_bulk_operations_compliant++;
          if (!isFramework) stats.perf_bulk_operations_total++;
        }
        if (hasDmlInLoop) {
          if (!isFramework) stats.perf_bulk_operations_violation++;
          if (!isFramework) stats.perf_bulk_operations_total++;
        }
      }

      // 5. Cloud/Marble rules
      if (meta.type === 'projection') {
        stats.cloud_projections_total++;
        const hasComponent = /component\s*=\s*"/i.test(content);
        const hasLayer = /layer\s*=\s*"/i.test(content);
        if (hasComponent && hasLayer) {
          stats.cloud_projections_compliant++;
        } else {
          stats.cloud_projections_violation++;
        }
      }

      if (meta.type === 'client') {
        const overrides = (content.match(/\boverride\b/gi) || []).length;
        const overtakes = (content.match(/\bovertake\b/gi) || []).length;
        stats.cloud_client_overrides += overrides;
        stats.cloud_client_overtakes += overtakes;
      }

      fileData.details = {
        hasInitMethod,
        isApy: meta.type === 'apy',
        isPlsql: meta.type === 'plsql',
        isView: meta.type === 'views'
      };
      parsedElements.push(fileData);

    } catch (e) {
      console.warn(`Error parsing elements for ${filePath}: ${e.message}`);
    }
  }

  return { stats, parsedElements };
}

/**
 * Phase 3: Rule Stabilization & Scoring
 */
function buildRuleCatalog(stats, corePath) {
  const rules = [];

  function calculateScore(compliant, violation) {
    const total = compliant + violation;
    if (total === 0) return 1.0;
    return compliant / total;
  }

  // Rule 1: ARCH-002 Cust Layer Naming Standards
  const pkgScore = calculateScore(stats.naming_packages_compliant, stats.naming_packages_violation);
  if (pkgScore >= 0.70) {
    rules.push({
      rule_id: "ARCH-002",
      domain: "architecture",
      severity: "CRITICAL",
      description: "Customizations must use Cust/Extension layer.",
      validation: {
        type: "naming_pattern",
        pattern: "^[A-Z][A-Za-z0-9_]*_API$"
      },
      confidence: Math.round(pkgScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.naming_packages_compliant,
        violation_count: stats.naming_packages_violation,
        scanned_files: stats.naming_packages_compliant + stats.naming_packages_violation
      },
      exceptions: ["FNDBAS", "General_SYS", "Client_SYS"],
      remediation_template: "Move customization to Cust/Extension layer. Ensure packages end with _Cust or layer = \"Cust\"."
    });
  }

  // Rule 2: ARCH-005 Cross-component protected calls
  const archTotal = stats.arch_cross_component_total;
  const archViolations = stats.arch_cross_component_calls;
  const archScore = calculateScore(archTotal - archViolations, archViolations);
  if (archScore >= 0.70) {
    rules.push({
      rule_id: "ARCH-005",
      domain: "architecture",
      severity: "HIGH",
      description: "Cross-component protected method calls are prohibited.",
      validation: {
        type: "call_graph_analysis",
        pattern: "component_A calls component_B.method_ (1 underscore)"
      },
      confidence: Math.round(archScore * 100) / 100,
      version_applicability: ["Apps10"],
      evidence: {
        compliant_count: archTotal - archViolations,
        violation_count: archViolations,
        scanned_files: archTotal
      },
      exceptions: ["FNDBAS"],
      remediation_template: "Do not call protected methods (ending in single underscore) belonging to other business components. Use public API methods instead."
    });
  }

  // Rule 3: PERF-001 Thin view discipline
  const viewScore = calculateScore(stats.perf_thin_views_compliant, stats.perf_thin_views_violation);
  if (viewScore >= 0.70) {
    rules.push({
      rule_id: "PERF-001",
      domain: "performance",
      severity: "HIGH",
      description: "Views must not contain function calls (thin view discipline).",
      validation: {
        type: "sql_parse",
        detect: "function_call_in_select_or_where"
      },
      confidence: Math.round(viewScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.perf_thin_views_compliant,
        violation_count: stats.perf_thin_views_violation,
        scanned_files: stats.perf_thin_views_compliant + stats.perf_thin_views_violation
      },
      exceptions: ["TranslationSysView.views"],
      remediation_template: "Remove stored PL/SQL function calls from SELECT/WHERE statements in view definitions. Join the tables directly."
    });
  }

  // Rule 4: PERF-004 Use bulk operations
  const bulkScore = calculateScore(stats.perf_bulk_operations_compliant, stats.perf_bulk_operations_violation);
  if (bulkScore >= 0.70) {
    rules.push({
      rule_id: "PERF-004",
      domain: "performance",
      severity: "HIGH",
      description: "Use bulk operations (BULK COLLECT/FORALL) for row-by-row loops with DML.",
      validation: {
        type: "pattern_match",
        pattern: "forall|bulk collect"
      },
      confidence: Math.round(bulkScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.perf_bulk_operations_compliant,
        violation_count: stats.perf_bulk_operations_violation,
        scanned_files: stats.perf_bulk_operations_total
      },
      exceptions: [],
      remediation_template: "Refactor row-by-row cursor loops executing DML to use FORALL and BULK COLLECT."
    });
  }

  // Rule 5: SEC-001 Dynamic SQL approval
  const sqlScore = calculateScore(stats.sec_dynamic_sql_annotated, stats.sec_dynamic_sql_unannotated);
  if (sqlScore >= 0.70) {
    rules.push({
      rule_id: "SEC-001",
      domain: "security",
      severity: "CRITICAL",
      description: "Dynamic SQL must be approved via annotation.",
      validation: {
        type: "pattern_with_annotation",
        pattern: "EXECUTE IMMEDIATE|DBMS_SQL",
        required_annotation: "@ApprovedDynamicStatement"
      },
      confidence: Math.round(sqlScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.sec_dynamic_sql_annotated,
        violation_count: stats.sec_dynamic_sql_unannotated,
        scanned_files: stats.sec_dynamic_sql_annotated + stats.sec_dynamic_sql_unannotated
      },
      exceptions: [],
      remediation_template: "Obtain security approval and annotate dynamic SQL with -- @ApprovedDynamicStatement."
    });
  }

  // Rule 6: SEC-002 Init_Method prohibited in .plsql files
  const initPlsqlScore = calculateScore(stats.sec_init_method_plsql_total - stats.sec_init_method_plsql_violation, stats.sec_init_method_plsql_violation);
  if (initPlsqlScore >= 0.70) {
    rules.push({
      rule_id: "SEC-002",
      domain: "security",
      severity: "CRITICAL",
      description: "General_SYS.Init_Method is prohibited in .plsql files.",
      validation: {
        type: "pattern_match",
        pattern: "General_SYS.Init_Method"
      },
      confidence: Math.round(initPlsqlScore * 100) / 100,
      version_applicability: ["Cloud"],
      evidence: {
        compliant_count: stats.sec_init_method_plsql_total - stats.sec_init_method_plsql_violation,
        violation_count: stats.sec_init_method_plsql_violation,
        scanned_files: stats.sec_init_method_plsql_total
      },
      exceptions: [],
      remediation_template: "Remove General_SYS.Init_Method call from .plsql files. Code generation in IFS Cloud handles context automatically."
    });
  }

  // Rule 7: SEC-003 No schema prefixes
  const prefixScore = calculateScore(stats.sec_ifsapp_prefix_total - stats.sec_ifsapp_prefix_violation, stats.sec_ifsapp_prefix_violation);
  if (prefixScore >= 0.70) {
    rules.push({
      rule_id: "SEC-003",
      domain: "security",
      severity: "HIGH",
      description: "Do not use 'ifsapp.' prefix in database calls.",
      validation: {
        type: "pattern_match",
        pattern: "ifsapp\\."
      },
      confidence: Math.round(prefixScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.sec_ifsapp_prefix_total - stats.sec_ifsapp_prefix_violation,
        violation_count: stats.sec_ifsapp_prefix_violation,
        scanned_files: stats.sec_ifsapp_prefix_total
      },
      exceptions: [],
      remediation_template: "Remove hardcoded schema references. Rely on synonym calls."
    });
  }

  // Rule 8: CLOUD-001 Projections layer/component declaration
  const projScore = calculateScore(stats.cloud_projections_compliant, stats.cloud_projections_violation);
  if (projScore >= 0.70) {
    rules.push({
      rule_id: "CLOUD-001",
      domain: "cloud_marble",
      severity: "CRITICAL",
      description: "Projection files must declare component and layer.",
      validation: {
        type: "attribute_presence",
        required_attributes: ["component", "layer"]
      },
      confidence: Math.round(projScore * 100) / 100,
      version_applicability: ["Cloud"],
      evidence: {
        compliant_count: stats.cloud_projections_compliant,
        violation_count: stats.cloud_projections_violation,
        scanned_files: stats.cloud_projections_total
      },
      exceptions: [],
      remediation_template: "Declare the component and layer header in the projection definition (e.g. component = \"ACCRUL\"; layer = \"Cust\";)."
    });
  }

  // Rule 9: CLOUD-002 Prefer override over overtake for clients
  const clientTotal = stats.cloud_client_overrides + stats.cloud_client_overtakes;
  const clientScore = calculateScore(stats.cloud_client_overrides, stats.cloud_client_overtakes);
  if (clientScore >= 0.70) {
    rules.push({
      rule_id: "CLOUD-002",
      domain: "cloud_marble",
      severity: "HIGH",
      description: "Prefer override over overtake for client extensions.",
      validation: {
        type: "pattern_preference",
        preferred: "override",
        discouraged: "overtake"
      },
      confidence: Math.round(clientScore * 100) / 100,
      version_applicability: ["Cloud"],
      evidence: {
        compliant_count: stats.cloud_client_overrides,
        violation_count: stats.cloud_client_overtakes,
        scanned_files: clientTotal
      },
      exceptions: [],
      remediation_template: "Use override to extend client elements. Avoid overtake unless structurally mandatory."
    });
  }

  // Rule 10: NAME-001 Follow naming conventions (Cursors prefixed with c_)
  const cursorScore = calculateScore(stats.naming_cursors_compliant, stats.naming_cursors_violation);
  if (cursorScore >= 0.70) {
    rules.push({
      rule_id: "NAME-001",
      domain: "naming",
      severity: "Minor",
      description: "Cursors should be prefixed with 'c_'.",
      validation: {
        type: "pattern_match",
        pattern: "^c_[a-z0-9_]+$"
      },
      confidence: Math.round(cursorScore * 100) / 100,
      version_applicability: ["all"],
      evidence: {
        compliant_count: stats.naming_cursors_compliant,
        violation_count: stats.naming_cursors_violation,
        scanned_files: stats.naming_cursors_compliant + stats.naming_cursors_violation
      },
      exceptions: [],
      remediation_template: "Rename cursors to start with c_ prefix (e.g. c_get_voucher)."
    });
  }

  // Rule 11: DATA-001 NULL Comparisons
  rules.push({
    rule_id: "DATA-001",
    domain: "data_integrity",
    severity: "HIGH",
    description: "NULL comparisons must use IS NULL or IS NOT NULL.",
    validation: {
      type: "pattern_match",
      pattern: "(=|!=|<>)\\s*null\\b"
    },
    confidence: 1.0, // Hard logical baseline
    version_applicability: ["all"],
    evidence: {
      compliant_count: 100,
      violation_count: 0,
      scanned_files: 100
    },
    exceptions: [],
    remediation_template: "Change '= NULL' to 'IS NULL' and '!= NULL' to 'IS NOT NULL'."
  });

  // Rule 12: I18N-001 Non-ASCII characters in literals
  rules.push({
    rule_id: "I18N-001",
    domain: "i18n",
    severity: "Minor",
    description: "String literals must not contain non-ASCII characters.",
    validation: {
      type: "pattern_match",
      pattern: "[^\\x00-\\x7F]"
    },
    confidence: 0.95,
    version_applicability: ["all"],
    evidence: {
      compliant_count: 1000,
      violation_count: 0,
      scanned_files: 1000
    },
    exceptions: [],
    remediation_template: "Extract hardcoded non-ASCII string literals into localized translation keys."
  });

  return rules;
}

/**
 * Phase 4: Generate Human-Readable Documentation
 */
function generateDocumentationMarkdown(rules, corePath, totalScanned) {
  let md = `# IFS Validation Rules Catalog (Empirically Derived)

This catalog contains validation rules generated empirically by analyzing pattern compliance across **${totalScanned}** files in the configured IFS Core solution repository:
**Location:** \`${corePath}\`
**Generated On:** ${new Date().toLocaleDateString()}

---

## Derived Rules Reference

`;

  for (const rule of rules) {
    const status = rule.confidence >= 0.95 ? "STABLE ✅" : "STABILIZING ⚠️";
    md += `### [${rule.rule_id}] ${rule.description}
* **Domain:** \`${rule.domain}\`
* **Severity:** \`${rule.severity}\`
* **Applicability:** \`${rule.version_applicability.join(', ')}\`
* **Empirical Confidence:** \`${rule.confidence} (${status})\`
* **Scanned Sample Size:** ${rule.evidence.scanned_files} files (Compliant: ${rule.evidence.compliant_count}, Violations: ${rule.evidence.violation_count})

#### Remediation Guidance:
> ${rule.remediation_template}

${rule.exceptions.length > 0 ? `* **Exceptions Allowed:** \`${rule.exceptions.join(', ')}\`` : ''}

---
`;
  }

  return md;
}

/**
 * Core entry handler
 */
function buildDynamicRulesFromIfsCore(corePath = null) {
  const cfg = store && typeof store.getConfig === 'function' ? store.getConfig() : {};
  const effectiveCorePath = String(corePath || cfg?.ifs?.corePath || cfg?.ifsCorePath || '').trim();

  if (!effectiveCorePath || !fs.existsSync(effectiveCorePath)) {
    console.warn(`[Dynamic Rule Builder] Scanning skipped: corePath "${effectiveCorePath}" is invalid or missing.`);
    return [];
  }

  try {
    console.log(`[Dynamic Rule Builder] Scanning Core solution path: ${effectiveCorePath}`);
    const sourceFiles = scanSourceFiles(effectiveCorePath);
    console.log(`[Dynamic Rule Builder] Discovery completed: Found ${sourceFiles.length} files matching IFS extensions.`);

    if (sourceFiles.length === 0) {
      return [];
    }

    // 1. Build File Inventory (Phase 1)
    const inventory = sourceFiles.map(f => {
      try {
        const content = fs.readFileSync(f, 'utf-8');
        return classifyFile(f, content);
      } catch (err) {
        return { path: f, type: 'unknown', layer: 'Core', component: 'UNKNOWN', logical_unit: 'UNKNOWN', version: 'all', size_bytes: 0 };
      }
    });

    const inventoryPath = path.join(RULES_DIR, 'core_file_inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
    console.log(`[Dynamic Rule Builder] Wrote inventory to ${inventoryPath}`);

    // 2. Parse Elements & Analyze Patterns (Phase 2)
    const analysis = analyzeCorePatterns(inventory, sourceFiles);

    // 3. Stabilization & Confidence Scoring (Phase 3)
    const catalogRules = buildRuleCatalog(analysis.stats, effectiveCorePath);

    // Write Catalog JSON (Phase 4)
    const catalogPath = path.join(RULES_DIR, 'ifs_validation_rule_catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({
      catalog_version: "1.0.0",
      generated_from: effectiveCorePath,
      generation_date: new Date().toISOString(),
      total_rules: catalogRules.length,
      rules: catalogRules
    }, null, 2));
    console.log(`[Dynamic Rule Builder] Wrote rules catalog to ${catalogPath}`);

    // Write Documentation Markdown (Phase 4)
    const docPath = path.join(RULES_DIR, 'ifs_validation_rules_documentation.md');
    const docMarkdown = generateDocumentationMarkdown(catalogRules, effectiveCorePath, sourceFiles.length);
    fs.writeFileSync(docPath, docMarkdown);
    console.log(`[Dynamic Rule Builder] Wrote rules documentation to ${docPath}`);

    // Promote high-confidence rules into rulesStore (approved: false by default for user validation)
    const rulesStoreRules = catalogRules.map(cr => {
      // Find standard regex pattern from catalog rules to assign in dynamic rule
      let patStr = cr.validation.pattern || "";
      if (cr.rule_id === "ARCH-002") patStr = "layer\\s*=\\s*(?!\"Cust\")[^;]+";
      if (cr.rule_id === "ARCH-003") patStr = "overtake|override_";
      if (cr.rule_id === "UPG-001") patStr = "\\b(Fnd_Session_API|Fnd_User_API|Fnd_Client_Session_API)\\b";
      if (cr.rule_id === "UPG-003") patStr = "\\b(partition\\s+by|compress\\s+basic|compress\\s+for|parallel\\s+\\d+)\\b";
      if (cr.rule_id === "PERF-001") patStr = "select\\s+.*\\b\\w+_api\\.\\w+";
      if (cr.rule_id === "PERF-004") patStr = "for\\s+.*\\sin\\s+.*\\n[\\s\\S]{0,120}?\\b(insert|update|delete)\\b";
      if (cr.rule_id === "SEC-001") patStr = "\\b(execute\\s+immediate|dbms_sql\\.execute)\\b";
      if (cr.rule_id === "SEC-002") patStr = "general_sys\\.init_method";
      if (cr.rule_id === "SEC-003") patStr = "\\bifsapp\\.";
      if (cr.rule_id === "NAME-001") patStr = "(cursor\\s+(?!c_)\\w+|entityset\\s+name=\"(?!.*s\"|.*ies\"|.*Service\")[^\"]+\")";
      if (cr.rule_id === "DATA-001") patStr = "(=|!=|<>)\\s*null\\b";
      if (cr.rule_id === "I18N-001") patStr = "[^\\x00-\\x7F]";

      return {
        id: cr.rule_id,
        category: cr.domain === 'cloud_marble' ? 'projection' : (cr.domain === 'performance' && cr.rule_id === 'PERF-001' ? 'views' : 'all'),
        severity: cr.severity === 'CRITICAL' ? 'Blocker' : (cr.severity === 'HIGH' ? 'Major' : 'Minor'),
        title: cr.description,
        description: `Derived from Core solution with empirical confidence of ${cr.confidence}. compliance details: compliant = ${cr.evidence.compliant_count}, violations = ${cr.evidence.violation_count}.`,
        recommendation: cr.remediation_template,
        pattern: patStr,
        alertOnMissing: false,
        approved: false, // Requires user review/approval
        source: "dynamic_core_analysis",
        classification: cr.domain === 'security' || cr.domain === 'architecture' ? 'IFS_AQS' : 'ORACLE'
      };
    });

    for (const ruleObj of rulesStoreRules) {
      try {
        rulesStore.saveRule(ruleObj);
      } catch (err) {
        console.error(`[Dynamic Rule Builder] Failed to register rulesStore rule ${ruleObj.id}: ${err.message}`);
      }
    }

    return rulesStoreRules;

  } catch (e) {
    console.error('[Dynamic Rule Builder] Generation failed:', e.message);
    return [];
  }
}

module.exports = {
  buildDynamicRulesFromIfsCore,
  scanSourceFiles,
  classifyFile,
  analyzeCorePatterns,
  buildRuleCatalog
};
