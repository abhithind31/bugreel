// Service worker for BugReel
console.log('ServiceWorker: loaded at', new Date().toISOString());

// Session storage keys
const STORAGE_KEYS = {
    RECORDING_STATE: 'isRecording',
    CONSOLE_LOGS: 'consoleLogs',
    NETWORK_LOGS: 'networkLogs',
    USER_ACTIONS: 'userActions',
    ENVIRONMENT_DATA: 'environmentData',
    RECORDING_START_TIME: 'recordingStartTime',
    VIDEO_DATA: 'videoData',
    VIDEO_ERROR: 'videoError' // Added for video recording errors
};

let serviceWorkerStartTime = Date.now();
console.log('ServiceWorker: start time', new Date(serviceWorkerStartTime).toISOString());

// Offscreen document management
let offscreenDocumentPromise = null;

// In-memory storage for large video data (Chrome storage.session has 1MB limit)
let videoDataInMemory = null;

// PII/Secret Scrubbing Configuration (Phase 3)
const PII_PATTERNS = {
    // Header patterns (case insensitive)
    sensitiveHeaders: [
        /^authorization$/i,
        /^x-api-key$/i,
        /^cookie$/i,
        /^set-cookie$/i,
        /^x-auth-token$/i,
        /^bearer$/i,
        /^basic$/i,
        /^api-key$/i,
        /^access-token$/i,
        /^refresh-token$/i,
        /^session-id$/i,
        /^csrf-token$/i,
        /^x-csrf-token$/i
    ],
    
    // JSON body key patterns (case insensitive)
    sensitiveKeys: [
        /password/i,
        /passwd/i,
        /pwd/i,
        /secret/i,
        /token/i,
        /key/i,
        /auth/i,
        /credential/i,
        /signature/i,
        /hash/i,
        /salt/i,
        /nonce/i,
        /sessionid/i,
        /session_id/i,
        /access_token/i,
        /refresh_token/i,
        /api_key/i,
        /private_key/i,
        /public_key/i,
        /oauth/i,
        /jwt/i,
        /bearer/i,
        /ssn/i,
        /social_security/i,
        /credit_card/i,
        /creditcard/i,
        /card_number/i,
        /cvv/i,
        /cvc/i,
        /pin/i,
        /license/i,
        /passport/i,
        /id_number/i
    ],
    
    // Value patterns (exact matches)
    sensitiveValues: [
        // JWT tokens
        /^ey[A-Za-z0-9-_=]+\.ey[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/,
        // AWS access keys
        /^AKIA[0-9A-Z]{16}$/,
        // AWS secret keys (40 chars base64)
        /^[A-Za-z0-9/+=]{40}$/,
        // Generic API keys (32+ alphanumeric chars)
        /^[A-Za-z0-9]{32,}$/,
        // Credit card patterns
        /^\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}$/,
        // SSN patterns
        /^\d{3}-?\d{2}-?\d{4}$/,
        // Email patterns (in some contexts might be PII)
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        // Phone numbers
        /^(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/,
        // UUIDs (sometimes used as secrets)
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    ],
    
    // URL patterns for sensitive data
    sensitiveUrlPatterns: [
        /[?&](password|pwd|token|key|secret|auth|credential)=[^&]+/gi,
        /[?&](access_token|refresh_token|api_key|session_id)=[^&]+/gi,
        /[?&](oauth|jwt|bearer)=[^&]+/gi
    ]
};

const PII_REPLACEMENT = '[REDACTED]';

// PII Scrubbing Functions (Phase 3)
function scrubPiiFromString(text) {
    if (typeof text !== 'string') {
        return text;
    }
    
    let scrubbedText = text;
    
    // Scrub based on value patterns
    PII_PATTERNS.sensitiveValues.forEach(pattern => {
        scrubbedText = scrubbedText.replace(pattern, PII_REPLACEMENT);
    });
    
    return scrubbedText;
}

function scrubPiiFromObject(obj, depth = 0) {
    if (depth > 10) {
        return obj; // Prevent infinite recursion
    }
    
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'string') {
        return scrubPiiFromString(obj);
    }
    
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => scrubPiiFromObject(item, depth + 1));
    }
    
    if (typeof obj === 'object') {
        const scrubbedObj = {};
        
        for (const [key, value] of Object.entries(obj)) {
            const lowerKey = key.toLowerCase();
            
            // Check if key matches sensitive patterns
            const isSensitiveKey = PII_PATTERNS.sensitiveKeys.some(pattern => pattern.test(lowerKey));
            
            if (isSensitiveKey) {
                scrubbedObj[key] = PII_REPLACEMENT;
            } else {
                scrubbedObj[key] = scrubPiiFromObject(value, depth + 1);
            }
        }
        
        return scrubbedObj;
    }
    
    return obj;
}

function scrubPiiFromHeaders(headers) {
    if (!headers || !Array.isArray(headers)) {
        return headers;
    }
    
    return headers.map(header => {
        const headerName = header.name ? header.name.toLowerCase() : '';
        const isSensitive = PII_PATTERNS.sensitiveHeaders.some(pattern => pattern.test(headerName));
        
        return {
            name: header.name,
            value: isSensitive ? PII_REPLACEMENT : header.value
        };
    });
}

function scrubPiiFromUrl(url) {
    if (typeof url !== 'string') {
        return url;
    }
    
    let scrubbedUrl = url;
    
    // Scrub sensitive URL parameters
    PII_PATTERNS.sensitiveUrlPatterns.forEach(pattern => {
        scrubbedUrl = scrubbedUrl.replace(pattern, (match, param) => {
            return match.replace(/=[^&]+/, `=${PII_REPLACEMENT}`);
        });
    });
    
    return scrubbedUrl;
}

function scrubPiiFromNetworkRequest(request) {
    if (!request) {
        return request;
    }
    
    return {
        ...request,
        url: scrubPiiFromUrl(request.url),
        requestHeaders: scrubPiiFromHeaders(request.requestHeaders),
        responseHeaders: scrubPiiFromHeaders(request.responseHeaders),
        requestBody: request.requestBody ? scrubPiiFromObject(request.requestBody) : request.requestBody,
        responseBody: request.responseBody ? scrubPiiFromResponseBody(request.responseBody, request.responseBodyEncoding) : request.responseBody,
        responseBodyEncoding: request.responseBodyEncoding
    };
}

function scrubPiiFromResponseBody(responseBody, encoding) {
    if (!responseBody) {
        return responseBody;
    }
    
    try {
        let bodyToScrub = responseBody;
        
        // If it's base64 encoded, decode it first for scrubbing (but we'll keep the truncated version)
        if (encoding === 'base64') {
            try {
                bodyToScrub = atob(responseBody);
            } catch (error) {
                // If decoding fails, treat as text
                bodyToScrub = responseBody;
            }
        }
        
        // Try to parse as JSON first
        try {
            const jsonData = JSON.parse(bodyToScrub);
            const scrubbedJson = scrubPiiFromObject(jsonData);
            return JSON.stringify(scrubbedJson);
        } catch (jsonError) {
            // Not JSON, scrub as string
            return scrubPiiFromString(bodyToScrub);
        }
    } catch (error) {
        console.error('SERVICE WORKER: Error scrubbing response body:', error);
        return responseBody; // Return original if scrubbing fails
    }
}

function scrubPiiFromConsoleLog(log) {
    if (!log) {
        return log;
    }
    
    return {
        ...log,
        message: scrubPiiFromString(log.message),
        args: log.args ? scrubPiiFromObject(log.args) : log.args
    };
}

function scrubPiiFromUserAction(action) {
    if (!action) {
        return action;
    }
    
    return {
        ...action,
        text: action.text ? scrubPiiFromString(action.text) : action.text,
        value: action.value ? scrubPiiFromString(action.value) : action.value,
        url: action.url ? scrubPiiFromUrl(action.url) : action.url
    };
}

// Initialize storage
chrome.runtime.onInstalled.addListener(async () => {
    await resetSessionData();
    console.log('SERVICE WORKER: BugReel installed and initialized');
});

// Service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('SERVICE WORKER: Service worker started');
});

// Track tab navigation during recording
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
        console.log('SERVICE WORKER: 🔄 Navigation event detected - Tab:', tabId, 'URL:', changeInfo.url || tab.url, 'Status:', changeInfo.status);
        
        const isRecording = await getRecordingState();
        console.log('SERVICE WORKER: 📊 Current recording state:', isRecording);
        
        if (!isRecording) {
            console.log('SERVICE WORKER: ⏹️ Not recording, ignoring navigation');
            return;
        }

        // Get current active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || activeTab.id !== tabId) {
            console.log('SERVICE WORKER: 🚫 Not active tab (current active:', activeTab?.id, 'event tab:', tabId, '), ignoring navigation');
            return;
        }

        console.log('SERVICE WORKER: ✅ Active tab navigation detected, need to re-inject content script');

        // Re-inject on any URL change or status change
        // NOTE: Video recording continues seamlessly in the offscreen document
        // Only the content script (UI and logging) needs to be re-injected
        if (changeInfo.url || changeInfo.status === 'complete') {
            console.log('SERVICE WORKER: 🔄 Re-injecting content script due to navigation (video recording continues uninterrupted)');
            
            // Add a small delay to ensure the new page is ready
            if (changeInfo.status === 'complete') {
                console.log('SERVICE WORKER: ⏰ Page complete, waiting 500ms before re-injection...');
                setTimeout(async () => {
                    try {
                        await reinjectContentScript(tabId);
                    } catch (error) {
                        console.error('SERVICE WORKER: ❌ Delayed re-injection failed:', error);
                    }
                }, 500);
            } else {
                // Immediate re-injection for URL changes
                await reinjectContentScript(tabId);
            }
        }
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error handling tab navigation:', error);
    }
});

// Content script re-injection function
async function reinjectContentScript(tabId) {
    console.log('ServiceWorker: re-inject content script for tab', tabId);
    
    try {
        // Remove any existing toolbar first
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'REMOVE_TOOLBAR' });
        } catch (error) {
            // Ignore errors - toolbar might not exist
        }
        
        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Inject the content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        
        // Wait for script to load
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Start logging - video recording continues in background
        await chrome.tabs.sendMessage(tabId, {
            type: 'START_LOGGING',
            recordingMode: 'video'
        });
        
        console.log('SERVICE WORKER: Content script re-injected successfully (video recording unaffected)');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error re-injecting content script:', error);
        
        // Retry once after a short delay
        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
            await chrome.tabs.sendMessage(tabId, {
                type: 'START_LOGGING',
                recordingMode: 'video'
            });
            
            console.log('SERVICE WORKER: Content script re-injected successfully on retry');
        } catch (retryError) {
            console.error('SERVICE WORKER: Failed to re-inject content script even on retry:', retryError);
        }
    }
}

// Message handler for popup and content script communication
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // minimal logging only for service worker diagnostics
    
    try {
        switch (message.type) {
            case 'NETWORK_RESPONSE_BODY':
                // Handle response body captured by content script
                handleNetworkResponseBody(message);
                sendResponse({ success: true });
                break;
                
            case 'START_CAPTURE':
                console.log('ServiceWorker: START_CAPTURE');
                await startCapture();
                sendResponse({ success: true });
                break;
                
            case 'STOP_CAPTURE':
                console.log('ServiceWorker: STOP_CAPTURE');
                await stopCapture();
                sendResponse({ success: true });
                break;
                
            case 'GET_RECORDING_STATE':
                const isRecording = await getRecordingState();
                sendResponse({ isRecording });
                break;
                
            case 'CONSOLE_LOG':
                console.log('SERVICE WORKER: 📝 Console log received:', message.payload);
                await handleConsoleLog(message.payload);
                sendResponse({ success: true });
                break;
                
            case 'USER_ACTION':
                await handleUserAction(message.payload);
                break;
                
                    case 'ENVIRONMENT_DATA':
            await handleEnvironmentData(message.payload);
            break;
            
        case 'VIDEO_RECORDED':
            console.log('ServiceWorker: VIDEO_RECORDED');
            await handleVideoRecorded(message.payload);
            break;
            
        case 'VIDEO_ERROR':
            console.error('ServiceWorker: VIDEO_ERROR', message.payload);
            await handleVideoError(message.payload);
            break;
            
        case 'DEBUG_TOOLBAR_ONLY':
            console.log('SERVICE WORKER: Handling DEBUG_TOOLBAR_ONLY');
            await debugToolbarOnly();
            sendResponse({ success: true });
            break;
            
        case 'SAVE_REPORT':
            console.log('SERVICE WORKER: Handling SAVE_REPORT');
            await saveReportFromPreview(message.notes);
            sendResponse({ success: true });
            break;
        case 'GET_ENVIRONMENT_DATA':
            try {
                const env = await getStoredData(STORAGE_KEYS.ENVIRONMENT_DATA);
                sendResponse({ success: true, environmentData: env });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
            break;
            
        case 'CANCEL_PREVIEW':
            console.log('SERVICE WORKER: Handling CANCEL_PREVIEW');
            await cancelPreview();
            sendResponse({ success: true });
            break;
            
        case 'RESTART_RECORDING':
            console.log('SERVICE WORKER: Handling RESTART_RECORDING');
            await restartRecording();
            sendResponse({ success: true });
            break;
            
        case 'TEST_VIDEO_RECORDING':
            console.log('SERVICE WORKER: Handling TEST_VIDEO_RECORDING');
            try {
                await startVideoRecording();
                sendResponse({ success: true });
                // Stop the recording immediately after starting
                setTimeout(async () => {
                    try {
                        await stopVideoRecording();
                        console.log('SERVICE WORKER: Test video recording stopped');
                    } catch (error) {
                        console.error('SERVICE WORKER: Error stopping test recording:', error);
                    }
                }, 1000);
            } catch (error) {
                console.error('SERVICE WORKER: Test video recording failed:', error);
                sendResponse({ success: false, error: error.message });
            }
            break;
            
        case 'PING':
            sendResponse({ success: true, pong: true });
            break;
            
        case 'PING_OFFSCREEN':
            try {
                await ensureOffscreenDocument();
                const response = await chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' });
                sendResponse({ success: true, offscreen: response });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            break;
            
        default:
            console.warn('ServiceWorker: unknown message type', message.type);
        }
    } catch (error) {
        console.error('ServiceWorker: message handler error', error);
        sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep message channel open for async response
});

// Debug function to test only toolbar creation
async function debugToolbarOnly() {
    try {
        console.log('SERVICE WORKER: DEBUG - Testing toolbar only...');
        
        // Set recording state
        await setRecordingState(true, 'Debug toolbar test started');
        await chrome.storage.session.set({
            [STORAGE_KEYS.RECORDING_START_TIME]: Date.now()
        });
        console.log('SERVICE WORKER: DEBUG - ✓ Recording state set');
        
        // Get current active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
            throw new Error('No active tab found');
        }
        
        console.log('SERVICE WORKER: DEBUG - ✓ Active tab found:', activeTab.id, activeTab.url);
        
        // Skip video recording and network logging - just inject content script
        console.log('SERVICE WORKER: DEBUG - Injecting content script...');
        try {
            await injectContentScript(activeTab.id);
            console.log('SERVICE WORKER: DEBUG - ✅ Content script injected successfully');
        } catch (contentError) {
            console.error('SERVICE WORKER: DEBUG - ❌ Content script injection failed:', contentError);
            throw contentError;
        }
        
        console.log('SERVICE WORKER: DEBUG - ✅ Toolbar-only test completed successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: DEBUG - ❌ Error in toolbar-only test:', error);
        
        // Reset recording state on error
        await setRecordingState(false, 'Error during debug toolbar test');
        
        throw error;
    }
}

