const vscode = require("../utils/vscode-shim");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

/**
 * Self-Diagnosing Error Handler
 * Detects FILE operation failures, explains the cause, and attempts automatic fixes
 */
class SelfDiagnosingErrorHandler {
  constructor(agent) {
    this.agent = agent;
    this.errorHistory = [];
    this.maxRetries = 3;
  }

  /**
   * Diagnose and fix FILE operation errors
   */
  async diagnoseAndFix(error, operation, context) {
    const diagnosis = this._diagnoseError(error, operation, context);
    
    console.log("[Self-Diagnose] Error detected:", diagnosis);
    
    // Log error for learning
    this._logError(diagnosis);
    
    // Attempt automatic fix
    const fixResult = await this._attemptAutoFix(diagnosis, context);
    
    if (fixResult.fixed) {
      return {
        success: true,
        diagnosis,
        fix: fixResult,
        message: `✅ Auto-fixed: ${fixResult.action}`
      };
    }
    
    // If auto-fix failed, provide detailed instructions
    return {
      success: false,
      diagnosis,
      fix: fixResult,
      message: this._buildUserInstructions(diagnosis)
    };
  }

  /**
   * Diagnose the root cause of an error
   */
  _diagnoseError(error, operation, context) {
    const errorCode = error.code || error.errno;
    const errorMessage = error.message || String(error);
    const filePath = context.filePath || context.path;
    
    // Common error patterns
    const patterns = [
      {
        match: /ENOENT|no such file or directory/i,
        type: "MISSING_FILE",
        cause: "File or directory does not exist",
        blocking: "File system cannot find the target path",
        canAutoFix: true
      },
      {
        match: /EACCES|permission denied/i,
        type: "PERMISSION_DENIED",
        cause: "Insufficient permissions to access file",
        blocking: "Operating system file permissions",
        canAutoFix: false
      },
      {
        match: /EEXIST|file already exists/i,
        type: "FILE_EXISTS",
        cause: "File already exists and cannot be overwritten",
        blocking: "File system protection against data loss",
        canAutoFix: true
      },
      {
        match: /EISDIR|illegal operation on a directory/i,
        type: "IS_DIRECTORY",
        cause: "Attempted file operation on a directory",
        blocking: "File system type mismatch",
        canAutoFix: true
      },
      {
        match: /ENOTDIR|not a directory/i,
        type: "NOT_DIRECTORY",
        cause: "Expected directory but found file",
        blocking: "File system type mismatch",
        canAutoFix: true
      },
      {
        match: /EMFILE|too many open files/i,
        type: "TOO_MANY_FILES",
        cause: "System file descriptor limit reached",
        blocking: "Operating system resource limits",
        canAutoFix: false
      },
      {
        match: /ENOSPC|no space left/i,
        type: "NO_SPACE",
        cause: "Disk is full",
        blocking: "Physical storage limitation",
        canAutoFix: false
      },
      {
        match: /EROFS|read-only file system/i,
        type: "READ_ONLY",
        cause: "File system is mounted read-only",
        blocking: "File system mount options",
        canAutoFix: false
      },
      {
        match: /outside_workspace/i,
        type: "OUTSIDE_WORKSPACE",
        cause: "File is outside workspace boundaries",
        blocking: "Code Janitor safety restrictions",
        canAutoFix: true
      },
      {
        match: /EPIPE|broken pipe/i,
        type: "BROKEN_PIPE",
        cause: "Connection to file system was interrupted",
        blocking: "Network or system instability",
        canAutoFix: false
      }
    ];
    
    // Find matching pattern
    const pattern = patterns.find(p => 
      p.match.test(errorMessage) || p.match.test(errorCode)
    );
    
    if (pattern) {
      return {
        type: pattern.type,
        cause: pattern.cause,
        blocking: pattern.blocking,
        canAutoFix: pattern.canAutoFix,
        operation,
        filePath,
        errorMessage,
        errorCode,
        timestamp: Date.now()
      };
    }
    
    // Unknown error
    return {
      type: "UNKNOWN",
      cause: "Unrecognized error",
      blocking: errorMessage,
      canAutoFix: false,
      operation,
      filePath,
      errorMessage,
      errorCode,
      timestamp: Date.now()
    };
  }

