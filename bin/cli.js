#!/usr/bin/env node

const { analyzeAndFixDirectory } = require('./core/janitor');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const targetDir = args[0] || process.cwd();
  const absolutePath = path.resolve(targetDir);
  
  console.log(` Code Janitor analyzing: ${absolutePath}`);
  console.log('Looking for syntax issues to fix automatically...\n');
  
  try {
    const results = await analyzeAndFixDirectory(absolutePath);
    
    console.log(` Analysis complete!`);
    console.log(` Files processed: ${results.filesProcessed}`);
    console.log(` Files modified: ${results.filesFixed}`);
    console.log(` Total fixes applied: ${results.totalFixes}`);
    
    if (results.fixedFiles.length > 0) {
      console.log('\n Modified files:');
      results.fixedFiles.forEach(file => {
        console.log(`   • ${path.relative(absolutePath, file)}`);
      });
    }
    
  } catch (error) {
    console.error(' Error:', error.message);
    process.exit(1);
  }
}

// Run if this script is executed directly
if (require.main === module) {
  main();
}