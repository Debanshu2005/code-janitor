#!/usr/bin/env node

const { analyzeAndFixDirectory } = require('./core/janitor');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  
  // Show help if requested - MUST be at the beginning
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0); // Exit after showing help
  }
  
  // Show version if requested
  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0); // Exit after showing version
  }
  
  const targetDir = args[0] || process.cwd();
  const absolutePath = path.resolve(targetDir);
  
  console.log('Code Janitor analyzing: ' + absolutePath);
  console.log('Looking for syntax issues to fix automatically...\n');
  
  try {
    const results = await analyzeAndFixDirectory(absolutePath);
    
    console.log('\n[SUCCESS] Analysis complete!');
    console.log('Files processed: ' + results.filesProcessed);
    console.log('Files modified: ' + results.filesFixed);
    console.log('Total fixes applied: ' + results.totalFixes);
    
    if (results.fixedFiles.length > 0) {
      console.log('\nModified files:');
      results.fixedFiles.forEach(file => {
        console.log('  - ' + path.relative(absolutePath, file));
      });
    } else {
      console.log('\nNo issues found! Your code looks clean.');
    }
    
  } catch (error) {
    console.error('[ERROR] ' + error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
Usage: code-janitor [directory]

Options:
  -h, --help     Show this help message
  -v, --version  Show version information

Description:
  Automatically fixes common syntax issues in JavaScript and Python files.
  If no directory is specified, the current working directory is used.

Examples:
  code-janitor .          # Fix current directory
  code-janitor ./src      # Fix specific directory
  code-janitor --help     # Show help
  `);
}

function showVersion() {
  const packageJson = require('../package.json');
  console.log(`code-janitor v${packageJson.version}`);
}

// Run if this script is executed directly
if (require.main === module) {
  main();
}