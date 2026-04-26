# YouTube API Key - Chat Panel UI Guide

## 🎯 New Feature: API Key Input in Chat Panel

You can now add your YouTube API key **directly in the chat panel** - no need to go to VS Code settings!

---

## 📸 Visual Guide

### Step 1: Open AI Chat
Press `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac)

```
┌─────────────────────────────────────────────────────────┐
│ Code Janitor AI                    🎓 Tutorial  🔊 TTS  │
│ Ollama                             [Provider] [Model]   │
├─────────────────────────────────────────────────────────┤
│ ⚡ Quick Actions ▼                                      │
├─────────────────────────────────────────────────────────┤
│ [🌐 Web ▼] [Search the web...]           [🔍 Search]   │  ← Search bar
├─────────────────────────────────────────────────────────┤
│                                                          │
│                    Chat messages here                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

### Step 2: Select YouTube from Dropdown
Click the dropdown and select **▶️ YouTube**

```
┌─────────────────────────────────────────────────────────┐
│ Code Janitor AI                    🎓 Tutorial  🔊 TTS  │
├─────────────────────────────────────────────────────────┤
│ ⚡ Quick Actions ▼                                      │
├─────────────────────────────────────────────────────────┤
│ [▶️ YouTube ▼] [Search YouTube videos...] [🔍 Search]  │  ← Changed!
│                                                          │
│ YouTube API Key: [Paste your YouTube API key here...]   │  ← NEW!
│                  [Save] [Get key]                        │
│                                                          │
│ Quota: 0/100 searches today                             │  ← Quota display
├─────────────────────────────────────────────────────────┤
│                                                          │
│                    Chat messages here                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**What appears:**
- ✅ Search placeholder changes to "Search YouTube videos..."
- ✅ **YouTube API Key input field** appears (NEW!)
- ✅ Save button
- ✅ "Get key" link (opens Google Cloud Console)
- ✅ Quota status display

---

### Step 3: Paste Your API Key
Paste your YouTube API key in the input field

```
┌─────────────────────────────────────────────────────────┐
│ [🎥 YouTube ▼] [Search YouTube videos...] [🔍 Search]  │
│                                                          │
│ YouTube API Key: [AIzaSyD1234567890abcdefghijk...]      │  ← Pasted!
│                  [Save] [Get key]                        │
│                                                          │
│ Quota: 0/100 searches today                             │
└─────────────────────────────────────────────────────────┘
```

---

### Step 4: Click Save
Click the **Save** button

```
┌─────────────────────────────────────────────────────────┐
│ [🎥 YouTube ▼] [Search YouTube videos...] [🔍 Search]  │
│                                                          │
│ YouTube API Key: ✓ Key saved [Change] [Get key]         │  ← Saved!
│                                                          │
│ Quota: 0/100 searches today                             │
├─────────────────────────────────────────────────────────┤
│ ✅ YouTube API key saved successfully!                   │  ← Confirmation
└─────────────────────────────────────────────────────────┘
```

**What happens:**
- ✅ Input field hides
- ✅ "✓ Key saved" message appears
- ✅ "Change" button appears (to update key later)
- ✅ Confirmation message in chat
- ✅ Ready to search!

---

### Step 5: Start Searching!
Type your query and click Search

```
┌─────────────────────────────────────────────────────────┐
│ [▶️ YouTube ▼] [React hooks tutorial]    [🔍 Search]   │
│                                                          │
│ YouTube API Key: ✓ Key saved [Change] [Get key]         │
│                                                          │
│ Quota: 0/100 searches today                             │
├─────────────────────────────────────────────────────────┤
│ ▶️ YouTube results for "React hooks tutorial":          │
│                                                          │
│ 📺 React Hooks Tutorial for Beginners                   │
│    Channel: Programming with Mosh                       │
│    https://www.youtube.com/watch?v=O6P86uwfdR0          │
│    [Video player embedded here]                         │
│                                                          │
│ 📺 Learn useState in 15 Minutes                         │
│    Channel: Web Dev Simplified                          │
│    https://www.youtube.com/watch?v=O6P86uwfdR0          │
│    [Video player embedded here]                         │
│                                                          │
│ Quota: 1/100 searches today                             │  ← Updated!
└─────────────────────────────────────────────────────────┘
```

---

## 🔄 Changing Your API Key

If you need to update your API key:

1. Select **▶️ YouTube** from dropdown
2. Click **"Change"** button
3. Input field reappears
4. Paste new API key
5. Click **Save**

```
Before:
YouTube API Key: ✓ Key saved [Change] [Get key]

