# 🔍 NVIDIA Rate Limit Diagnostic - Version 1.5.3

## Issue Reported
"NVIDIA NIM is hitting rate limits even though it's free endpoints - acting like I am using Groq"

## What's New in Version 1.5.3

### 1. Enhanced Error Handling for NVIDIA
Added specific error messages for:
- ✅ **429 Rate Limit errors** - Now shows NVIDIA-specific rate limit message
- ✅ **401 Authentication errors** - Shows API key issues
- ✅ **404 Not Found errors** - Shows model/endpoint issues

### 2. Debug Logging
Added console logging to verify:
- Which URL is being called (should be `https://integrate.api.nvidia.com/v1/chat/completions`)
- Which provider is active (should show `nvidia`)
- Which API key is being used (masked for security)

## 📦 Install Version 1.5.3

**File**: `d:\CityGrid\my-project\code-janitor\arduino-ide-agent\code-janitor-arduino-ai-agent-1.5.3.vsix`

**Installation Steps:**
1. Uninstall old version from Arduino IDE
2. Restart Arduino IDE
3. Install from VSIX: `code-janitor-arduino-ai-agent-1.5.3.vsix`
4. Restart Arduino IDE

## 🔍 Diagnostic Steps

### Step 1: Open Developer Console
1. In Arduino IDE, go to: **Help → Toggle Developer Tools**
2. Click the **Console** tab
3. Keep this open while testing

### Step 2: Test NVIDIA Request
1. Open Arduino AI Chat (`Ctrl+Alt+A`)
2. Select **"🚀 NVIDIA NIM"** provider
3. Select model: `meta/llama-3.1-8b-instruct`
4. Send a test message: "Hello"

### Step 3: Check Console Output
Look for these log messages in the console:

**Expected Output:**
```
[CodeJanitor] Request config provider=nvidia model=meta/llama-3.1-8b-instruct timeout=180000 url=remote
[CodeJanitor] Using NVIDIA API key: nvapi-ab...xyz4
[CodeJanitor] Sending request to: https://integrate.api.nvidia.com/v1/chat/completions with provider: nvidia
```

**If you see Groq URL instead:**
```
❌ [CodeJanitor] Sending request to: https://api.groq.com/openai/v1/chat/completions with provider: nvidia
```
This means the provider is not being set correctly!

### Step 4: Check Error Message
If you get a rate limit error, the console should show:

**NVIDIA Rate Limit (Expected):**
```
NVIDIA error: 429 Too Many Requests. NVIDIA NIM free tier has rate limits. Wait a moment and try again, or try a different model like meta/llama-3.1-8b-instruct.
```

**Groq Rate Limit (Wrong!):**
```
Groq error: Rate limit exceeded...
```

## 🎯 Possible Causes

### Cause 1: Wrong API Key Being Used
**Symptom**: Console shows Groq API key instead of NVIDIA key

**Solution**:
1. Open Arduino AI Chat
2. Select NVIDIA provider
3. Click the API key field
4. Paste your NVIDIA API key
5. Click "Save"
6. Verify console shows: `Using NVIDIA API key: nvapi-...`

### Cause 2: Provider Not Switching Correctly
**Symptom**: Console shows `provider=groq` even though NVIDIA is selected

**Solution**:
1. Clear extension cache:
   ```powershell
   Remove-Item -Recurse -Force "$env:APPDATA\Code\User\globalStorage\Debanshu2005.code-janitor-arduino-ai-agent"
   ```
2. Restart Arduino IDE
3. Reinstall extension
4. Set provider to NVIDIA again

### Cause 3: NVIDIA NIM Actually Has Rate Limits
**Symptom**: Console shows correct NVIDIA URL and key, but still getting 429 errors

**Explanation**: NVIDIA NIM free tier DOES have rate limits:
- **Requests per minute**: ~10-20 requests/min
- **Tokens per request**: Limited to 2048-4096 tokens
- **Concurrent requests**: 1-2 concurrent requests max

**Solutions**:
1. **Wait 1-2 minutes** between requests
2. **Use smaller prompts** (less context)
3. **Switch to a different model**:
   - Try `minimaxi/minimax-m2.7` (different rate limit pool)
   - Try `meta/llama-3.1-70b-instruct` (different rate limit pool)
4. **Use Fast mode** instead of Heavy mode (sends less context)

### Cause 4: Shared Rate Limit Pool
**Symptom**: Rate limits even though you just started using it

**Explanation**: NVIDIA NIM free tier may share rate limits across:
- All models using the same API key
- All requests from the same IP address
- All requests in a time window

**Solution**:
1. Check if you have other apps/tabs using NVIDIA NIM
2. Close other NVIDIA NIM sessions
3. Wait 5-10 minutes for rate limit to reset
4. Try again

## 📊 NVIDIA NIM Free Tier Limits (Estimated)

Based on NVIDIA's documentation and user reports:

| Limit Type | Free Tier |
|------------|-----------|
| Requests/min | 10-20 |
| Requests/hour | 100-200 |
| Tokens/request | 2048-4096 |
| Concurrent requests | 1-2 |
| Daily requests | 1000-2000 |

**Note**: These are estimates. Actual limits may vary by model and account.

## 🔧 Troubleshooting Commands

### Check which provider is saved in settings:
```powershell
# Open Arduino IDE settings
# File → Preferences → Settings
# Search for: "codeJanitor.ai.provider"
# Should show: "nvidia"
```

### Check which API key is saved:
```powershell
# Open Arduino IDE settings
# Search for: "codeJanitor.ai.nvidiaApiKey"
# Should show your NVIDIA key (starts with "nvapi-")
```

### Verify NVIDIA API key is valid:
```powershell
# Test your NVIDIA API key directly:
curl -X POST "https://integrate.api.nvidia.com/v1/chat/completions" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_NVIDIA_KEY" `
  -d '{
    "model": "meta/llama-3.1-8b-instruct",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100
  }'
```

If this returns 429, then NVIDIA is actually rate limiting you.
If this returns 401, your API key is invalid.
If this works, then the extension has a bug.

## ✅ Expected Behavior After Fix

1. **Console shows NVIDIA URL**: `https://integrate.api.nvidia.com/v1/chat/completions`
2. **Console shows NVIDIA provider**: `provider=nvidia`
3. **Console shows NVIDIA API key**: `nvapi-...`
4. **Error messages are NVIDIA-specific**: "NVIDIA error: ..." not "Groq error: ..."
5. **Rate limits are reasonable**: Can send 10-20 requests before hitting limit

## 🚨 If Still Seeing Groq Behavior

If after installing 1.5.3 you still see:
- Groq URL in console
- Groq error messages
- Groq API key being used

Then there's a bug in the provider switching logic. Please:
1. Share the console output
2. Share the error message
3. Share which provider is selected in the UI

## 📝 Summary

**Version 1.5.3 adds:**
- ✅ Better NVIDIA error handling (429, 401, 404)
- ✅ Debug logging to verify correct endpoint
- ✅ API key masking in logs for security
- ✅ Clear error messages for rate limits

**Next steps:**
1. Install version 1.5.3
2. Open Developer Console
3. Test with NVIDIA provider
4. Check console logs to verify correct endpoint
5. Share console output if still seeing issues

The debug logging will definitively show whether the extension is calling NVIDIA or Groq!
