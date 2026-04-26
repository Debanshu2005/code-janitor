# Self-Diagnosing Error System

## Overview

Code Janitor includes a **self-diagnosing error handler** that automatically detects FILE operation failures, explains exactly what's blocking the operation, and attempts to fix it automatically.

## How It Works

### 1. Error Detection
When a FILE operation fails:
```javascript
try {
  await fs.writeFile(path, content);
} catch (error) {
  // Error handler intercepts
}
```

### 2. Automatic Diagnosis
Analyzes the error and identifies:
- **Error type** (ENOENT, EACCES, EEXIST, etc.)
- **Root cause** (missing directory, permissions, etc.)
- **What's blocking** (file system, OS, security)
- **Can it be auto-fixed?** (yes/no)

### 3. Automatic Fix Attempt
If fixable, automatically:
- Creates missing directories
- Asks user for overwrite permission
- Corrects path mismatches
- Handles workspace boundaries

### 4. User Instructions
If cannot auto-fix, provides:
- Exact cause of failure
- What's blocking the operation
- Step-by-step fix instructions
- Alternative solutions

## Supported Error Types

### ✅ Auto-Fixable

| Error | Cause | Auto-Fix |
|-------|-------|----------|
| **ENOENT** | Missing file/directory | Create parent directories |
| **EEXIST** | File already exists | Ask user to overwrite/rename |
| **EISDIR** | File operation on directory | Append default filename |
| **ENOTDIR** | Directory operation on file | Use parent directory |
| **OUTSIDE_WORKSPACE** | File outside workspace | Ask user permission |

### ❌ Requires Manual Fix

| Error | Cause | Instructions Provided |
|-------|-------|----------------------|
| **EACCES** | Permission denied | How to fix permissions |
| **EMFILE** | Too many open files | How to increase limits |
| **ENOSPC** | Disk full | How to free space |
| **EROFS** | Read-only file system | How to remount |
| **EPIPE** | Broken pipe | How to fix connection |

## Example: Missing Directory

### Without Self-Diagnosis
```
❌ Error: ENOENT: no such file or directory
```

### With Self-Diagnosis
```
🔍 Diagnosing error...

❌ Missing File or Directory

What's blocking: File system cannot find the target path
Cause: Parent directory does not exist
File: src/components/Button.jsx

✅ Auto-fixing: Creating parent directory: src/components
✅ Retry successful!
```

## Example: Permission Denied

### Without Self-Diagnosis
```
❌ Error: EACCES: permission denied
```

### With Self-Diagnosis
```
🔍 Diagnosing error...

❌ Permission Denied

What's blocking: Operating system file permissions
File: /usr/local/bin/script.sh

How to fix:
1. Check file permissions: Right-click → Properties → Security
2. Ensure your user has write access
3. On Linux/Mac: `chmod +w "/usr/local/bin/script.sh"`

Alternative:
- Save file to a different location where you have permissions
- Use a workspace folder you own
```

## Example: Disk Full

### Without Self-Diagnosis
```
❌ Error: ENOSPC: no space left on device
```

### With Self-Diagnosis
```
🔍 Diagnosing error...

❌ No Space Left on Device

What's blocking: Physical storage limitation
Disk: Full

How to fix:
1. Free up disk space:
   - Delete temporary files
   - Empty trash/recycle bin
   - Remove old downloads
2. Check disk usage: `df -h` (Linux/Mac) or Disk Cleanup (Windows)
3. Move workspace to drive with more space

Quick wins:
- Clear node_modules: `rm -rf node_modules`
- Clear build artifacts: `rm -rf dist build out`
```

## Retry Logic

### Automatic Retry with Fix
```javascript
// Attempt 1: Fails with ENOENT
❌ Parent directory missing

// Auto-fix: Create parent directory
✅ Created: src/components

// Attempt 2: Success
✅ File written successfully
```

### Max 3 Attempts
```javascript
Attempt 1/3: Failed (ENOENT)
  → Auto-fix: Created parent directory
  
Attempt 2/3: Failed (EACCES)
  → Cannot auto-fix: Permission denied
  → Showing user instructions
```

## Error Statistics

View error patterns:
```javascript
{
  total: 15,
  byType: {
    ENOENT: 8,
    EACCES: 4,
    EEXIST: 2,
    ENOSPC: 1
  },
  recent: [
    { type: "ENOENT", filePath: "src/App.jsx", timestamp: 1704067200000 },
    { type: "EACCES", filePath: "/etc/config", timestamp: 1704067300000 }
  ]
}
```

## Integration

### In AIAgent
```javascript
// Wrap FILE operations with error handler
async applyChanges(filePath, content) {
  return await this.errorHandler.retryWithAutoFix(
    async (ctx) => this._applyChangesInternal(ctx),
    { filePath, content },
    3  // max retries
  );
}
```

### In ChatPanel
```javascript
// Errors are automatically diagnosed and fixed
const result = await this.agent.applyChanges(path, content);

if (!result.success) {
  // User already saw detailed instructions
  console.log(result.diagnosis);
}
```

## User Experience

### Before Self-Diagnosis
1. Operation fails
2. Generic error message
3. User confused
4. User searches Google
5. User tries random fixes
6. Eventually gives up or asks for help

### After Self-Diagnosis
1. Operation fails
2. Automatic diagnosis
3. Auto-fix attempted
4. If successful: ✅ Done
5. If not: Detailed instructions shown
6. User knows exactly what to do

## Configuration

Currently no configuration needed - works automatically!

Future options:
```json
{
  "codeJanitor.errorHandler.autoFix": true,
  "codeJanitor.errorHandler.maxRetries": 3,
  "codeJanitor.errorHandler.showDetailedErrors": true
}
```

## Logging

All errors are logged for analysis:
```javascript
errorHistory: [
  {
    type: "ENOENT",
    cause: "File or directory does not exist",
    blocking: "File system cannot find the target path",
    canAutoFix: true,
    operation: "file",
    filePath: "src/App.jsx",
    errorMessage: "ENOENT: no such file or directory",
    timestamp: 1704067200000
  }
]
```

## Benefits

### For Users
- ✅ Automatic fixes for common errors
- ✅ Clear explanations when auto-fix fails
- ✅ Step-by-step instructions
- ✅ No more cryptic error codes
- ✅ Faster problem resolution

### For Developers
- ✅ Reduced support requests
- ✅ Better error telemetry
- ✅ Identify common failure patterns
- ✅ Improve auto-fix strategies

## Future Enhancements

1. **Machine Learning**
   - Learn from error patterns
   - Predict likely fixes
   - Improve success rate

2. **Community Fixes**
   - Share successful fixes
   - Crowdsource solutions
   - Build fix database

3. **Proactive Detection**
   - Check before operation
   - Warn about potential issues
   - Suggest preventive actions

4. **Integration with AI**
   - Ask AI for fix suggestions
   - Generate custom solutions
   - Learn from AI responses

## Troubleshooting

**Error handler not working?**
1. Check console for error handler logs
2. Verify error handler is initialized
3. Check if error is supported type

**Want to disable auto-fix?**
```javascript
// Future configuration
{
  "codeJanitor.errorHandler.autoFix": false
}
```

**Want to see all errors?**
```javascript
// In Developer Console
agent.errorHandler.getErrorStats()
```

## Summary

The self-diagnosing error handler:
- ✅ Detects FILE operation failures
- ✅ Explains exactly what's blocking
- ✅ Attempts automatic fixes
- ✅ Provides detailed instructions
- ✅ Retries with fixes applied
- ✅ Logs all errors for learning

**Result:** Users spend less time debugging, more time coding! 🚀
