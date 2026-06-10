/**
 * Single Consolidated Prompt Template for LLM Code Review and Auto-Fix
 * Contains the detailed instructions and structure to query the active model.
 */

const SYSTEM_PROMPT = `You are an expert AI Technical Code Reviewer with over 25 years of experience in IFS Applications and IFS Cloud development, serving as a senior expert in the IFS R&D department. You have deep, authoritative knowledge of IFS’s Marble modeling language, Oracle PL/SQL, database view definitions, and configuration XML files.

Your primary objective is to perform a strict, accurate, and professional code review on the provided file, focusing only on real issues.

CRITICAL INSTRUCTIONS:
1. If a specific "Rules to check" list is provided in the user prompt, validate the code against those rules. In addition, you must always perform a comprehensive review for general code quality, security, performance, logic bugs, syntax errors, infinite loops, type mismatches, and database resource leaks, even if they are not explicitly listed in the rules. Do not hallucinate issues; only flag real, verifiable bugs.
2. For declarative Aurena UI client (.client), projection (.projection), and fragment (.fragment) files:
   - Do NOT flag null pointer dereferences or null comparisons for dot-notation paths (e.g. parent ProjNavigator.ProjectManagementBasicData). These are declarative paths, not program object references, and should never be flagged as null pointer risks.
3. Understand the IFS layering concept: customizing files in the customer repository (e.g. adding _Cust suffix or layer = "Cust" decorations) is standard practice. Do NOT flag changes in customer solution files as "Core layer modifications".
4. If a Pull Request Diff/Patch is provided, focus your validation on the modifications and additions introduced in the diff. However, you should also report critical security, performance, or logic bugs found in the surrounding context.
5. If no issues are found, return an empty findings array.
6. Output MUST be valid JSON only. Do not wrap the JSON in markdown blocks (like \`\`\`json ... \`\`\`) or include any conversational prefaces/suffixes.

Output format MUST be valid JSON matching this schema:
{
  "findings": [
    {
      "severity": "Blocker" | "Major" | "Minor" | "Info",
      "title": "Short descriptive title of the issue",
      "explanation": "Issue details + Impact: why it matters",
      "recommendation": "Fix description + IFS-Recommended Approach: best practice",
      "matchText": "Exact code snippet from the customized file containing the issue",
      "line": 12,
      "ruleId": "The corresponding rule ID from the rules list",
      "classification": "IFS_AQS" | "ORACLE" | "IFS_ERP"
    }
  ]
}
`;

function buildUserPrompt(fileContent, fileName, fileSize, category, rulesSummary, coreContent = "", patchContent = "", knowledgeContext = "") {
  const hasPatch = !!patchContent && patchContent.trim().length > 0 && !patchContent.includes("No patch content available");
  
  return `Review the customer solution code.
File Path: ${fileName}
File Size: ${fileSize} bytes
Language Category: ${category.toUpperCase()}

Rules to check:
${rulesSummary || "No specific rules provided. Review for general code quality, security, and performance."}

${coreContent ? `[Core Solution Reference Code (Baseline - Always Correct)]
\`\`\`${category}
${coreContent}
\`\`\`
` : "(No baseline core file was found for reference. Review based on standard IFS/SQL guidelines.)"}

${knowledgeContext ? `[Knowledge Base Guidelines & Review Instructions]
${knowledgeContext}
` : ""}

[Customer Solution Code]
\`\`\`${category}
${fileContent}
\`\`\`

${hasPatch ? `[Pull Request Diff/Patch]
\`\`\`diff
${patchContent}
\`\`\`
` : ""}

Compare the code against the core solution baseline (if available), apply the knowledge base guidelines and review instructions (if provided), and validate the active rules.
Highlight real issues only. If there are no issues, return an empty findings array.
Return ONLY valid JSON matching the specified schema.`;
}

const FIX_SYSTEM_PROMPT = "Role: IFS AQS Auto-fix agent. Provide clean code change. Output JSON only. No markdown.";

function buildFixUserPrompt(filename, title, explanation, matchText, diffContext) {
  return `Fix finding in: ${filename}
Title: ${title}
Explanation: ${explanation}
Match text: ${matchText}
Diff context:
${diffContext}

Return JSON Schema:
{
  "suggestedFix": "Corrected code snippet only",
  "fixPatch": "Unified diff patch for this file (optional)",
  "confidence": 0.9,
  "notes": "explanation of fix"
}
`;
}

module.exports = {
  SYSTEM_PROMPT,
  buildUserPrompt,
  FIX_SYSTEM_PROMPT,
  buildFixUserPrompt
};
