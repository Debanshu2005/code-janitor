# Google Search & YouTube Video Integration

## Current State
The chat panel already has web search functionality using DuckDuckGo API. The search bar is located below the action buttons.

## Proposed Enhancements

### 1. Add Google Search Option

**Implementation:**
- Add a dropdown next to the search button to select search engine (DuckDuckGo or Google)
- For Google search, use Google Custom Search JSON API
- Requires Google API key (free tier: 100 searches/day)

**Steps:**
1. Add search engine selector dropdown in HTML
2. Add Google API key configuration in VS Code settings
3. Implement Google Custom Search API integration in chat-panel.js
4. Display results with thumbnails, snippets, and links

### 2. YouTube Video Embedding

**Implementation:**
- Detect YouTube URLs in AI responses or user messages
- Automatically embed YouTube videos as iframes in the chat
- Add controls for play/pause, volume

**Features:**
- Auto-detect YouTube links: `https://youtube.com/watch?v=...` or `https://youtu.be/...`
- Embed videos directly in chat bubbles
- Responsive video player with controls
- Option to open in new tab

## Code Changes Required

### A. HTML Changes (chat-panel.html)

```html
<!-- Update search bar section -->
<div id="search-bar">
  <div id="search-row">
    <select id="search-engine-select" title="Search Engine">
      <option value="duckduckgo">🦆 DuckDuckGo</option>
      <option value="google">🔍 Google</option>
    </select>
    <input id="search-input" type="text" placeholder="🌐 Search the web..." />
    <button id="search-btn">🔍 Search</button>
  </div>
</div>

<!-- Add YouTube video styles -->
<style>
.youtube-embed {
  margin: 12px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #000;
}

.youtube-embed iframe {
  width: 100%;
  height: 315px;
  border: none;
  display: block;
}

.youtube-embed-header {
  padding: 8px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.youtube-embed-title {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.youtube-open-btn {
  padding: 4px 8px;
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
  text-decoration: none;
}
</style>
```

### B. JavaScript Changes (chat-panel.html script section)

```javascript
// Add after search functionality

// YouTube video detection and embedding
function detectAndEmbedYouTube(text) {
  var youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
  var match;
  var videos = [];
  
  while ((match = youtubeRegex.exec(text)) !== null) {
    videos.push({
      videoId: match[1],
      url: match[0]
    });
  }
  
  return videos;
}

function createYouTubeEmbed(videoId, url) {
  var wrap = document.createElement('div');
  wrap.className = 'youtube-embed';
  
  var header = document.createElement('div');
  header.className = 'youtube-embed-header';
  
  var title = document.createElement('div');
  title.className = 'youtube-embed-title';
  title.innerHTML = '▶️ YouTube Video';
  
  var openBtn = document.createElement('a');
  openBtn.className = 'youtube-open-btn';
  openBtn.textContent = 'Open in YouTube';
  openBtn.href = url;
  openBtn.target = '_blank';
  
  header.appendChild(title);
  header.appendChild(openBtn);
  
  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/' + videoId;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  
  wrap.appendChild(header);
  wrap.appendChild(iframe);
  
  return wrap;
}

// Update renderContent function to detect YouTube links
function renderContentWithYouTube(text) {
  var container = document.createElement('div');
  var videos = detectAndEmbedYouTube(text);
  
  // If videos found, embed them
  if (videos.length > 0) {
    videos.forEach(function(video) {
      container.appendChild(createYouTubeEmbed(video.videoId, video.url));
    });
  }
  
  // Render rest of content normally
  container.appendChild(renderContent(text));
  
  return container;
}

// Google Search implementation
var searchEngine = 'duckduckgo';
var searchEngineSelect = document.getElementById('search-engine-select');

if (searchEngineSelect) {
  searchEngineSelect.onchange = function() {
    searchEngine = searchEngineSelect.value;
    if (searchEngine === 'google') {
      // Check if Google API key is configured
      vscode.postMessage({ type: 'checkGoogleApiKey' });
    }
  };
}

function performGoogleSearch(query) {
  // Send to extension to use Google Custom Search API
  vscode.postMessage({ 
    type: 'googleSearch', 
    query: query 
  });
}

// Update performWebSearch function
function performWebSearch() {
  var query = searchInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  addActivity('Searching ' + searchEngine + ' for: ' + query, 'scan');
  showProgress('Searching the web...', 30);

  if (searchEngine === 'google') {
    performGoogleSearch(query);
  } else {
    // Existing DuckDuckGo search
    vscode.postMessage({ type: 'webSearch', query: query });
  }
  
  searchInput.value = '';
}
```