After clicking "Change":
YouTube API Key: [Paste your YouTube API key here...]
                 [Save] [Get key]
```

---

## 🎨 UI States

### State 1: No API Key
```
YouTube API Key: [Paste your YouTube API key here...]
                 [Save] [Get key]
```
- Input field visible
- Save button visible
- "Get key" link visible

### State 2: API Key Saved
```
YouTube API Key: ✓ Key saved [Change] [Get key]
```
- Input field hidden
- Save button hidden
- "✓ Key saved" message visible
- "Change" button visible
- "Get key" link visible

### State 3: Changing Key
```
YouTube API Key: [Paste your YouTube API key here...]
                 [Save] [Get key]
```
- Same as State 1 (input field reappears)

---

## 💡 Benefits of Chat Panel Input

### ✅ Advantages
1. **Faster**: No need to open VS Code settings
2. **Easier**: Everything in one place
3. **Visual**: See quota status immediately
4. **Convenient**: Add key while using the feature
5. **Discoverable**: Users see it when they select YouTube

### 🆚 Comparison

| Method | Steps | Time | Difficulty |
|--------|-------|------|------------|
| **Chat Panel** | 3 steps | 10 seconds | ⭐ Easy |
| VS Code Settings | 5 steps | 30 seconds | ⭐⭐ Medium |
| settings.json | 6 steps | 45 seconds | ⭐⭐⭐ Hard |

**Recommended:** Use chat panel method!

---

## 🔒 Security

- API key stored in VS Code configuration (encrypted)
- Input field uses `type="password"` (hidden characters)
- Key not visible after saving (shows "✓ Key saved")
- Same security as VS Code settings method

---

## 🎯 User Flow

```
1. User opens AI Chat
   ↓
2. Selects 🎥 YouTube
   ↓
3. Sees API key input field
   ↓
4. Clicks "Get key" link (opens Google Cloud)
   ↓
5. Gets API key (5 minutes)
   ↓
6. Returns to chat panel
   ↓
7. Pastes key in input field
   ↓
8. Clicks Save
   ↓
9. Sees "✓ Key saved" confirmation
   ↓
10. Starts searching immediately!
```

**Total time:** ~5 minutes (including getting API key)

---

## 📱 Responsive Design

The API key input row adapts to different screen sizes:

**Wide screen:**
```
YouTube API Key: [________________________] [Save] [Get key]
```

**Medium screen:**
```
YouTube API Key: [__________________] [Save]
                 [Get key]
```

**Narrow screen:**
```
YouTube API Key:
[_____________________]
[Save] [Get key]
```

---

## 🎨 Visual Styling

### Colors
- **Input field**: Dark background (#1e2a3a), light text (#e2e8f0)
- **Save button**: Blue (#1d4ed8), white text
- **"✓ Key saved"**: Green (#22c55e)
- **"Get key" link**: Blue (#3b82f6)
- **"Change" button**: Blue (#3b82f6), underlined

### Fonts
- **Input field**: 11px
- **Buttons**: 11px
- **Status text**: 11px

### Spacing
- **Padding**: 6px vertical, 0px horizontal
- **Gap**: 6px between elements
- **Border radius**: 6px (rounded corners)

---

## 🚀 Quick Start Summary

1. **Open AI Chat**: `Ctrl+Alt+C`
2. **Select YouTube**: Click dropdown → ▶️ YouTube
3. **Paste API key**: In the input field that appears
4. **Click Save**: Done!
5. **Start searching**: Type query → Click Search

**That's it!** No settings, no configuration files, just paste and go! 🎉

---

## 📞 Need Help?

- **Can't find input field?** Make sure you selected ▶️ YouTube from dropdown
- **Save button not working?** Check that you pasted a valid API key
- **Key not saving?** Try restarting VS Code
- **Still stuck?** See [HOW_TO_GET_YOUTUBE_API_KEY.md](HOW_TO_GET_YOUTUBE_API_KEY.md)

---

**Last Updated:** January 2025  
**Feature:** Chat Panel API Key Input  
**Status:** ✅ Available Now
