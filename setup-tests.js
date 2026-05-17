#!/usr/bin/env node

/**
 * Test Setup Script
 * Ensures all test dependencies are properly installed and configured
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up test environment...\n');

// Check if jest.config.js exists
const jestConfigPath = path.join(__dirname, 'jest.config.js');
if (fs.existsSync(jestConfigPath)) {
  console.log('✅ jest.config.js found');
} else {
  console.log('❌ jest.config.js not found');
  process.exit(1);
}

// Check Node.js version
const nodeVersion = process.version;
console.log(`✅ Node.js version: ${nodeVersion}`);

// Check if Jest is installed
try {
  execSync('npx jest --version', { stdio: 'pipe' });
  console.log('✅ Jest is installed');
} catch (error) {
  console.log('❌ Jest is not installed');
  console.log('   Run: npm install');
}

// Check if Python is available
try {
  const pythonVersion = execSync('python --version', { stdio: 'pipe' }).toString().trim();
  console.log(`✅ Python available: ${pythonVersion}`);
} catch (error) {
  console.log('⚠️  Python not found in PATH');
}

// Check if pytest is installed
try {
  execSync('pytest --version', { stdio: 'pipe' });
  console.log('✅ pytest is installed');
} catch (error) {
  console.log('⚠️  pytest not installed');
  console.log('   Run: pip install pytest pytest-json-report');
}

// Check baseline-browser-mapping
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  const hasBrowserMapping = packageJson.devDependencies?.['baseline-browser-mapping'];
  if (hasBrowserMapping) {
    console.log('✅ baseline-browser-mapping is in package.json');
  } else {
    console.log('⚠️  baseline-browser-mapping not found');
    console.log('   Run: npm i baseline-browser-mapping@latest -D');
  }
} catch (error) {
  console.log('❌ Error reading package.json');
}

// Count test files
let testCount = 0;
function countTests(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'dist', 'out'].includes(entry.name)) {
        countTests(fullPath);
      } else if (entry.isFile() && /\.(test|spec)\.(js|ts)$/.test(entry.name)) {
        testCount++;
      }
    }
  } catch (error) {
    // Ignore errors
  }
}

countTests(path.join(__dirname, 'src'));
console.log(`\n📊 Found ${testCount} test files\n`);

console.log('🎯 Test environment setup complete!');
console.log('\nTo run tests:');
console.log('  npm test              - Run all tests');
console.log('  npm test -- --watch   - Run tests in watch mode');
console.log('  npm test -- --coverage - Run tests with coverage');

// Made with Bob
