const fs = require('fs');
const path = require('path');

const configPath = 'C:/Users/pulkit.gupta/AppData/Roaming/electron-react-bootstrap/config.json';
const workspaceDir = 'c:/AQS-PULKITGUPTA025';

async function main() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const llmConfig = config.llm || {};
    
    // Copy config to local workspace root so configStore.js reads it correctly during test
    fs.writeFileSync(path.join(workspaceDir, 'config.json'), JSON.stringify(config, null, 2));
    
    console.log("Active Mode:", config.mcp?.mode);
    console.log("KB Enabled:", config.mcp?.enableKnowledgeBase);
    console.log("KB Path:", config.mcp?.knowledgePath);
    
    const agents = require(path.join(workspaceDir, 'electron/reviewEngine/agents'));
    
    // We create a customized file code snippet that violates the "C" Prefix Rule from the PPTX
    const codeSnippet = `
      layer Cust;
      
      @Override
      PROCEDURE Check_Insert___ (
         newrec_ IN OUT purchase_order_approval_tab%ROWTYPE,
         indrec_ IN OUT Indicator_Rec,
         attr_   IN OUT VARCHAR2 )
      IS
         my_new_field VARCHAR2(100); -- Violated: should use 'C' prefix
      BEGIN
         super(newrec_, indrec_, attr_);
      END Check_Insert___;
    `;

    const mockFile = {
      path: 'PurchaseOrderApproval-Cust.plsql',
      fullPath: 'PurchaseOrderApproval-Cust.plsql',
      extension: '.plsql',
      category: 'plsql',
      size: codeSnippet.length,
      patch: ''
    };

    const axios = require('axios');
    const postFunc = async (url, body, headers) => {
      console.log("\nPrompt sent to LLM contains Knowledge Base? ", body.messages[1].content.includes("[Knowledge Base Guidelines & Review Instructions]"));
      if (body.messages[1].content.includes("[Knowledge Base Guidelines & Review Instructions]")) {
        console.log("Length of Knowledge Base section in prompt:", body.messages[1].content.match(/\[Knowledge Base Guidelines & Review Instructions\]([\s\S]*?)\[Customer Solution Code\]/)?.[1]?.length);
      }
      return await axios.post(url, body, { headers });
    };

    console.log("\nRunning review engine via delegateReview...");
    const result = await agents.delegateReview(mockFile, codeSnippet, llmConfig, postFunc);
    
    console.log("\nReview Results:");
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    // Delete local config copy
    if (fs.existsSync(path.join(workspaceDir, 'config.json'))) {
      fs.unlinkSync(path.join(workspaceDir, 'config.json'));
    }
  }
}

main();
