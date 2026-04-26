# Self-Healing Test Script

## Test 1: Performance Self-Healing

1. Open AI Chat (Ctrl+Alt+C)
2. Switch to NVIDIA provider
3. Select minimaxai/minimax-m2.7 model
4. Send: "Explain async/await in detail"
5. Wait for slow response (30+ seconds)
6. Click "Auto-Fix Now" when notification appears
7. Verify model switched to meta/llama-3.1-8b-instruct
8. Send another request - should be ~8 seconds

## Test 2: Missing Directory (Auto-Fix)

Ask AI:
```
Create a file at src/components/ui/forms/Input.jsx with a basic React input component
```

Expected:
- ✅ Auto-creates: src/components/ui/forms/
- ✅ Creates: Input.jsx
- ✅ No errors

## Test 3: File Exists (User Prompt)

Ask AI again:
```
Create a file at src/components/ui/forms/Input.jsx
```

Expected:
- ❓ Prompt: "File already exists. Overwrite?"
- User chooses action

## Test 4: Outside Workspace (Permission Request)

Ask AI:
```
Create a file at C:/temp/test.txt with "Hello World"
```

Expected:
- ❓ Prompt: "File is outside workspace. Allow?"
- User chooses action

## Test 5: View Performance Report

Command Palette:
```
Code Janitor: Show AI Performance Report
```

Expected:
- Shows average response time
- Shows slow response count
- Shows failure rate
- Shows recommendations

## Test 6: Check Auto-Heal History

Open file:
```
~/.vscode/extensions/[extension-id]/globalStorage/auto-heal-log.json
```

Expected:
```json
[
  {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "changes": [
      "Switched model: minimaxai/minimax-m2.7 → meta/llama-3.1-8b-instruct"
    ]
  }
]
```

## Test 7: Stress Test (Multiple Errors)

Ask AI:
```
Create these files:
1. deep/nested/folder/structure/component1.jsx
2. another/deep/path/component2.jsx
3. yet/another/path/component3.jsx
```

Expected:
- ✅ Auto-creates all directories
- ✅ Creates all files
- ✅ Shows activity log with all auto-fixes

## Test 8: Permission Denied (Manual Fix)

Windows:
```cmd
echo test > readonly.txt
attrib +r readonly.txt
```

Linux/Mac:
```bash
echo test > readonly.txt
chmod 444 readonly.txt
```

Ask AI:
```
Edit readonly.txt and add "Hello World"
```

Expected:
- ❌ Cannot auto-fix
- 📋 Shows detailed instructions
- 📋 Explains what's blocking
- 📋 Provides fix steps

## Test 9: Disk Full Simulation (Manual Fix)

This is hard to test without actually filling disk, but you can see the error handling by checking the code.

## Test 10: View Activity Panel

In AI Chat:
1. Click "Show" button in Agent Activity panel
2. Send any request
3. Watch real-time activity log

Expected:
- Shows scanning steps
- Shows file operations
- Shows auto-fixes
- Shows errors and warnings

## Success Criteria

✅ Performance self-healing detects slow models
✅ Auto-switches to faster alternatives
✅ Error self-diagnosis catches FILE failures
✅ Auto-fixes missing directories
✅ Prompts user for ambiguous cases
✅ Shows detailed instructions for manual fixes
✅ Logs all optimizations
✅ Performance report shows metrics