// Start capture process
async function startCapture() {
    try {
        console.log('SERVICE WORKER: Starting capture process...');
        
        // Clear any existing data FIRST
        await resetSessionData();
        console.log('SERVICE WORKER: ✓ Session data reset');
        
        // Set recording state AFTER clearing data
        await setRecordingState(true, 'User started recording');
        await chrome.storage.session.set({
            [STORAGE_KEYS.RECORDING_START_TIME]: Date.now()
        });
        console.log('SERVICE WORKER: ✓ Recording state set');
        
        // Get current active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
            throw new Error('No active tab found');
        }
        
        console.log('SERVICE WORKER: ✓ Active tab found:', activeTab.id, activeTab.url);
        
        // Start video recording FIRST - this is independent of navigation
        // The offscreen document will handle continuous recording even during navigation
        console.log('SERVICE WORKER: Starting video recording...');
        try {
            await startVideoRecording();
            console.log('SERVICE WORKER: ✓ Video recording started successfully');
        } catch (videoError) {
            console.error('SERVICE WORKER: ❌ Video recording failed:', videoError);
            
            // Store the error for debugging
            await chrome.storage.session.set({
                [STORAGE_KEYS.VIDEO_ERROR]: {
                    message: videoError.message,
                    stack: videoError.stack,
                    timestamp: new Date().toISOString()
                }
            });
            
            console.warn('SERVICE WORKER: ⚠️ Video recording failed, but continuing with data-only capture');
            // Don't fail the whole process if video recording fails
        }
        
        // Start network logging
        console.log('SERVICE WORKER: Starting network logging...');
        try {
            await startNetworkLogging();
            console.log('SERVICE WORKER: ✓ Network logging started successfully');
        } catch (networkError) {
            console.warn('SERVICE WORKER: ⚠️ Network logging failed, but continuing:', networkError);
            // Don't fail the whole process if network logging fails
        }
        
        // Inject content script for console logging and UI - THIS IS CRITICAL FOR TOOLBAR
        console.log('SERVICE WORKER: Injecting content script...');
        try {
            await injectContentScript(activeTab.id);
            console.log('SERVICE WORKER: ✓ Content script injected successfully');
        } catch (contentError) {
            console.error('SERVICE WORKER: ❌ Content script injection failed:', contentError);
            // This is critical - if content script fails, we need to know
            throw contentError;
        }
        
        console.log('SERVICE WORKER: ✅ Capture started successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error starting capture:', error);
        
        // Reset recording state on error
        await setRecordingState(false, 'Error during startup: ' + error.message);
        
        throw error;
    }
}

// Stop capture process
async function stopCapture() {
    try {
        console.log('SERVICE WORKER: Stopping capture...');
        
        // Set recording state
        await setRecordingState(false, 'User stopped recording');
        console.log('SERVICE WORKER: Recording state set to false');
        
        // Stop network request logging
        await stopNetworkLogging();
        console.log('SERVICE WORKER: Network logging stopped');
        
        // Stop video recording
        await stopVideoRecording();
        console.log('SERVICE WORKER: Video recording stopped');
        
        // Get the active tab and send stop message to content script
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
            try {
                // Freeze the on-page timer immediately for better UX
                try {
                    await chrome.tabs.sendMessage(activeTab.id, { type: 'FREEZE_TIMER' });
                } catch (e) {
                    // Ignore if content script is not reachable
                }
                await chrome.tabs.sendMessage(activeTab.id, {
                    type: 'STOP_LOGGING'
                });
                console.log('SERVICE WORKER: Stop message sent to content script');
            } catch (error) {
                console.warn('Could not send stop message to content script:', error);
            }
        }
        
        // Set flag to generate preview after video processing
        console.log('SERVICE WORKER: Capture stopped successfully. Waiting for video processing...');
        
        // Store a flag that we need to generate preview after video processing
        await chrome.storage.session.set({
            waitingForVideoProcessing: true
        });
        
        // Set a timeout to generate preview even if no video data is received
        setTimeout(async () => {
            try {
                const data = await chrome.storage.session.get('waitingForVideoProcessing');
                if (data.waitingForVideoProcessing) {
                    console.log('SERVICE WORKER: ⏰ Video processing timeout - generating preview without video');
                    await chrome.storage.session.remove('waitingForVideoProcessing');
                    await generatePreview();
                    console.log('SERVICE WORKER: 📋 Preview generation completed (timeout)');
                }
            } catch (error) {
                console.error('SERVICE WORKER: Error in video processing timeout:', error);
            }
        }, 3000); // 3 second timeout
        
    } catch (error) {
        console.error('SERVICE WORKER: Error stopping capture:', error);
        throw error;
    }
}

// Inject content script into active tab
async function injectContentScript(tabId) {
    try {
        console.log('SERVICE WORKER: Injecting content script for tab:', tabId);
        
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        
        // Wait for script to load
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Send start logging message
        await chrome.tabs.sendMessage(tabId, {
            type: 'START_LOGGING',
            recordingMode: 'video'
        });
        
        console.log('SERVICE WORKER: Content script injected and START_LOGGING message sent successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error injecting content script:', error);
        
        // Retry once after a short delay
        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
            await chrome.tabs.sendMessage(tabId, {
                type: 'START_LOGGING',
                recordingMode: 'video'
            });
            
            console.log('SERVICE WORKER: Content script injected successfully on retry');
        } catch (retryError) {
            console.error('SERVICE WORKER: Failed to inject content script even on retry:', retryError);
            throw retryError;
        }
    }
}

// Network request logging
let networkRequestsInFlight = new Map();
let debuggerAttached = false;
let currentTabId = null;
let fallbackFetchesInProgress = new Set(); // Track URLs being fetched to prevent duplicates

async function startNetworkLogging() {
    chrome.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        { urls: ['<all_urls>'] },
        ['requestBody']
    );
    
    chrome.webRequest.onBeforeSendHeaders.addListener(
        onBeforeSendHeaders,
        { urls: ['<all_urls>'] },
        ['requestHeaders']
    );
    
    chrome.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        { urls: ['<all_urls>'] },
        ['responseHeaders']
    );
    
    chrome.webRequest.onCompleted.addListener(
        onCompleted,
        { urls: ['<all_urls>'] },
        ['responseHeaders']
    );
    
    chrome.webRequest.onErrorOccurred.addListener(
        onErrorOccurred,
        { urls: ['<all_urls>'] }
    );
    
    // Start debugger for response body capture
    await startDebuggerForResponseBodies();
    
    // Also try alternative method via content script fetch interception
    await startContentScriptNetworkInterception();
}

async function stopNetworkLogging() {
    chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
    chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    chrome.webRequest.onCompleted.removeListener(onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
    
    // Stop debugger for response body capture
    await stopDebuggerForResponseBodies();
}

// Debugger functions for response body capture
async function startDebuggerForResponseBodies() {
    try {
        // Get current active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            currentTabId = tabs[0].id;
            
            console.log('SERVICE WORKER: Attempting to attach debugger to tab:', currentTabId);
            
            // Attach debugger to the tab
            await chrome.debugger.attach({ tabId: currentTabId }, '1.3');
            debuggerAttached = true;
            
            console.log('SERVICE WORKER: ✅ Debugger attached successfully');
            
            // Enable Network domain
            await chrome.debugger.sendCommand({ tabId: currentTabId }, 'Network.enable');
            console.log('SERVICE WORKER: ✅ Network domain enabled');
            
            // Listen for Network.responseReceived events
            chrome.debugger.onEvent.addListener(onDebuggerEvent);
            
            console.log('SERVICE WORKER: ✅ Debugger event listener added for response body capture');
        } else {
            console.error('SERVICE WORKER: No active tab found for debugger attachment');
        }
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Failed to attach debugger:', error);
        debuggerAttached = false;
        
        // Try alternative approach - just log but continue without response bodies
        console.log('SERVICE WORKER: Continuing without response body capture. Error details:', {
            message: error.message,
            stack: error.stack
        });
    }
}

async function stopDebuggerForResponseBodies() {
    try {
        if (debuggerAttached && currentTabId) {
            chrome.debugger.onEvent.removeListener(onDebuggerEvent);
            await chrome.debugger.detach({ tabId: currentTabId });
            debuggerAttached = false;
            currentTabId = null;
            console.log('SERVICE WORKER: Debugger detached');
        }
    } catch (error) {
        console.error('SERVICE WORKER: Failed to detach debugger:', error);
    }
}

