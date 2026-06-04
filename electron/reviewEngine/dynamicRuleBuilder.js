/**
 * Dynamic Rule Builder
 * Scans IFS core source code and builds enterprise-specific validation rules
 * Caches rules between reviews to improve performance
 */

const fs = require('fs');
const path = require('path');
const store = require('../configStore');

// Cache structure: { hash: { rules, timestamp } }
const ruleCache = {};

function hashPath(dirPath) {
  // Simple hash for tracking when rules were built
  let hash = 0;
  const str = String(dirPath || '').toLowerCase();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function scanSourceFiles(dirPath, extensions = ['.plsql', '.sql', '.java', '.ts'], maxDepth = 5) {
  const files = [];
  
  function walk(currentPath, depth = 0) {
    if (depth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(path.join(currentPath, entry.name), depth + 1);
          }
        } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
          files.push(path.join(currentPath, entry.name));
          if (files.length > 100) return; // Limit to prevent large scans
        }
      }
    } catch (e) {
      // Skip unreadable directories
    }
  }
  
  walk(dirPath);
  return files;
}

function analyzeSourcePatterns(files) {
  const patterns = {
    initMethodUsage: [],
    dmlInLoops: [],
    customFields: [],
    apiInvocations: [],
    errorHandling: [],
    transactionControl: []
  };

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(path.dirname(file), file);

      // Pattern 1: Init method usage
      if (content.toLowerCase().includes('general_sys.init_method')) {
        patterns.initMethodUsage.push(relativePath);
      }

      // Pattern 2: DML in loops
      if (/for\s+.*\sin\s+[\s\S]{0,200}?(insert|update|delete)\b/i.test(content)) {
        patterns.dmlInLoops.push(relativePath);
      }

      // Pattern 3: Custom fields
      if (/custom_field|custom_ref|customfield/i.test(content)) {
        patterns.customFields.push(relativePath);
      }

      // Pattern 4: API invocations
      if (/api\.|\.call\(|rpc_call|invoke_call/i.test(content)) {
        patterns.apiInvocations.push(relativePath);
      }

      // Pattern 5: Error handling
      if (/raise|exception|throw|try\s*{|catch/i.test(content)) {
        patterns.errorHandling.push(relativePath);
      }

      // Pattern 6: Transaction control
      if (/commit|rollback|savepoint|transaction/i.test(content)) {
        patterns.transactionControl.push(relativePath);
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return patterns;
}

function buildDynamicRules(patterns, corePath) {
  const rules = [];

  // Rule: DML in loops anti-pattern
  if (patterns.dmlInLoops.length > 0) {
    rules.push({
      id: 'DYNAMIC_RULE_DML_IN_LOOPS_DETECTED',
      category: 'plsql',
      severity: 'Major',
      title: 'Code review: Avoid DML inside loops pattern detected in codebase',
      description: `The codebase contains ${patterns.dmlInLoops.length} file(s) with potential DML in loop patterns.`,
      evaluate: ({ content }) => {
        const result = [];
        if (content && /for\s+.*\sin\s+[\s\S]{0,200}?(insert|update|delete)\b/i.test(content)) {
          result.push({
            severity: 'Major',
            confidence: 0.85,
            title: 'DML operation detected inside loop',
            explanation: 'This file contains a DML operation within a loop, which violates IFS performance standards.',
            ruleId: 'DYNAMIC_RULE_DML_IN_LOOPS_DETECTED',
            recommendation: 'Refactor to use bulk operations outside loops.',
            lineRange: null,
            matchText: null
          });
        }
        return result;
      }
    });
  }

  // Rule: Custom fields usage
  if (patterns.customFields.length > 0) {
    rules.push({
      id: 'DYNAMIC_RULE_CUSTOM_FIELDS_USAGE',
      category: 'all',
      severity: 'Major',
      title: 'Custom fields detected: Ensure compatibility with IFS extensions',
      description: `Custom field patterns found in ${patterns.customFields.length} file(s).`,
      evaluate: ({ content }) => {
        const result = [];
        if (content && /custom_field|custom_ref/i.test(content)) {
          result.push({
            severity: 'Major',
            confidence: 0.8,
            title: 'Custom field extension detected',
            explanation: 'This code uses custom field extensions which may require additional testing.',
            ruleId: 'DYNAMIC_RULE_CUSTOM_FIELDS_USAGE',
            recommendation: 'Verify custom fields are properly registered and documented.',
            lineRange: null,
            matchText: null
          });
        }
        return result;
      }
    });
  }

  // Rule: API invocation patterns
  if (patterns.apiInvocations.length > 0) {
    rules.push({
      id: 'DYNAMIC_RULE_API_INVOCATION_PATTERNS',
      category: 'all',
      severity: 'Major',
      title: 'API invocation patterns: Verify compatibility with IFS service contracts',
      description: `Found ${patterns.apiInvocations.length} file(s) with API invocation patterns.`,
      evaluate: ({ content }) => {
        const result = [];
        if (content && /api\.|\.call\(|rpc_call/i.test(content)) {
          result.push({
            severity: 'Major',
            confidence: 0.75,
            title: 'API invocation detected',
            explanation: 'This code invokes APIs which must conform to IFS service contract standards.',
            ruleId: 'DYNAMIC_RULE_API_INVOCATION_PATTERNS',
            recommendation: 'Verify API calls against current IFS service definitions.',
            lineRange: null,
            matchText: null
          });
        }
        return result;
      }
    });
  }

  return rules;
}

function buildDynamicRulesFromIfsCore(corePath = null) {
  const cfg = store && typeof store.getConfig === 'function' ? store.getConfig() : {};
  const effectiveCorePath = String(corePath || cfg?.ifs?.corePath || cfg?.ifsCorePath || '').trim();

  if (!effectiveCorePath) {
    return []; // No core path configured
  }

  try {
    if (!fs.existsSync(effectiveCorePath)) {
      return []; // Path doesn't exist
    }
  } catch (e) {
    return [];
  }

  const cacheKey = hashPath(effectiveCorePath);

  // Check cache
  if (ruleCache[cacheKey] && ruleCache[cacheKey].timestamp) {
    const age = Date.now() - ruleCache[cacheKey].timestamp;
    if (age < 3600000) { // 1 hour cache validity
      return ruleCache[cacheKey].rules || [];
    }
  }

  try {
    // Scan source files
    const sourceFiles = scanSourceFiles(effectiveCorePath);
    if (sourceFiles.length === 0) {
      return [];
    }

    // Analyze patterns
    const patterns = analyzeSourcePatterns(sourceFiles);

    // Build dynamic rules
    const dynamicRules = buildDynamicRules(patterns, effectiveCorePath);

    // Cache the rules
    ruleCache[cacheKey] = {
      rules: dynamicRules,
      timestamp: Date.now(),
      patterns
    };

    return dynamicRules;
  } catch (e) {
    console.error('Error building dynamic rules:', e.message);
    return [];
  }
}

module.exports = {
  buildDynamicRulesFromIfsCore,
  scanSourceFiles,
  analyzeSourcePatterns,
  buildDynamicRules
};
