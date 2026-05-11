// Main library entry point
const {
  analyzeFile,
  analyzeTarget,
  analyzeAndFixFile,
  analyzeAndFixDirectory
} = require("./core/janitor");

// Export the public API
module.exports = {
  analyzeFile,
  analyzeTarget,
  analyzeAndFixFile,
  analyzeAndFixDirectory,
  
  // You can also export individual fixers for advanced usage
  fixers: require("./core/fixers")
};
