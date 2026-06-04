/**
 * Review Engine - Main Entry Point
 * Exports all review engine modules for use in ipcHandlers and other backend code
 */

module.exports = {
  fileDiscovery: require("./fileDiscovery"),
  fileClassifier: require("./fileClassifier"),
  staticAnalyzer: require("./staticAnalyzer"),
  prompts: require("./prompts"),
  orchestrator: require("./orchestrator")
};
