// background.js - Service Worker for BugReel extension
console.log('SERVICE WORKER: 🚀 BugReel service worker loaded at', new Date().toISOString());

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

// Track service worker restarts
let serviceWorkerStartTime = Date.now();
console.log('SERVICE WORKER: 📊 Service worker start time:', new Date(serviceWorkerStartTime).toISOString());

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
        responseBody: request.responseBody ? scrubPiiFromObject(request.responseBody) : request.responseBody
    };
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
    console.log('SERVICE WORKER: Re-injecting content script for tab:', tabId);
    
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
    console.log('SERVICE WORKER: Received message:', message.type, 'from', sender.tab ? 'tab' : 'popup');
    
    try {
        switch (message.type) {
            case 'START_CAPTURE':
                console.log('SERVICE WORKER: Handling START_CAPTURE');
                await startCapture();
                sendResponse({ success: true });
                break;
                
            case 'STOP_CAPTURE':
                console.log('SERVICE WORKER: Handling STOP_CAPTURE');
                await stopCapture();
                sendResponse({ success: true });
                break;
                
            case 'GET_RECORDING_STATE':
                const isRecording = await getRecordingState();
                sendResponse({ isRecording });
                break;
                
            case 'CONSOLE_LOG':
                await handleConsoleLog(message.payload);
                break;
                
            case 'USER_ACTION':
                await handleUserAction(message.payload);
                break;
                
                    case 'ENVIRONMENT_DATA':
            await handleEnvironmentData(message.payload);
            break;
            
        case 'VIDEO_RECORDED':
            console.log('SERVICE WORKER: 📹 VIDEO_RECORDED message received, payload:', message.payload);
            await handleVideoRecorded(message.payload);
            break;
            
        case 'DEBUG_TOOLBAR_ONLY':
            console.log('SERVICE WORKER: Handling DEBUG_TOOLBAR_ONLY');
            await debugToolbarOnly();
            sendResponse({ success: true });
            break;
            
        default:
            console.warn('SERVICE WORKER: Unknown message type:', message.type);
        }
    } catch (error) {
        console.error('SERVICE WORKER: Error handling message:', error);
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
            console.warn('SERVICE WORKER: ⚠️ Video recording failed, but continuing:', videoError);
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
                await chrome.tabs.sendMessage(activeTab.id, {
                    type: 'STOP_LOGGING'
                });
                console.log('SERVICE WORKER: Stop message sent to content script');
            } catch (error) {
                console.warn('Could not send stop message to content script:', error);
            }
        }
        
        // Generate and download report
        console.log('SERVICE WORKER: About to generate report...');
        await generateReport();
        console.log('SERVICE WORKER: Report generation completed');
        
        console.log('SERVICE WORKER: Capture stopped successfully');
        
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
}

async function stopNetworkLogging() {
    chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
    chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    chrome.webRequest.onCompleted.removeListener(onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
}

// Network request event handlers
function onBeforeRequest(details) {
    const startTime = Date.now();
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
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.requestHeaders = details.requestHeaders;
    }
}

function onHeadersReceived(details) {
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.statusCode = details.statusCode;
        request.responseHeaders = details.responseHeaders;
    }
}

function onCompleted(details) {
    const request = networkRequestsInFlight.get(details.requestId);
    if (request) {
        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.status = 'completed';
        
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
            await downloadViaContentScript(htmlReport, 'html');
        } else {
            console.log('SERVICE WORKER: No video data available, reason:', 
                videoData ? 'Video data exists but no videoData property' : 'No video data at all');
            const jsonString = JSON.stringify(reportData, null, 2);
            await downloadViaContentScript(jsonString, 'json');
        }
        
        console.log('SERVICE WORKER: Report generated successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error generating report:', error);
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
        throw error;
    }
}

