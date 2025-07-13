# 🎬 BugReel - Personal Bug Reporting Tool

A personal-use browser extension for capturing comprehensive bug reports with console logs, network requests, user actions, and environment data.

## 🚀 Project Overview

BugReel is inspired by tools like Jam.dev but designed specifically for personal use. It captures detailed debugging information into self-contained reports without requiring any backend infrastructure or cloud services.

### Key Features (Current Implementation - Phase 3)

✅ **Console Log Capture**: Intercepts and records all console.log, console.error, console.warn, console.info, and console.debug messages  
✅ **Network Request Logging**: Captures HTTP requests with headers, status codes, timing, and metadata  
✅ **User Action Tracking**: Records clicks, keyboard inputs, and navigation events for reproduction steps  
✅ **Environment Data Collection**: Gathers browser, OS, screen resolution, and page metadata  
✅ **Advanced PII Scrubbing**: Comprehensive client-side scrubbing of passwords, tokens, API keys, and sensitive data  
✅ **Screen Recording**: Captures tab/screen video with system and microphone audio  
✅ **Audio Merging**: Combines system audio and microphone using Web Audio API  
✅ **Self-Contained HTML Reports**: Interactive reports with embedded video and synchronized playback  
✅ **Enhanced Timeline Synchronization**: Advanced algorithm with visual timeline markers and precise highlighting  
✅ **Interactive Search & Filtering**: Real-time search across logs, requests, and actions with multiple filter options  
✅ **Visual Timeline Markers**: Interactive timeline showing errors, network issues, and user actions  
✅ **Smart Auto-scrolling**: Intelligent content synchronization with video playback  

### Planned Features (Future Phases)

🔄 **Phase 4**: AI-powered debugging assistance and screenshot annotation  

## 📋 Installation

### Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this project directory
4. The BugReel extension should now appear in your extensions list

## 🔧 How to Use

1. **Navigate to any webpage** you want to debug
2. **Click the BugReel extension icon** in your browser toolbar
3. **Click "Start Recording"** to begin capturing data
   - Grant screen sharing permissions when prompted
   - Optionally allow microphone access for narration
4. **Reproduce the bug** by interacting with the page
5. **Click "Stop Recording"** when done
6. **An HTML report file** will be automatically downloaded with:
   - Embedded video recording
   - Synchronized console logs, network requests, and user actions
   - Interactive timeline that highlights relevant data as video plays

## 📊 Report Contents

The generated JSON report contains:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "consoleLogs": [
    {
      "level": "error",
      "message": "TypeError: Cannot read property 'foo' of undefined",
      "timestamp": "2024-01-15T10:30:05.123Z",
      "url": "https://example.com/page"
    }
  ],
  "networkLogs": [
    {
      "url": "https://api.example.com/data",
      "method": "POST",
      "statusCode": 500,
      "duration": 1234,
      "requestHeaders": [...],
      "responseHeaders": [...]
    }
  ],
  "userActions": [
    {
      "type": "click",
      "selector": "#submit-button",
      "timestamp": "2024-01-15T10:30:03.456Z",
      "text": "Submit Form"
    }
  ],
  "environmentData": {
    "userAgent": "Mozilla/5.0...",
    "screen": { "width": 1920, "height": 1080 },
    "viewport": { "width": 1200, "height": 800 },
    "url": "https://example.com"
  }
}
```

## 🏗️ Architecture

### Extension Components

- **manifest.json**: Extension configuration and permissions
- **popup.html/js**: User interface for start/stop controls
- **background.js**: Service worker coordinating all data capture
- **content.js**: Script injected into web pages for data collection

### Data Flow

1. User clicks "Start Recording" in popup
2. Service worker injects content script into active tab
3. Content script overrides console methods and adds event listeners
4. Service worker captures network requests via webRequest API
5. All data is aggregated in session storage
6. On "Stop Recording", data is compiled into JSON report and downloaded

## 🛠️ Development Status

### Phase 1: Core Capture Foundation ✅ COMPLETE

- [x] Chrome Extension V3 structure
- [x] Console log interception
- [x] Network request capturing
- [x] User action tracking
- [x] Environment data collection
- [x] JSON report generation

### Phase 2: Video Recording & Self-Contained Viewer ✅ COMPLETE

- [x] Offscreen document for screen capture
- [x] MediaRecorder integration with getDisplayMedia
- [x] Audio stream merging (system + microphone)
- [x] Self-contained HTML viewer with embedded video
- [x] Basic timeline synchronization
- [x] Interactive tabbed interface

### Phase 3: Interactive Viewer ✅ COMPLETE

- [x] Enhanced timeline synchronization with visual markers
- [x] Comprehensive PII/secret scrubbing module
- [x] Interactive search and filtering functionality
- [x] Visual timeline with error/network/action markers
- [x] Smart auto-scrolling and content highlighting
- [x] Enhanced UI/UX with modern controls

### Phase 4: Advanced Features

- [ ] AI debugging assistant
- [ ] Screenshot annotation
- [ ] Advanced report formats

## 🔒 Privacy & Security

- **No data transmission**: All processing happens locally in your browser
- **No cloud storage**: Reports are saved only to your local machine
- **PII protection**: Passwords and sensitive inputs are automatically masked
- **Session-only storage**: Data is cleared when browser session ends

## 🤝 Contributing

This is designed as a personal tool, but contributions are welcome! Areas for improvement:

- Enhanced error handling
- Better UI/UX for the popup
- Additional capture capabilities
- Performance optimizations

## 📜 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

Inspired by [Jam.dev](https://jam.dev) and similar bug reporting tools, but reimagined for personal use without the complexity of collaborative features.

---

**Current Version**: 2.1.0 (Phase 3)  
**Last Updated**: January 2024  
**Status**: Enhanced interactive viewer with timeline synchronization, PII scrubbing, and advanced search capabilities 