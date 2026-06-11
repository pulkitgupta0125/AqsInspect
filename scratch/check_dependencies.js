const fs = require('fs');
const path = require('path');

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const declaredDeps = new Set(Object.keys(packageJson.dependencies || {}));

const builtins = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers',
  'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib', 'electron'
]);

const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

function walk(dir, files = []) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'extensions') {
        walk(full, files);
      }
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      files.push(full);
    }
  }
  return files;
}

const electronDir = path.resolve(__dirname, '../electron');
const files = walk(electronDir);
const externalImports = new Map();

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Skip local imports
    if (importPath.startsWith('.')) continue;
    // Skip Node.js built-ins
    if (builtins.has(importPath)) continue;

    if (!externalImports.has(importPath)) {
      externalImports.set(importPath, []);
    }
    externalImports.get(importPath).push(path.relative(path.resolve(__dirname, '..'), file));
  }
}

console.log('=== Scanned Main Process Modules ===');
let missingCount = 0;
for (const [dep, files] of externalImports.entries()) {
  if (declaredDeps.has(dep)) {
    console.log(`✅ [OK] "${dep}" is declared in package.json (used in: ${files.join(', ')})`);
  } else {
    console.log(`❌ [MISSING] "${dep}" is NOT declared in package.json dependencies! (used in: ${files.join(', ')})`);
    missingCount++;
  }
}

if (missingCount === 0) {
  console.log('\n🎉 No missing main process dependencies!');
} else {
  console.log(`\n⚠️ Found ${missingCount} missing dependencies. Please add them to package.json.`);
}
