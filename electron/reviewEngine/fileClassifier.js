/**
 * File Classifier Module
 * Categorizes files by IFS type (PL/SQL, Aurena, Forms, etc.)
 * Uses extension + content heuristics
 */

const fs = require("fs");
const { promisify } = require("util");
const readfileAsync = promisify(fs.readFile);

const FILE_CATEGORIES = {
  PLSQL: "plsql",           // .plsql, .plsvc, .views, .storage
  VIEWS: "views",           // .views and view-related
  DB_SCRIPT: "db_script",   // .cdb, .cre, .ins, .upg
  RDF: "rdf",               // .rdf (IFS reference data format)
  API: "api",               // .api, .apy (API definitions)
  PROJECTION: "projection", // .projection (Aurena projections)
  CLIENT: "client",         // .client (Aurena client components)
  ENTITY: "entity",         // .entity (IFS entity definitions)
  REPORT: "report",         // .report, .xsl, .layout
  FORMS: "forms",           // .cs, .designer.cs, .resx (Apps10 forms)
  MARBLE: "marble",         // .marble, .layout, .form, .ux (Marble UI language)
  CONFIG: "config",         // XML configs, .connectConfig.xml
  OTHER: "other"
};

const EXTENSION_MAP = {
  ".plsql": FILE_CATEGORIES.PLSQL,
  ".plsvc": FILE_CATEGORIES.PLSQL,
  ".views": FILE_CATEGORIES.VIEWS,
  ".storage": FILE_CATEGORIES.DB_SCRIPT,
  ".cdb": FILE_CATEGORIES.DB_SCRIPT,
  ".cre": FILE_CATEGORIES.DB_SCRIPT,
  ".ins": FILE_CATEGORIES.DB_SCRIPT,
  ".upg": FILE_CATEGORIES.DB_SCRIPT,
  ".rdf": FILE_CATEGORIES.RDF,
  ".api": FILE_CATEGORIES.API,
  ".apy": FILE_CATEGORIES.API,
  ".projection": FILE_CATEGORIES.PROJECTION,
  ".client": FILE_CATEGORIES.CLIENT,
  ".fragment": FILE_CATEGORIES.CLIENT,
  ".entity": FILE_CATEGORIES.ENTITY,
  ".report": FILE_CATEGORIES.REPORT,
  ".xsl": FILE_CATEGORIES.REPORT,
  ".layout": FILE_CATEGORIES.MARBLE,
  ".cs": FILE_CATEGORIES.FORMS,
  ".designer.cs": FILE_CATEGORIES.FORMS,
  ".resx": FILE_CATEGORIES.FORMS,
  ".marble": FILE_CATEGORIES.MARBLE,
  ".form": FILE_CATEGORIES.MARBLE,
  ".ux": FILE_CATEGORIES.MARBLE
};

async function classifyFile(filePath, fullPath) {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();

  // Direct extension match
  if (EXTENSION_MAP[ext]) {
    return {
      path: filePath,
      category: EXTENSION_MAP[ext],
      confidence: 1.0,
      hints: [ext]
    };
  }

  // Complex extension (e.g., file.designer.cs)
  for (const [extPattern, category] of Object.entries(EXTENSION_MAP)) {
    if (filePath.endsWith(extPattern)) {
      return {
        path: filePath,
        category,
        confidence: 1.0,
        hints: [extPattern]
      };
    }
  }

  // Generic XML: check for IFS markers via content heuristics
  if (ext === ".xml") {
    try {
      const content = await readfileAsync(fullPath, "utf-8");
      if (content.includes("connectConfig") || content.includes("ConnectionConfiguration")) {
        return { path: filePath, category: FILE_CATEGORIES.CONFIG, confidence: 0.95, hints: ["connectConfig"] };
      }
      if (content.includes("<projection") || content.includes("Projection")) {
        return { path: filePath, category: FILE_CATEGORIES.PROJECTION, confidence: 0.8, hints: ["projection tag"] };
      }
      if (content.includes("<layout") || content.includes("Layout")) {
        return { path: filePath, category: FILE_CATEGORIES.MARBLE, confidence: 0.8, hints: ["layout tag"] };
      }
      if (content.includes("<entity") || content.includes("<Entity")) {
        return { path: filePath, category: FILE_CATEGORIES.ENTITY, confidence: 0.8, hints: ["entity tag"] };
      }
      return { path: filePath, category: FILE_CATEGORIES.CONFIG, confidence: 0.6, hints: ["generic xml"] };
    } catch (e) {
      // Fallback if can't read
    }
  }

  // Check content for SQL patterns
  if ([".sql", ".txt"].includes(ext)) {
    try {
      const content = await readfileAsync(fullPath, "utf-8");
      const upper = content.toUpperCase();
      if (upper.includes("GENERAL_SYS.INIT_METHOD")) {
        return { path: filePath, category: FILE_CATEGORIES.PLSQL, confidence: 0.9, hints: ["General_SYS.Init_Method"] };
      }
      if (upper.includes("CREATE OR REPLACE VIEW")) {
        return { path: filePath, category: FILE_CATEGORIES.VIEWS, confidence: 0.9, hints: ["CREATE VIEW"] };
      }
      if (upper.includes("CREATE TABLE") || upper.includes("ALTER TABLE")) {
        return { path: filePath, category: FILE_CATEGORIES.DB_SCRIPT, confidence: 0.8, hints: ["DDL"] };
      }
    } catch (e) {
      // Fallback
    }
  }

  // Default to OTHER
  return {
    path: filePath,
    category: FILE_CATEGORIES.OTHER,
    confidence: 0.0,
    hints: []
  };
}

async function classifyMultiple(files, fullPathRoot) {
  const classified = [];
  for (const file of files) {
    const cat = await classifyFile(file.path, file.fullPath);
    classified.push({
      ...file,
      ...cat
    });
  }
  return classified;
}

function groupByCategory(classifiedFiles) {
  const groups = {};
  for (const file of classifiedFiles) {
    if (!groups[file.category]) {
      groups[file.category] = [];
    }
    groups[file.category].push(file);
  }
  return groups;
}

module.exports = {
  classifyFile,
  classifyMultiple,
  groupByCategory,
  FILE_CATEGORIES,
  EXTENSION_MAP
};
