# FETCH Action Fix - Version 1.10.1

## Issue
When users asked about current events/news (e.g., "How's the war with Iran going on?"), the AI would **say** it was going to fetch information but wouldn't actually output the FETCH action:

```
AI: "To get the latest information on the recent developments between India and Pakistan, 
I will fetch the latest news from a reliable source. FETCH: https://www.reuters.com"
```

The AI was **explaining** what it would do instead of **doing** it. The FETCH action wasn't being parsed and executed until the user explicitly asked again.

## Root Cause
The system instructions were telling the AI to use FETCH but weren't explicit enough about:
1. Outputting the FETCH action **immediately** without explanation
2. The exact format and placement of the FETCH action
3. That explanation should come **after** the fetch, not before

## Solution
Made system instructions much more explicit and directive:

### Fast Mode Rules (Before)
```
- You have FULL internet access via FETCH: action. When users ask about current events, 
  news, or time-sensitive topics, ALWAYS use FETCH to get the latest information from 
  reliable news sources (e.g., FETCH: https://www.reuters.com or FETCH: https://www.bbc.com/news). 
  Never say you don't have access to current information.
```

### Fast Mode Rules (After)
```
- You have FULL internet access via FETCH: action. When users ask about current events, 
  news, or time-sensitive topics:
  * IMMEDIATELY output: FETCH: https://www.reuters.com (or other reliable source)
  * Do NOT explain what you will do - just output the FETCH action
  * The content will be fetched and displayed automatically
  * After seeing the fetched content, you can then discuss it
  * Example: User asks "What's happening with Iran?" → You output: FETCH: https://www.reuters.com
```

### Heavy Mode Rules (Before)
```
- You have FULL internet access via FETCH: action. Use it when:
  * User asks about current events, news, politics, wars, conflicts, or any time-sensitive topics
  * User explicitly asks for current/latest information from the web
  * Format: FETCH: https://www.reuters.com or FETCH: https://www.bbc.com/news
  * CRITICAL: When asked about news/current events, ALWAYS fetch from reliable sources.
```

### Heavy Mode Rules (After)
```
- You have FULL internet access via FETCH: action. Use it when:
  * User asks about current events, news, politics, wars, conflicts, or any time-sensitive topics
  * CRITICAL: Output FETCH action IMMEDIATELY, don't explain first
  * Format: FETCH: https://www.reuters.com (on its own line)
  * The fetched content will be displayed to the user automatically
  * After content is fetched, you can discuss and analyze it
  * Example: User: "What's the latest on Iran?" → You: FETCH: https://www.reuters.com
```

### System Hint Injection (Before)
```javascript
resolvedMessage = `${userMessage}\n\n[System hint: Use FETCH: https://www.reuters.com or 
FETCH: https://www.bbc.com/news to get current information]`
```

### System Hint Injection (After)
```javascript
resolvedMessage = `${userMessage}\n\n[CRITICAL SYSTEM INSTRUCTION: You MUST output a FETCH 
action as your FIRST response. Format: FETCH: https://www.reuters.com
Do NOT explain what you will do. Just output the FETCH line immediately. The content will be 
fetched and shown to the user, then you can discuss it.]`
```

## Changes Made

### 1. agent.js - Fast Mode Rules (lines ~1568)
- Changed from "ALWAYS use FETCH" to "IMMEDIATELY output: FETCH:"
- Added explicit "Do NOT explain what you will do"
- Added concrete example showing input → output
- Emphasized that explanation comes AFTER fetch

### 2. agent.js - Heavy Mode Rules (lines ~1600)
- Added "CRITICAL: Output FETCH action IMMEDIATELY, don't explain first"
- Specified format with "on its own line"
- Added example showing direct FETCH output
- Clarified workflow: fetch first, discuss after

### 3. agent.js - System Hint Injection (lines ~1009)
- Changed from "[System hint:]" to "[CRITICAL SYSTEM INSTRUCTION:]"
- Added "You MUST output a FETCH action as your FIRST response"
- Explicitly stated "Do NOT explain what you will do"
- Made it clear: output FETCH immediately, then discuss

## Expected Behavior After Fix

### User Query
```
User: "How's the war with Iran going on?"
```

### AI Response (Correct)
```
FETCH: https://www.reuters.com

[Content is fetched and displayed]

Based on the latest news from Reuters, here's the current situation with Iran...
```

### AI Response (Incorrect - Before Fix)
```
To get the latest information on the recent developments between India and Pakistan, 
I will fetch the latest news from a reliable source. FETCH: https://www.reuters.com

[User has to ask again to actually trigger the fetch]
```

## Testing

Test with these queries:
1. "How's the war with Iran going on?"
2. "What's the latest news about the election?"
3. "Tell me about current events in politics"
4. "What's happening in the Middle East?"

Expected: AI should output `FETCH: https://www.reuters.com` as the FIRST line, then discuss after content is fetched.

## Technical Details

### Why This Happened
LLMs are trained to be conversational and explain their actions. When told to "use FETCH", they naturally want to:
1. Acknowledge the request
2. Explain what they're going to do
3. Then do it

This is helpful in conversation but breaks the action-based system where FETCH needs to be parsed and executed.

### The Fix
Made instructions **prescriptive** rather than **descriptive**:
- Before: "use FETCH to get information" (descriptive)
- After: "output FETCH: URL immediately" (prescriptive)

Added **negative instructions**:
- "Do NOT explain what you will do"
- "Don't explain first"

Added **concrete examples**:
- Showed exact input → output format
- Demonstrated the correct behavior

Made it **critical**:
- Changed from "hint" to "CRITICAL SYSTEM INSTRUCTION"
- Used "MUST" instead of "should"
- Emphasized "IMMEDIATELY" and "FIRST response"

## Files Modified
- `src/ai-agent/agent.js`: Updated system instructions and hint injection
- `package.json`: Version updated to 1.10.1

## Version History
- **1.10.1**: Fixed FETCH action not being output immediately
- **1.10.0**: Added customizable token limits
- **1.9.5**: Added current affairs awareness with FETCH capability
- **1.9.3**: Implemented internet connectivity via FETCH action

## Related Issues
This fix addresses the gap between having FETCH capability (v1.9.3) and making the AI actually use it correctly (v1.10.1).
