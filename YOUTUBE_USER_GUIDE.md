# YouTube Search - User Guide

## Quick Start (No Setup Required!)

### How to Search YouTube

1. **Open AI Chat Panel**
   - Press `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac)
   - Or: Command Palette → "Code Janitor: Open AI Chat"

2. **Select YouTube Search**
   - Find the search bar below the Quick Actions
   - Click the dropdown that says "🌐 Web"
   - Select "▶️ YouTube"

3. **Search for Videos**
   - Type your search query (e.g., "python tutorial")
   - Press Enter or click "🔍 Search"
   - Wait 2-3 seconds for results

4. **Watch Videos**
   - Results appear with clickable YouTube links
   - Click any link to embed the video in chat
   - Video plays directly in the chat panel (16:9 responsive player)

## Example Searches

### Programming Tutorials
```
python tutorial for beginners
javascript async await explained
react hooks tutorial
```

### Code Reviews
```
clean code principles
code review best practices
refactoring techniques
```

### Tech Talks
```
google io 2024
aws reinvent keynote
github universe
```

### Debugging Help
```
how to debug python
chrome devtools tutorial
git merge conflicts
```

## Features

### ✅ What Works
- **Unlimited Searches**: Search as much as you want
- **No API Key**: Works immediately, no setup
- **Video Embedding**: Videos play directly in chat
- **Responsive Player**: 16:9 aspect ratio, scales to fit
- **Multiple Videos**: Embed multiple videos in one chat
- **Clickable Links**: All YouTube URLs auto-embed

### ⚠️ Limitations
- **Fewer Results**: Typically 3-5 videos per search (vs 10+ with API)
- **No Metadata**: No view counts, likes, or upload dates in search results
- **Search Quality**: Depends on DuckDuckGo's YouTube indexing
- **No Channels**: Channel information not shown in results

## Tips & Tricks

### Better Search Results
1. **Be Specific**: "python pandas dataframe tutorial" > "python tutorial"
2. **Use Keywords**: Include "tutorial", "explained", "guide", "how to"
3. **Add Year**: "react 2024 tutorial" for recent content
4. **Try Variations**: If no results, rephrase your query

### Embedding Videos
- **Any YouTube URL**: Paste any YouTube link in chat to embed it
- **Multiple Formats**: Works with youtube.com/watch?v=, youtu.be/, youtube.com/embed/
- **Manual Embedding**: Copy URL from browser, paste in chat

### Keyboard Shortcuts
- **Enter**: Send search query
- **Escape**: Close search results
- **Ctrl+C**: Copy video URL
- **Ctrl+V**: Paste and auto-embed video

## Troubleshooting

### No Results Found
**Problem**: Search returns "No videos found"

**Solutions**:
1. Try different search terms
2. Check spelling
3. Use more general keywords
4. Try searching on YouTube.com directly to verify content exists

### Videos Not Embedding
**Problem**: YouTube links don't auto-embed

**Solutions**:
1. Ensure URL is complete (starts with https://)
2. Check URL format (should contain youtube.com or youtu.be)
3. Try copying URL from YouTube directly
4. Refresh chat panel (Ctrl+Alt+C to close/reopen)

### Search Not Working
**Problem**: Search button does nothing or shows error

**Solutions**:
1. Check internet connection
2. Verify DuckDuckGo is accessible (visit duckduckgo.com)
3. Try web search first to test connectivity
4. Restart VS Code
5. Check VS Code Developer Tools (Help → Toggle Developer Tools) for errors

### Slow Search
**Problem**: Search takes >10 seconds

**Solutions**:
1. Check internet speed
2. Try again (DuckDuckGo may be slow temporarily)
3. Use web search instead
4. Search directly on YouTube.com

## Comparison with Web Search

| Feature | Web Search (🌐) | YouTube Search (▶️) |
|---------|----------------|-------------------|
| **Results** | Text summaries + links | Video links only |
| **Embedding** | No | Yes (auto-embed) |
| **Speed** | Fast (1-2 sec) | Medium (2-3 sec) |
| **Content** | Articles, docs, forums | Videos only |
| **Best For** | Documentation, articles | Tutorials, talks |

## Privacy & Data

### What's Sent
- Your search query is sent to DuckDuckGo
- No personal information is sent
- No tracking or analytics

### What's Stored
- Nothing is stored locally
- No search history saved
- No API keys or credentials

### DuckDuckGo Privacy
- DuckDuckGo doesn't track users
- No search history stored
- No personal data collected
- Learn more: https://duckduckgo.com/privacy

## FAQ

### Q: Do I need a YouTube account?
**A**: No, you can search and watch videos without any account.

### Q: Can I download videos?
**A**: No, videos play in the embedded player only. Use youtube-dl or similar tools for downloads.

### Q: Can I search YouTube channels?
**A**: No, only video search is supported. Search for channel name + "channel" to find their videos.

### Q: Can I search playlists?
**A**: No, playlist search is not supported. Search for playlist name to find videos from it.

### Q: Why fewer results than YouTube.com?
**A**: DuckDuckGo returns fewer results than YouTube's official API. This is a trade-off for not requiring API keys.

### Q: Can I use YouTube API instead?
**A**: Not currently. The extension uses DuckDuckGo exclusively to avoid API key requirements.

### Q: Is there a search limit?
**A**: No daily limit, but DuckDuckGo may rate limit excessive requests (100+ searches/minute).

### Q: Can I search in other languages?
**A**: Yes, search in any language. Results depend on DuckDuckGo's indexing.

## Examples

### Example 1: Learning Python
```
Search: "python tutorial for beginners"

Results:
📺 Python Tutorial - Full Course for Beginners
   https://www.youtube.com/watch?v=_uQrJ0TkZlc

📺 Learn Python - Full Course for Beginners
   https://www.youtube.com/watch?v=rfscVS0vtbw

💡 Click any video link above to watch it embedded in the chat!
```

### Example 2: Debugging JavaScript
```
Search: "javascript debugging chrome devtools"

Results:
📺 Chrome DevTools Tutorial - Debug JavaScript
   https://www.youtube.com/watch?v=H0XScE08hy8

📺 JavaScript Debugging Tips and Tricks
   https://www.youtube.com/watch?v=AX7uybwukkk

💡 Click any video link above to watch it embedded in the chat!
```

### Example 3: Watching Embedded Video
```
[User clicks video link]

[Video player appears in chat]
┌─────────────────────────────────────┐
│                                     │
│     [YouTube Video Player]          │
│     Playing: Python Tutorial        │
│                                     │
│     [▶️ Play] [⏸️ Pause] [🔊 Volume] │
│                                     │
└─────────────────────────────────────┘
```

## Support

### Get Help
- **GitHub Issues**: https://github.com/Debanshu2005/code-janitor/issues
- **Documentation**: https://code-janitor-web.vercel.app/
- **VS Code Marketplace**: Search "Code Janitor"

### Report Bugs
If YouTube search isn't working:
1. Check internet connection
2. Try web search to verify connectivity
3. Check VS Code Developer Tools for errors
4. Report issue on GitHub with:
   - Search query used
   - Error message (if any)
   - VS Code version
   - Operating system

---

**Last Updated**: January 2025  
**Version**: 1.11.9+  
**Status**: ✅ Active Feature
