(function() {
    'use strict';
    
    console.log('BugReel: content script loaded on', window.location.href);
    
    // State variables
    let isLogging = false;
    let originalConsole = {};
    let isAudioEnabled = true;
    let isMicrophoneEnabled = true;
    
    // Store original console methods
    ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        originalConsole[level] = console[level];
    });
    
    // JSON stringify helper resilient to circular references and exotic values
    function safeJsonStringify(obj, maxDepth = 10) {
        const seen = new WeakSet();
        
        function replacer(key, value) {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            
            // DOM elements
            if (value instanceof Element) {
                return `<${value.tagName.toLowerCase()}${value.id ? ' id="' + value.id + '"' : ''}${value.className ? ' class="' + value.className + '"' : ''}/>`;
            }
            
            // Errors
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
            }
            
            // Functions
            if (typeof value === 'function') {
                return '[Function: ' + (value.name || 'anonymous') + ']';
            }
            
            // Undefined
            if (value === undefined) {
                return '[undefined]';
            }
            
            // Symbols
            if (typeof value === 'symbol') {
                return '[Symbol: ' + value.toString() + ']';
            }
            
            return value;
        }
        
        try {
            return JSON.stringify(obj, replacer, 2);
        } catch (error) {
            console.warn('BugReel: unable to serialize object', error);
            return '[Unable to serialize: ' + error.message + ']';
        }
    }
    
    function createRecordingToolbar(recordingMode = 'video') {
        console.log('BugReel: creating toolbar, mode:', recordingMode);
        
        // Remove any existing toolbar first
        console.log('BugReel: removing existing toolbar');
        try {
            removeRecordingToolbar();
            console.log('BugReel: previous toolbar removed');
        } catch (error) {
            console.error('BugReel: remove toolbar error:', error);
        }
        
        console.log('BugReel: creating toolbar element');
        
        // Create the toolbar HTML
        const toolbar = document.createElement('div');
        toolbar.id = 'bugreel-toolbar';
        console.log('BugReel: toolbar element created:', toolbar.id);
        
        console.log('BugReel: setting toolbar markup');
        toolbar.innerHTML = `
            <div style="all: initial; position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif; user-select: none; pointer-events: auto;">
                <div class="br-bar" style="animation: bugreel-slide-in 0.25s ease-out both;">
                    <button class="br-btn br-stop" id="bugreel-stop-btn" title="Stop Recording" aria-label="Stop Recording"></button>
                    <button class="br-btn" id="bugreel-pause-btn" title="Pause/Resume Recording" aria-label="Pause or resume">⏸</button>
                    <span class="bugreel-timer" aria-live="polite">00:00</span>
                    <div class="br-divider" role="separator"></div>
                    <button class="br-btn" id="bugreel-mic-btn" title="Toggle Microphone" aria-pressed="true"></button>
                    <button class="br-btn" id="bugreel-audio-btn" title="Toggle System Audio" aria-pressed="true"></button>
                </div>
            </div>
        `;
        
        console.log('BugReel: toolbar markup set');
        
        // Add styles
        console.log('BugReel: injecting styles');
        const styles = `
            <style>
            @keyframes bugreel-slide-in {
                from { opacity: 0; transform: translateX(-50%) translateY(8px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            .br-bar {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                padding: 6px 10px;
                background: rgba(17, 17, 17, 0.92);
                border-radius: 14px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.2);
                backdrop-filter: saturate(140%) blur(6px);
                -webkit-backdrop-filter: saturate(140%) blur(6px);
                cursor: grab;
            }
            .br-bar.dragging { cursor: grabbing; }
            .br-btn {
                width: 36px;
                height: 36px;
                border-radius: 8px;
                border: none;
                background: rgba(255,255,255,0.08);
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: transform 0.12s ease, background 0.12s ease, opacity 0.12s ease;
                font-size: 16px;
                line-height: 1;
            }
            .br-btn svg { width: 17px; height: 17px; display: block; stroke-linecap: round; stroke-linejoin: round; }
            .br-btn:hover { background: rgba(255,255,255,0.16); transform: translateY(-1px); }
            .br-btn:active { transform: translateY(0); }
            .br-btn[aria-pressed="false"] { opacity: 0.7; }
            .br-stop { background: #e53935; width: 14px; height: 14px; border-radius: 4px; box-shadow: 0 0 0 8px #e53935 inset; }
            .br-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.14); border-radius: 1px; }
            .bugreel-timer { color: #fff; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 13px; padding: 2px 8px; background: rgba(255,255,255,0.08); border-radius: 7px; }
            </style>
        `;

        // Insert styles into the head
        console.log('BugReel: inserting styles into head');
        try {
            const styleElement = document.createElement('div');
            styleElement.innerHTML = styles;
            document.head.appendChild(styleElement.firstElementChild);
            console.log('BugReel: styles inserted');
        } catch (error) {
            console.error('BugReel: style injection error:', error);
        }

        // Add toolbar to the page
        console.log('BugReel: adding toolbar to document');
        try {
            if (!document.body) {
                console.error('BugReel: document.body missing; cannot add toolbar');
                return;
            }
            
            document.body.appendChild(toolbar);
            console.log('BugReel: toolbar added to document');
            
            const addedToolbar = document.getElementById('bugreel-toolbar');
            if (addedToolbar) {
                console.log('BugReel: toolbar verified in DOM');
            } else {
                console.error('BugReel: toolbar not found after add');
            }
            
        } catch (error) {
            console.error('BugReel: error adding toolbar to body', error);
        }

        // Set up event listeners
        console.log('BugReel: wiring toolbar events');
        try {
            setupToolbarEventListeners();
            console.log('BugReel: toolbar events wired');
        } catch (error) {
            console.error('BugReel: error wiring toolbar events', error);
        }

        // Enable drag-to-move
        try { setupToolbarDrag(); } catch (error) { console.error('BugReel: drag init error', error); }

        // Initialize icon graphics
        try { refreshAudioIcons(); } catch (error) { console.error('BugReel: icon init error', error); }

        // Start the recording timer
        console.log('BugReel: starting on-screen timer');
        try {
            startRecordingTimer();
            console.log('BugReel: timer started');
        } catch (error) {
            console.error('BugReel: timer start error', error);
        }
        
        console.log('BugReel: toolbar ready');
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
                audioToggle.setAttribute('aria-pressed', String(isAudioEnabled));
                refreshAudioIcons();
                chrome.runtime.sendMessage({ type: 'TOGGLE_AUDIO_RECORDING', enabled: isAudioEnabled });
            });
        }
        
        if (micToggle) {
            micToggle.addEventListener('click', () => {
                isMicrophoneEnabled = !isMicrophoneEnabled;
                micToggle.setAttribute('aria-pressed', String(isMicrophoneEnabled));
                refreshAudioIcons();
                chrome.runtime.sendMessage({ type: 'TOGGLE_MICROPHONE_RECORDING', enabled: isMicrophoneEnabled });
            });
        }
        
        if (pauseToggle) {
            pauseToggle.addEventListener('click', () => {
                const isPaused = pauseToggle.getAttribute('data-paused') === 'true';
                const nextPaused = !isPaused;
                pauseToggle.setAttribute('data-paused', String(nextPaused));
                pauseToggle.textContent = nextPaused ? '▶' : '⏸';

                if (nextPaused) {
                    const now = Date.now();
                    pausedElapsedSeconds = startTime ? Math.max(0, Math.floor((now - startTime) / 1000)) : 0;
                    freezeTimer();
                } else {
                    startRecordingTimer(pausedElapsedSeconds);
                }

                chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE_RECORDING', paused: nextPaused });
            });
        }
        
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                stopRecording();
            });
        }
        
        // Note: minimalist UI no longer has a minimize button
    }

    function iconMic(on = true) {
        return on
            ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 20v3" stroke="currentColor" stroke-width="2"/></svg>'
            : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" fill="currentColor" opacity=".5"/><path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" fill="none" opacity=".5"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2"/></svg>';
    }

    function iconSpeaker(on = true) {
        return on
            ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 9v6h4l5 4V5L7 9H3Z" fill="currentColor"/><path d="M16.5 12a4.5 4.5 0 0 0-2.3-3.9v7.8a4.5 4.5 0 0 0 2.3-3.9Z" fill="currentColor"/><path d="M19 12a7 7 0 0 0-3.5-6.1v2.2A4.9 4.9 0 0 1 17 12c0 1.9-1.1 3.6-2.5 4.9v2.2A7 7 0 0 0 19 12Z" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 9v6h4l5 4V5L7 9H3Z" fill="currentColor" opacity=".5"/><path d="M19 12a7 7 0 0 0-3.5-6.1v2.2A4.9 4.9 0 0 1 17 12c0 1.9-1.1 3.6-2.5 4.9v2.2A7 7 0 0 0 19 12Z" fill="currentColor" opacity=".4"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2"/></svg>';
    }

    function refreshAudioIcons() {
        const audioBtn = document.getElementById('bugreel-audio-btn');
        const micBtn = document.getElementById('bugreel-mic-btn');
        if (audioBtn) audioBtn.innerHTML = iconSpeaker(isAudioEnabled);
        if (micBtn) micBtn.innerHTML = iconMic(isMicrophoneEnabled);
    }

    function setupToolbarDrag() {
        const container = document.querySelector('#bugreel-toolbar > div');
        const bar = container ? container.querySelector('.br-bar') : null;
        if (!container || !bar) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let originLeft = 0;
        let originTop = 0;

        const onPointerDown = (e) => {
            // Only start drag when pressing on empty bar area, not on buttons
            if (e.target.closest('.br-btn')) return;
            isDragging = true;
            bar.classList.add('dragging');
            startX = e.clientX;
            startY = e.clientY;
            const rect = container.getBoundingClientRect();
            originLeft = rect.left;
            originTop = rect.top;
            container.style.left = originLeft + 'px';
            container.style.top = originTop + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            container.style.transform = 'none';
            container.style.position = 'fixed';
            window.addEventListener('pointermove', onPointerMove, { passive: true });
            window.addEventListener('pointerup', onPointerUp, { once: true });
        };

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        const onPointerMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const barRect = container.getBoundingClientRect();
            const newLeft = clamp(originLeft + dx, 8, vw - barRect.width - 8);
            const newTop = clamp(originTop + dy, 8, vh - barRect.height - 8);
            container.style.left = newLeft + 'px';
            container.style.top = newTop + 'px';
        };

        const onPointerUp = () => {
            isDragging = false;
            bar.classList.remove('dragging');
            window.removeEventListener('pointermove', onPointerMove, { passive: true });
        };

        bar.addEventListener('pointerdown', onPointerDown);
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
    let pausedElapsedSeconds = 0;
    
    function startRecordingTimer(initialElapsedSeconds = 0) {
        pausedElapsedSeconds = initialElapsedSeconds || 0;
        startTime = Date.now() - (pausedElapsedSeconds * 1000);
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

    function freezeTimer() {
        if (window.bugReelTimer) {
            clearInterval(window.bugReelTimer);
            window.bugReelTimer = null;
        }
    }
    
    // Override console methods
    function overrideConsole() {
        ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
            console[level] = function(...args) {
                // Suppress tool-internal logs from page console and from report capture
                const isInternal = args.some(a => typeof a === 'string' && /(BugReel|CONTENT|OFFSCREEN|SERVICE WORKER|ServiceWorker|Offscreen)/i.test(a));
                if (isInternal) {
                    return; // do not forward or print
                }
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
                
                case 'FREEZE_TIMER':
                    console.log('CONTENT: ⏸️ Freezing timer display');
                    freezeTimer();
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