async function onDebuggerEvent(source, method, params) {
    if (source.tabId !== currentTabId) return;
    
    console.log('SERVICE WORKER: Debugger event received:', method, 'for tab:', source.tabId);
    
    if (method === 'Network.responseReceived') {
        const requestId = params.requestId;
        const request = networkRequestsInFlight.get(requestId);
        
        console.log('SERVICE WORKER: Response received for request:', requestId, 'URL:', params.response?.url);
        
        if (request) {
            // Wait a bit for the response to be fully loaded
            setTimeout(async () => {
                try {
                    // Get response body
                    const response = await chrome.debugger.sendCommand(
                        { tabId: currentTabId },
                        'Network.getResponseBody',
                        { requestId: requestId }
                    );
                    
                    console.log('SERVICE WORKER: getResponseBody response:', {
                        requestId,
                        url: request.url,
                        hasBody: !!response?.body,
                        bodyLength: response?.body?.length || 0,
                        isBase64: response?.base64Encoded,
                        requestType: request.type,
                        statusCode: request.statusCode,
                        contentType: request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value,
                        contentEncoding: request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-encoding')?.value,
                        contentLength: request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value,
                        response
                    });
                    
                    if (response && response.body) {
                        request.responseBody = truncateResponseBody(response.body, response.base64Encoded);
                        request.responseBodyEncoding = response.base64Encoded ? 'base64' : 'text';
                        console.log('SERVICE WORKER: ✅ Response body captured for', request.url, 'Length:', response.body.length);
                    } else {
                        // Check if this is a navigation request (main document)
                        const isMainDocument = request.type === 'main_frame' || request.type === 'document';
                        const contentEncoding = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-encoding')?.value;
                        
                        if (isMainDocument) {
                            const statusCode = request.statusCode;
                            const contentLength = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value;
                            const contentType = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
                            
                            // Check if this is actually a JSON API endpoint accessed via navigation
                            if (contentType.includes('application/json')) {
                                // Treat this as a compressed JSON response, not a main document
                                if (contentEncoding === 'gzip' || contentEncoding === 'br' || contentEncoding === 'zstd') {
                                    try {
                                        // Attempt to fetch with no-compression headers to get JSON content
                                        const jsonResponse = await fetch(request.url, {
                                            headers: { 'Accept-Encoding': 'identity', 'Accept': 'application/json' },
                                            method: 'GET'
                                        });
                                        
                                        if (jsonResponse.ok) {
                                            const jsonText = await jsonResponse.text();
                                            request.responseBody = truncateResponseBody(jsonText, false);
                                            request.responseBodyEncoding = 'text';
                                            console.log('SERVICE WORKER: ✅ Got JSON content for main document navigation:', request.url);
                                        } else {
                                            throw new Error('Fetch failed');
                                        }
                                    } catch (fetchError) {
                                        request.responseBody = `[Compressed JSON API Response - ${contentEncoding}]\n\nContent-Type: ${contentType}\nContent-Length: ${contentLength || 'Unknown'} bytes\n\nThis is a JSON API endpoint accessed via browser navigation. The response is compressed and cannot be accessed via Chrome debugger API.\n\nTypical content:\n• JSON data array or object\n• API response data\n• Structured information`;
                                        console.log('SERVICE WORKER: ℹ️ Could not fetch uncompressed JSON for main document:', fetchError.message);
                                    }
                                } else {
                                    // Uncompressed JSON - try to fetch it
                                    try {
                                        const jsonResponse = await fetch(request.url, {
                                            headers: { 'Accept': 'application/json' },
                                            method: 'GET'
                                        });
                                        
                                        if (jsonResponse.ok) {
                                            const jsonText = await jsonResponse.text();
                                            request.responseBody = truncateResponseBody(jsonText, false);
                                            request.responseBodyEncoding = 'text';
                                            console.log('SERVICE WORKER: ✅ Got JSON content for main document navigation:', request.url);
                                        } else {
                                            throw new Error('Fetch failed');
                                        }
                                    } catch (fetchError) {
                                        request.responseBody = `[JSON API Response - Navigation]\n\nContent-Type: ${contentType}\nContent-Length: ${contentLength || 'Unknown'} bytes\n\nThis is a JSON API endpoint accessed via browser navigation, but content could not be fetched.`;
                                        console.log('SERVICE WORKER: ℹ️ Could not fetch JSON for main document:', fetchError.message);
                                    }
                                }
                            } else if (statusCode >= 400) {
                                // Try to fetch the error page content
                                try {
                                    const errorPageResponse = await fetch(request.url, {
                                        method: 'GET',
                                        headers: { 'Accept': 'text/html' }
                                    });
                                    
                                    if (errorPageResponse.status === statusCode) {
                                        const errorHtml = await errorPageResponse.text();
                                        const truncatedHtml = errorHtml.substring(0, 500);
                                        request.responseBody = `[${statusCode} Error Page - Content fetched:]\n\n${truncatedHtml}${errorHtml.length > 500 ? '\n\n[Content truncated - full error page was ' + errorHtml.length + ' characters]' : ''}`;
                                        console.log('SERVICE WORKER: ✅ Fetched error page content for', request.url);
                                    } else {
                                        throw new Error('Status mismatch');
                                    }
                                } catch (fetchError) {
                                    request.responseBody = `[${statusCode} Error Page - Main document navigation]\n\nContent-Length: ${contentLength || 'Unknown'} bytes\n\nThis is likely an error page (HTML) but cannot be accessed via Chrome debugger API for main document navigations.\n\nTypical content:\n• Error message and description\n• Page not found information\n• Site navigation/branding\n• Troubleshooting links\n\nNote: To see the actual error page content, view the page directly in the browser tab.`;
                                    console.log('SERVICE WORKER: ℹ️ Could not fetch error page content:', fetchError.message);
                                }
                            } else {
                                request.responseBody = `[Main document response - HTML page]\n\nContent-Length: ${contentLength || 'Unknown'} bytes\n\nThis is a full HTML page but cannot be accessed via Chrome debugger API for main document navigations.`;
                            }
                            console.log('SERVICE WORKER: ℹ️ Main document request detected for', request.url, 'Status:', statusCode);
                        } else if (contentEncoding === 'gzip' || contentEncoding === 'br' || contentEncoding === 'zstd') {
                            const contentType = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
                            const fileExtension = request.url.split('.').pop()?.split('?')[0];
                            
                            // Try to fetch a small sample if it's a text-based resource
                            if (contentType.includes('javascript') || contentType.includes('css') || contentType.includes('json') || contentType.includes('text/')) {
                                try {
                                    // Attempt to fetch with no-compression headers
                                    const sampleResponse = await fetch(request.url, {
                                        headers: { 'Accept-Encoding': 'identity' },
                                        method: 'GET'
                                    });
                                    
                                    if (sampleResponse.ok) {
                                        const sampleText = await sampleResponse.text();
                                        request.responseBody = `[Compressed ${contentEncoding} response - Sample uncompressed content:]\n\n${sampleText.substring(0, 200)}${sampleText.length > 200 ? '...\n\n[Content truncated - full response was compressed]' : ''}`;
                                        console.log('SERVICE WORKER: ✅ Got uncompressed sample for', request.url);
                                    } else {
                                        throw new Error('Fetch failed');
                                    }
                                } catch (fetchError) {
                                    request.responseBody = `[Compressed ${contentEncoding} response - Content-Type: ${contentType}${fileExtension ? ', File: .' + fileExtension : ''}]\n\nNote: Compressed responses cannot be accessed via Chrome debugger API. This typically contains:\n${getTypicalContent(contentType, fileExtension)}`;
                                    console.log('SERVICE WORKER: ℹ️ Could not fetch uncompressed version:', fetchError.message);
                                }
                            } else {
                                request.responseBody = `[Compressed ${contentEncoding} response - Content-Type: ${contentType}${fileExtension ? ', File: .' + fileExtension : ''}]\n\nNote: Compressed responses cannot be accessed via Chrome debugger API. This typically contains:\n${getTypicalContent(contentType, fileExtension)}`;
                            }
                            
                            console.log('SERVICE WORKER: ℹ️ Compressed response detected for', request.url, 'Type:', contentType, 'Encoding:', contentEncoding);
                        } else {
                            // Analyze why there's no response body
                            const contentLength = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value;
                            const statusCode = request.statusCode;
                            
                            if (contentLength === '0') {
                                request.responseBody = `[Empty response - Server sent Content-Length: 0]\n\nThis is normal for:\n• Analytics/telemetry endpoints\n• Status/health checks\n• Fire-and-forget API calls\n• ${statusCode === 202 ? 'Async processing (202 Accepted)' : 'Success confirmations'}`;
                            } else if (statusCode === 204) {
                                request.responseBody = `[204 No Content - Success with no response body]`;
                            } else if (statusCode >= 300 && statusCode < 400) {
                                request.responseBody = `[${statusCode} Redirect - No body content]`;
                            } else {
                                request.responseBody = null;
                            }
                            console.log('SERVICE WORKER: ⚠️ No response body for', request.url, 'Content-Length:', contentLength, 'Status:', statusCode);
                        }
                    }
                } catch (error) {
                    // Some requests may not have response bodies or may fail to retrieve
                    request.responseBody = null;
                    console.log('SERVICE WORKER: ❌ Could not get response body for request:', requestId, 'URL:', request.url, 'Error:', error.message);
                }
            }, 100); // Wait 100ms for response to be fully loaded
        } else {
            console.log('SERVICE WORKER: ⚠️ No request found in flight map for:', requestId);
        }
    }
    
    if (method === 'Network.loadingFinished') {
        const requestId = params.requestId;
        const request = networkRequestsInFlight.get(requestId);
        
        if (request && !request.responseBody) {
            // Try to get response body when loading is finished
            setTimeout(async () => {
                try {
                    const response = await chrome.debugger.sendCommand(
                        { tabId: currentTabId },
                        'Network.getResponseBody',
                        { requestId: requestId }
                    );
                    
                    if (response && response.body) {
                        request.responseBody = truncateResponseBody(response.body, response.base64Encoded);
                        request.responseBodyEncoding = response.base64Encoded ? 'base64' : 'text';
                        console.log('SERVICE WORKER: ✅ Response body captured on loadingFinished for', request.url);
                    }
                } catch (error) {
                    console.log('SERVICE WORKER: ❌ Failed to get response body on loadingFinished:', error.message);
                }
            }, 50);
        }
    }
}

// Alternative method: Content script network interception
async function startContentScriptNetworkInterception() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            const tabId = tabs[0].id;
            
            // Inject network interception script
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    // Intercept fetch requests
                    const originalFetch = window.fetch;
                    window.fetch = async function(...args) {
                        const response = await originalFetch.apply(this, args);
                        
                        // Clone response to read body
                        const clonedResponse = response.clone();
                        try {
                            const contentType = response.headers.get('content-type') || '';
                            const contentEncoding = response.headers.get('content-encoding') || '';
                            
                            let body = '';
                            if (contentEncoding.includes('gzip') || contentEncoding.includes('br') || contentEncoding.includes('zstd')) {
                                body = `[Compressed response (${contentEncoding})]`;
                            } else if (contentType.includes('text/') || contentType.includes('application/json') || contentType.includes('application/xml')) {
                                const responseText = await clonedResponse.text();
                                body = responseText.substring(0, 300); // Truncate to 300 chars
                            } else {
                                body = `[Binary response: ${contentType}]`;
                            }
                            
                            // Send response body to background script
                            chrome.runtime.sendMessage({
                                type: 'NETWORK_RESPONSE_BODY',
                                url: response.url,
                                status: response.status,
                                body: body,
                                contentType: contentType,
                                contentEncoding: contentEncoding,
                                timestamp: Date.now()
                            });
                        } catch (error) {
                            console.log('Failed to read response body:', error);
                            chrome.runtime.sendMessage({
                                type: 'NETWORK_RESPONSE_BODY',
                                url: response.url,
                                status: response.status,
                                body: `[Error reading response: ${error.message}]`,
                                timestamp: Date.now()
                            });
                        }
                        
                        return response;
                    };
                    
                    // Intercept XMLHttpRequest
                    const originalXHROpen = XMLHttpRequest.prototype.open;
                    const originalXHRSend = XMLHttpRequest.prototype.send;
                    
                    XMLHttpRequest.prototype.open = function(method, url, ...args) {
                        this._url = url;
                        this._method = method;
                        return originalXHROpen.apply(this, [method, url, ...args]);
                    };
                    
                    XMLHttpRequest.prototype.send = function(...args) {
                        this.addEventListener('load', function() {
                            try {
                                const responseText = this.responseText || '';
                                chrome.runtime.sendMessage({
                                    type: 'NETWORK_RESPONSE_BODY',
                                    url: this._url,
                                    status: this.status,
                                    body: responseText.substring(0, 300), // Truncate to 300 chars
                                    timestamp: Date.now()
                                });
                            } catch (error) {
                                console.log('Failed to capture XHR response:', error);
                            }
                        });
                        
                        return originalXHRSend.apply(this, args);
                    };
                }
            });
            
            console.log('SERVICE WORKER: ✅ Content script network interception started');
        }
    } catch (error) {
        console.log('SERVICE WORKER: Failed to start content script network interception:', error);
    }
}

// Handle response body from content script interception
function handleNetworkResponseBody(message) {
    try {
        console.log('SERVICE WORKER: Received response body from content script:', {
            url: message.url,
            status: message.status,
            bodyLength: message.body?.length || 0
        });
        
        // Find matching request by URL and approximate timing
        const requests = Array.from(networkRequestsInFlight.values());
        const recentRequests = requests.filter(req => 
            req.url === message.url && 
            Math.abs(Date.now() - req.startTime) < 10000 // Within 10 seconds
        );
        
        if (recentRequests.length > 0) {
            const request = recentRequests[recentRequests.length - 1]; // Get most recent
            request.responseBody = message.body || 'Empty response';
            request.responseBodyEncoding = 'text';
            console.log('SERVICE WORKER: ✅ Response body attached to request via content script');
        } else {
            console.log('SERVICE WORKER: ⚠️ No matching request found for response body from:', message.url);
        }
    } catch (error) {
        console.log('SERVICE WORKER: Error handling response body from content script:', error);
    }
}

// Helper function to describe typical content for compressed responses
function getTypicalContent(contentType, fileExtension) {
    if (contentType.includes('javascript') || fileExtension === 'js') {
        return `• JavaScript code
• Function definitions
• Event handlers
• DOM manipulation
• AJAX calls
• Libraries/frameworks`;
    } else if (contentType.includes('css') || fileExtension === 'css') {
        return `• CSS styles
• Class definitions
• Media queries
• Animations
• Layout rules`;
    } else if (contentType.includes('html')) {
        return `• HTML markup
• Meta tags
• Scripts and styles
• Page content`;
    } else if (contentType.includes('json')) {
        return `• JSON data
• API responses
• Configuration
• Data objects`;
    } else if (contentType.includes('xml')) {
        return `• XML data
• Structured content
• API responses`;
    } else if (contentType.includes('text/')) {
        return `• Plain text content
• Data files
• Logs or config`;
    } else {
        return `• Binary or encoded content
• Media files
• Compiled assets`;
    }
}

// Function to truncate response body if too large
function truncateResponseBody(body, isBase64Encoded = false) {
    const maxLength = 300; // Maximum characters to keep
    
    if (!body) return body;
    
    if (isBase64Encoded) {
        // For base64 data, we'll decode first to check actual content size
        try {
            const decoded = atob(body);
            if (decoded.length > maxLength) {
                // Re-encode truncated content
                return btoa(decoded.substring(0, maxLength)) + '... [truncated]';
            }
            return body;
        } catch (error) {
            // If decoding fails, just truncate the base64 string
            return body.length > maxLength ? body.substring(0, maxLength) + '... [truncated]' : body;
        }
    } else {
        // For text content
        if (body.length > maxLength) {
            return body.substring(0, maxLength) + '... [truncated]';
        }
        return body;
    }
}

// Network request event handlers
function onBeforeRequest(details) {
    const startTime = Date.now();
    
    // Skip tracking our own fallback fetches to prevent infinite loops
    if (fallbackFetchesInProgress.has(details.url)) {
        console.log('SERVICE WORKER: ⏭️ Skipping tracking fallback fetch request:', details.url);
        return;
    }
    
    console.log('SERVICE WORKER: 🌐 Request started:', details.method, details.url, 'Type:', details.type);
    networkRequestsInFlight.set(details.requestId, {
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        startTime: startTime,
        timestamp: new Date().toISOString()
    });
}

function onBeforeSendHeaders(details) {
    // Skip our own fallback fetches
    if (fallbackFetchesInProgress.has(details.url)) {
        return;
    }
    
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.requestHeaders = details.requestHeaders;
    }
}

function onHeadersReceived(details) {
    // Skip our own fallback fetches
    if (fallbackFetchesInProgress.has(details.url)) {
        return;
    }
    
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.statusCode = details.statusCode;
        request.responseHeaders = details.responseHeaders;
    }
}

function onCompleted(details) {
    // Skip our own fallback fetches
    if (fallbackFetchesInProgress.has(details.url)) {
        return;
    }
    
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.status = 'completed';
        request.statusCode = details.statusCode;
        
        console.log('SERVICE WORKER: 🏁 Request completed:', details.method, details.url, 'Status:', details.statusCode, 'Has body:', !!request.responseBody);
        
        // If no response body was captured by debugger, try a fallback for JSON endpoints
        if (!request.responseBody && details.statusCode === 200) {
            const contentType = request.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
            const isJsonEndpoint = contentType.includes('application/json');
            const isNotFallbackFetch = !fallbackFetchesInProgress.has(details.url);
            
            if (isJsonEndpoint && isNotFallbackFetch) {
                console.log('SERVICE WORKER: 🔄 Attempting fallback JSON fetch for:', details.url);
                fallbackFetchesInProgress.add(details.url);
                
                // Try to fetch the JSON content as a fallback
                setTimeout(async () => {
                    try {
                        const fallbackResponse = await fetch(details.url, {
                            headers: { 
                                'Accept': 'application/json',
                                'Accept-Encoding': 'identity',
                                'Cache-Control': 'no-cache' // Prevent cached responses
                            },
                            method: details.method || 'GET'
                        });
                        
                        if (fallbackResponse.ok && fallbackResponse.headers.get('content-type')?.includes('application/json')) {
                            const jsonText = await fallbackResponse.text();
                            request.responseBody = truncateResponseBody(jsonText, false);
                            request.responseBodyEncoding = 'text';
                            console.log('SERVICE WORKER: ✅ Fallback JSON fetch successful for:', details.url, 'Body length:', jsonText.length);
                            
                            // Update the stored request - use a more direct approach
                            const currentLogs = await getStoredData(STORAGE_KEYS.NETWORK_LOGS) || [];
                            const requestIndex = currentLogs.findIndex(log => log.requestId === request.requestId);
                            
                            if (requestIndex !== -1) {
                                currentLogs[requestIndex] = scrubPiiFromNetworkRequest(request);
                                await chrome.storage.session.set({ [STORAGE_KEYS.NETWORK_LOGS]: currentLogs });
                                console.log('SERVICE WORKER: 📝 Updated stored request with response body');
                            } else {
                                // If not found, save as new
                                saveNetworkRequest(request);
                                console.log('SERVICE WORKER: 📝 Saved new request with response body');
                            }
                        } else {
                            console.log('SERVICE WORKER: ⚠️ Fallback fetch response not JSON or failed:', fallbackResponse.status);
                        }
                    } catch (error) {
                        console.log('SERVICE WORKER: ❌ Fallback JSON fetch failed for:', details.url, error.message);
                    } finally {
                        // Always remove from in-progress set
                        fallbackFetchesInProgress.delete(details.url);
                    }
                }, 100);
            } else if (isJsonEndpoint && fallbackFetchesInProgress.has(details.url)) {
                console.log('SERVICE WORKER: ⏭️ Skipping fallback fetch for:', details.url, '(already in progress)');
            }
        }
        
        // Move to completed requests
        saveNetworkRequest(request);
        networkRequestsInFlight.delete(details.requestId);
    }
}

