const downloadFormatters = require('./download-formatters');

// Only download formatters if they don't exist
async function installFormatters() {
  const fs = require('fs-extra');
  const path = require('path');
  
  const formattersDir = path.join(__dirname, '..', 'formatters');
  
  // Check if formatters directory exists and has content
  if (fs.existsSync(formattersDir)) {
    const files = await fs.readdir(formattersDir);
    if (files.length > 0) {
      console.log('📦 Formatters already installed, skipping download...');
      return;
    }
  }
  
  console.log('📦 Installing formatters...');
  await downloadFormatters();
}

installFormatters().catch(console.error);