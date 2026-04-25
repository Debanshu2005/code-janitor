# YouTube Search Integration

Code Janitor now includes full YouTube search integration with automatic quota tracking and user notifications.

## Features

### 1. YouTube Video Search
- Search YouTube directly from the chat panel
- Get top 5 video results with titles, channels, and descriptions
- Videos automatically embed when AI includes YouTube URLs in responses
- Switch between Web search (DuckDuckGo) and YouTube search with dropdown

### 2. Automatic Quota Tracking
- Tracks daily API usage (100 searches/day on free tier)
- Shows real-time quota status: "X/100 searches today"
- Warns when approaching limit (≤10 searches remaining)
- Blocks searches when quota exhausted
- Automatic reset at midnight Pacific Time

### 3. User Notifications
- **Approaching Limit**: Yellow warning when ≤10 searches remain
- **Quota Exhausted**: Red error with hours until reset
- **API Errors**: Clear messages for configuration issues

## Setup Instructions

### Step 1: Get YouTube API Key (Free)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **YouTube Data API v3**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"
4. Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key

### Step 2: Configure in VS Code

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Code Janitor YouTube"
3. Paste your API key in **Code Janitor > YouTube > API Key**

Alternatively, edit `settings.json`:
```json
{
  "codeJanitor.youtube.apiKey": "YOUR_API_KEY_HERE"
}
```

### Step 3: Start Searching

1. Open Code Janitor AI Chat (`Ctrl+Alt+C`)
2. Select **🎥 YouTube** from the search engine dropdown
3. Type your query and click Search
4. Videos will appear with embedded players

## Usage Examples

### Manual Search
1. Select "🎥 YouTube" from dropdown
2. Type: "React hooks tutorial"
3. Click Search
4. Watch videos directly in chat panel

### AI-Powered Search
Ask the AI to search for you:
- "Find YouTube videos about Python async programming"
- "Search YouTube for VS Code extension tutorials"
- "Show me videos on Docker containers"

The AI will automatically use YouTube search and embed results.

### Embedded Playback
When AI responses include YouTube URLs, they automatically embed:
```
Check out this tutorial: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
The video will play inline in the chat panel.

## Quota Management

### Free Tier Limits
- **Daily Quota**: 10,000 units
- **Search Cost**: 100 units per search
- **Effective Limit**: 100 searches per day
- **Reset Time**: Midnight Pacific Time (PST/PDT)

### Quota Tracking
The extension automatically tracks usage:
- Stores daily count in VS Code global state
- Resets counter at midnight PT
- Shows remaining searches in UI
- Blocks searches when exhausted

### Quota Status Display
```
Quota: 45/100 searches today  (Normal - white text)
Quota: 95/100 searches today  (Warning - yellow text)
Quota: 100/100 searches today (Exhausted - red text)
```

### When Quota Exhausted
Error message:
```
⚠️ YouTube API quota exhausted for today. You've used all 100 free searches. 
Quota resets in ~8 hours at midnight Pacific Time. 
Consider upgrading your Google Cloud quota or try again tomorrow.
```

## API Error Handling

### No API Key Configured
```
YouTube API key not configured. Set it in Settings > Code Janitor > YouTube > API Key. 
Get a free key at https://console.cloud.google.com/apis/credentials
```

### Quota Exceeded (Google API Error)
```
YouTube API quota exceeded for today. The free tier allows 10,000 queries per day. 
Quota resets at midnight Pacific Time.
```

### Network Errors
```
Failed to search YouTube: Network request failed
```

## Technical Details

### Implementation Files
- **chat-panel.js**: Backend search handler with quota tracking
  - `_searchYouTube()`: Calls YouTube Data API v3
  - `_getYouTubeQuotaStatus()`: Checks daily usage
  - `_checkYouTubeQuota()`: Validates before search
  - `_incrementYouTubeQuota()`: Updates usage counter
  - `_getQuotaResetTime()`: Calculates midnight PT

- **chat-panel.html**: Frontend UI with search selector
  - Search engine dropdown (Web/YouTube)
  - Quota status display
  - YouTube embed detection and rendering
  - Real-time quota updates

- **package.json**: Configuration schema
  - `codeJanitor.youtube.apiKey`: API key setting

### Quota Storage
- **Key Format**: `codeJanitor.youtube.quota.YYYY-MM-DD`
- **Storage**: VS Code `globalState` (persists across sessions)
- **Reset Logic**: New date = new counter
- **Example**: `codeJanitor.youtube.quota.2025-01-15` → 45

### API Endpoint
```
https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &maxResults=5
  &q=QUERY
  &type=video
  &key=API_KEY
```

### Response Format
```javascript
{
  videos: [
    {
      videoId: "dQw4w9WgXcQ",
      title: "Video Title",
      channel: "Channel Name",
      description: "Video description...",
      thumbnail: "https://i.ytimg.com/vi/..."
    }
  ]
}
```

## Upgrading Quota

If you need more than 100 searches/day:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" > "Quotas"
3. Find "YouTube Data API v3"
4. Request quota increase (requires billing account)
5. Paid tier: $0.20 per 10,000 units

## Troubleshooting

### "API key not configured"
- Check Settings > Code Janitor > YouTube > API Key
- Ensure key is pasted correctly (no extra spaces)
- Restart VS Code after setting key

### "Quota exceeded" but counter shows <100
- Google's quota is 10,000 units, not searches
- Each search costs 100 units = 100 searches max
- Check [Google Cloud Console](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas) for actual usage

### Videos not embedding
- Ensure YouTube URLs are in format: `https://www.youtube.com/watch?v=VIDEO_ID`
- Supported formats: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/embed/`
- Check browser console for iframe errors

### Quota not resetting
- Quota resets at midnight Pacific Time (not local time)
- Wait until next day (PT timezone)
- Check date in quota key: `codeJanitor.youtube.quota.YYYY-MM-DD`

## Privacy & Security

- API key stored in VS Code settings (encrypted by VS Code)
- No data sent to Code Janitor servers
- Direct communication with YouTube API
- Quota tracking stored locally in VS Code global state
- No personal data collected

## Comparison: Web Search vs YouTube Search

| Feature | Web Search (DuckDuckGo) | YouTube Search |
|---------|------------------------|----------------|
| API Key | Not required | Required (free) |
| Daily Limit | Unlimited | 100 searches |
| Cost | Free | Free (10k units/day) |
| Results | Text summaries + links | Video embeds |
| Quota Tracking | No | Yes (automatic) |
| Best For | General info, docs | Tutorials, demos |

## Future Enhancements

Potential improvements:
- Video duration and view count in results
- Playlist search support
- Channel search
- Video transcript extraction
- Thumbnail preview in search results
- Custom quota limits per user
- Multiple API key rotation

## Support

For issues or questions:
- GitHub: https://github.com/Debanshu2005/code-janitor/issues
- Website: https://code-janitor-web.vercel.app/

## License

MIT License - Same as Code Janitor extension
