const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');

async function downloadFile(url, destination) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(destination);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function downloadFormatters() {
  const formattersDir = path.join(__dirname, '..', 'formatters');
  await fs.ensureDir(formattersDir);

  console.log('📦 Downloading formatters...');

  // Download Uncrustify (Embedded C)
  if (!fs.existsSync(path.join(formattersDir, 'uncrustify'))) {
    console.log('Downloading Uncrustify for Embedded C...');
    let uncrustifyUrl;
    
    if (process.platform === 'win32') {
      uncrustifyUrl = 'https://github.com/uncrustify/uncrustify/releases/download/uncrustify-0.81.0/uncrustify-0.81.0_f-win64.zip';
    } else if (process.platform === 'darwin') {
      uncrustifyUrl = 'https://github.com/uncrustify/uncrustify/releases/download/uncrustify-0.81.0/uncrustify-0.81.0_f-macOS.zip';
    } else {
      uncrustifyUrl = 'https://github.com/uncrustify/uncrustify/releases/download/uncrustify-0.81.0/uncrustify-0.81.0_f-linux.zip';
    }

    try {
      const zipPath = path.join(formattersDir, 'uncrustify.zip');
      await downloadFile(uncrustifyUrl, zipPath);
      
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(path.join(formattersDir, 'uncrustify'), true);
      
      await fs.remove(zipPath);
      console.log('✅ Uncrustify downloaded successfully');
    } catch (error) {
      console.warn('❌ Failed to download Uncrustify:', error.message);
    }
  }

  // Download google-java-format (Java)
  if (!fs.existsSync(path.join(formattersDir, 'google-java-format'))) {
    console.log('Downloading google-java-format...');
    try {
      const jarUrl = 'https://github.com/google/google-java-format/releases/download/v1.19.2/google-java-format-1.19.2-all-deps.jar';
      const jarPath = path.join(formattersDir, 'google-java-format', 'google-java-format.jar');
      await fs.ensureDir(path.dirname(jarPath));
      await downloadFile(jarUrl, jarPath);
      console.log('✅ google-java-format downloaded successfully');
    } catch (error) {
      console.warn('❌ Failed to download google-java-format:', error.message);
    }
  }

  // Download Black (Python) - We'll use pip to install it locally
  if (!fs.existsSync(path.join(formattersDir, 'black'))) {
    console.log('Installing Black for Python...');
    try {
      await fs.ensureDir(path.join(formattersDir, 'black'));
      
      // Create a virtual environment and install black
      const venvPath = path.join(formattersDir, 'black', 'venv');
      execSync(`python -m venv "${venvPath}"`, { stdio: 'pipe' });
      
      if (process.platform === 'win32') {
        execSync(`"${path.join(venvPath, 'Scripts', 'pip')}" install black`, { stdio: 'pipe' });
      } else {
        execSync(`"${path.join(venvPath, 'bin', 'pip')}" install black`, { stdio: 'pipe' });
      }
      
      console.log('✅ Black installed successfully');
    } catch (error) {
      console.warn('❌ Failed to install Black:', error.message);
    }
  }

  // Download Prettier (JavaScript) - Install via npm in local directory
  if (!fs.existsSync(path.join(formattersDir, 'prettier'))) {
    console.log('Installing Prettier for JavaScript...');
    try {
      await fs.ensureDir(path.join(formattersDir, 'prettier'));
      
      // Create package.json for prettier
      const packageJson = {
        name: "prettier-bundle",
        version: "1.0.0",
        dependencies: {
          "prettier": "^3.0.0"
        }
      };
      
      await fs.writeJson(path.join(formattersDir, 'prettier', 'package.json'), packageJson);
      
      // Install prettier locally
      execSync('npm install', { 
        cwd: path.join(formattersDir, 'prettier'),
        stdio: 'pipe' 
      });
      
      console.log('✅ Prettier installed successfully');
    } catch (error) {
      console.warn('❌ Failed to install Prettier:', error.message);
    }
  }

  console.log('🎉 All formatters downloaded successfully!');
}

// Run if called directly
if (require.main === module) {
  downloadFormatters().catch(console.error);
}

module.exports = downloadFormatters;