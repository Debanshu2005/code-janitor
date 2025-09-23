const fs = require('fs').promises;
const path = require('path');

/**
 * Recursively finds files with specific extensions in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} allowedExtensions - Array of extensions to include (e.g., ['.js', '.py'])
 * @returns {Promise<string[]>} - Array of file paths
 */
async function findFiles(dir, allowedExtensions) {
  let results = [];
  
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        // Skip node_modules and hidden directories
        if (item.name === 'node_modules' || item.name.startsWith('.')) {
          continue;
        }
        results = results.concat(await findFiles(fullPath, allowedExtensions));
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}: ${error.message}`);
  }
  
  return results;
}

module.exports = { findFiles };