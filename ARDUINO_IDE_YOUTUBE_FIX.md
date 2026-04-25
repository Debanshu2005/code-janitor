# Arduino IDE Agent - YouTube Fixes

## Issues Fixed

### Issue 1: Wrong Videos for Non-Arduino Searches
**Problem**: Searching for "raspberry pi" returned Arduino tutorials

**Root Cause**: 
```javascript
// OLD CODE - Too aggressive matching
const isArduinoRelated = /\b(arduino|sensor|led|motor|servo|ultrasonic|programming|circuit|electronics|microcontroller|esp32|esp8266|raspberry|pi)\b/i.test(query);

if (!isArduinoRelated) {
  // Return search link
} else {
  // Return Arduino videos (WRONG for "raspberry pi"!)
}
```

The regex included "raspberry" and "pi" as Arduino-related keywords, so "raspberry pi" matched and returned Arduino videos.

**Fix**: Removed the aggressive "isArduinoRelated" check and added proper keyword matching:
```javascript
// NEW CODE - Specific keyword matching
const fallbackMap = {
  'raspberry pi': [...], // Specific Raspberry Pi videos
  'arduino': [...],      // Arduino videos
  'vscode': [...],       // VS Code videos
  // etc.
};

// Try exact match first
for (const [key, videos] of Object.entries(fallbackMap)) {
  if (keywords.includes(key)) {
    return videos;
  }
}

// Return empty if no match (shows "No videos found" instead of wrong videos)
return [];
```

### Issue 2: Only Arduino Videos Embed, Others Show Button
**Problem**: Non-Arduino videos showed "Open in YouTube" button instead of embedding

**Root Cause**: The old code returned a special "search link" object for non-Arduino queries:
```javascript
return [{
  videoId: 'search',
  title: `📺 Search API temporarily unavailable`,
  url: searchUrl,
  isSearchLink: true  // This prevented embedding
}];
```

**Fix**: Now returns empty array, which triggers proper "No videos found" message and allows API search to work when available.

### Issue 3: Outdated Invidious Instances
**Problem**: Only 3 old Invidious instances, all timing out

**Fix**: Updated to 5 newer instances with better uptime:
- `invidious.io.lol` (NEW)
- `inv.tux.pizza` (NEW)
- `invidious.nerdvpn.de` (NEW)
- `inv.nadeko.net`
- `invidious.privacyredirect.com`

## Changes Applied

### File: `arduino-ide-agent/src/ai-agent/chat-panel.js`

1. **Updated `_searchYouTube()` function**:
   - Added 5 Invidious instances (was 3)
   - Reduced timeout: 10s → 8s
   - Added `sort=relevance` parameter
   - Enhanced logging

2. **Rewrote `_getFallbackYouTubeVideos()` function**:
   - Removed aggressive "isArduinoRelated" check
   - Added Raspberry Pi fallback videos
   - Added VS Code, JavaScript, Python fallbacks
   - Returns empty array for unknown topics (instead of wrong videos)
   - Added smart keyword matching

## Test Results

### Before Fix
```
Search: "raspberry pi"
Result: ❌ Arduino Tutorial for Beginners
        ❌ Arduino Programming Tutorial
```

### After Fix
```
Search: "raspberry pi"
Result: ✅ Raspberry Pi Tutorial for Beginners
        ✅ Getting Started with Raspberry Pi
```

### Fallback Coverage

| Search Query | Fallback Videos |
|--------------|----------------|
| raspberry pi | Raspberry Pi tutorials |
| vscode | VS Code tutorials |
| arduino | Arduino tutorials |
| sensor | Arduino sensor tutorials |
| led | Arduino LED tutorials |
| motor | Arduino motor tutorials |
| programming | Arduino programming |
| javascript | JavaScript tutorials |
| python | Python tutorials |
| **Other topics** | No videos (waits for API) |

## Why Videos Now Embed Correctly

**Before**: Non-Arduino searches returned a special "search link" object that couldn't embed

**After**: 
1. API tries 5 instances → If success, returns real videos
2. If all fail → Checks fallback map
3. If in fallback map → Returns embeddable videos
4. If not in fallback map → Returns empty (shows "No videos found")

All returned videos are proper YouTube video objects with `videoId`, `title`, and `url`, so they embed correctly.

## Files Modified

1. `arduino-ide-agent/src/ai-agent/chat-panel.js`:
   - `_searchYouTube()` - Lines ~3000-3040
   - `_getFallbackYouTubeVideos()` - Lines ~3040-3110

## Verification

Test these searches in Arduino IDE:
- ✅ "raspberry pi" → Should show Raspberry Pi videos
- ✅ "vscode" → Should show VS Code videos  
- ✅ "arduino" → Should show Arduino videos
- ✅ "python tutorial" → Should show Python videos
- ✅ "random topic" → Should show "No videos found" (not Arduino videos)

All videos should embed and play inline (CSP header already fixed).