  /**
   * Attempt automatic fix
   */
  async _attemptAutoFix(diagnosis, context) {
    if (!diagnosis.canAutoFix) {
      return {
        fixed: false,
        action: "Cannot auto-fix",
        reason: "Requires manual intervention"
      };
    }
    
    try {
      switch (diagnosis.type) {
        case "MISSING_FILE":
          return await this._fixMissingFile(diagnosis, context);
        
        case "FILE_EXISTS":
          return await this._fixFileExists(diagnosis, context);
        
        case "IS_DIRECTORY":
          return await this._fixIsDirectory(diagnosis, context);
        
        case "NOT_DIRECTORY":
          return await this._fixNotDirectory(diagnosis, context);
        
        case "OUTSIDE_WORKSPACE":
          return await this._fixOutsideWorkspace(diagnosis, context);
        
        default:
          return {
            fixed: false,
            action: "No auto-fix available",
            reason: `Unknown error type: ${diagnosis.type}`
          };
      }
    } catch (fixError) {
      return {
        fixed: false,
        action: "Auto-fix failed",
        reason: fixError.message
      };
    }
  }

  /**
   * Fix: Missing file or directory
   */
  async _fixMissingFile(diagnosis, context) {
    const filePath = diagnosis.filePath;
    
    if (diagnosis.operation === "mkdir") {
      // Parent directory missing - create it
      const parentDir = path.dirname(filePath);
      await fs.mkdir(parentDir, { recursive: true });
      
      return {
        fixed: true,
        action: `Created parent directory: ${parentDir}`,
        nextStep: "Retry original operation"
      };
    }
    
    if (diagnosis.operation === "file") {
      // Parent directory missing - create it
      const parentDir = path.dirname(filePath);
      await fs.mkdir(parentDir, { recursive: true });
      
      return {
        fixed: true,
        action: `Created parent directory: ${parentDir}`,
        nextStep: "Retry file write"
      };
    }
    
    return {
      fixed: false,
      action: "Cannot create missing file",
      reason: "File content not provided"
    };
  }

  /**
   * Fix: File already exists
   */
  async _fixFileExists(diagnosis, context) {
    const filePath = diagnosis.filePath;
    
    // Check if we should overwrite
    if (context.allowOverwrite) {
      return {
        fixed: true,
        action: "Overwrite allowed by context",
        nextStep: "Retry with overwrite flag"
      };
    }
    
    // Ask user for permission
    const action = await vscode.window.showWarningMessage(
      `File already exists: ${path.basename(filePath)}. Overwrite?`,
      "Overwrite",
      "Skip",
      "Rename"
    );
    
    if (action === "Overwrite") {
      context.allowOverwrite = true;
      return {
        fixed: true,
        action: "User approved overwrite",
        nextStep: "Retry with overwrite"
      };
    }
    
    if (action === "Rename") {
      const newName = await vscode.window.showInputBox({
        prompt: "Enter new filename",
        value: path.basename(filePath)
      });
      
      if (newName) {
        context.filePath = path.join(path.dirname(filePath), newName);
        return {
          fixed: true,
          action: `Renamed to: ${newName}`,
          nextStep: "Retry with new name"
        };
      }
    }
    
    return {
      fixed: false,
      action: "User cancelled",
      reason: "File exists and user chose not to overwrite"
    };
  }

  /**
   * Fix: Attempted file operation on directory
   */
  async _fixIsDirectory(diagnosis, context) {
    const filePath = diagnosis.filePath;
    
    // If trying to write file but path is directory, append default filename
    if (diagnosis.operation === "file") {
      const newPath = path.join(filePath, "index.html");
      context.filePath = newPath;
      
      return {
        fixed: true,
        action: `Changed path to file: ${newPath}`,
        nextStep: "Retry with corrected path"
      };
    }
    
    return {
      fixed: false,
      action: "Cannot fix directory/file mismatch",
      reason: "Operation type incompatible"
    };
  }

