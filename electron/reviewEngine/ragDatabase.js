const fs = require("fs");
const path = require("path");
const { parseSingleFile } = require("./knowledgeBaseParser");

let app;
try {
  app = require("electron").app;
} catch (err) {
  app = null;
}

const RAG_FILE = path.join(
  app?.getPath ? app.getPath("userData") : process.cwd(),
  "rag_database.json"
);

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

/**
 * Tokenize guidelines or code text.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ") // replace punctuation with spaces
    .split(/[\s_]+/) // split by spaces or underscores
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Split document text into chunks of text.
 */
function chunkText(text, sourceName, maxChunkSize = 1000, overlap = 200) {
  if (!text) return [];

  const paragraphs = text.split(/\r?\n\r?\n/);
  const chunks = [];
  let currentChunk = "";

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].trim();
    if (!p) continue;

    if (p.length > maxChunkSize) {
      // Split large paragraphs by sentences
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize) {
          if (currentChunk) {
            chunks.push({ text: currentChunk, source: sourceName });
            currentChunk = currentChunk.slice(-overlap) + " " + sentence;
          } else {
            chunks.push({ text: sentence, source: sourceName });
          }
        } else {
          currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
        }
      }
    } else {
      if (currentChunk.length + p.length > maxChunkSize) {
        chunks.push({ text: currentChunk, source: sourceName });
        currentChunk = currentChunk.slice(-overlap) + "\n\n" + p;
      } else {
        currentChunk = currentChunk ? currentChunk + "\n\n" + p : p;
      }
    }
  }

  if (currentChunk) {
    chunks.push({ text: currentChunk, source: sourceName });
  }

  return chunks.map((c, index) => ({
    id: `${sourceName}_chunk_${index}`,
    source: c.source,
    text: c.text
  }));
}

/**
 * Load index file from disk.
 */
function loadRAG() {
  if (!fs.existsSync(RAG_FILE)) {
    return null;
  }
  try {
    const data = fs.readFileSync(RAG_FILE, "utf-8");
    return JSON.parse(data) || null;
  } catch (err) {
    console.error("[RAG] Failed to load RAG database:", err.message);
    return null;
  }
}

/**
 * Save index file to disk.
 */
function saveRAG(dbData) {
  try {
    fs.writeFileSync(RAG_FILE, JSON.stringify(dbData, null, 2), "utf-8");
    console.log("[RAG] Saved RAG database to:", RAG_FILE);
  } catch (err) {
    console.error("[RAG] Failed to save RAG database:", err.message);
  }
}

/**
 * Build or rebuild RAG database index if files have changed.
 */