function onErrorOccurred(details) {
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.status = 'error';
        request.error = details.error;
        
        // Move to completed requests
        saveNetworkRequest(request);
        networkRequestsInFlight.delete(details.requestId);
    }
}

// Data handling functions
async function handleConsoleLog(logData) {
    const logs = await getStoredData(STORAGE_KEYS.CONSOLE_LOGS) || [];
    // Apply PII scrubbing (Phase 3)
    const scrubbedLog = scrubPiiFromConsoleLog(logData);
    logs.push(scrubbedLog);
    await chrome.storage.session.set({ [STORAGE_KEYS.CONSOLE_LOGS]: logs });
}

async function handleUserAction(actionData) {
    const actions = await getStoredData(STORAGE_KEYS.USER_ACTIONS) || [];
    // Apply PII scrubbing (Phase 3)
    const scrubbedAction = scrubPiiFromUserAction(actionData);
    actions.push(scrubbedAction);
    await chrome.storage.session.set({ [STORAGE_KEYS.USER_ACTIONS]: actions });
}

async function handleEnvironmentData(envData) {
    await chrome.storage.session.set({ [STORAGE_KEYS.ENVIRONMENT_DATA]: envData });
}

async function saveNetworkRequest(request) {
    const requests = await getStoredData(STORAGE_KEYS.NETWORK_LOGS) || [];
    // Apply PII scrubbing (Phase 3)
    const scrubbedRequest = scrubPiiFromNetworkRequest(request);
    requests.push(scrubbedRequest);
    await chrome.storage.session.set({ [STORAGE_KEYS.NETWORK_LOGS]: requests });
}

// Utility functions
// Function to set recording state with logging
async function setRecordingState(isRecording, reason = 'Unknown') {
    try {
        console.log('SERVICE WORKER: 📝 Setting recording state to:', isRecording, 'Reason:', reason);
        await chrome.storage.session.set({
            [STORAGE_KEYS.RECORDING_STATE]: isRecording,
            recordingStateLastChanged: Date.now(),
            recordingStateChangeReason: reason
        });
        console.log('SERVICE WORKER: ✅ Recording state set successfully');
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error setting recording state:', error);
    }
}

async function getRecordingState() {
    try {
        const serviceWorkerAge = Date.now() - serviceWorkerStartTime;
        const result = await chrome.storage.session.get([
            STORAGE_KEYS.RECORDING_STATE, 
            'recordingStateLastChanged', 
            'recordingStateChangeReason'
        ]);
        const isRecording = result[STORAGE_KEYS.RECORDING_STATE] || false;
        console.log('SERVICE WORKER: 🔍 getRecordingState called, result:', isRecording, 
                   'Last changed:', result.recordingStateLastChanged ? new Date(result.recordingStateLastChanged).toISOString() : 'never',
                   'Reason:', result.recordingStateChangeReason || 'unknown',
                   'SW age:', Math.round(serviceWorkerAge / 1000) + 's');
        return isRecording;
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error getting recording state:', error);
        return false;
    }
}

async function getStoredData(key) {
    const data = await chrome.storage.session.get(key);
    
    // Debug logging for video data specifically
    if (key === STORAGE_KEYS.VIDEO_DATA) {
        console.log('SERVICE WORKER: 🔍 getStoredData debug for VIDEO_DATA:', {
            key: key,
            rawData: data,
            hasKey: key in data,
            value: data[key],
            valueType: typeof data[key],
            valueIsNull: data[key] === null,
            valueIsUndefined: data[key] === undefined
        });
    }
    
    return data[key];
}

async function resetSessionData() {
    console.log('SERVICE WORKER: 🗑️ Resetting session data...');
    await chrome.storage.session.clear();
    
    // Clear in-memory video data
    videoDataInMemory = null;
    
    // Use setRecordingState for consistency and tracking
    await setRecordingState(false, 'Session data reset');
    
    // Set other storage keys
    await chrome.storage.session.set({
        [STORAGE_KEYS.CONSOLE_LOGS]: [],
        [STORAGE_KEYS.NETWORK_LOGS]: [],
        [STORAGE_KEYS.USER_ACTIONS]: [],
        [STORAGE_KEYS.ENVIRONMENT_DATA]: null,
        [STORAGE_KEYS.VIDEO_DATA]: null,
        [STORAGE_KEYS.VIDEO_ERROR]: null // Reset video error
    });
    
    console.log('SERVICE WORKER: ✅ Session data reset completed');
}

// Generate report with all collected data
async function generateReport() {
    try {
        console.log('SERVICE WORKER: Generating report...');
        
        // Debug: Check all storage data before retrieval
        const allStorageData = await chrome.storage.session.get();
        console.log('SERVICE WORKER: 🔍 All storage keys before retrieval:', Object.keys(allStorageData));
        console.log('SERVICE WORKER: 🔍 VIDEO_DATA exists before retrieval:', STORAGE_KEYS.VIDEO_DATA in allStorageData);
        
        // Get all collected data
        const [consoleLogs, networkLogs, userActions, environmentData, videoDataFromStorage] = await Promise.all([
            getStoredData(STORAGE_KEYS.CONSOLE_LOGS),
            getStoredData(STORAGE_KEYS.NETWORK_LOGS),
            getStoredData(STORAGE_KEYS.USER_ACTIONS),
            getStoredData(STORAGE_KEYS.ENVIRONMENT_DATA),
            getStoredData(STORAGE_KEYS.VIDEO_DATA)
        ]);
        
        // Handle video data from storage or memory
        let videoData = null;
        
        console.log('SERVICE WORKER: 🔍 Debug videoDataFromStorage:', {
            value: videoDataFromStorage,
            type: typeof videoDataFromStorage,
            isNull: videoDataFromStorage === null,
            isUndefined: videoDataFromStorage === undefined,
            truthy: !!videoDataFromStorage
        });
        
        if (videoDataFromStorage) {
            if (videoDataFromStorage.stored === 'in_memory') {
                console.log('SERVICE WORKER: 📹 Retrieving video data from memory...');
                videoData = videoDataInMemory;
            } else {
                console.log('SERVICE WORKER: 📹 Using video data from storage...');
                videoData = videoDataFromStorage;
            }
        } else {
            // Try direct access if getStoredData failed
            console.log('SERVICE WORKER: 🔍 getStoredData returned null, trying direct access...');
            const directAccess = await chrome.storage.session.get(STORAGE_KEYS.VIDEO_DATA);
            const directVideoData = directAccess[STORAGE_KEYS.VIDEO_DATA];
            
            console.log('SERVICE WORKER: 🔍 Direct access result:', {
                hasKey: STORAGE_KEYS.VIDEO_DATA in directAccess,
                value: directVideoData,
                type: typeof directVideoData,
                isInMemory: directVideoData && directVideoData.stored === 'in_memory'
            });
            
            if (directVideoData && directVideoData.stored === 'in_memory') {
                console.log('SERVICE WORKER: 📹 Found in-memory reference, retrieving from memory...');
                videoData = videoDataInMemory;
            } else if (directVideoData && directVideoData.videoData) {
                console.log('SERVICE WORKER: 📹 Found direct video data...');
                videoData = directVideoData;
            }
        }
        
        console.log('SERVICE WORKER: 📹 Video data retrieval:', {
            fromStorage: !!videoDataFromStorage,
            fromMemory: !!videoDataInMemory,
            final: !!videoData,
            type: videoData ? 'present' : 'null'
        });
        
        console.log('SERVICE WORKER: Raw data retrieved:', {
            consoleLogs: consoleLogs ? consoleLogs.length : 'null',
            networkLogs: networkLogs ? networkLogs.length : 'null',
            userActions: userActions ? userActions.length : 'null',
            environmentData: environmentData ? 'present' : 'null',
            videoData: videoData ? {
                hasVideoData: !!videoData.videoData,
                size: videoData.size,
                mimeType: videoData.mimeType,
                duration: videoData.duration,
                videoDataLength: videoData.videoData ? videoData.videoData.length : 'no videoData property'
            } : 'null'
        });
        
        // Debug: Additional check for video data
        if (!videoData) {
            console.log('SERVICE WORKER: 🔍 VIDEO_DATA is null, checking direct storage access...');
            const directVideoData = await chrome.storage.session.get(STORAGE_KEYS.VIDEO_DATA);
            console.log('SERVICE WORKER: 🔍 Direct video data access:', {
                hasKey: STORAGE_KEYS.VIDEO_DATA in directVideoData,
                value: directVideoData[STORAGE_KEYS.VIDEO_DATA] ? 'present' : 'null',
                valueType: typeof directVideoData[STORAGE_KEYS.VIDEO_DATA]
            });
        }
        
        // For Phase 2, create either HTML report with video or JSON fallback
        const reportData = {
            timestamp: new Date().toISOString(),
            consoleLogs: consoleLogs || [],
            networkLogs: networkLogs || [],
            userActions: userActions || [],
            environmentData: environmentData || {},
            videoData: videoData || null,
            metadata: {
                version: '2.0.0',
                phase: 'Phase 3 - Enhanced Synchronization, PII Scrubbing & Interactive Viewer'
            }
        };
        
        console.log('SERVICE WORKER: Report data prepared:', {
            consoleLogs: reportData.consoleLogs.length,
            networkLogs: reportData.networkLogs.length,
            userActions: reportData.userActions.length,
            hasEnvironmentData: !!reportData.environmentData,
            hasVideoData: !!reportData.videoData,
            videoDataDetails: reportData.videoData ? {
                hasVideoData: !!reportData.videoData.videoData,
                size: reportData.videoData.size,
                mimeType: reportData.videoData.mimeType
            } : null
        });
        
        // Create HTML report if we have video data, otherwise fallback to JSON
        if (videoData && videoData.videoData) {
            console.log('SERVICE WORKER: Creating HTML report with video...');
            const htmlReport = createHtmlReport(reportData);
            await downloadViaDownloadsApi(htmlReport, 'html');
        } else {
            console.log('SERVICE WORKER: No video data available, reason:', 
                videoData ? 'Video data exists but no videoData property' : 'No video data at all');
            const jsonString = JSON.stringify(reportData, null, 2);
            await downloadViaDownloadsApi(jsonString, 'json');
        }
        
        console.log('SERVICE WORKER: Report generated successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error generating report:', error);
        throw error;
    }
}

// Generate preview window with all collected data
async function generatePreview() {
    try {
        console.log('SERVICE WORKER: Generating preview...');
        
        // Get all collected data including video error info
        const [consoleLogs, networkLogs, userActions, environmentData, videoDataFromStorage, videoError] = await Promise.all([
            getStoredData(STORAGE_KEYS.CONSOLE_LOGS),
            getStoredData(STORAGE_KEYS.NETWORK_LOGS),
            getStoredData(STORAGE_KEYS.USER_ACTIONS),
            getStoredData(STORAGE_KEYS.ENVIRONMENT_DATA),
            getStoredData(STORAGE_KEYS.VIDEO_DATA),
            getStoredData(STORAGE_KEYS.VIDEO_ERROR)
        ]);
        
        // Handle video data from storage or memory
        let videoData = null;
        
        if (videoDataFromStorage) {
            if (videoDataFromStorage.stored === 'in_memory') {
                console.log('SERVICE WORKER: 📹 Retrieving video data from memory for preview...');
                videoData = videoDataInMemory;
            } else {
                console.log('SERVICE WORKER: 📹 Using video data from storage for preview...');
                videoData = videoDataFromStorage;
            }
        } else {
            // Try direct access if getStoredData failed
            const directAccess = await chrome.storage.session.get(STORAGE_KEYS.VIDEO_DATA);
            const directVideoData = directAccess[STORAGE_KEYS.VIDEO_DATA];
            
            if (directVideoData && directVideoData.stored === 'in_memory') {
                console.log('SERVICE WORKER: 📹 Found in-memory reference for preview...');
                videoData = videoDataInMemory;
            } else if (directVideoData && directVideoData.videoData) {
                console.log('SERVICE WORKER: 📹 Found direct video data for preview...');
                videoData = directVideoData;
            }
        }
        
        // Prepare preview data
        const previewData = {
            timestamp: new Date().toISOString(),
            consoleLogs: consoleLogs || [],
            networkLogs: networkLogs || [],
            userActions: userActions || [],
            environmentData: environmentData || {},
            videoData: videoData || null,
            videoError: videoError || null,
            metadata: {
                version: '2.1.0',
                phase: 'Phase 3 - Enhanced Synchronization, PII Scrubbing & Interactive Viewer'
            }
        };
        
        console.log('SERVICE WORKER: Preview data prepared:', {
            consoleLogs: previewData.consoleLogs.length,
            networkLogs: previewData.networkLogs.length,
            userActions: previewData.userActions.length,
            hasEnvironmentData: !!previewData.environmentData,
            hasVideoData: !!previewData.videoData,
            videoDataDetails: previewData.videoData ? {
                hasVideoData: !!previewData.videoData.videoData,
                size: previewData.videoData.size,
                mimeType: previewData.videoData.mimeType,
                duration: previewData.videoData.duration
            } : null
        });
        
        // Create preview HTML and store it for the dedicated extension preview page
        const previewHtml = createPreviewHtml(previewData);
        await chrome.storage.session.set({ PREVIEW_HTML: previewHtml });

        // Open dedicated extension preview page where chrome APIs are available
        const previewUrl = chrome.runtime.getURL('preview.html');
        const previewTab = await chrome.tabs.create({ url: previewUrl, active: true });
        console.log('SERVICE WORKER: Preview tab created (extension page):', previewTab.id);
        
    } catch (error) {
        console.error('SERVICE WORKER: Error generating preview:', error);
        throw error;
    }
}