  /**
   * Fix: Expected directory but found file
   */
  async _fixNotDirectory(diagnosis, context) {
    const filePath = diagnosis.filePath;
    
    // If trying to create directory but file exists, use parent
    if (diagnosis.operation === "mkdir") {
      const parentDir = path.dirname(filePath);
      context.filePath = parentDir;
      
      return {
        fixed: true,
        action: `Using parent directory: ${parentDir}`,
        nextStep: "Retry with parent path"
      };
    }
    
    return {
      fixed: false,
      action: "Cannot fix file/directory mismatch",
      reason: "Operation type incompatible"
    };
  }

  /**
   * Fix: File outside workspace
   */
  async _fixOutsideWorkspace(diagnosis, context) {
    const filePath = diagnosis.filePath;
    
    // Ask user for permission
    const action = await vscode.window.showWarningMessage(
      `File is outside workspace: ${filePath}. Allow?`,
      "Allow Once",
      "Always Allow",
      "Cancel"
    );
    
    if (action === "Allow Once") {
      context.allowOutsideWorkspace = true;
      return {
        fixed: true,
        action: "User allowed outside workspace access",
        nextStep: "Retry with permission"
      };
    }
    
    if (action === "Always Allow") {
      context.allowOutsideWorkspace = true;
      context.alwaysAllowOutside = true;
      return {
        fixed: true,
        action: "User always allows outside workspace",
        nextStep: "Retry with permanent permission"
      };
    }
    
    return {
      fixed: false,
      action: "User denied outside workspace access",
      reason: "Security restriction"
    };
  }

  /**
   * Build user instructions for manual fix
   */
  _buildUserInstructions(diagnosis) {
    const instructions = {
      PERMISSION_DENIED: `
❌ Permission Denied

**What's blocking:** ${diagnosis.blocking}
**File:** ${diagnosis.filePath}

**How to fix:**
1. Check file permissions: Right-click → Properties → Security
2. Ensure your user has write access
3. On Windows: Run VS Code as Administrator (not recommended)
4. On Linux/Mac: \`chmod +w "${diagnosis.filePath}"\`

**Alternative:**
- Save file to a different location where you have permissions
- Use a workspace folder you own
`,
      
      TOO_MANY_FILES: `
❌ Too Many Open Files

**What's blocking:** ${diagnosis.blocking}
**Limit reached:** System file descriptor limit

**How to fix:**
1. Close unused applications
2. Restart VS Code
3. Increase system limits:
   - Linux/Mac: \`ulimit -n 4096\`
   - Windows: Restart system

**Prevention:**
- Close unused editor tabs
- Disable auto-save temporarily
`,
      
      NO_SPACE: `
❌ No Space Left on Device

**What's blocking:** ${diagnosis.blocking}
**Disk:** Full

**How to fix:**
1. Free up disk space:
   - Delete temporary files
   - Empty trash/recycle bin
   - Remove old downloads
2. Check disk usage: \`df -h\` (Linux/Mac) or Disk Cleanup (Windows)
3. Move workspace to drive with more space

**Quick wins:**
- Clear node_modules: \`rm -rf node_modules\`
- Clear build artifacts: \`rm -rf dist build out\`
`,
      
      READ_ONLY: `
❌ Read-Only File System

**What's blocking:** ${diagnosis.blocking}
**File system:** Mounted read-only

**How to fix:**
1. Check mount options: \`mount | grep ${diagnosis.filePath}\`
2. Remount as read-write: \`sudo mount -o remount,rw /mount/point\`
3. On Windows: Check drive properties → Uncheck "Read-only"

**Common causes:**
- USB drive write-protected
- Network share permissions
- System protection enabled
`,
      
      BROKEN_PIPE: `
❌ Broken Pipe / Connection Lost

**What's blocking:** ${diagnosis.blocking}
**Cause:** Network or system instability

**How to fix:**
1. Check network connection (if network drive)
2. Restart VS Code
3. Check system logs for hardware issues
4. Try saving to local drive first

**If persistent:**
- Run disk check: \`chkdsk\` (Windows) or \`fsck\` (Linux/Mac)
- Check for failing hardware
`,
      
      UNKNOWN: `
❌ Unknown Error

**What's blocking:** ${diagnosis.blocking}
**Error:** ${diagnosis.errorMessage}

**How to fix:**
1. Check VS Code Output panel for details
2. Try restarting VS Code
3. Check file system health
4. Report issue with error details

**Debug info:**
- Operation: ${diagnosis.operation}
- File: ${diagnosis.filePath}
- Error code: ${diagnosis.errorCode}
`
    };
    
    return instructions[diagnosis.type] || instructions.UNKNOWN;
  }

