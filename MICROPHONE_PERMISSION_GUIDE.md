# Microphone Permission Guide for Code Janitor

## Where is the Lock Icon? 🔒

The lock icon (or site information icon) is located in your **browser's address bar** at the **top-left** of the window, just before the URL.

### Visual Guide by Browser:

#### Chrome / Edge / Brave
```
┌─────────────────────────────────────────────────┐
│ 🔒 vscode-webview://... ▼  [Tabs]  [Extensions] │  ← Lock icon here
├─────────────────────────────────────────────────┤
│                                                  │
│         Code Janitor AI Chat Panel               │
│                                                  │
└─────────────────────────────────────────────────┘
```

#### Safari
```
┌─────────────────────────────────────────────────┐
│ 🔒 vscode-webview://...        [Share] [Reader] │  ← Lock icon here
├─────────────────────────────────────────────────┤
│                                                  │
│         Code Janitor AI Chat Panel               │
│                                                  │
└─────────────────────────────────────────────────┘
```

## How to Allow Microphone Access

### Method 1: Click the Lock Icon (Recommended)

1. **Click the 🔒 lock icon** in the address bar (top-left corner)
2. A dropdown menu will appear showing site permissions
3. Find **"Microphone"** in the list
4. Change it from **"Block"** or **"Ask"** to **"Allow"**
5. **Reload the page** (F5 or Ctrl+R)
6. Click the 🎤 microphone button again

### Method 2: Browser Settings

#### Chrome / Edge / Brave:
1. Click the **three dots menu** (⋮) → **Settings**
2. Go to **Privacy and security** → **Site settings**
3. Click **Microphone**
4. Find `vscode-webview://` in the list
5. Change to **"Allow"**
6. Reload the Code Janitor panel

#### Safari:
1. Go to **Safari** → **Settings** (or Preferences)
2. Click **Websites** tab
3. Select **Microphone** from the left sidebar
4. Find the Code Janitor webview
5. Change to **"Allow"**
6. Reload the panel

### Method 3: System Permissions (macOS/Windows)

#### macOS:
1. Open **System Settings** → **Privacy & Security**
2. Click **Microphone**
3. Make sure your browser (Chrome/Safari/Edge) is **checked**
4. Restart the browser if needed

#### Windows:
1. Open **Settings** → **Privacy** → **Microphone**
2. Make sure **"Allow apps to access your microphone"** is **ON**
3. Scroll down and make sure your browser is **allowed**
4. Restart the browser if needed

## Troubleshooting

### "Microphone access denied" message keeps appearing

**Possible causes:**
1. ❌ Browser blocked the permission
2. ❌ System-level microphone access is disabled
3. ❌ No microphone is connected
4. ❌ Another app is using the microphone

**Solutions:**
1. ✅ Follow Method 1 above to allow microphone in browser
2. ✅ Check system permissions (Method 3)
3. ✅ Connect a microphone or enable built-in mic
4. ✅ Close other apps using the microphone (Zoom, Teams, etc.)
5. ✅ Try a different browser (Chrome works best)

### Microphone button is grayed out

This means your browser doesn't support the Web Speech API.

**Supported browsers:**
- ✅ Chrome (recommended)
- ✅ Edge (recommended)
- ✅ Safari (macOS only)
- ❌ Firefox (not supported)

**Solution:** Use Chrome or Edge for voice input features.

### Permission prompt never appears

If clicking the microphone button doesn't show a permission prompt:

1. The permission was already denied - use Method 1 to reset it
2. Your browser is blocking all permissions - check browser settings
3. The webview security policy is blocking it - restart VS Code/Arduino IDE

## Testing Microphone Access

After granting permission:

1. Click the **🎤 microphone button** in the input area
2. You should see: **"✅ Microphone access granted! Speak now..."**
3. The button should turn **red** and pulse while recording
4. Speak clearly into your microphone
5. Your words should appear in the input field in real-time
6. Click the button again to stop recording

## Still Having Issues?

If microphone still doesn't work after following all steps:

1. **Check browser console** for errors:
   - Press F12 to open DevTools
   - Look for red error messages
   - Share them with support

2. **Test microphone in browser**:
   - Visit https://www.onlinemictest.com/
   - If it doesn't work there, it's a system/hardware issue

3. **Restart everything**:
   - Close VS Code / Arduino IDE completely
   - Restart your browser
   - Restart your computer if needed

4. **Use a different browser**:
   - Chrome and Edge have the best Web Speech API support
   - Safari works on macOS but may have limitations

## Alternative: Type Instead of Voice

If you can't get the microphone working, you can always type your questions in the input field. The voice input is a convenience feature, not required for using Code Janitor.

---

**Need more help?** Open an issue on GitHub: https://github.com/Debanshu2005/code-janitor/issues
