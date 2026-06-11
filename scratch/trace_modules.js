try {
  const officeParser = require('officeparser');
  console.log("✅ Successfully required officeparser!");
  // Find which path it resolved to from module cache
  const resolvedPath = Object.keys(require.cache).find(k => k.includes('officeparser'));
  console.log("Resolved path in cache:", resolvedPath);
} catch (err) {
  console.error("❌ Failed to require officeparser:", err.message);
}

try {
  const electron = require('electron');
  console.log("✅ Successfully required electron!");
  const resolvedPath = Object.keys(require.cache).find(k => k.includes('electron'));
  console.log("Resolved path in cache:", resolvedPath);
} catch (err) {
  console.error("❌ Failed to require electron:", err.message);
}