async function indexKnowledgeBaseIfNeeded(knowledgePath) {
  if (!knowledgePath || !fs.existsSync(knowledgePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(knowledgePath);
    if (!stats.isDirectory()) {
      return null;
    }

    const files = fs.readdirSync(knowledgePath);
    const validExtensions = new Set([".txt", ".md", ".docx", ".pptx", ".xlsx", ".pdf"]);
    const currentManifest = {};

    for (const file of files) {
      const fullPath = path.join(knowledgePath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && validExtensions.has(path.extname(file).toLowerCase())) {
        currentManifest[file] = {
          size: stat.size,
          mtimeMs: stat.mtimeMs
        };
      }
    }

    const db = loadRAG();
    let needsReindex = false;

    if (!db || !db.lastIndexedManifest || !db.chunks) {
      needsReindex = true;
    } else {
      const savedManifest = db.lastIndexedManifest;
      const savedKeys = Object.keys(savedManifest);
      const currentKeys = Object.keys(currentManifest);

      if (savedKeys.length !== currentKeys.length) {
        needsReindex = true;
      } else {
        for (const key of currentKeys) {
          if (!savedManifest[key] ||
              savedManifest[key].size !== currentManifest[key].size ||
              savedManifest[key].mtimeMs !== currentManifest[key].mtimeMs) {
            needsReindex = true;
            break;
          }
        }
      }
    }

    if (!needsReindex) {
      return db;
    }

    console.log(`[RAG] Re-indexing knowledge base guidelines at: ${knowledgePath}`);
    const allChunks = [];

    for (const file of Object.keys(currentManifest)) {
      const fullPath = path.join(knowledgePath, file);
      try {
        const text = await parseSingleFile(fullPath);
        if (!text || text.trim().length === 0) continue;

        const chunks = chunkText(text.trim(), file);
        for (const chunk of chunks) {
          const tokens = tokenize(chunk.text);
          const tf = {};
          for (const token of tokens) {
            tf[token] = (tf[token] || 0) + 1;
          }
          allChunks.push({
            id: chunk.id,
            source: chunk.source,
            text: chunk.text,
            tf,
            tokenCount: tokens.length
          });
        }
      } catch (err) {
        console.error(`[RAG] Failed to index document ${file}:`, err.message);
      }
    }

    // Compute document frequencies and inverse document frequencies (IDF)
    const df = {};
    for (const chunk of allChunks) {
      const uniqueTokens = Object.keys(chunk.tf);
      for (const token of uniqueTokens) {
        df[token] = (df[token] || 0) + 1;
      }
    }

    const idfMap = {};
    const totalChunks = allChunks.length;
    for (const token in df) {
      idfMap[token] = Math.log((totalChunks - df[token] + 0.5) / (df[token] + 0.5) + 1);
    }

    const totalTokenCount = allChunks.reduce((acc, c) => acc + c.tokenCount, 0);
    const avgdl = totalChunks > 0 ? totalTokenCount / totalChunks : 0;

    const newDbData = {
      lastIndexedManifest: currentManifest,
      chunks: allChunks,
      idfMap,
      avgdl,
      totalChunks
    };

    saveRAG(newDbData);
    return newDbData;
  } catch (err) {
    console.error("[RAG] Failed to index knowledge base:", err.message);
    return null;
  }
}

/**
 * Extract distinct query tokens from search query source.
 */
function extractQueryTokens(fileName, category, codeContent) {
  const tokens = [];
  
  // 1. Add filename and category terms
  tokens.push(...tokenize(fileName));
  tokens.push(...tokenize(category));

  // 2. Tokenize code content, filtering coding keywords
  const codeKeywords = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export",
    "require", "module", "default", "true", "false", "null", "undefined", "this", "new", "async", "await",
    "select", "from", "where", "insert", "update", "delete", "into", "values", "begin", "end", "declare",
    "procedure", "function", "package", "body", "is", "as", "exception", "when", "then", "others", "cursor",
    "type", "table", "rowtype", "varchar2", "number", "date", "boolean", "loop", "commit", "rollback", "pragma"
  ]);

  const rawCodeTokens = codeContent
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_]+/)
    .map(t => t.trim())
    .filter(t => t.length > 3 && !STOP_WORDS.has(t) && !codeKeywords.has(t));

  const uniqueCodeTokens = [...new Set(rawCodeTokens)];
  tokens.push(...uniqueCodeTokens);

  return [...new Set(tokens)];
}

/**
 * Retrieve the top N most relevant guideline chunks based on target review code.
 */
async function getRelevantGuidelines(knowledgePath, codeContent, file, category, limit = 5) {
  const db = await indexKnowledgeBaseIfNeeded(knowledgePath);
  if (!db || !db.chunks || db.chunks.length === 0) {
    return "";
  }

  const queryTokens = extractQueryTokens(file.path || file.filename || "", category, codeContent);
  if (queryTokens.length === 0) {
    // If no query terms could be parsed, just return the first few chunks
    return db.chunks.slice(0, limit).map(c => `[Guideline Chunk from ${c.source}]\n${c.text}`).join("\n\n");
  }

  const chunks = db.chunks;
  const idfMap = db.idfMap;
  const avgdl = db.avgdl;
  const k1 = 1.2;
  const b = 0.75;

  const scores = [];
  for (const chunk of chunks) {
    let score = 0;
    for (const token of queryTokens) {
      if (chunk.tf[token]) {
        const tf = chunk.tf[token];
        const idf = idfMap[token] || Math.log((db.totalChunks + 0.5) / 0.5 + 1);
        const chunkLen = chunk.tokenCount;
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunkLen / avgdl)));
      }
    }
    if (score > 0) {
      scores.push({ chunk, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const topChunks = scores.slice(0, limit).map(s => s.chunk);

  if (topChunks.length === 0) {
    // Return first chunks as a general fallback if BM25 score is 0
    return chunks.slice(0, limit).map(c => `[Guideline Chunk from ${c.source}]\n${c.text}`).join("\n\n");
  }

  return topChunks.map(c => `[Guideline Chunk from ${c.source}]\n${c.text}`).join("\n\n");
}

module.exports = {
  indexKnowledgeBaseIfNeeded,
  getRelevantGuidelines
};
