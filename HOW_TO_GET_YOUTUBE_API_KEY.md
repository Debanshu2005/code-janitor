# How to Get YouTube API Key (Step-by-Step)

## 📋 Prerequisites
- Google account (Gmail)
- 5 minutes of time
- No credit card required for free tier

---

## 🎯 Step-by-Step Instructions

### Step 1: Go to Google Cloud Console
1. Open your browser
2. Go to: **https://console.cloud.google.com/**
3. Sign in with your Google account

---

### Step 2: Create a New Project (or Select Existing)

#### Option A: Create New Project
1. Click the **project dropdown** at the top (next to "Google Cloud")
2. Click **"NEW PROJECT"** button (top right)
3. Enter project details:
   - **Project name**: `Code Janitor YouTube` (or any name)
   - **Organization**: Leave as "No organization" (default)
4. Click **"CREATE"**
5. Wait 10-20 seconds for project creation
6. You'll see a notification when ready

#### Option B: Use Existing Project
1. Click the **project dropdown** at the top
2. Select your existing project from the list

---

### Step 3: Enable YouTube Data API v3

1. In the left sidebar, click **"APIs & Services"**
2. Click **"Library"** (or go to: https://console.cloud.google.com/apis/library)
3. In the search bar, type: **"YouTube Data API v3"**
4. Click on **"YouTube Data API v3"** from results
5. Click the blue **"ENABLE"** button
6. Wait 5-10 seconds for activation
7. You'll see "API enabled" confirmation

**Important:** Make sure you enable "YouTube Data API v3" (not YouTube Analytics or other YouTube APIs)

---

### Step 4: Create API Credentials

1. After enabling the API, you'll see the API dashboard
2. Click **"CREATE CREDENTIALS"** button (top right)
3. You'll see "Which API are you using?" screen

#### Fill in the form:
- **Which API are you using?**: Select **"YouTube Data API v3"**
- **What data will you be accessing?**: Select **"Public data"**
- Click **"NEXT"**

#### Or use the direct method:
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"API key"** from dropdown

---

### Step 5: Copy Your API Key

1. A popup will appear with your API key
2. **Copy the API key** (it looks like: `AIzaSyD1234567890abcdefghijklmnopqrst`)
3. Click **"CLOSE"** or **"DONE"**

**Important:** Save this key somewhere safe! You'll need it for VS Code.

---

### Step 6: (Optional) Restrict API Key for Security

For better security, restrict your API key:

1. Go to: https://console.cloud.google.com/apis/credentials
2. Find your API key in the list
3. Click the **pencil icon** (Edit) next to it
4. Under **"API restrictions"**:
   - Select **"Restrict key"**
   - Check **"YouTube Data API v3"**
5. Under **"Application restrictions"** (optional):
   - Select **"HTTP referrers (web sites)"**
   - Add: `vscode-webview://*`
6. Click **"SAVE"**

**Note:** Restrictions are optional but recommended for production use.

---

### Step 7: Add API Key to Code Janitor Chat Panel

**Method 1: Direct in Chat Panel (Easiest)**
1. Open **Code Janitor AI Chat**: `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac)
2. Select **"▶️ YouTube"** from the search engine dropdown
3. You'll see a **YouTube API Key** input field appear
4. Paste your API key in the field
5. Click **"Save"** button
6. You'll see "✓ Key saved" confirmation
7. Done! Start searching immediately

**Method 2: VS Code Settings (Alternative)**
1. Open **Visual Studio Code**
2. Press `Ctrl+,` (Windows/Linux) or `Cmd+,` (Mac) to open Settings
3. In the search bar, type: **"Code Janitor YouTube"**
4. Find **"Code Janitor > Youtube > Api Key"**
5. Paste your API key in the text field
6. Close settings (auto-saves)

**Method 3: settings.json (Advanced)**
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type: **"Preferences: Open Settings (JSON)"**
3. Add this line:
```json
{
  "codeJanitor.youtube.apiKey": "YOUR_API_KEY_HERE"
}
```
4. Save the file

**Recommended:** Use Method 1 (chat panel) - it's the fastest and easiest!

---

### Step 8: Test Your Setup

1. Open Code Janitor AI Chat: `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac)
2. Select **"🎥 YouTube"** from the search dropdown
3. Type a test query: **"React tutorial"**
4. Click **"🔍 Search"**
5. You should see 5 video results!

**If it works:** ✅ You're all set!

**If you see an error:** See troubleshooting below ⬇️

---

## 🔍 Troubleshooting

### Error: "YouTube API key not configured"
**Solution:** 
- **Easiest:** Open AI Chat (`Ctrl+Alt+C`), select ▶️ YouTube, paste key in the input field, click Save
- **Alternative:** Add key in VS Code Settings > Code Janitor > YouTube > API Key
- Check for extra spaces before/after the key
- Restart VS Code if using settings method

