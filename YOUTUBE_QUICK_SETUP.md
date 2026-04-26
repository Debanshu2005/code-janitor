# YouTube Search - Quick Setup Guide

## 🎥 Search YouTube from VS Code!

Code Janitor now lets you search YouTube and watch videos directly in the AI chat panel.

## ⚡ Quick Setup (2 minutes)

### Step 1: Get Free API Key
1. Go to https://console.cloud.google.com/
2. Create a project (or use existing)
3. Enable "YouTube Data API v3"
4. Create API Key (Credentials → Create Credentials → API Key)
5. Copy the key

### Step 2: Add to Code Janitor
**Method 1: Chat Panel (Easiest)**
1. Open AI Chat (`Ctrl+Alt+C`)
2. Select **▶️ YouTube** from dropdown
3. Paste API key in the input field
4. Click **Save**
5. Done! ✅

**Method 2: VS Code Settings**
1. Open Settings (`Ctrl+,`)
2. Search: "Code Janitor YouTube"
3. Paste your API key
4. Done! ✅

## 🚀 How to Use

### Manual Search
1. Open AI Chat (`Ctrl+Alt+C`)
2. Select **▶️ YouTube** from dropdown
3. Type your query
4. Click Search
5. Watch videos in chat!

### AI Search
Just ask:
- "Find YouTube videos about React hooks"
- "Search YouTube for Python tutorials"
- "Show me Docker videos"

AI will search and embed results automatically!

## 📊 Free Tier Limits

- **100 searches per day** (free)
- Quota resets at midnight Pacific Time
- Extension shows: "X/100 searches today"
- Warns when approaching limit
- Blocks when exhausted

## ⚠️ Quota Warnings

```
Quota: 45/100 searches today  ✅ Normal
Quota: 95/100 searches today  ⚠️ Warning (yellow)
Quota: 100/100 searches today ❌ Exhausted (red)
```

When exhausted:
```
⚠️ YouTube API quota exhausted for today. 
Quota resets in ~8 hours at midnight Pacific Time.
Try again tomorrow or upgrade your Google Cloud quota.
```

## 🎬 Video Embedding

Videos automatically embed when AI includes YouTube URLs:
```
Check this out: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
→ Video plays inline in chat!

Supported formats:
- `youtube.com/watch?v=VIDEO_ID`
- `youtu.be/VIDEO_ID`
- `youtube.com/embed/VIDEO_ID`

## 🔧 Troubleshooting

### "API key not configured"
→ **Easiest fix:** Open AI Chat (`Ctrl+Alt+C`), select ▶️ YouTube, paste key in input field, click Save  
→ **Alternative:** Add key in Settings > Code Janitor > YouTube > API Key

### "Quota exceeded"
→ Wait until midnight Pacific Time for reset
→ Or upgrade quota at console.cloud.google.com

### Videos not playing
→ Check internet connection
→ Ensure YouTube URLs are valid
→ Try refreshing chat panel

## 💡 Pro Tips

1. **Save Quota**: Use Web search for general info, YouTube for tutorials
2. **Ask AI**: Let AI search for you to save time
3. **Embed URLs**: Paste YouTube links in chat for instant playback
4. **Check Quota**: Dropdown shows remaining searches
5. **Plan Ahead**: 100 searches = ~10 per hour for 10-hour workday

## 📚 Full Documentation

For detailed info, see:
- `YOUTUBE_INTEGRATION.md` - Complete guide
- `YOUTUBE_IMPLEMENTATION_SUMMARY.md` - Technical details

## 🆓 Cost

- **API Key**: Free
- **Daily Quota**: 10,000 units (100 searches)
- **Upgrade**: $0.20 per 10,000 units (optional)

## 🔒 Privacy

- API key stored securely in VS Code
- No data sent to Code Janitor servers
- Direct communication with YouTube
- No tracking or cookies

## ✨ Example Queries

Try these:
- "React hooks tutorial"
- "Python async programming"
- "Docker containers explained"
- "VS Code extensions guide"
- "Git workflow tutorial"
- "JavaScript promises"

## 🎯 Use Cases

Perfect for:
- Learning new technologies
- Finding coding tutorials
- Watching conference talks
- Debugging with video guides
- Exploring frameworks
- Following along with demos

## 🚀 Get Started Now!

1. Get API key: https://console.cloud.google.com/
2. Add to VS Code Settings
3. Open AI Chat (`Ctrl+Alt+C`)
4. Select 🎥 YouTube
5. Start searching!

---

**Questions?** Open an issue at https://github.com/Debanshu2005/code-janitor/issues

**Website:** https://code-janitor-web.vercel.app/
