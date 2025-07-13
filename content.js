// BugReel Content Script
(function() {
    'use strict';
    
    console.log('CONTENT: 🚀 BugReel content script loaded on:', window.location.href);
    console.log('CONTENT: Content script timestamp:', new Date().toISOString());
    
    // State variables
    let isLogging = false;
    let originalConsole = {};
    let isAudioEnabled = true;
    let isMicrophoneEnabled = true;
    
    // Store original console methods
    ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        originalConsole[level] = console[level];
    });
    
    // Safe JSON stringify function to handle circular references
    function safeJsonStringify(obj, maxDepth = 10) {
        const seen = new WeakSet();
        
        function replacer(key, value) {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            
            // Handle DOM elements
            if (value instanceof Element) {
                return `<${value.tagName.toLowerCase()}${value.id ? ' id="' + value.id + '"' : ''}${value.className ? ' class="' + value.className + '"' : ''}/>`;
            }
            
            // Handle other special objects
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
            }
            
            // Handle functions
            if (typeof value === 'function') {
                return '[Function: ' + (value.name || 'anonymous') + ']';
            }
            
            // Handle undefined
            if (value === undefined) {
                return '[undefined]';
            }
            
            // Handle symbols
            if (typeof value === 'symbol') {
                return '[Symbol: ' + value.toString() + ']';
            }
            
            return value;
        }
        
        try {
            return JSON.stringify(obj, replacer, 2);
        } catch (error) {
            console.warn('CONTENT: Unable to serialize object:', error);
            return '[Unable to serialize: ' + error.message + ']';
        }
    }
    
    function createRecordingToolbar(recordingMode = 'video') {
        console.log('CONTENT: 🎨 createRecordingToolbar called with mode:', recordingMode);
        
        // Remove any existing toolbar first
        console.log('CONTENT: 🗑️ Removing any existing toolbar...');
        try {
            removeRecordingToolbar();
            console.log('CONTENT: ✅ Existing toolbar removed');
        } catch (error) {
            console.error('CONTENT: ❌ Error removing existing toolbar:', error);
        }
        
        console.log('CONTENT: 🔧 Creating toolbar HTML element...');
        
        // Create the toolbar HTML
        const toolbar = document.createElement('div');
        toolbar.id = 'bugreel-toolbar';
        console.log('CONTENT: ✅ Toolbar div created with ID:', toolbar.id);
        
        console.log('CONTENT: 📝 Setting toolbar innerHTML...');
        toolbar.innerHTML = `
            <div style="all: initial; position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647; font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; user-select: none; pointer-events: auto;">
                <div style="background: #263238; border-radius: 8px; padding: 12px 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.12); display: flex; align-items: center; gap: 16px; min-height: 48px; animation: bugreel-slide-in 0.3s ease-out;">
                    <div class="bugreel-toolbar-left">
                        <div class="bugreel-logo">
                            <div class="bugreel-logo-icon">fiber_manual_record</div>
                            <div class="bugreel-logo-text">BugReel</div>
                        </div>
                        <div class="bugreel-status">
                            <div class="bugreel-recording-dot"></div>
                            <span class="bugreel-timer">00:00</span>
                        </div>
                    </div>
                    <div class="bugreel-toolbar-center">
                        <div class="bugreel-mode-info">
                            <div class="bugreel-icon">videocam</div>
                            <div class="bugreel-label">Recording</div>
                        </div>
                    </div>
                    <div class="bugreel-toolbar-right">
                        <button class="bugreel-btn" id="bugreel-audio-btn" title="Toggle System Audio">
                            <div class="bugreel-icon">volume_up</div>
                        </button>
                        <button class="bugreel-btn" id="bugreel-mic-btn" title="Toggle Microphone">
                            <div class="bugreel-icon">mic</div>
                        </button>
                        <button class="bugreel-btn" id="bugreel-pause-btn" title="Pause/Resume Recording">
                            <div class="bugreel-icon">pause</div>
                        </button>
                        <button class="bugreel-btn bugreel-stop-btn" id="bugreel-stop-btn" title="Stop Recording">
                            <div class="bugreel-icon">stop</div>
                        </button>
                        <button class="bugreel-btn bugreel-minimize-btn" id="bugreel-minimize-btn" title="Minimize">
                            <div class="bugreel-icon">remove</div>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        console.log('CONTENT: ✅ Toolbar innerHTML set, length:', toolbar.innerHTML.length);
        
        // Add styles
        console.log('CONTENT: 🎨 Adding styles...');
        const styles = `
            <style>
            @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
            @import url('https://fonts.googleapis.com/icon?family=Material+Icons');
            
            @keyframes bugreel-slide-in {
                from {
                    transform: translateX(-50%) translateY(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
            }
            
            @keyframes bugreel-pulse {
                0%, 100% { 
                    opacity: 1;
                    transform: scale(1);
                }
                50% { 
                    opacity: 0.7;
                    transform: scale(1.1);
                }
            }
            
            .bugreel-toolbar-left {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 120px;
            }
            
            .bugreel-logo {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 500;
                font-size: 14px;
                color: #ffffff;
            }
            
            .bugreel-logo-icon {
                font-family: 'Material Icons';
                color: #f44336;
                font-size: 18px;
                animation: bugreel-pulse 2s ease-in-out infinite;
            }
            
            .bugreel-logo-text {
                font-weight: 500;
                color: #ffffff;
            }
            
            .bugreel-status {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #b0bec5;
                margin-top: 2px;
            }
            
            .bugreel-recording-dot {
                width: 8px;
                height: 8px;
                background: #f44336;
                border-radius: 50%;
                animation: bugreel-pulse 1.5s ease-in-out infinite;
            }
            
            .bugreel-timer {
                font-family: 'Roboto', monospace;
                color: #ffffff;
                font-weight: 500;
                background: rgba(255, 255, 255, 0.1);
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
            }
            
            .bugreel-toolbar-center {
                display: flex;
                align-items: center;
                gap: 16px;
                flex: 1;
                justify-content: center;
            }
            
            .bugreel-toolbar-right {
                display: flex;
                gap: 8px;
            }
            
            .bugreel-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.1);
                border: none;
                border-radius: 50%;
                padding: 0;
                color: #ffffff;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                width: 40px;
                height: 40px;
                position: relative;
                overflow: hidden;
            }
            
            .bugreel-btn::before {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 0;
                height: 0;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                transition: all 0.3s ease;
                transform: translate(-50%, -50%);
            }
            
            .bugreel-btn:hover::before {
                width: 100%;
                height: 100%;
            }
          
            .bugreel-btn:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.05);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            }
            
            .bugreel-btn.active {
                background: #2196f3;
                color: #ffffff;
            }
            
            .bugreel-btn.disabled {
                background: rgba(244, 67, 54, 0.8);
                color: #ffffff;
            }
            
            .bugreel-btn.disabled:hover {
                transform: none;
            }
            
            .bugreel-icon {
                font-family: 'Material Icons';
                font-size: 20px;
                line-height: 1;
                z-index: 1;
                position: relative;
            }
            
            .bugreel-label {
                font-size: 10px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #b0bec5;
                margin-top: 2px;
            }
            
            .bugreel-stop-btn {
                background: #f44336;
                color: #ffffff;
            }
            
            .bugreel-stop-btn:hover {
                background: #d32f2f;
                box-shadow: 0 4px 12px rgba(244, 67, 54, 0.4);
            }
            
            .bugreel-minimize-btn {
                width: 32px;
                height: 32px;
            }
            
            .bugreel-minimize-btn .bugreel-icon {
                font-size: 16px;
            }
            
            .bugreel-mode-info {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: rgba(33, 150, 243, 0.1);
                border: 1px solid rgba(33, 150, 243, 0.3);
                border-radius: 20px;
                color: #2196f3;
            }
            
            .bugreel-mode-info .bugreel-icon {
                color: #2196f3;
                font-size: 18px;
            }
            
            .bugreel-mode-info .bugreel-label {
                color: #2196f3;
                font-weight: 500;
                font-size: 12px;
                text-transform: none;
                letter-spacing: 0;
                margin: 0;
            }
            </style>
        `;

        // Insert styles into the head
        console.log('CONTENT: 📎 Inserting styles into head...');
        try {
            const styleElement = document.createElement('div');
            styleElement.innerHTML = styles;
            document.head.appendChild(styleElement.firstElementChild);
            console.log('CONTENT: ✅ Styles inserted successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error inserting styles:', error);
        }

        // Add toolbar to the page
        console.log('CONTENT: 🏗️ Adding toolbar to document body...');
        try {
            console.log('CONTENT: Document body exists:', !!document.body);
            console.log('CONTENT: Document ready state:', document.readyState);
            
            if (!document.body) {
                console.error('CONTENT: ❌ Document body is null! Cannot add toolbar.');
                return;
            }
            
            document.body.appendChild(toolbar);
            console.log('CONTENT: ✅ Toolbar added to document body');
            
            // Verify toolbar was added
            const addedToolbar = document.getElementById('bugreel-toolbar');
            if (addedToolbar) {
                console.log('CONTENT: ✅ Toolbar verified in DOM after adding');
                console.log('CONTENT: Toolbar parent:', addedToolbar.parentNode);
                console.log('CONTENT: Toolbar dimensions:', addedToolbar.offsetWidth, 'x', addedToolbar.offsetHeight);
                console.log('CONTENT: Toolbar style display:', getComputedStyle(addedToolbar).display);
                console.log('CONTENT: Toolbar style visibility:', getComputedStyle(addedToolbar).visibility);
            } else {
                console.error('CONTENT: ❌ Toolbar NOT found in DOM after adding');
            }
            
        } catch (error) {
            console.error('CONTENT: ❌ Error adding toolbar to body:', error);
        }

        // Set up event listeners
        console.log('CONTENT: 🔧 Setting up toolbar event listeners...');
        try {
            setupToolbarEventListeners();
            console.log('CONTENT: ✅ Toolbar event listeners set up successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error setting up toolbar event listeners:', error);
        }

        // Start the recording timer
        console.log('CONTENT: ⏰ Starting recording timer...');
        try {
            startRecordingTimer();
            console.log('CONTENT: ✅ Recording timer started successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error starting recording timer:', error);
        }
        
        console.log('CONTENT: 🎉 Recording toolbar creation completed successfully');
    }
    
    function setupToolbarEventListeners() {
        const audioToggle = document.getElementById('bugreel-audio-btn');
        const micToggle = document.getElementById('bugreel-mic-btn');
        const pauseToggle = document.getElementById('bugreel-pause-btn');
        const stopBtn = document.getElementById('bugreel-stop-btn');
        const minimizeBtn = document.getElementById('bugreel-minimize-btn');
        
        // Only add video-specific controls if they exist
        if (audioToggle) {
            audioToggle.addEventListener('click', () => {
                isAudioEnabled = !isAudioEnabled;
                audioToggle.classList.toggle('disabled', !isAudioEnabled);
                audioToggle.querySelector('.bugreel-icon').textContent = isAudioEnabled ? '🔊' : '🔇';
                
                // Send message to service worker to toggle audio
                chrome.runtime.sendMessage({
                    type: 'TOGGLE_AUDIO',
                    enabled: isAudioEnabled
                });
            });
        }
        
        if (micToggle) {
            micToggle.addEventListener('click', () => {
                isMicrophoneEnabled = !isMicrophoneEnabled;
                micToggle.classList.toggle('disabled', !isMicrophoneEnabled);
                micToggle.querySelector('.bugreel-icon').textContent = isMicrophoneEnabled ? '🎤' : '🎤';
                
                // Send message to service worker to toggle microphone
                chrome.runtime.sendMessage({
                    type: 'TOGGLE_MICROPHONE',
                    enabled: isMicrophoneEnabled
                });
            });
        }
        
        if (pauseToggle) {
            pauseToggle.addEventListener('click', () => {
                const isPaused = pauseToggle.classList.contains('active');
                pauseToggle.classList.toggle('active');
                pauseToggle.querySelector('.bugreel-icon').textContent = isPaused ? '⏸️' : '▶️';
                pauseToggle.querySelector('.bugreel-label').textContent = isPaused ? 'Pause' : 'Resume';
                
                // Send message to service worker to pause/resume recording
                chrome.runtime.sendMessage({
                    type: 'TOGGLE_PAUSE',
                    paused: !isPaused
                });
            });
        }
        
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                stopRecording();
            });
        }
        
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                const toolbar = document.getElementById('bugreel-toolbar');
                if (toolbar) {
                    toolbar.classList.toggle('minimized');
                    const isMinimized = toolbar.classList.contains('minimized');
                    minimizeBtn.querySelector('.bugreel-icon').textContent = isMinimized ? '+' : '−';
                }
            });
        }
    }
    
    function stopRecording() {
        // Send stop message to service worker
        chrome.runtime.sendMessage({
            type: 'STOP_CAPTURE'
        });
        
        // Remove toolbar
        removeRecordingToolbar();
    }
    
    function removeRecordingToolbar() {
        const toolbar = document.getElementById('bugreel-toolbar');
        if (toolbar) {
            toolbar.remove();
            console.log('CONTENT: Recording toolbar removed');
        }
        
        // Stop timer
        if (window.bugReelTimer) {
            clearInterval(window.bugReelTimer);
            window.bugReelTimer = null;
        }
    }
    
    let startTime = null;
    
    function startRecordingTimer() {
        startTime = Date.now();
        window.bugReelTimer = setInterval(updateTimer, 1000);
    }
    
    function updateTimer() {
        if (!startTime) return;
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        const timerElement = document.querySelector('#bugreel-toolbar .bugreel-timer');
        if (timerElement) {
            timerElement.textContent = 
                minutes.toString().padStart(2, '0') + ':' + 
                seconds.toString().padStart(2, '0');
        }
    }
    
    // Override console methods
    function overrideConsole() {
        ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
            console[level] = function(...args) {
                // Send to service worker if logging is active
                if (isLogging) {
                    try {
                        chrome.runtime.sendMessage({
                            type: 'CONSOLE_LOG',
                            payload: {
                                level: level,
                                message: safeJsonStringify(args),
                                timestamp: new Date().toISOString(),
                                url: window.location.href
                            }
                        });
                    } catch (error) {
                        // Silently handle errors to avoid breaking the page
                    }
                }
                
                // Call original console method
                originalConsole[level].apply(console, args);
            };
        });
    }
    
    // Restore original console methods
    function restoreConsole() {
        ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
            console[level] = originalConsole[level];
        });
    }
    
    // Get CSS selector for an element
    function getSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        if (element.className) {
            const classes = element.className.split(' ').filter(c => c.trim());
            if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
        }
        
        return element.tagName.toLowerCase();
    }
    
    // Track user actions
    function trackUserAction(event) {
        if (!isLogging) return;
        
        // Don't track clicks on the BugReel toolbar
        if (event.target.closest('#bugreel-toolbar')) {
            return;
        }
        
        const target = event.target;
        const actionData = {
            type: event.type,
            selector: getSelector(target),
            timestamp: new Date().toISOString(),
            url: window.location.href,
            elementType: target.tagName.toLowerCase()
        };
        
        // Add specific data based on event type
        switch (event.type) {
            case 'click':
                actionData.text = target.textContent ? target.textContent.trim().substring(0, 50) : '';
                break;
            case 'input':
                actionData.inputType = target.type;
                // Enhanced PII protection
                if (target.type === 'password' || target.type === 'hidden') {
                    actionData.value = '[SENSITIVE_DATA]';
                } else if (target.name && /password|pwd|secret|token|key|pin|ssn|social/i.test(target.name)) {
                    actionData.value = '[SENSITIVE_DATA]';
                } else if (target.placeholder && /password|pwd|secret|token|key|pin|ssn|social/i.test(target.placeholder)) {
                    actionData.value = '[SENSITIVE_DATA]';
                } else {
                    actionData.value = target.value.substring(0, 50);
                }
                break;
            case 'keydown':
                actionData.key = event.key;
                actionData.ctrlKey = event.ctrlKey;
                actionData.shiftKey = event.shiftKey;
                actionData.altKey = event.altKey;
                break;
        }
        
        try {
            chrome.runtime.sendMessage({
                type: 'USER_ACTION',
                payload: actionData
            });
        } catch (error) {
            // Silently handle errors
        }
    }
    
    // Collect environment data
    function collectEnvironmentData() {
        const envData = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            language: navigator.language,
            languages: navigator.languages,
            platform: navigator.platform,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                availHeight: window.screen.availHeight,
                pixelDepth: window.screen.pixelDepth,
                colorDepth: window.screen.colorDepth
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio
            },
            document: {
                title: document.title,
                readyState: document.readyState,
                referrer: document.referrer
            }
        };
        
        // Add modern User-Agent Client Hints if available
        if (navigator.userAgentData) {
            envData.userAgentData = {
                brands: navigator.userAgentData.brands,
                mobile: navigator.userAgentData.mobile,
                platform: navigator.userAgentData.platform
            };
        }
        
        return envData;
    }
    
    // Track URL changes
    function trackUrlChange() {
        if (!isLogging) return;
        
        const actionData = {
            type: 'navigation',
            url: window.location.href,
            timestamp: new Date().toISOString()
        };
        
        try {
            chrome.runtime.sendMessage({
                type: 'USER_ACTION',
                payload: actionData
            });
        } catch (error) {
            // Silently handle errors
        }
    }
    
    // Start logging
    function startLogging(recordingMode = 'video') {
        console.log('CONTENT: 🎬 Starting logging with mode:', recordingMode);
        console.log('CONTENT: Current isLogging state:', isLogging);
        
        isLogging = true;
        console.log('CONTENT: ✅ Set isLogging to true');
        
        // Override console methods
        console.log('CONTENT: 🔧 Overriding console methods...');
        try {
            overrideConsole();
            console.log('CONTENT: ✅ Console methods overridden successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error overriding console:', error);
        }
        
        // Create recording toolbar
        console.log('CONTENT: 🎨 Creating recording toolbar...');
        try {
            createRecordingToolbar(recordingMode);
            console.log('CONTENT: ✅ Recording toolbar creation attempted');
            
            // Check if toolbar was actually created
            const toolbar = document.getElementById('bugreel-toolbar');
            if (toolbar) {
                console.log('CONTENT: ✅ Toolbar element found in DOM:', toolbar);
                console.log('CONTENT: Toolbar innerHTML length:', toolbar.innerHTML.length);
                console.log('CONTENT: Toolbar visible:', toolbar.offsetWidth > 0 && toolbar.offsetHeight > 0);
            } else {
                console.error('CONTENT: ❌ Toolbar element NOT found in DOM after creation');
            }
        } catch (error) {
            console.error('CONTENT: ❌ Error creating recording toolbar:', error);
        }
        
        // Collect and send environment data
        console.log('CONTENT: 📊 Collecting environment data...');
        try {
            const envData = collectEnvironmentData();
            chrome.runtime.sendMessage({
                type: 'ENVIRONMENT_DATA',
                payload: envData
            });
            console.log('CONTENT: ✅ Environment data sent successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error sending environment data:', error);
        }
        
        // Add event listeners for user actions
        console.log('CONTENT: 👂 Adding event listeners...');
        try {
            document.addEventListener('click', trackUserAction, true);
            document.addEventListener('input', trackUserAction, true);
            document.addEventListener('keydown', trackUserAction, true);
            console.log('CONTENT: ✅ Event listeners added successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error adding event listeners:', error);
        }
        
        // Track URL changes
        console.log('CONTENT: 🔗 Setting up URL change tracking...');
        try {
            window.addEventListener('popstate', trackUrlChange);
            window.addEventListener('hashchange', trackUrlChange);
            
            // Override history methods to track programmatic navigation
            if (!window.bugReelHistoryOriginals) {
                window.bugReelHistoryOriginals = {
                    pushState: history.pushState,
                    replaceState: history.replaceState
                };
            }
            
            history.pushState = function(...args) {
                const result = window.bugReelHistoryOriginals.pushState.apply(this, args);
                setTimeout(trackUrlChange, 0);
                return result;
            };
            
            history.replaceState = function(...args) {
                const result = window.bugReelHistoryOriginals.replaceState.apply(this, args);
                setTimeout(trackUrlChange, 0);
                return result;
            };
            
            console.log('CONTENT: ✅ URL change tracking set up successfully');
        } catch (error) {
            console.error('CONTENT: ❌ Error setting up URL change tracking:', error);
        }
        
        console.log('CONTENT: 🎉 StartLogging completed successfully');
    }
    
    // Stop logging
    function stopLogging() {
        console.log('BugReel: Stopping logging');
        isLogging = false;
        
        // Restore original console methods
        restoreConsole();
        
        // Remove recording toolbar
        removeRecordingToolbar();
        
        // Remove event listeners
        document.removeEventListener('click', trackUserAction, true);
        document.removeEventListener('input', trackUserAction, true);
        document.removeEventListener('keydown', trackUserAction, true);
        window.removeEventListener('popstate', trackUrlChange);
        window.removeEventListener('hashchange', trackUrlChange);
        
        // Restore history methods
        if (window.bugReelHistoryOriginals) {
            history.pushState = window.bugReelHistoryOriginals.pushState;
            history.replaceState = window.bugReelHistoryOriginals.replaceState;
        }
    }
    
    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('CONTENT: 📨 Message received:', message.type, 'on:', window.location.href);
        console.log('CONTENT: Message details:', message);
        
        try {
            switch (message.type) {
                case 'START_LOGGING':
                    console.log('CONTENT: 🎬 Processing START_LOGGING message');
                    startLogging(message.recordingMode);
                    console.log('CONTENT: ✅ START_LOGGING completed successfully');
                    sendResponse({ success: true });
                    break;
                    
                case 'STOP_LOGGING':
                    console.log('CONTENT: 🛑 Processing STOP_LOGGING message');
                    stopLogging();
                    console.log('CONTENT: ✅ STOP_LOGGING completed successfully');
                    sendResponse({ success: true });
                    break;
                    
                case 'PING':
                    // Respond to ping to confirm content script is active
                    // Also check if toolbar exists
                    const toolbar = document.getElementById('bugreel-toolbar');
                    const response = { 
                        alive: true, 
                        logging: isLogging,
                        hasToolbar: !!toolbar,
                        url: window.location.href
                    };
                    console.log('CONTENT: 🏓 PING response:', response);
                    sendResponse(response);
                    break;
                    
                case 'REMOVE_TOOLBAR':
                    // Remove existing toolbar to prevent duplicates
                    console.log('CONTENT: 🗑️ Removing toolbar');
                    removeRecordingToolbar();
                    sendResponse({ success: true });
                    break;
                    
                default:
                    console.warn('CONTENT: ❓ Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('CONTENT: ❌ Error processing message:', error);
            sendResponse({ success: false, error: error.message });
        }
        
        return true;
    });
    
    // Note: We don't add a beforeunload listener because we want recording to persist across navigation
    // The service worker will handle re-injecting the content script on new pages
    
})(); 