// Main library entry point
const { analyzeAndFixFile, analyzeAndFixDirectory } = require('./core/janitor');

// Export the public API
module.exports = {
  analyzeAndFixFile,
  analyzeAndFixDirectory,
  
  // You can also export individual fixers for advanced usage
  fixers: require('./core/fixers')
};