### Error: "API key not valid"
**Solution:**
- Go back to Google Cloud Console
- Check if YouTube Data API v3 is enabled
- Create a new API key if needed
- Make sure you copied the entire key

### Error: "YouTube Data API has not been used in project"
**Solution:**
- Go to: https://console.cloud.google.com/apis/library
- Search for "YouTube Data API v3"
- Click "ENABLE" button
- Wait 30 seconds and try again

### Error: "Quota exceeded"
**Solution:**
- You've used all 100 free searches today
- Wait until midnight Pacific Time for reset
- Or upgrade quota at console.cloud.google.com

### Error: "Access Not Configured"
**Solution:**
- Make sure you're using the correct project
- Check that YouTube Data API v3 is enabled (not disabled)
- Try creating a new API key

---

## 📊 Understanding Your Quota

### Free Tier Limits
- **Daily Quota**: 10,000 units
- **Search Cost**: 100 units per search
- **Effective Limit**: 100 searches per day
- **Reset Time**: Midnight Pacific Time (PST/PDT)

### Checking Your Usage
1. Go to: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas
2. Select your project
3. View "Queries per day" usage

### Upgrading Quota (Optional)
If you need more than 100 searches/day:
1. Go to: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas
2. Click "EDIT QUOTAS"
3. Request quota increase
4. **Note:** Requires billing account (credit card)
5. Cost: $0.20 per 10,000 units

---

## 🔒 Security Best Practices

### ✅ DO:
- Restrict API key to YouTube Data API v3 only
- Keep your API key private (don't share publicly)
- Use application restrictions if possible
- Monitor usage in Google Cloud Console
- Regenerate key if compromised

### ❌ DON'T:
- Share your API key in public repositories
- Commit API key to Git (use .gitignore)
- Use the same key for multiple applications
- Leave API key unrestricted in production

---

## 📸 Visual Guide Summary

Here's what you'll see at each step:

1. **Google Cloud Console Homepage**
   - Blue header with "Google Cloud" logo
   - Project dropdown at top
   - Left sidebar with navigation

2. **Create Project Screen**
   - "New Project" form
   - Project name field
   - Organization dropdown
   - CREATE button

3. **API Library**
   - Search bar at top
   - Grid of API cards
   - "YouTube Data API v3" card with YouTube logo

4. **API Details Page**
   - Blue "ENABLE" button
   - API description
   - Documentation links

5. **Credentials Page**
   - "+ CREATE CREDENTIALS" button
   - List of existing credentials
   - API key shown in table

6. **API Key Popup**
   - "API key created" message
   - Long string of characters (your key)
   - COPY button
   - CLOSE button

7. **VS Code Settings**
   - Search bar with "Code Janitor YouTube"
   - Text field for API key
   - Auto-save indicator

---

## 🎥 Video Tutorial (Coming Soon)

We're creating a video tutorial showing each step. Check:
- Website: https://code-janitor-web.vercel.app/
- YouTube: Search "Code Janitor YouTube API Setup"

---

## 💡 Quick Tips

1. **Bookmark this page**: https://console.cloud.google.com/apis/credentials
2. **Save your API key** in a password manager
3. **Test immediately** after setup to confirm it works
4. **Check quota daily** if you're a heavy user
5. **Set up billing alerts** in Google Cloud (optional)

---

## 📞 Need Help?

### Official Resources
- **Google Cloud Support**: https://cloud.google.com/support
- **YouTube API Docs**: https://developers.google.com/youtube/v3
- **API Console**: https://console.cloud.google.com/

### Code Janitor Support
- **GitHub Issues**: https://github.com/Debanshu2005/code-janitor/issues
- **Website**: https://code-janitor-web.vercel.app/
- **Documentation**: See `YOUTUBE_INTEGRATION.md`

---

## ✅ Checklist

Before you start:
- [ ] Have a Google account
- [ ] Browser is open
- [ ] VS Code is installed
- [ ] Code Janitor extension is installed

After setup:
- [ ] Project created in Google Cloud
- [ ] YouTube Data API v3 enabled
- [ ] API key created and copied
- [ ] API key added to VS Code settings
- [ ] Test search completed successfully
- [ ] Quota status shows "0/100 searches today"

---

## 🎉 You're Done!

Congratulations! You can now:
- ✅ Search YouTube from VS Code
- ✅ Watch videos in the chat panel
- ✅ Ask AI to find videos for you
- ✅ Track your daily quota usage
- ✅ Get automatic warnings before limits

**Start searching:** Open AI Chat (`Ctrl+Alt+C`) and select 🎥 YouTube!

---

**Last Updated:** January 2025  
**Version:** 1.0  
**Difficulty:** Easy (5 minutes)  
**Cost:** Free (10,000 units/day)
