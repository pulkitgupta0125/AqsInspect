const fs = require("fs");
const path = require("path");
const axios = require("axios");

let app;
try {
  app = require("electron").app;
} catch (err) {
  app = null;
}

const CACHE_DIR = app?.getPath ? app.getPath("userData") : process.cwd();
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cache expiry

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "arent", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "cant", "cannot", "could",
  "couldnt", "did", "didnt", "do", "does", "doesnt", "doing", "dont", "down", "during", "each", "few", "for", "from",
  "further", "had", "hadnt", "has", "hasnt", "have", "havent", "having", "he", "hed", "hell", "hes", "her", "here",
  "heres", "hers", "herself", "him", "himself", "his", "how", "hows", "i", "id", "ill", "im", "ive", "if", "in",
  "into", "is", "isnt", "it", "its", "itself", "lets", "me", "more", "most", "mustnt", "my", "myself", "no", "nor",
  "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
  "same", "shant", "she", "shed", "shell", "shes", "should", "shouldnt", "so", "some", "such", "than", "that",
  "thats", "the", "their", "theirs", "them", "themselves", "then", "there", "theres", "these", "they", "theyd",
  "theyll", "theyre", "theyve", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "wasnt", "we", "wed", "well", "were", "weve", "werent", "what", "whats", "when", "whens", "where", "wheres",
  "which", "while", "who", "whos", "whom", "why", "whys", "with", "wont", "would", "wouldnt", "you", "youd",
  "youll", "youre", "youve", "your", "yours", "yourself", "yourselves"
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_]+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Downloads and caches the MkDocs search index for the configured version.
 */
async function loadSearchIndex(version) {
  const cleanVersion = String(version || "26r1").trim().toLowerCase();
  const cacheFile = path.join(CACHE_DIR, `ifs_techdocs_index_${cleanVersion}.json`);

  // 1. Check if index file is cached and valid
  if (fs.existsSync(cacheFile)) {
    try {
      const stats = fs.statSync(cacheFile);
      const age = Date.now() - stats.mtimeMs;
      if (age < CACHE_MAX_AGE_MS) {
        console.log(`[IFS Docs Scraper] Loading search index from cache for version: ${cleanVersion}`);
        const data = fs.readFileSync(cacheFile, "utf-8");
        return JSON.parse(data);
      }
      console.log(`[IFS Docs Scraper] Cache expired for version: ${cleanVersion}. Re-fetching...`);
    } catch (e) {
      console.warn(`[IFS Docs Scraper] Failed to read index cache:`, e.message);
    }
  }

  // 2. Fetch from docs.ifs.com
  const indexUrl = `https://docs.ifs.com/techdocs/${cleanVersion}/search/search_index.json`;
  console.log(`[IFS Docs Scraper] Fetching search index from: ${indexUrl}`);

  try {
    const response = await axios.get(indexUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 20000
    });

    if (response.status === 200 && response.data && response.data.docs) {
      // Save to cache async
      fs.writeFileSync(cacheFile, JSON.stringify(response.data, null, 2), "utf-8");
      console.log(`[IFS Docs Scraper] Successfully cached search index for version: ${cleanVersion}`);
      return response.data;
    }
    
    throw new Error(`Invalid status: ${response.status}`);
  } catch (error) {
    console.error(`[IFS Docs Scraper] Failed to download index from ${indexUrl}:`, error.message);
    
    // Fallback to expired cache if fetch fails
    if (fs.existsSync(cacheFile)) {
      console.log(`[IFS Docs Scraper] Falling back to expired search index cache.`);
      try {
        const data = fs.readFileSync(cacheFile, "utf-8");
        return JSON.parse(data);
      } catch (_) {}
    }
    return null;
  }
}

/**
 * Queries the active LLM to generate targeted keywords based on filename and contents.
 */