// Download method using content script (where URL.createObjectURL is available)
async function downloadViaContentScript(content, type = 'json') {
    try {
        console.log('SERVICE WORKER: Starting download via content script...');
        
        // Get the active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!activeTab) {
            throw new Error('No active tab found for download');
        }
        
        console.log('SERVICE WORKER: Injecting download script into tab:', activeTab.id);
        
        // Inject download script into the active tab
        await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (content, fileType) => {
                try {
                    console.log('DOWNLOAD SCRIPT: Creating blob and download for type:', fileType);
                    
                    // Determine MIME type and file extension
                    const mimeType = fileType === 'html' ? 'text/html' : 'application/json';
                    const extension = fileType === 'html' ? 'html' : 'json';
                    
                    // Create download in page context where URL.createObjectURL is available
                    const blob = new Blob([content], { type: mimeType });
                    const url = URL.createObjectURL(blob);
                    
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `bugreel-report-${Date.now()}.${extension}`;
                    a.style.display = 'none';
                    
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    
                    // Clean up
                    setTimeout(() => {
                        URL.revokeObjectURL(url);
                    }, 1000);
                    
                    console.log('DOWNLOAD SCRIPT: Report downloaded successfully');
                    return { success: true };
                    
                } catch (error) {
                    console.error('DOWNLOAD SCRIPT: Error:', error);
                    return { success: false, error: error.message };
                }
            },
            args: [content, type]
        });
        
        console.log('SERVICE WORKER: Download script executed successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Download via content script failed:', error);
        // Fallback: use downloads API from service worker with data URL
        try {
            await downloadViaDownloadsApi(content, type);
            console.log('SERVICE WORKER: Fallback download via downloads API succeeded');
        } catch (fallbackError) {
            console.error('SERVICE WORKER: Fallback download failed:', fallbackError);
            throw fallbackError;
        }
    }
}

async function downloadViaDownloadsApi(content, type = 'json') {
    const mimeType = type === 'html' ? 'text/html' : 'application/json';
    const extension = type === 'html' ? 'html' : 'json';
    const dataUrl = 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(content);
    await chrome.downloads.download({
        url: dataUrl,
        filename: `bugreel-report-${Date.now()}.${extension}`,
        saveAs: true
    });
}

// Video recording functions
async function startVideoRecording() {
    try {
        console.log('SERVICE WORKER: 🎬 Starting video recording...');
        
        // Create offscreen document if it doesn't exist
        console.log('SERVICE WORKER: 📄 Ensuring offscreen document...');
        await ensureOffscreenDocument();
        console.log('SERVICE WORKER: ✅ Offscreen document ready');
        
        // Wait longer for the offscreen document to be ready
        console.log('SERVICE WORKER: ⏰ Waiting 1000ms for offscreen document to initialize...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send start recording message to offscreen document with timeout
        console.log('SERVICE WORKER: 📤 Sending START_RECORDING message to offscreen document...');
        
        const messagePromise = new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'START_RECORDING',
                options: {
                    includeSystemAudio: true,
                    includeMicrophone: true
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('SERVICE WORKER: 🚨 Chrome runtime error:', chrome.runtime.lastError);
                    reject(new Error(`Chrome runtime error: ${chrome.runtime.lastError.message}`));
                } else {
                    console.log('SERVICE WORKER: 📨 Raw response from offscreen:', response);
                    resolve(response);
                }
            });
        });
        
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Video recording start timeout after 15 seconds')), 15000);
        });
        
        const response = await Promise.race([messagePromise, timeoutPromise]);
        
        console.log('SERVICE WORKER: 📥 Received response from offscreen document:', response);
        
        if (!response) {
            const errorMsg = 'Failed to start video recording: No response from offscreen document';
            console.error('SERVICE WORKER: ❌ Video recording failed:', errorMsg);
            throw new Error(errorMsg);
        }
        
        if (!response.success) {
            const errorMsg = 'Failed to start video recording: ' + (response.error || 'Offscreen document reported failure without error message');
            console.error('SERVICE WORKER: ❌ Video recording failed:', errorMsg);
            throw new Error(errorMsg);
        }
        
        console.log('SERVICE WORKER: ✅ Video recording started successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error starting video recording:', error);
        throw error;
    }
}

async function stopVideoRecording() {
    try {
        console.log('SERVICE WORKER: 🛑 Stopping video recording...');
        
        // Send stop recording message to offscreen document
        console.log('SERVICE WORKER: 📤 Sending STOP_RECORDING message to offscreen document...');
        const response = await chrome.runtime.sendMessage({
            type: 'STOP_RECORDING'
        });
        
        console.log('SERVICE WORKER: 📥 Received stop response from offscreen document:', response);
        
        if (!response || !response.success) {
            console.warn('SERVICE WORKER: ⚠️ Failed to stop video recording properly:', response?.error || 'Unknown error');
        } else {
            console.log('SERVICE WORKER: ✅ Video recording stopped successfully');
        }
        
        console.log('SERVICE WORKER: 📋 Video recording stop process completed');
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error stopping video recording:', error);
        // Don't throw error here as we want to continue with report generation
    }
}

async function ensureOffscreenDocument() {
    try {
        // Check if offscreen document already exists
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL('offscreen.html')]
        });
        
        if (existingContexts.length > 0) {
            console.log('SERVICE WORKER: Offscreen document already exists');
            return;
        }
        
        // Create offscreen document
        console.log('SERVICE WORKER: Creating offscreen document...');
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DISPLAY_MEDIA', 'USER_MEDIA'],
            justification: 'Recording screen and microphone for bug reports'
        });
        
        console.log('SERVICE WORKER: Offscreen document created successfully');
        
        // Wait a moment for the offscreen document to fully initialize
        console.log('SERVICE WORKER: ⏰ Waiting 500ms for offscreen document to fully initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
    } catch (error) {
        console.error('SERVICE WORKER: Error creating offscreen document:', error);
        throw error;
    }
}

async function handleVideoRecorded(videoData) {
    try {
        console.log('SERVICE WORKER: 📹 Processing video data...');
        console.log('SERVICE WORKER: Video data structure:', {
            hasVideoData: !!videoData.videoData,
            videoDataLength: videoData.videoData ? videoData.videoData.length : 'null',
            size: videoData.size,
            mimeType: videoData.mimeType,
            duration: videoData.duration,
            keys: Object.keys(videoData)
        });
        
        // Debug: Check Chrome storage limits
        const dataSize = JSON.stringify(videoData).length;
        console.log('SERVICE WORKER: 📊 Video data JSON size:', dataSize, 'bytes');
        
        // Chrome storage.session has a quota limit of ~1MB per item
        const STORAGE_LIMIT = 1024 * 1024; // 1MB
        if (dataSize > STORAGE_LIMIT) {
            console.warn('SERVICE WORKER: ⚠️ Video data exceeds storage limit!', {
                dataSize,
                limit: STORAGE_LIMIT,
                ratio: (dataSize / STORAGE_LIMIT).toFixed(2) + 'x'
            });
            
            // Store in memory instead of Chrome storage
            videoDataInMemory = videoData;
            console.log('SERVICE WORKER: ✅ Video data stored in memory (too large for Chrome storage)');
            
            // Store a reference in Chrome storage
            await chrome.storage.session.set({
                [STORAGE_KEYS.VIDEO_DATA]: { stored: 'in_memory', size: dataSize }
            });
        } else {
            // Small enough for Chrome storage
            await chrome.storage.session.set({
                [STORAGE_KEYS.VIDEO_DATA]: videoData
            });
            console.log('SERVICE WORKER: ✅ Video data stored in session successfully');
        }
        
        // Verify it was stored correctly with more detailed debugging
        const storedData = await getStoredData(STORAGE_KEYS.VIDEO_DATA);
        console.log('SERVICE WORKER: 🔍 Verification - stored video data:', {
            stored: !!storedData,
            hasVideoData: storedData ? !!storedData.videoData : 'no data',
            storedDataSize: storedData ? JSON.stringify(storedData).length : 'no data',
            keys: storedData ? Object.keys(storedData) : 'no data',
            videoDataType: storedData ? typeof storedData.videoData : 'no data',
            videoDataLength: storedData && storedData.videoData ? storedData.videoData.length : 'no data'
        });
        
        // Additional verification: Try to get all storage data
        const allStorageData = await chrome.storage.session.get();
        console.log('SERVICE WORKER: 🔍 All storage keys:', Object.keys(allStorageData));
        console.log('SERVICE WORKER: 🔍 VIDEO_DATA key exists in storage:', STORAGE_KEYS.VIDEO_DATA in allStorageData);
        
        // Check if we're waiting for video processing to complete before generating preview
        if (allStorageData.waitingForVideoProcessing) {
            console.log('SERVICE WORKER: ✅ Video processing complete. Generating preview...');
            
            // Remove the flag
            await chrome.storage.session.remove('waitingForVideoProcessing');
            
            // Generate preview now that video data is available
            await generatePreview();
            console.log('SERVICE WORKER: 📋 Preview generation completed');
        }
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error handling video data:', error);
    }
}

async function handleVideoError(errorData) {
    try {
        console.error('SERVICE WORKER: 🚨 Processing video error:', errorData);
        
        // Store the comprehensive error information
        await chrome.storage.session.set({
            [STORAGE_KEYS.VIDEO_ERROR]: {
                ...errorData,
                receivedAt: new Date().toISOString()
            }
        });
        
        console.log('SERVICE WORKER: ✅ Video error stored for debugging');
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error storing video error:', error);
    }
}

