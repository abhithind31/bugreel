# 🎥 BugReel Video Recording Debug Guide

When you see "No video recording available" in the preview, follow these steps to diagnose the issue:

## 🔍 Step 1: Check the Enhanced Preview

The preview now shows detailed diagnostic information:

- **🚨 Recording Error**: If there was a specific error, you'll see the error message, timestamp, and technical details
- **🔍 Possible Causes**: If no specific error was captured, you'll see a list of common causes
- **📝 Check browser console**: Always check the browser console for additional error messages

## 🛠️ Step 2: Run the Debug Script

1. Open Chrome DevTools (F12)
2. Go to the **Console** tab
3. Load the debug script by running:
   ```javascript
   // Paste and run the contents of debug-video.js
   ```
4. The script will automatically test:
   - Extension permissions
   - Offscreen document status
   - Session storage contents
   - Media device access
   - MediaRecorder support

## 🚨 Common Issues & Solutions

### Issue: "Permission denied" or "NotAllowedError"
**Cause**: User denied screen sharing permission
**Solution**: 
- Click "Start Tab Recording" again
- In the permission dialog, select **"Current Tab"** (not "Cancel")
- Make sure to click "Share" button

### Issue: "MediaRecorder not supported"
**Cause**: Browser doesn't support required video codecs
**Solution**:
- Update Chrome to the latest version
- Try in a different Chrome-based browser (Edge, Brave)

### Issue: "Failed to start video recording: timeout"
**Cause**: Offscreen document not responding
**Solution**:
- Reload the extension: Chrome > Extensions > BugReel > Reload
- Try recording again

### Issue: Video data too large
**Cause**: Recording exceeded Chrome storage limits
**Solution**:
- Record shorter sessions (< 2-3 minutes)
- The system automatically stores large videos in memory

## 🔧 Advanced Debugging

### Check Service Worker Logs
1. Open `chrome://extensions/`
2. Find BugReel extension
3. Click "service worker" link
4. Check console for detailed error messages

### Check Offscreen Document Logs
1. Open Chrome DevTools
2. Go to Application > Frames
3. Look for "offscreen.html"
4. Check its console for recording errors

### Manual Storage Inspection
```javascript
// Check what's in session storage
chrome.storage.session.get().then(console.log);

// Check for video errors specifically
chrome.storage.session.get('videoError').then(console.log);
```

## 📊 Error Types Explained

- **StartRecording**: Error occurred when trying to start screen capture
- **MediaRecorder**: Error from the browser's MediaRecorder API
- **ProcessVideo**: Error when converting recorded video to base64
- **Permission denied**: User denied screen sharing access
- **Timeout**: Recording system didn't respond within 10 seconds

## ✅ Testing Video Recording

To test if video recording works:

1. Start a recording
2. Wait 10-15 seconds
3. Stop the recording
4. Check the preview for video or error details

If you consistently see "No video recording available", the most common cause is **permission denial** - make sure to allow screen sharing when prompted.

## 🆘 Still Having Issues?

If video recording still doesn't work after following this guide:

1. Share the **complete console output** from both Service Worker and Offscreen Document
2. Include the **error details** from the preview (if any)
3. Mention your **Chrome version** and **operating system**
4. Describe **exactly what happens** when you try to start recording (permission dialog behavior, etc.)

The enhanced debugging system will provide much more detailed information about what's going wrong! 