async function generateAiSearchQuery(filename, category, content, llmConfig, llmPostFunction) {
  if (!llmConfig || !llmPostFunction) {
    return [];
  }

  const codeSnippet = content.substring(0, 2500); // Grab first 2500 characters
  
  const systemPrompt = "You are a senior IFS developer technical search agent. Your job is to analyze a customized file and output 2 to 3 highly specific developer search terms or API names to find relevant coding guidelines in the IFS technical documentation. Output ONLY the search query phrases, one per line. Do not include any introduction, formatting, numbering, or prefixes.";
  const userPrompt = `Filename: ${filename}\nCategory: ${category}\n\nCode Snippet:\n${codeSnippet}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const provider = (llmConfig.provider || "azure").toLowerCase();
  let url;
  let headers;
  let body;

  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${llmConfig.apiKey}`,
      "Content-Type": "application/json"
    };
    body = {
      model: llmConfig.model,
      messages,
      temperature: 0.1,
      max_tokens: 150
    };
  } else if (provider === "ollama") {
    const endpoint = String(llmConfig.endpoint || "http://localhost:11434").replace(/\/$/, "");
    url = `${endpoint}/api/chat`;
    headers = {
      "Content-Type": "application/json"
    };
    body = {
      model: llmConfig.model,
      messages,
      stream: false,
      options: { temperature: 0.1 }
    };
  } else {
    // Azure
    const endpoint = String(llmConfig.endpoint || "").replace(/\/$/, "");
    const apiVersion = llmConfig.apiVersion || "2024-02-15-preview";
    url = `${endpoint}/openai/deployments/${llmConfig.model}/chat/completions?api-version=${apiVersion}`;
    headers = {
      "api-key": llmConfig.apiKey,
      "Content-Type": "application/json"
    };
    body = {
      messages,
      temperature: 0.1,
      max_tokens: 150
    };
  }

  try {
    const res = await llmPostFunction(url, body, headers);
    const textResponse = provider === "ollama" ? (res?.data?.message?.content || "") : (res?.data?.choices?.[0]?.message?.content || "");
    
    // Parse response line by line, cleaning formatting prefixes
    const queries = textResponse.split(/\r?\n/)
      .map(q => q.replace(/^\d+\.\s*/, "").replace(/^[-*+]\s*/, "").replace(/["'-]/g, "").trim())
      .filter(q => q.length > 3);
    
    console.log(`[IFS Docs Scraper] AI generated search queries:`, queries);
    return queries.slice(0, 3);
  } catch (err) {
    console.warn("[IFS Docs Scraper] AI search query generation failed:", err.message);
    return [];
  }
}

/**
 * Searches the local cached documentation index and writes the top matches to the knowledge base.
 */
async function searchAndInjectDocs(filename, category, fileContent, knowledgePath, version = "26r1", limit = 5, llmConfig = null, llmPostFunction = null) {
  if (!knowledgePath || !fs.existsSync(knowledgePath)) {
    console.warn(`[IFS Docs Scraper] Cannot inject docs. Invalid knowledgePath: ${knowledgePath}`);
    return false;
  }

  const index = await loadSearchIndex(version);
  if (!index || !index.docs || index.docs.length === 0) {
    console.warn(`[IFS Docs Scraper] No documentation index loaded.`);
    return false;
  }

  // 1. Generate search queries using AI if LLM configuration is available
  let aiQueries = [];
  if (llmConfig && llmPostFunction) {
    aiQueries = await generateAiSearchQuery(filename, category, fileContent, llmConfig, llmPostFunction);
  }

  // 2. Tokenize base keywords as query terms
  const baseName = path.basename(filename, path.extname(filename));
  let queryTokens = [];
  
  if (aiQueries.length > 0) {
    queryTokens = [...new Set(aiQueries.flatMap(q => tokenize(q)))];
  } else {
    queryTokens = [...new Set([
      ...tokenize(baseName),
      ...tokenize(category),
      ...tokenize(fileContent).slice(0, 25)
    ])];
  }

  if (queryTokens.length === 0) {
    return false;
  }

  const scores = [];
  const devPathKeywords = ["dev", "development", "technical", "marble", "techdoc", "plsql", "projection", "client", "apy", "api"];

  for (const doc of index.docs) {
    const docLoc = String(doc.location || "").toLowerCase();
    
    // Strict path filtering: exclude administration and installation guides for code review
    const isDevDoc = devPathKeywords.some(kw => docLoc.includes(kw));
    const isAdminDoc = docLoc.includes("administration") || docLoc.includes("installation") || docLoc.includes("bckgrnd_processing");
    
    if (isAdminDoc && !isDevDoc) {
      continue; // Skip admin manuals
    }

    let score = 0;
    const docTitleLower = String(doc.title || "").toLowerCase();
    const docTextLower = String(doc.text || "").toLowerCase();

    // Check query terms
    for (const token of queryTokens) {
      if (docTitleLower.includes(token)) {
        score += 15; // Strong weight for title matches
      }
      // Count matches in text
      const regex = new RegExp(`\\b${token}\\b`, "g");
      const matches = docTextLower.match(regex);
      if (matches) {
        score += matches.length * 1;
      }
    }

    if (score >= 10) { // Set a solid relevance threshold to filter noise
      scores.push({ doc, score });
    }
  }

  if (scores.length === 0) {
    console.log(`[IFS Docs Scraper] No relevant documentation matches found for query tokens: ${queryTokens.slice(0, 5).join(", ")}`);
    return false;
  }

  // Sort by score descending and pick top
  scores.sort((a, b) => b.score - a.score);
  const topMatches = scores.slice(0, limit);

  // Build target injection file path directly in knowledgePath (flat-scan compatibility)
  const sanitizedBase = baseName.replace(/[^\w]/g, "_");
  const targetFile = path.join(knowledgePath, `ifs_docs_${sanitizedBase}_${category}.md`);

  // Format matches as clean markdown
  let fileMarkdown = `# IFS Technical Documentation: ${baseName}\n`;
  fileMarkdown += `Auto-extracted from docs.ifs.com/techdocs/ for PR review validation.\n\n`;

  for (const match of topMatches) {
    const fullUrl = `https://docs.ifs.com/techdocs/${String(version).toLowerCase()}/${match.doc.location}`;
    fileMarkdown += `## ${match.doc.title || "Documentation Section"}\n`;
    fileMarkdown += `Source: [${match.doc.title}](${fullUrl})\n\n`;
    fileMarkdown += `${match.doc.text.trim()}\n\n`;
    fileMarkdown += `---\n\n`;
  }

  try {
    fs.writeFileSync(targetFile, fileMarkdown, "utf-8");
    console.log(`[IFS Docs Scraper] Injected documentation rules to ${path.basename(targetFile)}`);
    return true;
  } catch (err) {
    console.error(`[IFS Docs Scraper] Failed to write docs injection:`, err.message);
    return false;
  }
}

module.exports = {
  loadSearchIndex,
  searchAndInjectDocs
};