// Create self-contained HTML report
function createHtmlReport(reportData) {
    const videoDataUrl = reportData.videoData ? 
        `data:${reportData.videoData.mimeType};base64,${reportData.videoData.videoData}` : 
        null;
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BugReel Report - ${reportData.timestamp}</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        :root{ --bg:#0f1113; --card:#161a1d; --muted:#b9c1c6; --text:#ffffff; --radius:14px; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
        .container { max-width: 1200px; margin:0 auto; padding:16px; }
        .header { background: transparent; color: var(--muted); margin-bottom: 8px; }
        .header .meta { color: var(--muted); font-size:12px; }
        
        /* Notes (dark) */
        .notes-section { margin-bottom: 12px; }
        .notes-section h2 { margin: 0 0 8px 0; font-size: 1.1em; color: var(--text); opacity: .9; }
        .notes-content { color: #e5e7eb; line-height: 1.6; background: #161a1d; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        
        .main-content { display:grid; grid-template-columns: 3fr 2fr; gap: 20px; min-height: 600px; }
        
        .video-section { background: var(--card); border-radius: var(--radius); box-shadow: 0 12px 30px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.25); padding: 16px; border: 1px solid rgba(255,255,255,0.06); }
        
        .video-container {
            position: relative;
            width: 100%;
            background: #000;
            border-radius: 8px;
            overflow: hidden;
        }
        
        video {
            width: 100%;
            height: auto;
            display: block;
        }
        
        .video-controls { margin-top: 12px; display:flex; gap:8px; align-items:center; color: var(--muted); }
        
        .data-section { background: var(--card); border-radius: var(--radius); box-shadow: 0 12px 30px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.25); padding: 16px; border: 1px solid rgba(255,255,255,0.06); overflow-y:auto; max-height:80vh; }
        
        .tabs { display:flex; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; }
        .tab { padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent; transition: all .12s ease; color: var(--muted); font-weight:600; font-size:13px; }
        .tab.active { border-bottom-color: #0b84ff; color:#0b84ff; }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* Enhanced Controls Section (Phase 3) */
        .controls-section {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #dee2e6;
        }
        
        .search-container { display:flex; align-items:center; margin-bottom:12px; position:relative; }
        
        #search-input { flex:1; padding:8px 40px 8px 12px; border:1px solid rgba(255,255,255,.08); border-radius:8px; font-size:14px; background:#1b2024; color:#e5e7eb; }
        
        #search-input:focus { outline:none; border-color:#0b84ff; box-shadow: 0 0 0 2px rgba(11,132,255,.25); }
        
        #clear-search { position:absolute; right:8px; background:none; border:none; color:#9aa3a9; cursor:pointer; padding:4px; border-radius:6px; font-size:14px; }
        #clear-search:hover { background:rgba(255,255,255,.06); color:#e5e7eb; }
        
        .filter-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        
        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .filter-group label {
            font-size: 12px;
            font-weight: 600;
            color: #495057;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .filter-group select {
            padding: 6px 8px;
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 13px;
            background: white;
            cursor: pointer;
        }
        
        .filter-group select:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
        }
        
        .log-entry {
            margin-bottom: 10px;
            padding: 10px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            border-left: 4px solid #ddd;
        }
        
        .log-entry.error {
            background-color: #fdf2f2;
            border-left-color: #e74c3c;
        }
        
        .log-entry.warn {
            background-color: #fef9e7;
            border-left-color: #f39c12;
        }
        
        .log-entry.info {
            background-color: #e8f4f8;
            border-left-color: #3498db;
        }
        
        .log-entry.debug {
            background-color: #f4f4f4;
            border-left-color: #95a5a6;
        }
        
        .log-entry.highlight {
            background-color: #fff3cd;
            border-left-color: #ffc107;
            transform: scale(1.02);
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .log-entry.active-sync {
            background-color: #e3f2fd;
            border-left-color: #2196f3;
            transform: scale(1.05);
            box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
            animation: pulseSync 1s ease-in-out;
        }
        
        @keyframes pulseSync {
            0%, 100% { box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3); }
            50% { box-shadow: 0 6px 20px rgba(33, 150, 243, 0.5); }
        }
        
        .timestamp {
            color: #7f8c8d;
            font-size: 11px;
            margin-bottom: 5px;
        }
        
        .network-request { margin-bottom: 12px; padding: 12px; background:#1b2024; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; }
        
        .network-request.error {
            border-left: 4px solid #e74c3c;
        }
        
        .network-request.success {
            border-left: 4px solid #27ae60;
        }
        
        .request-header { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
        
        .request-method { font-weight:700; padding: 2px 6px; border-radius: 6px; font-size: 12px; background: rgba(255,255,255,.06); color:#e5e7eb; }
        
        .method-get { background: #d4edda; color: #155724; }
        .method-post { background: #fff3cd; color: #856404; }
        .method-put { background: #cce5ff; color: #004085; }
        .method-delete { background: #f8d7da; color: #721c24; }
        
        .status-code { font-weight:700; padding: 2px 6px; border-radius: 6px; font-size: 12px; background: rgba(255,255,255,.06); color:#e5e7eb; }
        
        .status-2xx { background: #d4edda; color: #155724; }
        .status-3xx { background: #cce5ff; color: #004085; }
        .status-4xx { background: #fff3cd; color: #856404; }
        .status-5xx { background: #f8d7da; color: #721c24; }
        
        .collapsible { 
            cursor: pointer; 
            padding: 8px 12px; 
            background: #0f1113; 
            border: 1px solid rgba(255,255,255,.08); 
            border-radius: 8px; 
            margin-top: 8px; 
            color: #e5e7eb; 
            font-weight: 600;
            transition: background 0.2s ease;
        }
        .collapsible:hover { background: #13171a; }
        
        .request-headers-btn { border-left: 4px solid #28a745; }
        .response-headers-btn { border-left: 4px solid #ffc107; }
        .response-body-btn { border-left: 4px solid #17a2b8; }
        
        .collapsible-content { 
            display: none; 
            padding: 15px; 
            background: #0f1113; 
            border: 1px solid rgba(255,255,255,.08); 
            border-top: none; 
            border-radius: 0 0 8px 8px; 
            color: #b9c1c6; 
        }
        
        .headers-container {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
        }
        
        .header-row {
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            gap: 12px;
        }
        
        .header-row:last-child {
            border-bottom: none;
        }
        
        .header-name {
            color: #ffc107;
            font-weight: bold;
            min-width: 150px;
            flex-shrink: 0;
        }
        
        .header-value {
            color: #e5e7eb;
            word-break: break-all;
            flex: 1;
        }
        
        .response-body-container {
            max-height: 400px;
            overflow-y: auto;
        }
        
        .response-body-content {
            white-space: pre-wrap;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            background: #1a1a1a;
            color: #e5e7eb;
            padding: 15px;
            border-radius: 6px;
            margin: 0;
            font-size: 12px;
            line-height: 1.4;
            max-height: 350px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .request-url { color:#e5e7eb; word-break: break-all; margin: 6px 0; }
        .request-timing { color:#b9c1c6; font-size: 12px; }
        
        .user-action {
            margin-bottom: 10px;
            padding: 12px;
            border-radius: 10px;
            background: #1b2024;
            border: 1px solid rgba(255,255,255,0.06);
            color: #e5e7eb;
        }
        
        .user-action.highlight {
            background-color: #2a2f34;
            border-color: rgba(255,255,255,0.12);
        }
        
        .user-action.active-sync {
            background-color: #233027;
            border-color: #4caf50;
            transform: scale(1.02);
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.25);
            animation: pulseSync 1s ease-in-out;
        }
        
        .network-request.highlight {
            transform: scale(1.01);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .network-request.active-sync {
            transform: scale(1.02);
            box-shadow: 0 4px 16px rgba(255, 152, 0, 0.3);
            border-left-width: 6px;
            animation: pulseSync 1s ease-in-out;
        }
        
        .environment-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .env-item { padding: 12px; background: #1b2024; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); }
        
        .env-label { font-weight: 700; color: #e5e7eb; margin-bottom: 6px; font-size: 12px; letter-spacing: .3px; text-transform: uppercase; opacity: .9; }
        
        .env-value { color: #b9c1c6; font-size: 14px; }
        
        .no-data {
            text-align: center;
            color: #6c757d;
            padding: 40px;
            font-style: italic;
        }
        
        /* Timeline removed per design */
        
        .error-marker {
            background: #e74c3c;
            box-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
        }
        
        .network-marker {
            background: #f39c12;
            box-shadow: 0 0 4px rgba(243, 156, 18, 0.5);
        }
        
        .action-marker {
            background: #27ae60;
            box-shadow: 0 0 4px rgba(39, 174, 96, 0.5);
        }
        
        .timeline-position-indicator {
            position: absolute;
            top: 0;
            width: 2px;
            height: 100%;
            background: #2196f3;
            box-shadow: 0 0 6px rgba(33, 150, 243, 0.8);
            z-index: 20;
            transition: left 0.1s ease-out;
        }
        
        .timeline-position-indicator::before {
            content: '';
            position: absolute;
            top: -5px;
            left: -3px;
            width: 8px;
            height: 8px;
            background: #2196f3;
            border-radius: 50%;
            box-shadow: 0 0 8px rgba(33, 150, 243, 0.8);
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
            }
            
            .container {
                padding: 10px;
            }
            
            .timeline-markers {
                margin-top: 10px;
                padding: 8px;
            }
            
            .timeline-track {
                height: 50px;
            }
            
            .timeline-bars {
                height: 30px;
            }
            
            .timeline-bar {
                height: 8px;
            }
            
            .error-bar {
                top: 2px;
            }
            
            .network-bar {
                top: 12px;
            }
            
            .action-bar {
                top: 22px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="meta">
                Generated: ${new Date(reportData.timestamp).toLocaleString()}
            </div>
        </div>
        
        ${reportData.notes ? `
        <div class="notes-section">
            <h2>📝 Notes</h2>
            <div class="notes-content">
                ${escapeHtml(reportData.notes).replace(/\n/g, '<br>')}
            </div>
        </div>
        ` : ''}
        
        <div class="main-content">
            <div class="video-section">
                <h2 style="margin:0 0 8px 0; font-size:1.1em; opacity:.9">📹 Screen Recording</h2>
                ${videoDataUrl ? `
                    <div class="video-container">
                        <video id="mainVideo" controls>
                            <source src="${videoDataUrl}" type="${reportData.videoData.mimeType}">
                            Your browser does not support the video tag.
                        </video>
                    </div>
                    <div class="video-controls">
                        <span>Size: ${(reportData.videoData.size / 1024 / 1024).toFixed(2)} MB</span>
                        <span>·</span>
                        <span>Format: ${reportData.videoData.mimeType}</span>
                    </div>
                ` : `
                    <div class="no-data">
                        <p>No video recording available</p>
                        <p>Video recording may have failed or been skipped</p>
                    </div>
                `}
            </div>
            
            <div class="data-section">
                <div class="tabs">
                    <div class="tab active" data-tab="console">Console (${reportData.consoleLogs.length})</div>
                    <div class="tab" data-tab="network">Network (${reportData.networkLogs.length})</div>
                    <div class="tab" data-tab="actions">Actions (${reportData.userActions.length})</div>
                    <div class="tab" data-tab="environment">Environment</div>
                </div>
                
                <!-- Enhanced Search and Filter Controls (Phase 3) -->
                <div class="controls-section" style="background:#1b2024; border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:12px;">
                    <div class="search-container" style="margin-bottom:10px;">
                        <input type="text" id="search-input" placeholder="Search logs, requests, or actions..." style="background:#0f1113; border:1px solid rgba(255,255,255,0.08); color:#e5e7eb;" />
                        <button id="clear-search" title="Clear search">✕</button>
                    </div>
                    <div class="filter-container">
                        <div class="filter-group">
                            <label>Log Level:</label>
                            <select id="log-level-filter" style="background:#0f1113; color:#e5e7eb; border:1px solid rgba(255,255,255,0.08)">
                                <option value="">All Levels</option>
                                <option value="error">Errors</option>
                                <option value="warn">Warnings</option>
                                <option value="info">Info</option>
                                <option value="debug">Debug</option>
                                <option value="log">Logs</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label>Status:</label>
                            <select id="status-filter" style="background:#0f1113; color:#e5e7eb; border:1px solid rgba(255,255,255,0.08)">
                                <option value="">All Status</option>
                                <option value="2xx">Success (2xx)</option>
                                <option value="3xx">Redirect (3xx)</option>
                                <option value="4xx">Client Error (4xx)</option>
                                <option value="5xx">Server Error (5xx)</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label>Time Range:</label>
                            <select id="time-filter" style="background:#0f1113; color:#e5e7eb; border:1px solid rgba(255,255,255,0.08)">
                                <option value="">All Time</option>
                                <option value="first-10">First 10s</option>
                                <option value="first-30">First 30s</option>
                                <option value="last-10">Last 10s</option>
                                <option value="last-30">Last 30s</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="tab-content active" id="console">
                    ${reportData.consoleLogs.length > 0 ? 
                        reportData.consoleLogs.map(log => `
                            <div class="log-entry ${log.level}" data-timestamp="${log.timestamp}">
                                <div class="timestamp">${new Date(log.timestamp).toLocaleTimeString()}</div>
                                <div class="message">${escapeHtml(log.message)}</div>
                            </div>
                        `).join('') : 
                        '<div class="no-data">No console logs captured</div>'
                    }
                </div>
                
                <div class="tab-content" id="network">
                    ${reportData.networkLogs.length > 0 ? 
                        reportData.networkLogs.map(req => `
                            <div class="network-request ${req.statusCode >= 200 && req.statusCode < 300 ? 'success' : 'error'}">
                                <div class="request-header">
                                    <div>
                                        <span class="request-method method-${req.method.toLowerCase()}">${req.method}</span>
                                        <span class="status-code status-${Math.floor(req.statusCode / 100)}xx">${req.statusCode || 'N/A'}</span>
                                    </div>
                                    <div class="timestamp">${new Date(req.timestamp).toLocaleTimeString()}</div>
                                </div>
                                <div class="request-url">${escapeHtml(req.url)}</div>
                                <div class="request-timing">Duration: ${req.duration || 'N/A'}ms</div>
                                <div class="collapsible request-headers-btn" onclick="toggleCollapsible(this)">
                                    📥 Show Request Headers
                                </div>
                                <div class="collapsible-content">
                                    <div class="headers-container">
                                        ${req.requestHeaders ? req.requestHeaders.map(h => `<div class="header-row"><span class="header-name">${h.name}:</span> <span class="header-value">${h.value}</span></div>`).join('') : '<div class="no-data">No request headers</div>'}
                                    </div>
                                </div>
                                
                                <div class="collapsible response-headers-btn" onclick="toggleCollapsible(this)">
                                    📤 Show Response Headers
                                </div>
                                <div class="collapsible-content">
                                    <div class="headers-container">
                                        ${req.responseHeaders ? req.responseHeaders.map(h => `<div class="header-row"><span class="header-name">${h.name}:</span> <span class="header-value">${h.value}</span></div>`).join('') : '<div class="no-data">No response headers</div>'}
                                    </div>
                                </div>
                                
                                <div class="collapsible response-body-btn" onclick="toggleCollapsible(this)">
                                    📄 Show Response Body
                                </div>
                                <div class="collapsible-content">
                                    <div class="response-body-container">
                                        ${req.responseBody ? `<pre class="response-body-content">${req.responseBody}</pre>` : '<div class="no-data">No response body captured</div>'}
                                    </div>
                                </div>
                            </div>
                        `).join('') : 
                        '<div class="no-data">No network requests captured</div>'
                    }
                </div>
                
                <div class="tab-content" id="actions">
                    ${reportData.userActions.length > 0 ? 
                        reportData.userActions.map(action => `
                            <div class="user-action" data-timestamp="${action.timestamp}">
                                <div class="timestamp">${new Date(action.timestamp).toLocaleTimeString()}</div>
                                <div><strong>${action.type}</strong> on ${action.selector}</div>
                                ${action.text ? `<div>Text: "${escapeHtml(action.text)}"</div>` : ''}
                                ${action.key ? `<div>Key: ${action.key}</div>` : ''}
                                ${action.url ? `<div>URL: ${escapeHtml(action.url)}</div>` : ''}
                            </div>
                        `).join('') : 
                        '<div class="no-data">No user actions captured</div>'
                    }
                </div>
                
                <div class="tab-content" id="environment">
                    ${reportData.environmentData ? `
                        <div class="environment-grid">
                            <div class="env-item">
                                <div class="env-label">Browser</div>
                                <div class="env-value">${escapeHtml(reportData.environmentData.userAgent || 'Unknown')}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Language</div>
                                <div class="env-value">${reportData.environmentData.language || 'Unknown'}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Platform</div>
                                <div class="env-value">${reportData.environmentData.platform || 'Unknown'}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Screen Resolution</div>
                                <div class="env-value">${reportData.environmentData.screen ? `${reportData.environmentData.screen.width}x${reportData.environmentData.screen.height}` : 'Unknown'}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Viewport</div>
                                <div class="env-value">${reportData.environmentData.viewport ? `${reportData.environmentData.viewport.width}x${reportData.environmentData.viewport.height}` : 'Unknown'}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Page Title</div>
                                <div class="env-value">${escapeHtml(reportData.environmentData.document?.title || 'Unknown')}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Page URL</div>
                                <div class="env-value">${escapeHtml(reportData.environmentData.url || 'Unknown')}</div>
                            </div>
                            <div class="env-item">
                                <div class="env-label">Device Pixel Ratio</div>
                                <div class="env-value">${reportData.environmentData.viewport?.devicePixelRatio || 'Unknown'}</div>
                            </div>
                        </div>
                    ` : '<div class="no-data">No environment data captured</div>'}
                </div>
            </div>
        </div>
    </div>
    
    <!-- Embedded Data -->
    <script type="application/json" id="report-data">
        ${JSON.stringify(reportData, null, 2)}
    </script>
    
    <script>
        // Report viewer functionality
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs and contents
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                // Add active class to clicked tab and corresponding content
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab).classList.add('active');
            });
        });
        
        // Collapsible sections
        function toggleCollapsible(element) {
            const content = element.nextElementSibling;
            const currentText = element.textContent.trim();
            
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                // Update text based on current button type
                if (currentText.includes('Request Headers')) {
                    element.textContent = '📥 Hide Request Headers';
                } else if (currentText.includes('Response Headers')) {
                    element.textContent = '📤 Hide Response Headers';
                } else if (currentText.includes('Response Body')) {
                    element.textContent = '📄 Hide Response Body';
                }
            } else {
                content.style.display = 'none';
                // Restore original text
                if (currentText.includes('Request Headers')) {
                    element.textContent = '📥 Show Request Headers';
                } else if (currentText.includes('Response Headers')) {
                    element.textContent = '📤 Show Response Headers';
                } else if (currentText.includes('Response Body')) {
                    element.textContent = '📄 Show Response Body';
                }
            }
        }
        
        // Enhanced Video Synchronization (Phase 3)
        const reportData = JSON.parse(document.getElementById('report-data').textContent);
        const video = document.getElementById('mainVideo');
        let recordingStartTime = null;
        let isUserSeeking = false;
        
        if (video && reportData) {
            // Calculate recording start time from report metadata
            const reportTimestamp = new Date(reportData.timestamp);
            recordingStartTime = reportTimestamp.getTime();
            
            // No duration display; timeline removed
            
            // Handle seeking detection
            video.addEventListener('seeking', () => {
                isUserSeeking = true;
            });
            
            video.addEventListener('seeked', () => {
                setTimeout(() => {
                    isUserSeeking = false;
                }, 100);
            });
            
            video.addEventListener('timeupdate', () => {
                if (!isUserSeeking) {
                    const currentVideoTime = video.currentTime;
                    // Calculate the actual timestamp based on video position
                    const currentTimestamp = new Date(recordingStartTime + (currentVideoTime * 1000));
                    
                    // Enhanced synchronization with better algorithm
                    synchronizeContent(currentTimestamp, currentVideoTime);
                }
            });
        }
        
        // Timeline removed
        
        // Timeline removed
        
        function synchronizeContent(currentTimestamp, videoTime) {
            // Remove previous highlights
            document.querySelectorAll('.highlight, .active-sync').forEach(el => {
                el.classList.remove('highlight', 'active-sync');
            });
            
            const currentTime = currentTimestamp.getTime();
            const tolerance = 1500; // 1.5 seconds tolerance
            const strictTolerance = 500; // 0.5 seconds for exact matches
            
            let foundExactMatch = false;
            let relevantElements = [];
            
            // Find all timestamped elements
            document.querySelectorAll('[data-timestamp]').forEach(element => {
                const elementTime = new Date(element.dataset.timestamp).getTime();
                const timeDiff = Math.abs(currentTime - elementTime);
                
                if (timeDiff < strictTolerance) {
                    element.classList.add('active-sync');
                    relevantElements.push({ element, timeDiff, priority: 'high' });
                    foundExactMatch = true;
                } else if (timeDiff < tolerance) {
                    element.classList.add('highlight');
                    relevantElements.push({ element, timeDiff, priority: 'low' });
                }
            });
            
            // Auto-scroll to most relevant content
            if (relevantElements.length > 0) {
                // Sort by time difference (closest first)
                relevantElements.sort((a, b) => a.timeDiff - b.timeDiff);
                const mostRelevant = relevantElements[0];
                
                // Only scroll if we have a high priority match or user isn't actively browsing
                if (mostRelevant.priority === 'high' || !isUserInteracting()) {
                    scrollToElement(mostRelevant.element);
                }
            }
            
            // Timeline removed
        }
        // Timeline removed
        
        function scrollToElement(element) {
            if (element && element.scrollIntoView) {
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }
        
        function isUserInteracting() {
            // Simple heuristic to detect if user is actively scrolling or interacting
            return document.querySelector('.data-section:hover') !== null;
        }
        
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
        }
        
        // Enhanced Search and Filter Functionality (Phase 3)
        function initializeSearchAndFilters() {
            const searchInput = document.getElementById('search-input');
            const clearSearch = document.getElementById('clear-search');
            const logLevelFilter = document.getElementById('log-level-filter');
            const statusFilter = document.getElementById('status-filter');
            const timeFilter = document.getElementById('time-filter');
            
            // Search functionality
            if (searchInput) {
                searchInput.addEventListener('input', debounce(performSearch, 300));
            }
            
            if (clearSearch) {
                clearSearch.addEventListener('click', () => {
                    searchInput.value = '';
                    performSearch();
                });
            }
            
            // Filter functionality
            [logLevelFilter, statusFilter, timeFilter].forEach(filter => {
                if (filter) {
                    filter.addEventListener('change', applyFilters);
                }
            });
        }
        
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
        
        function performSearch() {
            const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
            const activeTab = document.querySelector('.tab.active')?.dataset.tab;
            
            if (!searchTerm) {
                // Show all items if search is empty
                showAllItems();
                return;
            }
            
            // Search in console logs
            if (activeTab === 'console') {
                document.querySelectorAll('#console .log-entry').forEach(entry => {
                    const message = entry.querySelector('.message')?.textContent.toLowerCase() || '';
                    const timestamp = entry.querySelector('.timestamp')?.textContent.toLowerCase() || '';
                    
                    if (message.includes(searchTerm) || timestamp.includes(searchTerm)) {
                        entry.style.display = 'block';
                        highlightSearchTerm(entry, searchTerm);
                    } else {
                        entry.style.display = 'none';
                    }
                });
            }
            
            // Search in network requests
            if (activeTab === 'network') {
                document.querySelectorAll('#network .network-request').forEach(request => {
                    const url = request.querySelector('.request-url')?.textContent.toLowerCase() || '';
                    const method = request.querySelector('.request-method')?.textContent.toLowerCase() || '';
                    const status = request.querySelector('.status-code')?.textContent.toLowerCase() || '';
                    
                    if (url.includes(searchTerm) || method.includes(searchTerm) || status.includes(searchTerm)) {
                        request.style.display = 'block';
                        highlightSearchTerm(request, searchTerm);
                    } else {
                        request.style.display = 'none';
                    }
                });
            }
            
            // Search in user actions
            if (activeTab === 'actions') {
                document.querySelectorAll('#actions .user-action').forEach(action => {
                    const text = action.textContent.toLowerCase();
                    
                    if (text.includes(searchTerm)) {
                        action.style.display = 'block';
                        highlightSearchTerm(action, searchTerm);
                    } else {
                        action.style.display = 'none';
                    }
                });
            }
        }
        
        function highlightSearchTerm(element, searchTerm) {
            // Remove existing highlights
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }
            
            textNodes.forEach(textNode => {
                if (textNode.textContent.toLowerCase().includes(searchTerm)) {
                    const span = document.createElement('span');
                                         span.innerHTML = textNode.textContent.replace(
                         new RegExp('(' + escapeRegex(searchTerm) + ')', 'gi'),
                         '<mark style="background: #ffeb3b; padding: 1px 2px;">$1</mark>'
                     );
                    textNode.parentNode.replaceChild(span, textNode);
                }
            });
        }
        
        function escapeRegex(string) {
            return string.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
        }
        
        function showAllItems() {
            document.querySelectorAll('.log-entry, .network-request, .user-action').forEach(item => {
                item.style.display = 'block';
                // Remove search highlights
                item.querySelectorAll('mark').forEach(mark => {
                    mark.replaceWith(mark.textContent);
                });
            });
        }
        
        function applyFilters() {
            const logLevel = document.getElementById('log-level-filter')?.value || '';
            const status = document.getElementById('status-filter')?.value || '';
            const timeRange = document.getElementById('time-filter')?.value || '';
            const activeTab = document.querySelector('.tab.active')?.dataset.tab;
            
            if (activeTab === 'console' && logLevel) {
                document.querySelectorAll('#console .log-entry').forEach(entry => {
                    if (entry.classList.contains(logLevel)) {
                        entry.style.display = 'block';
                    } else {
                        entry.style.display = 'none';
                    }
                });
            }
            
            if (activeTab === 'network' && status) {
                document.querySelectorAll('#network .network-request').forEach(request => {
                    const statusCode = request.querySelector('.status-code')?.textContent || '';
                    const statusClass = getStatusClass(parseInt(statusCode));
                    
                    if (statusClass === status) {
                        request.style.display = 'block';
                    } else {
                        request.style.display = 'none';
                    }
                });
            }
            
            // Apply time filters if needed
            if (timeRange) {
                applyTimeFilter(timeRange);
            }
        }
        
        function getStatusClass(statusCode) {
            if (statusCode >= 200 && statusCode < 300) return '2xx';
            if (statusCode >= 300 && statusCode < 400) return '3xx';
            if (statusCode >= 400 && statusCode < 500) return '4xx';
            if (statusCode >= 500) return '5xx';
            return '';
        }
        
        function applyTimeFilter(range) {
            // Implementation would depend on having recording start time
            // This is a placeholder for time-based filtering
            console.log('Time filter:', range);
        }
        
        // Initialize
        console.log('BugReel Report Viewer loaded');
        console.log('Report data:', JSON.parse(document.getElementById('report-data').textContent));
        initializeSearchAndFilters();
    </script>
</body>
</html>`;
    
    // Helper function to escape HTML
    function escapeHtml(text) {
        if (typeof text !== 'string') {
            text = String(text);
        }
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

// Save report from preview with optional notes
async function saveReportFromPreview(notes = '') {
    try {
        console.log('SERVICE WORKER: Saving report from preview with notes:', notes);
        
        // Get all collected data (same as generateReport)
        const [consoleLogs, networkLogs, userActions, environmentData, videoDataFromStorage] = await Promise.all([
            getStoredData(STORAGE_KEYS.CONSOLE_LOGS),
            getStoredData(STORAGE_KEYS.NETWORK_LOGS),
            getStoredData(STORAGE_KEYS.USER_ACTIONS),
            getStoredData(STORAGE_KEYS.ENVIRONMENT_DATA),
            getStoredData(STORAGE_KEYS.VIDEO_DATA)
        ]);
        
        // Handle video data from storage or memory
        let videoData = null;
        
        if (videoDataFromStorage) {
            if (videoDataFromStorage.stored === 'in_memory') {
                videoData = videoDataInMemory;
            } else {
                videoData = videoDataFromStorage;
            }
        } else {
            const directAccess = await chrome.storage.session.get(STORAGE_KEYS.VIDEO_DATA);
            const directVideoData = directAccess[STORAGE_KEYS.VIDEO_DATA];
            
            if (directVideoData && directVideoData.stored === 'in_memory') {
                videoData = videoDataInMemory;
            } else if (directVideoData && directVideoData.videoData) {
                videoData = directVideoData;
            }
        }
        
        // Create final report data with notes
        const reportData = {
            timestamp: new Date().toISOString(),
            consoleLogs: consoleLogs || [],
            networkLogs: networkLogs || [],
            userActions: userActions || [],
            environmentData: environmentData || {},
            videoData: videoData || null,
            notes: notes || '', // Include user notes
            metadata: {
                version: '2.1.0',
                phase: 'Phase 3 - Enhanced Synchronization, PII Scrubbing & Interactive Viewer',
                previewUsed: true
            }
        };
        
        console.log('SERVICE WORKER: Final report data prepared with notes');
        
        // Create HTML report if we have video data, otherwise fallback to JSON
        if (videoData && videoData.videoData) {
            console.log('SERVICE WORKER: Creating HTML report with video and notes...');
            const htmlReport = createHtmlReport(reportData);
            await downloadViaContentScript(htmlReport, 'html');
        } else {
            console.log('SERVICE WORKER: No video data available, creating JSON report with notes...');
            const jsonString = JSON.stringify(reportData, null, 2);
            await downloadViaContentScript(jsonString, 'json');
        }
        
        // Clean up session data after successful save
        await resetSessionData();
        
        console.log('SERVICE WORKER: Report saved successfully from preview');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error saving report from preview:', error);
        throw error;
    }
}

// Cancel preview and clean up data
async function cancelPreview() {
    try {
        console.log('SERVICE WORKER: Cancelling preview and cleaning up data...');
        
        // Reset all session data
        await resetSessionData();
        
        console.log('SERVICE WORKER: Preview cancelled and data cleaned up');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error cancelling preview:', error);
        throw error;
    }
}

// Restart recording by cleaning up data and starting fresh
async function restartRecording() {
    try {
        console.log('SERVICE WORKER: Restarting recording...');
        
        // Reset all session data
        await resetSessionData();
        
        // Start a new capture
        await startCapture();
        
        console.log('SERVICE WORKER: Recording restarted successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error restarting recording:', error);
        throw error;
    }
}

// Create preview HTML for review before saving
function createPreviewHtml(previewData) {
    console.log('SERVICE WORKER: createPreviewHtml called with:', {
        networkLogsCount: previewData.networkLogs?.length || 0,
        firstNetworkLog: previewData.networkLogs?.[0]
    });
    
    const videoDataUrl = previewData.videoData && previewData.videoData.videoData ? 
        'data:' + previewData.videoData.mimeType + ';base64,' + previewData.videoData.videoData : null;
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BugReel Preview - ${new Date(previewData.timestamp).toLocaleString()}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f1113;
            color: #e5e7eb;
            line-height: 1.6;
        }
        
        .preview-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .preview-header {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 30px;
            text-align: center;
        }
        
        .preview-header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            color: #2c3e50;
        }
        
        .preview-header p {
            font-size: 1.2em;
            color: #6c757d;
            margin-bottom: 20px;
        }
        
        .preview-actions {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin-bottom: 30px;
        }
        
        .btn {
            padding: 12px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .btn-save {
            background: #28a745;
            color: white;
        }
        
        .btn-save:hover {
            background: #218838;
            transform: translateY(-2px);
        }
        
        .btn-cancel {
            background: #dc3545;
            color: white;
        }
        
        .btn-cancel:hover {
            background: #c82333;
            transform: translateY(-2px);
        }
        
        .btn-restart {
            background: #ffc107;
            color: #212529;
        }
        
        .btn-restart:hover {
            background: #e0a800;
            transform: translateY(-2px);
        }
        
        .preview-content {
            display: grid;
            grid-template-columns: 3fr 2fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .video-section {
            background: #161a1d;
            padding: 16px;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25);
            border: 1px solid rgba(255,255,255,0.06);
        }
        
        .video-section h2 {
            margin: 0 0 12px 0;
            color: #ffffff;
            font-size: 1.1em;
            opacity: .9;
        }
        
        .video-container {
            position: relative;
            width: 100%;
            margin: 0;
        }
        
        .video-player {
            width: 100%;
            height: auto;
            background: #000;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25);
        }
        
        .video-info {
            margin-top: 12px;
            padding: 12px;
            background: #1b2024;
            border-radius: 10px;
            font-size: 13px;
            color: #b9c1c6;
            border: 1px solid rgba(255,255,255,0.06);
        }
        
        .data-summary {
            background: #161a1d;
            padding: 16px;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25);
            border: 1px solid rgba(255,255,255,0.06);
        }
        
        .data-summary h2 {
            margin: 0 0 12px 0;
            color: #ffffff;
            font-size: 1.1em;
            opacity: .9;
        }
        
        .summary-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            margin-bottom: 8px;
            background: #1b2024;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.06);
        }
        
        .summary-item:last-child {
            margin-bottom: 0;
        }
        
        .summary-item.console-logs {
            border-left-color: #dc3545;
        }
        
        .summary-item.network-logs {
            border-left-color: #ffc107;
        }
        
        .summary-item.user-actions {
            border-left-color: #28a745;
        }
        
        .summary-label {
            font-weight: 600;
            color: #e5e7eb;
        }
        
        .summary-count {
            font-size: 1.1em;
            font-weight: 700;
            color: #b9c1c6;
        }
        
        /* notes-section removed */
        
        .notes-section h2 {
            margin-bottom: 20px;
            color: #2c3e50;
            font-size: 1.5em;
        }
        
        .notes-textarea {
            width: 100%;
            min-height: 150px;
            padding: 15px;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            resize: vertical;
            transition: border-color 0.3s ease;
        }
        
        .notes-textarea:focus {
            outline: none;
            border-color: #007bff;
        }
        
        .no-video-message {
            text-align: center;
            padding: 40px 20px;
            color: #6c757d;
            font-size: 1.1em;
        }
        
        .no-video-message i {
            font-size: 4em;
            margin-bottom: 20px;
            display: block;
        }
        
        .error-details {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
            color: #721c24;
        }
        
        .error-message {
            font-family: monospace;
            font-weight: bold;
            margin: 10px 0;
            padding: 10px;
            background: rgba(0,0,0,0.1);
            border-radius: 4px;
        }
        
        .error-time {
            font-size: 0.9em;
            opacity: 0.8;
            margin-bottom: 15px;
        }
        
        .error-stack {
            margin-top: 15px;
        }
        
        .error-stack summary {
            cursor: pointer;
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        .error-stack pre {
            background: rgba(0,0,0,0.1);
            padding: 10px;
            border-radius: 4px;
            font-size: 0.8em;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .diagnostic-info {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
            color: #0c5460;
        }
        
        .diagnostic-info ul {
            margin: 15px 0;
            padding-left: 0;
            list-style: none;
        }
        
        .diagnostic-info li {
            margin: 8px 0;
            padding: 5px 0;
        }
        
        .fallback-note {
            margin-top: 20px;
            font-style: italic;
            opacity: 0.8;
        }
        
        /* Detailed Data Section Styles */
        .detailed-data-section {
            margin-top: 30px;
            background: #161a1d;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.35);
            border: 1px solid rgba(255,255,255,0.06);
            overflow: hidden;
        }
        
        .tab-navigation {
            display: flex;
            background: #1b2024;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .tab-button {
            flex: 1;
            padding: 16px 20px;
            background: transparent;
            border: none;
            color: #b9c1c6;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            border-bottom: 3px solid transparent;
        }
        
        .tab-button:hover {
            background: rgba(255,255,255,0.05);
            color: #e5e7eb;
        }
        
        .tab-button.active {
            color: #ffffff;
            background: rgba(255,255,255,0.08);
            border-bottom-color: #0066cc;
        }
        
        .tab-content {
            padding: 20px;
        }
        
        .tab-panel {
            display: none;
        }
        
        .tab-panel.active {
            display: block;
        }
        
        .tab-panel h3 {
            margin: 0 0 20px 0;
            color: #ffffff;
            font-size: 1.2em;
        }
        
        /* Network Request Styles */
        .network-requests {
            space-y: 10px;
        }
        
        .network-request-item {
            background: #1b2024;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 12px;
            overflow: hidden;
        }
        
        .request-header {
            padding: 16px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.2s ease;
            border-left: 3px solid transparent;
        }
        
        .request-header:hover {
            background: rgba(255,255,255,0.05);
            border-left-color: #0066cc;
        }
        
        .request-summary {
            display: flex;
            gap: 12px;
            align-items: center;
            flex: 1;
        }
        
        .method {
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            min-width: 60px;
            text-align: center;
        }
        
        .method.get { background: #28a745; color: white; }
        .method.post { background: #ffc107; color: #212529; }
        .method.put { background: #17a2b8; color: white; }
        .method.delete { background: #dc3545; color: white; }
        .method.patch { background: #6f42c1; color: white; }
        .method.unknown { background: #6c757d; color: white; }
        
        .url {
            color: #e5e7eb;
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
            flex: 1;
        }
        
        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 12px;
            min-width: 60px;
            text-align: center;
        }
        
        .status-2xx { background: #28a745; color: white; }
        .status-3xx { background: #ffc107; color: #212529; }
        .status-4xx { background: #fd7e14; color: white; }
        .status-5xx { background: #dc3545; color: white; }
        .status-0xx { background: #6c757d; color: white; }
        
        .duration {
            color: #b9c1c6;
            font-size: 12px;
            font-weight: 600;
            min-width: 50px;
            text-align: right;
        }
        
        .toggle-icon {
            color: #b9c1c6;
            font-size: 12px;
            transition: transform 0.2s ease;
        }
        
        .toggle-icon.rotated {
            transform: rotate(180deg);
        }
        
        .request-details {
            display: none;
            border-top: 1px solid rgba(255,255,255,0.1);
            background: #0f1113;
        }
        
        .request-details.open {
            display: block !important;
        }
        
        .request-tabs {
            display: flex;
            background: #161a1d;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .request-tab-btn {
            padding: 12px 20px;
            background: transparent;
            border: none;
            color: #b9c1c6;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            border-bottom: 2px solid transparent;
        }
        
        .request-tab-btn:hover {
            background: rgba(255,255,255,0.05);
            color: #e5e7eb;
        }
        
        .request-tab-btn.active {
            color: #ffffff;
            background: rgba(255,255,255,0.08);
            border-bottom-color: #0066cc;
        }
        
        .request-tab-content {
            padding: 20px;
        }
        
        .request-tab-panel {
            display: none;
        }
        
        .request-tab-panel.active {
            display: block;
        }
        
        .headers-section h4 {
            color: #ffffff;
            margin: 0 0 12px 0;
            font-size: 14px;
        }
        
        .headers-list {
            background: #1b2024;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,0.06);
        }
        
        .header-item {
            display: flex;
            margin-bottom: 8px;
            font-family: monospace;
            font-size: 12px;
        }
        
        .header-item:last-child {
            margin-bottom: 0;
        }
        
        .header-name {
            color: #ffc107;
            font-weight: 600;
            min-width: 150px;
            padding-right: 8px;
        }
        
        .header-value {
            color: #e5e7eb;
            word-break: break-all;
        }
        
        .response-body-section h4 {
            color: #ffffff;
            margin: 0 0 12px 0;
            font-size: 14px;
        }
        
        .response-body {
            background: #1b2024;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.06);
            max-height: 400px;
            overflow-y: auto;
        }
        
        .response-body pre {
            margin: 0;
            padding: 16px;
            color: #e5e7eb;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        /* Console Logs Styles */
        .console-logs {
            background: #1b2024;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.06);
            overflow: hidden;
        }
        
        .console-log-item {
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            gap: 12px;
            align-items: flex-start;
            font-family: monospace;
            font-size: 12px;
        }
        
        .console-log-item:last-child {
            border-bottom: none;
        }
        
        .console-log-item.log-error {
            background: rgba(220, 53, 69, 0.1);
            border-left: 3px solid #dc3545;
        }
        
        .console-log-item.log-warn {
            background: rgba(255, 193, 7, 0.1);
            border-left: 3px solid #ffc107;
        }
        
        .console-log-item.log-info {
            background: rgba(23, 162, 184, 0.1);
            border-left: 3px solid #17a2b8;
        }
        
        .console-log-item.log-debug {
            background: rgba(108, 117, 125, 0.1);
            border-left: 3px solid #6c757d;
        }
        
        .console-log-item .timestamp {
            color: #b9c1c6;
            white-space: nowrap;
        }
        
        .console-log-item .level {
            color: #ffc107;
            font-weight: 600;
            min-width: 50px;
        }
        
        .console-log-item .message {
            color: #e5e7eb;
            flex: 1;
            word-break: break-word;
        }
        
        /* User Actions Styles */
        .user-actions {
            background: #1b2024;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.06);
            overflow: hidden;
        }
        
        .user-action-item {
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            gap: 12px;
            align-items: flex-start;
            font-family: monospace;
            font-size: 12px;
        }
        
        .user-action-item:last-child {
            border-bottom: none;
        }
        
        .user-action-item .timestamp {
            color: #b9c1c6;
            white-space: nowrap;
        }
        
        .user-action-item .action-type {
            color: #28a745;
            font-weight: 600;
            min-width: 80px;
        }
        
        .user-action-item .action-details {
            color: #e5e7eb;
            flex: 1;
            word-break: break-word;
        }
        
        /* Environment Data Styles */
        .environment-data {
            background: #1b2024;
            color: #e5e7eb;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.06);
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.5;
            overflow-x: auto;
            white-space: pre;
        }
        
        .no-data {
            text-align: center;
            color: #6c757d;
            font-style: italic;
            padding: 40px;
        }
        
        @media (max-width: 768px) {
            .preview-content {
                grid-template-columns: 1fr;
            }
            
            .preview-actions {
                flex-direction: column;
                align-items: center;
            }
            
            .btn {
                width: 100%;
                max-width: 300px;
            }
            
            .tab-navigation {
                flex-direction: column;
            }
            
            .request-summary {
                flex-direction: column;
                gap: 8px;
                align-items: flex-start;
            }
            
            .url {
                font-size: 11px;
            }
        }
    </style>
</head>
<body>
    <div class="preview-container">
        <!-- Minimal header removed per new design -->
        
        <!-- Action buttons removed; outer extension page provides controls -->
        
        <div class="preview-content">
            <div class="video-section">
                <h2>📹 Recorded Video</h2>
                ${videoDataUrl ? `
                    <div class="video-container">
                        <video class="video-player" controls>
                            <source src="${videoDataUrl}" type="${previewData.videoData.mimeType}">
                            Your browser does not support the video tag.
                        </video>
                        <div class="video-info">
                            <strong>Duration:</strong> <span id="brDuration">${typeof previewData.videoData.duration === 'number' && isFinite(previewData.videoData.duration) && previewData.videoData.duration > 0 ? (previewData.videoData.duration / 1000).toFixed(1) + 's' : 'Unknown'}</span><br>
                            <strong>Size:</strong> ${previewData.videoData.size ? (previewData.videoData.size / 1024 / 1024).toFixed(1) + ' MB' : 'Unknown'}<br>
                            <strong>Format:</strong> ${previewData.videoData.mimeType || 'Unknown'}
                        </div>
                    </div>
                ` : `
                    <div class="no-video-message">
                        <i>📹</i>
                        <p><strong>No video recording available</strong></p>
                        ${previewData.videoError ? `
                            <div class="error-details">
                                <p><strong>🚨 Recording Error:</strong></p>
                                <p class="error-message">${previewData.videoError.message}</p>
                                <p class="error-time">Failed at: ${new Date(previewData.videoError.timestamp).toLocaleString()}</p>
                                <details class="error-stack">
                                    <summary>Technical Details</summary>
                                    <pre>${previewData.videoError.stack || 'No stack trace available'}</pre>
                                </details>
                            </div>
                        ` : `
                            <div class="diagnostic-info">
                                <p><strong>🔍 Possible Causes:</strong></p>
                                <ul>
                                    <li>• User denied screen sharing permission</li>
                                    <li>• Browser doesn't support screen recording</li>
                                    <li>• Extension lacks required permissions</li>
                                    <li>• Recording failed to start or stopped unexpectedly</li>
                                </ul>
                                <p><strong>📝 Check browser console for detailed error messages</strong></p>
                            </div>
                        `}
                        <p class="fallback-note">The report will be saved as JSON format instead</p>
                    </div>
                `}
            </div>
            
            <div class="data-summary">
                <h2>📊 Captured Data Summary</h2>
                <div class="summary-item console-logs">
                    <span class="summary-label">📝 Console Logs</span>
                    <span class="summary-count">${previewData.consoleLogs.length}</span>
                </div>
                <div class="summary-item network-logs">
                    <span class="summary-label">🌐 Network Requests</span>
                    <span class="summary-count">${previewData.networkLogs.length}</span>
                </div>
                <div class="summary-item user-actions">
                    <span class="summary-label">🖱️ User Actions</span>
                    <span class="summary-count">${previewData.userActions.length}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">💻 Environment Data</span>
                    <span class="summary-count">${previewData.environmentData && Object.keys(previewData.environmentData).length > 0 ? '✓' : '✗'}</span>
                </div>
            </div>
        </div>
        

        
        <!-- Notes section removed per new design -->
    </div>
    
    <script>
        // Update duration from actual video metadata if missing or 'Unknown'
        (function(){
            try {
                const video = document.querySelector('.video-player');
                const durSpan = document.getElementById('brDuration');
                if (video && durSpan) {
                    const setDur = () => {
                        if (isFinite(video.duration) && video.duration > 0) {
                            durSpan.textContent = (video.duration).toFixed(1) + 's';
                        }
                    };
                    video.addEventListener('loadedmetadata', setDur, { once: true });
                    // In case metadata is already loaded
                    if (!isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
                        setDur();
                    }
                }
            } catch (e) {}
        })();
        

    </script>
</body>
</html>`;
} 