// Video recording functions
async function startVideoRecording() {
    try {
        console.log('SERVICE WORKER: 🎬 Starting video recording...');
        
        // Create offscreen document if it doesn't exist
        console.log('SERVICE WORKER: 📄 Ensuring offscreen document...');
        await ensureOffscreenDocument();
        console.log('SERVICE WORKER: ✅ Offscreen document ready');
        
        // Wait a moment for the offscreen document to be ready
        console.log('SERVICE WORKER: ⏰ Waiting 500ms for offscreen document to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send start recording message to offscreen document with timeout
        console.log('SERVICE WORKER: 📤 Sending START_RECORDING message to offscreen document...');
        
        const messagePromise = chrome.runtime.sendMessage({
            type: 'START_RECORDING',
            options: {
                includeSystemAudio: true,
                includeMicrophone: true
            }
        });
        
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Video recording start timeout after 10 seconds')), 10000);
        });
        
        const response = await Promise.race([messagePromise, timeoutPromise]);
        
        console.log('SERVICE WORKER: 📥 Received response from offscreen document:', response);
        
        if (!response || !response.success) {
            const errorMsg = 'Failed to start video recording: ' + (response?.error || 'Unknown error');
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
            reasons: ['USER_MEDIA'],
            justification: 'Recording screen and audio for bug reports'
        });
        
        console.log('SERVICE WORKER: Offscreen document created successfully');
        
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
        
    } catch (error) {
        console.error('SERVICE WORKER: ❌ Error handling video data:', error);
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f5f5;
            color: #333;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        .header h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .header .meta {
            color: #7f8c8d;
            font-size: 14px;
        }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 400px;
            gap: 20px;
            min-height: 600px;
        }
        
        .video-section {
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 20px;
        }
        
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
        
        .video-controls {
            margin-top: 15px;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        .data-section {
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 20px;
            overflow-y: auto;
            max-height: 80vh;
        }
        
        .tabs {
            display: flex;
            border-bottom: 2px solid #ecf0f1;
            margin-bottom: 20px;
        }
        
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.3s ease;
        }
        
        .tab.active {
            border-bottom-color: #3498db;
            color: #3498db;
            font-weight: bold;
        }
        
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
        
        .search-container {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            position: relative;
        }
        
        #search-input {
            flex: 1;
            padding: 8px 40px 8px 12px;
            border: 1px solid #ced4da;
            border-radius: 6px;
            font-size: 14px;
            background: white;
        }
        
        #search-input:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
        }
        
        #clear-search {
            position: absolute;
            right: 8px;
            background: none;
            border: none;
            color: #6c757d;
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            font-size: 14px;
        }
        
        #clear-search:hover {
            background: #e9ecef;
            color: #495057;
        }
        
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
        
        .network-request {
            margin-bottom: 15px;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        
        .network-request.error {
            border-left: 4px solid #e74c3c;
        }
        
        .network-request.success {
            border-left: 4px solid #27ae60;
        }
        
        .request-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .request-method {
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
        }
        
        .method-get { background: #d4edda; color: #155724; }
        .method-post { background: #fff3cd; color: #856404; }
        .method-put { background: #cce5ff; color: #004085; }
        .method-delete { background: #f8d7da; color: #721c24; }
        
        .status-code {
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
        }
        
        .status-2xx { background: #d4edda; color: #155724; }
        .status-3xx { background: #cce5ff; color: #004085; }
        .status-4xx { background: #fff3cd; color: #856404; }
        .status-5xx { background: #f8d7da; color: #721c24; }
        
        .collapsible {
            cursor: pointer;
            padding: 5px;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 3px;
            margin-top: 5px;
        }
        
        .collapsible-content {
            display: none;
            padding: 10px;
            background: #fff;
            border: 1px solid #dee2e6;
            border-top: none;
            border-radius: 0 0 3px 3px;
        }
        
        .user-action {
            margin-bottom: 10px;
            padding: 10px;
            border-radius: 5px;
            background: #f8f9fa;
            border-left: 4px solid #6c757d;
        }
        
        .user-action.highlight {
            background-color: #fff3cd;
            border-left-color: #ffc107;
        }
        
        .user-action.active-sync {
            background-color: #e8f5e8;
            border-left-color: #4caf50;
            transform: scale(1.02);
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
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
        
        .env-item {
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
            border: 1px solid #dee2e6;
        }
        
        .env-label {
            font-weight: bold;
            color: #495057;
            margin-bottom: 5px;
        }
        
        .env-value {
            color: #6c757d;
            font-size: 14px;
        }
        
        .no-data {
            text-align: center;
            color: #6c757d;
            padding: 40px;
            font-style: italic;
        }
        
        /* Timeline Visualization Styles (Phase 3) */
        .timeline-markers {
            margin-top: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
            border: 1px solid #dee2e6;
        }
        
        .timeline-track {
            position: relative;
            height: 60px;
        }
        
        .timeline-labels {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 12px;
            font-weight: 500;
        }
        
        .timeline-label {
            padding: 2px 8px;
            border-radius: 12px;
            color: white;
            font-size: 10px;
        }
        
        .timeline-label.errors {
            background: #e74c3c;
        }
        
        .timeline-label.network {
            background: #f39c12;
        }
        
        .timeline-label.actions {
            background: #27ae60;
        }
        
        .timeline-bars {
            position: relative;
            height: 40px;
            background: #ecf0f1;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .timeline-bar {
            position: absolute;
            width: 100%;
            height: 12px;
        }
        
        .error-bar {
            top: 2px;
        }
        
        .network-bar {
            top: 16px;
        }
        
        .action-bar {
            top: 30px;
        }
        
        .timeline-marker {
            position: absolute;
            width: 3px;
            height: 100%;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .timeline-marker:hover {
            width: 5px;
            z-index: 10;
        }
        
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
            <h1>🎬 BugReel Report</h1>
            <div class="meta">
                Generated: ${new Date(reportData.timestamp).toLocaleString()} | 
                Version: ${reportData.metadata.version} | 
                Phase: ${reportData.metadata.phase}
            </div>
        </div>
        
        <div class="main-content">
            <div class="video-section">
                <h2>📹 Screen Recording</h2>
                ${videoDataUrl ? `
                    <div class="video-container">
                        <video id="mainVideo" controls>
                            <source src="${videoDataUrl}" type="${reportData.videoData.mimeType}">
                            Your browser does not support the video tag.
                        </video>
                    </div>
                    <div class="video-controls">
                        <span>Duration: <span id="videoDuration">--:--</span></span>
                        <span>|</span>
                        <span>Size: ${(reportData.videoData.size / 1024 / 1024).toFixed(2)} MB</span>
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
                <div class="controls-section">
                    <div class="search-container">
                        <input type="text" id="search-input" placeholder="Search logs, requests, or actions..." />
                        <button id="clear-search" title="Clear search">✕</button>
                    </div>
                    <div class="filter-container">
                        <div class="filter-group">
                            <label>Log Level:</label>
                            <select id="log-level-filter">
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
                            <select id="status-filter">
                                <option value="">All Status</option>
                                <option value="2xx">Success (2xx)</option>
                                <option value="3xx">Redirect (3xx)</option>
                                <option value="4xx">Client Error (4xx)</option>
                                <option value="5xx">Server Error (5xx)</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label>Time Range:</label>
                            <select id="time-filter">
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
                                <div class="collapsible" onclick="toggleCollapsible(this)">
                                    Show Headers
                                </div>
                                <div class="collapsible-content">
                                    <strong>Request Headers:</strong><br>
                                    ${req.requestHeaders ? req.requestHeaders.map(h => `${h.name}: ${h.value}`).join('<br>') : 'None'}
                                    <br><br>
                                    <strong>Response Headers:</strong><br>
                                    ${req.responseHeaders ? req.responseHeaders.map(h => `${h.name}: ${h.value}`).join('<br>') : 'None'}
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
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                element.textContent = 'Hide Headers';
            } else {
                content.style.display = 'none';
                element.textContent = 'Show Headers';
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
            
            video.addEventListener('loadedmetadata', () => {
                const duration = Math.floor(video.duration);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                document.getElementById('videoDuration').textContent = 
                    minutes.toString().padStart(2, '0') + ':' + 
                    seconds.toString().padStart(2, '0');
                
                // Initialize timeline markers
                initializeTimelineMarkers();
            });
            
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
        
        function initializeTimelineMarkers() {
            // Add timeline visualization
            const videoContainer = document.querySelector('.video-container');
            if (videoContainer && video) {
                const timeline = document.createElement('div');
                timeline.className = 'timeline-markers';
                timeline.innerHTML = '<div class="timeline-track">' +
                    '<div class="timeline-labels">' +
                        '<span class="timeline-label errors">Errors</span>' +
                        '<span class="timeline-label network">Network</span>' +
                        '<span class="timeline-label actions">Actions</span>' +
                    '</div>' +
                    '<div class="timeline-bars">' +
                        '<div class="timeline-bar error-bar" id="error-timeline"></div>' +
                        '<div class="timeline-bar network-bar" id="network-timeline"></div>' +
                        '<div class="timeline-bar action-bar" id="action-timeline"></div>' +
                    '</div>' +
                '</div>';
                videoContainer.appendChild(timeline);
                
                // Populate timeline markers
                populateTimelineMarkers();
            }
        }
        
        function populateTimelineMarkers() {
            if (!video || !recordingStartTime) return;
            
            const videoDuration = video.duration;
            const errorBar = document.getElementById('error-timeline');
            const networkBar = document.getElementById('network-timeline');
            const actionBar = document.getElementById('action-timeline');
            
            if (!errorBar || !networkBar || !actionBar) return;
            
            // Clear existing markers
            [errorBar, networkBar, actionBar].forEach(bar => bar.innerHTML = '');
            
            // Add error markers
            reportData.consoleLogs.filter(log => log.level === 'error').forEach(log => {
                const logTime = new Date(log.timestamp).getTime();
                const relativeTime = (logTime - recordingStartTime) / 1000;
                if (relativeTime >= 0 && relativeTime <= videoDuration) {
                    const position = (relativeTime / videoDuration) * 100;
                    const marker = document.createElement('div');
                    marker.className = 'timeline-marker error-marker';
                    marker.style.left = position + '%';
                    marker.title = 'Error at ' + formatTime(relativeTime) + ': ' + log.message.substring(0, 50) + '...';
                    errorBar.appendChild(marker);
                }
            });
            
            // Add network error markers
            reportData.networkLogs.filter(req => req.statusCode >= 400).forEach(req => {
                const reqTime = new Date(req.timestamp).getTime();
                const relativeTime = (reqTime - recordingStartTime) / 1000;
                if (relativeTime >= 0 && relativeTime <= videoDuration) {
                    const position = (relativeTime / videoDuration) * 100;
                    const marker = document.createElement('div');
                    marker.className = 'timeline-marker network-marker';
                    marker.style.left = position + '%';
                    marker.title = req.method + ' ' + req.url + ' - ' + req.statusCode + ' at ' + formatTime(relativeTime);
                    networkBar.appendChild(marker);
                }
            });
            
            // Add user action markers
            reportData.userActions.forEach(action => {
                const actionTime = new Date(action.timestamp).getTime();
                const relativeTime = (actionTime - recordingStartTime) / 1000;
                if (relativeTime >= 0 && relativeTime <= videoDuration) {
                    const position = (relativeTime / videoDuration) * 100;
                    const marker = document.createElement('div');
                    marker.className = 'timeline-marker action-marker';
                    marker.style.left = position + '%';
                    marker.title = action.type + ' on ' + action.selector + ' at ' + formatTime(relativeTime);
                    actionBar.appendChild(marker);
                }
            });
        }
        
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
            
            // Update timeline position indicator
            updateTimelinePosition(videoTime);
        }
        
        function updateTimelinePosition(videoTime) {
            const videoDuration = video ? video.duration : 0;
            if (videoDuration > 0) {
                const position = (videoTime / videoDuration) * 100;
                
                // Update or create position indicator
                let indicator = document.getElementById('timeline-position');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'timeline-position';
                    indicator.className = 'timeline-position-indicator';
                    const timelineTrack = document.querySelector('.timeline-track');
                    if (timelineTrack) {
                        timelineTrack.appendChild(indicator);
                    }
                }
                
                if (indicator) {
                    indicator.style.left = position + '%';
                }
            }
        }
        
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