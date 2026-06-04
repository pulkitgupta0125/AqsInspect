/**
 * File Discovery Module
 * Traverses repository safely, discovers all relevant files
 * Respects ignore lists and excludes build artifacts
 */

const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const readfileAsync = promisify(fs.readFile);

// Default ignore patterns (similar to .gitignore)
const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  ".vscode",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  ".cache",
  ".vite",
  "__pycache__",
  ".egg-info",
  ".DS_Store",
  "*.tmp"
];

// IFS-relevant file extensions
const IFS_EXTENSIONS = {
  views: ".views",
  storage: ".storage",
  plsql: ".plsql",
  plsvc: ".plsvc",
  rdf: ".rdf",
  cdb: ".cdb",
  ins: ".ins",
  cre: ".cre",
  upg: ".upg",
  api: ".api",
  apy: ".apy",
  client: ".client",
  projection: ".projection",
  fragment: ".fragment",
  entity: ".entity",
  report: ".report",
  xsl: ".xsl",
  cs: ".cs",
  designer: ".designer.cs",
  resx: ".resx"
};

function shouldIgnore(filePath, ignorePatterns = DEFAULT_IGNORES) {
  for (const pattern of ignorePatterns) {
    if (filePath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

async function loadIgnoreList(repoRoot) {
  try {
    const gitignorePath = path.join(repoRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const content = await readfileAsync(gitignorePath, "utf-8");
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      return [...DEFAULT_IGNORES, ...patterns];
    }
  } catch (e) {
    // Ignore error, fall back to defaults
  }
  return DEFAULT_IGNORES;
}

async function discoverFiles(repoRoot, maxFiles = 5000) {
  const ignorePatterns = await loadIgnoreList(repoRoot);
  const files = [];
  let traversed = 0;

  async function traverse(dir, depth = 0) {
    if (depth > 15) return; // Prevent deep recursion
    if (files.length >= maxFiles) return; // Safety limit

    try {
      const entries = await readdirAsync(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = path.relative(repoRoot, fullPath);

        traversed++;
        if (traversed % 100 === 0) {
          // Periodic yield to not block event loop
          await new Promise((r) => setImmediate(r));
        }

        if (shouldIgnore(relPath, ignorePatterns)) {
          continue;
        }

        try {
          const stat = await statAsync(fullPath);

          if (stat.isDirectory()) {
            await traverse(fullPath, depth + 1);
          } else if (stat.isFile()) {
            files.push({
              path: relPath,
              fullPath,
              size: stat.size,
              mtime: stat.mtime.getTime(),
              extension: path.extname(entry).toLowerCase()
            });
          }
        } catch (e) {
          // Skip files we can't stat
        }
      }
    } catch (e) {
      // Directory read error, skip
    }
  }

  await traverse(repoRoot);
  return files;
}

module.exports = {
  discoverFiles,
  loadIgnoreList,
  shouldIgnore,
  IFS_EXTENSIONS,
  DEFAULT_IGNORES
};