  /**
   * Log error for learning
   */
  _logError(diagnosis) {
    this.errorHistory.push(diagnosis);
    
    // Keep only last 50 errors
    if (this.errorHistory.length > 50) {
      this.errorHistory.shift();
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {};
    
    for (const error of this.errorHistory) {
      stats[error.type] = (stats[error.type] || 0) + 1;
    }
    
    return {
      total: this.errorHistory.length,
      byType: stats,
      recent: this.errorHistory.slice(-5)
    };
  }

  /**
   * Retry operation with auto-fix
   */
  async retryWithAutoFix(operation, context, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Self-Diagnose] Attempt ${attempt}/${maxRetries}`);
        
        // Execute operation
        const result = await operation(context);
        
        console.log(`[Self-Diagnose] Success on attempt ${attempt}`);
        return { success: true, result, attempts: attempt };
        
      } catch (error) {
        lastError = error;
        console.log(`[Self-Diagnose] Attempt ${attempt} failed:`, error.message);
        
        // Diagnose and attempt fix
        const diagnosis = await this.diagnoseAndFix(error, context.type, context);
        
        if (!diagnosis.fix.fixed) {
          // Cannot auto-fix, show instructions
          vscode.window.showErrorMessage(
            diagnosis.message,
            "View Details"
          ).then(action => {
            if (action === "View Details") {
              this._showDetailedError(diagnosis);
            }
          });
          
          return {
            success: false,
            error: lastError,
            diagnosis,
            attempts: attempt
          };
        }
        
        // Auto-fix succeeded, update context and retry
        console.log(`[Self-Diagnose] Auto-fixed: ${diagnosis.fix.action}`);
        
        // Show success notification
        vscode.window.showInformationMessage(
          `✅ ${diagnosis.fix.action}. Retrying...`
        );
        
        // Continue to next attempt
      }
    }
    
    // All retries exhausted
    return {
      success: false,
      error: lastError,
      message: `Failed after ${maxRetries} attempts`,
      attempts: maxRetries
    };
  }

  /**
   * Show detailed error in panel
   */
  _showDetailedError(diagnosis) {
    const panel = vscode.window.createWebviewPanel(
      "errorDetails",
      "Error Details",
      vscode.ViewColumn.One,
      {}
    );
    
    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            padding: 20px;
            line-height: 1.6;
          }
          h1 { color: #d73a49; }
          h2 { color: #333; margin-top: 20px; }
          pre {
            background: #f6f8fa;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
          }
          .error-box {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 15px 0;
          }
          .fix-box {
            background: #d4edda;
            border-left: 4px solid #28a745;
            padding: 15px;
            margin: 15px 0;
          }
          code {
            background: #f6f8fa;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
          }
        </style>
      </head>
      <body>
        <h1>❌ ${diagnosis.type.replace(/_/g, " ")}</h1>
        
        <div class="error-box">
          <strong>What's blocking:</strong> ${diagnosis.blocking}<br>
          <strong>Cause:</strong> ${diagnosis.cause}<br>
          <strong>File:</strong> <code>${diagnosis.filePath || "N/A"}</code><br>
          <strong>Operation:</strong> ${diagnosis.operation}
        </div>
        
        ${diagnosis.fix.fixed ? `
          <div class="fix-box">
            <strong>✅ Auto-Fixed:</strong> ${diagnosis.fix.action}<br>
            <strong>Next Step:</strong> ${diagnosis.fix.nextStep}
          </div>
        ` : `
          <h2>How to Fix</h2>
          <pre>${diagnosis.message}</pre>
        `}
        
        <h2>Technical Details</h2>
        <pre>${JSON.stringify({
          errorCode: diagnosis.errorCode,
          errorMessage: diagnosis.errorMessage,
          timestamp: new Date(diagnosis.timestamp).toISOString()
        }, null, 2)}</pre>
      </body>
      </html>
    `;
  }
}

module.exports = SelfDiagnosingErrorHandler;
