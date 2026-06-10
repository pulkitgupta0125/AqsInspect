const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const officeParser = require('officeparser');

/**
 * Extracts raw text from a Word (.docx) file using mammoth.
 */
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  } catch (err) {
    console.error(`[Knowledge Base] Failed to extract Word text from ${path.basename(filePath)}:`, err.message);
    return "";
  }
}

/**
 * Extracts raw text from Office documents (DOCX, PPTX, XLSX) using officeparser.
 */
async function extractTextFromOffice(filePath) {
  try {
    const result = await officeParser.parseOffice(filePath);
    return result.toText() || "";
  } catch (err) {
    console.error(`[Knowledge Base] Failed to extract Office text from ${path.basename(filePath)}:`, err.message);
    return "";
  }
}

/**
 * Extracts raw text from a PDF file using pdf-parse.
 */
async function extractTextFromPdf(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text || "";
  } catch (err) {
    console.error(`[Knowledge Base] Failed to extract PDF text from ${path.basename(filePath)}:`, err.message);
    return "";
  }
}

/**
 * Recursively or flat-scans the knowledgePath folder and consolidates document content.
 */
async function loadKnowledgeBase(knowledgePath) {
  if (!knowledgePath || !fs.existsSync(knowledgePath)) {
    return "";
  }

  try {
    const stats = fs.statSync(knowledgePath);
    if (!stats.isDirectory()) {
      return "";
    }

    const files = fs.readdirSync(knowledgePath);
    let combinedText = "";

    for (const file of files) {
      const fullPath = path.join(knowledgePath, file);
      const fileStats = fs.statSync(fullPath);

      if (fileStats.isFile()) {
        const ext = path.extname(file).toLowerCase();
        let fileText = "";

        if (ext === '.txt' || ext === '.md') {
          try {
            fileText = fs.readFileSync(fullPath, 'utf-8');
          } catch (err) {
            console.error(`[Knowledge Base] Failed to read text file ${file}:`, err.message);
          }
        } else if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') {
          fileText = await extractTextFromOffice(fullPath);
        } else if (ext === '.pdf') {
          fileText = await extractTextFromPdf(fullPath);
        }

        if (fileText && fileText.trim().length > 0) {
          combinedText += `\n\n--- DOCUMENT: ${file} ---\n${fileText.trim()}\n`;
        }
      }
    }

    return combinedText.trim();
  } catch (err) {
    console.error("[Knowledge Base] Failed to load knowledge base:", err.message);
    return "";
  }
}

module.exports = {
  loadKnowledgeBase
};
