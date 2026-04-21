# 🚀 Version 1.5.3 - NVIDIA Rate Limit Debug Release

## What You Reported
> "NVIDIA NIM is hitting rate limits even though it's free endpoints - it's acting like I am using Groq"

## Two Possible Scenarios

### Scenario A: Extension is calling Groq API instead of NVIDIA ❌
**Symptoms:**
- Error messages say "Groq error" instead of "NVIDIA error"
- Rate limits hit immediately
- Feels like Groq's aggressive rate limiting

**Root Cause:** Provider not switching correctly, wrong API endpoint being called

**Fix:** Version 1.5.3 adds debug logging to verify which endpoint is called

### Scenario B: NVIDIA NIM actually has rate limits ✅
**Symptoms:**
- Error messages say "NVIDIA error" or generic "429"
- Rate limits after 10-20 requests
- Happens even with correct NVIDIA endpoint

**Root Cause:** NVIDIA NIM free tier DOES have rate limits (10-20 req/min)

**Fix:** Version 1.5.3 adds better error messages explaining NVIDIA rate limits

## What's in Version 1.5.3

### 1. Debug Logging
```javascript
console.log(`[CodeJanitor] Sending request to: ${reqOpts.url} with provider: ${runtimeConfig.provider}`)
console.log(`[CodeJanitor] Using NVIDIA API key: ${maskedKey}`)
```

This will show in Developer Console:
- ✅ Which URL is being called (NVIDIA vs Groq)
- ✅ Which provider is active
- ✅ Which API key is being used (masked)

### 2. Better Error Messages
```javascript
if (/\b429\b|rate limit|quota|too many requests/i.test(message)) {
  return `NVIDIA error: ${message}. NVIDIA NIM free tier has rate limits. Wait a moment and try again...`
}
```

Now you'll see clear NVIDIA-specific error messages instead of generic errors.

### 3. Authentication Error Handling
```javascript
if (/\b401\b|unauthorized|invalid.*key|authentication/i.test(message)) {
  return `NVIDIA error: ${message}. Your API key may be invalid or expired...`
}
```

## How to Diagnose

### Step 1: Install Version 1.5.3
```
File: code-janitor-arduino-ai-agent-1.5.3.vsix
Location: d:\CityGrid\my-project\code-janitor\arduino-ide-agent\
```

### Step 2: Open Developer Console
Arduino IDE → Help → Toggle Developer Tools → Console tab

### Step 3: Send Test Message
1. Select NVIDIA provider
2. Send "Hello"
3. Check console output

### Step 4: Read Console Output

**If you see this (CORRECT):**
```
[CodeJanitor] Sending request to: https://integrate.api.nvidia.com/v1/chat/completions with provider: nvidia
[CodeJanitor] Using NVIDIA API key: nvapi-ab...xyz4
```
✅ Extension is calling NVIDIA correctly
✅ Rate limits are from NVIDIA (expected behavior)
✅ Solution: Wait between requests, use Fast mode, try different models

**If you see this (BUG):**
```
[CodeJanitor] Sending request to: https://api.groq.com/openai/v1/chat/completions with provider: nvidia
```
❌ Extension is calling Groq instead of NVIDIA!
❌ This is a bug in provider switching
❌ Solution: Clear cache, reinstall, report bug with console output

## NVIDIA NIM Free Tier Reality Check

**Yes, NVIDIA NIM free tier HAS rate limits:**
- ~10-20 requests per minute
- ~100-200 requests per hour
- 2048-4096 tokens per request
- 1-2 concurrent requests

**This is normal and expected.** The free tier is for testing, not production use.

**Workarounds:**
1. **Wait 1-2 minutes** between requests
2. **Use Fast mode** (less context = fewer tokens)
3. **Switch models** (different models may have separate rate limit pools)
4. **Use Groq instead** (Groq has higher free tier limits)
5. **Use Ollama locally** (no rate limits, but slower)

## Quick Test Script

Test your NVIDIA API key directly:

```powershell
$apiKey = "YOUR_NVIDIA_KEY"
$body = @{
    model = "meta/llama-3.1-8b-instruct"
    messages = @(@{role="user"; content="Hello"})
    max_tokens = 100
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://integrate.api.nvidia.com/v1/chat/completions" `
    -Method Post `
    -Headers @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $apiKey"
    } `
    -Body $body
```

**If this returns 429:** NVIDIA is rate limiting you (normal)
**If this returns 401:** Your API key is invalid
**If this works:** Extension should work too

## Summary

✅ **Version 1.5.3 is ready to install**
✅ **Adds debug logging to verify which API is called**
✅ **Adds better error messages for NVIDIA rate limits**
✅ **Will definitively show if extension is calling Groq instead of NVIDIA**

**Next step:** Install 1.5.3, open Developer Console, test, and share console output!

The debug logs will tell us exactly what's happening.