### C. Backend Changes (chat-panel.js)

```javascript
// Add Google Custom Search API integration

async _performGoogleSearch(query) {
  const apiKey = vscode.workspace.getConfiguration('codeJanitor').get('googleApiKey', '');
  const searchEngineId = vscode.workspace.getConfiguration('codeJanitor').get('googleSearchEngineId', '');
  
  if (!apiKey || !searchEngineId) {
    this.panel.webview.postMessage({
      type: 'error',
      text: 'Google Search requires API key and Search Engine ID. Configure in settings: codeJanitor.googleApiKey and codeJanitor.googleSearchEngineId'
    });
    this.panel.webview.postMessage({ type: 'searchError', error: 'Missing API credentials' });
    return;
  }
  
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000)
    });
    
    if (!response.ok) {
      throw new Error(`Google Search API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    let resultText = `🔍 Google Search results for "${query}":\n\n`;
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items.slice(0, 5)) {
        resultText += `📌 ${item.title}\n`;
        resultText += `${item.snippet}\n`;
        resultText += `🔗 ${item.link}\n\n`;
      }
    } else {
      resultText += `No results found. Try a different query.`;
    }
    
    this.panel.webview.postMessage({ type: 'stream', text: resultText });
    this.panel.webview.postMessage({ type: 'done' });
    this.panel.webview.postMessage({ type: 'searchComplete' });
    
  } catch (error) {
    console.error('[ChatPanel] Google search error:', error);
    this.panel.webview.postMessage({ 
      type: 'error', 
      text: `Google Search failed: ${error.message}` 
    });
    this.panel.webview.postMessage({ type: 'searchError', error: error.message });
  }
}

// Add message handler for Google search
if (message.type === 'googleSearch') {
  await this._performGoogleSearch(message.query);
}

if (message.type === 'checkGoogleApiKey') {
  const apiKey = vscode.workspace.getConfiguration('codeJanitor').get('googleApiKey', '');
  if (!apiKey) {
    this.panel.webview.postMessage({
      type: 'status',
      text: '⚠️ Google Search requires an API key. Get one at: https://developers.google.com/custom-search/v1/overview'
    });
  }
}
```

### D. Configuration (package.json)

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "codeJanitor.googleApiKey": {
          "type": "string",
          "default": "",
          "description": "Google Custom Search API key for web search (get from https://developers.google.com/custom-search/v1/overview)"
        },
        "codeJanitor.googleSearchEngineId": {
          "type": "string",
          "default": "",
          "description": "Google Custom Search Engine ID (create at https://programmablesearchengine.google.com/)"
        }
      }
    }
  }
}
```

## Setup Instructions for Users

### Google Custom Search API Setup:

1. **Get API Key:**
   - Go to https://console.cloud.google.com/
   - Create a new project or select existing
   - Enable "Custom Search API"
   - Go to Credentials → Create Credentials → API Key
   - Copy the API key

2. **Create Search Engine:**
   - Go to https://programmablesearchengine.google.com/
   - Click "Add" to create new search engine
   - Set "Search the entire web" option
   - Copy the Search Engine ID (cx parameter)

3. **Configure in VS Code:**
   - Open Settings (Ctrl+,)
   - Search for "Code Janitor"
   - Set `codeJanitor.googleApiKey`
   - Set `codeJanitor.googleSearchEngineId`

### YouTube Embedding:

- No setup required
- Just paste YouTube URLs in chat or AI will include them in responses
- Videos will automatically embed with player controls

## Benefits

1. **Google Search:**
   - More comprehensive search results
   - Better ranking algorithm
   - Rich snippets and metadata
   - Image and video search support

2. **YouTube Integration:**
   - Watch tutorials without leaving VS Code
   - AI can recommend and embed relevant coding tutorials
   - Quick reference for video documentation
   - Seamless learning experience

## Limitations

- Google Custom Search API: 100 free searches/day
- YouTube embeds require internet connection
- Webview security restrictions apply (CSP)

## Alternative: Simple Implementation

If you want a simpler implementation without Google API:

1. Keep DuckDuckGo for web search (already working)
2. Add YouTube embedding only (no API required)
3. Use Google search by opening links in external browser

This avoids API key management while still providing YouTube video playback in the webview.
