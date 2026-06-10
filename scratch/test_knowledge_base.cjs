const fs = require('fs');
const path = require('path');

const workspaceDir = 'c:/AQS-PULKITGUPTA025';
const kbDir = path.join(workspaceDir, 'scratch/mock_kb');

// Ensure mock KB directory exists
if (!fs.existsSync(kbDir)) {
  fs.mkdirSync(kbDir, { recursive: true });
}

// Write mock files
fs.writeFileSync(path.join(kbDir, 'rules.txt'), 'Rule 1: Always check for SQL injection in PL/SQL. Rule 2: Do not use SELECT *.');
fs.writeFileSync(path.join(kbDir, 'guidelines.md'), '# Formatting Guidelines\n\nUse uppercase for SQL keywords like SELECT, UPDATE, DELETE.');
fs.writeFileSync(path.join(kbDir, 'presentation.pptx'), 'pptx-placeholder-content');

async function runTests() {
  console.log("--- 1. Testing Document Extraction from Knowledge Base ---");
  const parser = require('../electron/reviewEngine/knowledgeBaseParser');
  
  // Mock officeparser
  const officeParser = require('officeparser');
  const originalParseOffice = officeParser.parseOffice;
  officeParser.parseOffice = async (filePath) => {
    if (filePath.endsWith('.pptx')) {
      return {
        toText: () => "Rule 3: Avoid complex expressions in PPTX."
      };
    }
    return { toText: () => "" };
  };

  const kbContent = await parser.loadKnowledgeBase(kbDir);
  console.log("Loaded content from Mock KB:");
  console.log(kbContent);

  // Restore officeparser
  officeParser.parseOffice = originalParseOffice;

  if (kbContent.includes('Rule 1') && kbContent.includes('Formatting Guidelines') && kbContent.includes('Rule 3')) {
    console.log("✅ Document parser loaded text and PPTX files successfully!");
  } else {
    console.error("❌ Document parser failed to load text and PPTX files.");
  }

  console.log("\n--- 2. Testing agents.js Integration ---");
  const agents = require('../electron/reviewEngine/agents');
  
  // Set up mock config
  const configPath = path.join(workspaceDir, 'config.json');
  let originalConfig = {};
  if (fs.existsSync(configPath)) {
    originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  
  const testConfig = {
    ...originalConfig,
    mcp: {
      mode: 'rules-only',
      enableKnowledgeBase: true,
      knowledgePath: kbDir
    }
  };
  
  // Temporarily write test config to file
  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  try {
    const codeSnippet = `
      SELECT * FROM customers;
    `;
    const mockFile = {
      path: 'test_kb.sql',
      fullPath: 'test_kb.sql',
      extension: '.sql',
      category: 'sql',
      size: codeSnippet.length,
      patch: ''
    };

    console.log("Config read by store:", require('../electron/configStore').getConfig());

    // Mock officeparser before calling delegateReview
    let runAQSReviewerCalled = false;
    let receivedCorrectContext = false;
    const officeParserRun = require('officeparser');
    const origParse = officeParserRun.parseOffice;
    officeParserRun.parseOffice = async (filePath) => {
      if (filePath.endsWith('.pptx')) return { toText: () => "Rule 3: Avoid complex expressions in PPTX." };
      return { toText: () => "" };
    };

    const mockLlmConfig = { provider: 'openai', model: 'gpt-4o' };
    const mockPostFunc = async (url, body, headers) => {
      runAQSReviewerCalled = true;
      const userPrompt = body?.messages?.[1]?.content || "";
      console.log("mockPostFunc was called!");
      
      if (userPrompt.includes('Rule 1') && userPrompt.includes('Formatting Guidelines') && userPrompt.includes('Rule 3')) {
        receivedCorrectContext = true;
        console.log("✅ Prompt received correct knowledge base context!");
      } else {
        console.error("❌ Prompt did not receive correct knowledge base context.");
      }
      return { data: { choices: [{ message: { content: '{"findings": []}' } }] } };
    };

    console.log("Calling delegateReview in 'rules-only' mode with KB enabled...");
    const result = await agents.delegateReview(mockFile, codeSnippet, mockLlmConfig, mockPostFunc);
    console.log("delegateReview returned findings count:", result?.findings?.length);

    // Restore original parseOffice
    officeParserRun.parseOffice = origParse;

    if (runAQSReviewerCalled && receivedCorrectContext) {
      console.log("✅ Successfully invoked AI Reviewer in rules-only mode with active Knowledge Base!");
    } else {
      console.error("❌ Failed to invoke AI Reviewer in rules-only mode with active Knowledge Base.");
    }

  } finally {
    // Restore original config
    fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2));
    
    // Clean up mock files
    if (fs.existsSync(path.join(kbDir, 'rules.txt'))) fs.unlinkSync(path.join(kbDir, 'rules.txt'));
    if (fs.existsSync(path.join(kbDir, 'guidelines.md'))) fs.unlinkSync(path.join(kbDir, 'guidelines.md'));
    if (fs.existsSync(path.join(kbDir, 'presentation.pptx'))) fs.unlinkSync(path.join(kbDir, 'presentation.pptx'));
    if (fs.existsSync(kbDir)) fs.rmdirSync(kbDir);
  }
}

runTests().catch(console.error);
