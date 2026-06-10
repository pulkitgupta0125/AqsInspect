const fs = require('fs');

const cachePath = 'C:\\Users\\pulkit.gupta\\AppData\\Roaming\\electron-react-bootstrap\\reviews_cache.json';

try {
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const keys = Object.keys(data);
    console.log("Total cache entries:", keys.length);
    
    // We want to inspect a few keys and see if they contain knowledge base parts
    // Wait, the key itself is a sha256 hash. Let's see if we can find any entries that were cached.
    let countEmpty = 0;
    let countWithFindings = 0;
    
    for (const key of keys) {
      const entry = data[key];
      const findings = entry.review?.findings || [];
      if (findings.length === 0) {
        countEmpty++;
      } else {
        countWithFindings++;
      }
    }
    
    console.log("Entries with empty findings:", countEmpty);
    console.log("Entries with findings:", countWithFindings);
    
    // Print a few sample entries
    console.log("\nSample entry keys:");
    keys.slice(0, 5).forEach(k => {
      console.log(`- ${k}: ${data[k].review?.findings?.length || 0} findings, timestamp: ${data[k].timestamp}`);
    });
  } else {
    console.log("Cache file does not exist.");
  }
} catch (err) {
  console.error("Error reading cache:", err.message);
}
