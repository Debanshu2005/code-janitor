# How to Enable Microphone in VS Code/Arduino IDE

## The Real Solution

The microphone feature in VS Code/Arduino IDE webviews requires **system-level permissions**, not browser permissions.

## Step-by-Step Fix:

### Windows:
1. Press **Windows + I** to open Settings
2. Go to **Privacy & Security** → **Microphone**
3. Turn ON **"Let apps access your microphone"**
4. Scroll down and find **"Visual Studio Code"** or **"Arduino IDE"**
5. Make sure it's set to **ON**
6. **Completely close and restart** VS Code/Arduino IDE (not just close the window - quit the app)
7. Open Code Janitor chat panel
8. Click the 🎤 microphone button

### macOS:
1. Open **System Settings** (or System Preferences)
2. Go to **Privacy & Security** → **Microphone**
3. Look for **"Visual Studio Code"** or **"Arduino IDE"** in the list
4. **Check the box** next to it to allow microphone access
5. **Completely quit and restart** VS Code/Arduino IDE (Cmd+Q to quit)
6. Open Code Janitor chat panel
7. Click the 🎤 microphone button

### Linux:
1. Open your system's privacy/security settings
2. Find microphone permissions
3. Grant access to VS Code or Arduino IDE
4. Restart the application completely

## Important Notes:

- ✅ The microphone works in VS Code/Arduino IDE webviews
- ✅ It requires system-level permissions (not browser permissions)
- ✅ You must **completely restart** the application after granting permission
- ✅ The feature uses Web Speech API which requires internet connection
- ✅ Works in Chrome-based webviews (VS Code uses Electron/Chromium)

## Still Not Working?

If it still doesn't work after following the steps:

1. **Check if microphone is connected** - test it in another app
2. **Check if another app is using it** - close Zoom, Teams, Discord, etc.
3. **Restart your computer** - sometimes permissions need a full restart
4. **Check VS Code/Arduino IDE version** - make sure you're using a recent version

## Alternative: Just Type

Remember, the microphone is **optional**. You can always type your questions in the input field and get the same AI responses!
