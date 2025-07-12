// background.js - Service Worker for BugReel extension
console.log('SERVICE WORKER: BugReel service worker loaded at', new Date().toISOString());

// Session storage keys
const STORAGE_KEYS = {
    RECORDING_STATE: 'isRecording',
    CONSOLE_LOGS: 'consoleLogs',
    NETWORK_LOGS: 'networkLogs',
    USER_ACTIONS: 'userActions',
    ENVIRONMENT_DATA: 'environmentData',
    RECORDING_START_TIME: 'recordingStartTime',
    VIDEO_DATA: 'videoData'
};

// Offscreen document management
let offscreenDocumentPromise = null;

// Initialize storage
chrome.runtime.onInstalled.addListener(async () => {
    await resetSessionData();
    console.log('SERVICE WORKER: BugReel installed and initialized');
});

// Service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('SERVICE WORKER: Service worker started');
});

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
            await handleVideoRecorded(message.payload);
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

// Start capture process
async function startCapture() {
    try {
        console.log('Starting capture...');
        
        // Clear previous session data FIRST
        await resetSessionData();
        
        // Set recording state
        await chrome.storage.session.set({ 
            [STORAGE_KEYS.RECORDING_STATE]: true,
            [STORAGE_KEYS.RECORDING_START_TIME]: Date.now()
        });
        
        // Get the active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!activeTab) {
            throw new Error('No active tab found');
        }
        
        // Inject content script into the active tab
        await injectContentScript(activeTab.id);
        
        // Start network request logging
        await startNetworkLogging();
        
        // Start video recording via offscreen document
        await startVideoRecording();
        
        console.log('Capture started successfully');
        
    } catch (error) {
        console.error('Error starting capture:', error);
        await chrome.storage.session.set({ [STORAGE_KEYS.RECORDING_STATE]: false });
        throw error;
    }
}

// Stop capture process
async function stopCapture() {
    try {
        console.log('SERVICE WORKER: Stopping capture...');
        
        // Set recording state
        await chrome.storage.session.set({ [STORAGE_KEYS.RECORDING_STATE]: false });
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
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        
        // Send start logging message
        await chrome.tabs.sendMessage(tabId, {
            type: 'START_LOGGING'
        });
        
    } catch (error) {
        console.error('Error injecting content script:', error);
        throw error;
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
    logs.push(logData);
    await chrome.storage.session.set({ [STORAGE_KEYS.CONSOLE_LOGS]: logs });
}

async function handleUserAction(actionData) {
    const actions = await getStoredData(STORAGE_KEYS.USER_ACTIONS) || [];
    actions.push(actionData);
    await chrome.storage.session.set({ [STORAGE_KEYS.USER_ACTIONS]: actions });
}

async function handleEnvironmentData(envData) {
    await chrome.storage.session.set({ [STORAGE_KEYS.ENVIRONMENT_DATA]: envData });
}

async function saveNetworkRequest(request) {
    const requests = await getStoredData(STORAGE_KEYS.NETWORK_LOGS) || [];
    requests.push(request);
    await chrome.storage.session.set({ [STORAGE_KEYS.NETWORK_LOGS]: requests });
}

// Utility functions
async function getRecordingState() {
    const data = await chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE);
    return data[STORAGE_KEYS.RECORDING_STATE] || false;
}

async function getStoredData(key) {
    const data = await chrome.storage.session.get(key);
    return data[key];
}

async function resetSessionData() {
    await chrome.storage.session.clear();
    await chrome.storage.session.set({
        [STORAGE_KEYS.RECORDING_STATE]: false,
        [STORAGE_KEYS.CONSOLE_LOGS]: [],
        [STORAGE_KEYS.NETWORK_LOGS]: [],
        [STORAGE_KEYS.USER_ACTIONS]: [],
        [STORAGE_KEYS.ENVIRONMENT_DATA]: null,
        [STORAGE_KEYS.VIDEO_DATA]: null
    });
}

// Generate and download report
async function generateReport() {
    try {
        console.log('SERVICE WORKER: Generating report...');
        
        // Get all collected data
        const [consoleLogs, networkLogs, userActions, environmentData, videoData] = await Promise.all([
            getStoredData(STORAGE_KEYS.CONSOLE_LOGS),
            getStoredData(STORAGE_KEYS.NETWORK_LOGS),
            getStoredData(STORAGE_KEYS.USER_ACTIONS),
            getStoredData(STORAGE_KEYS.ENVIRONMENT_DATA),
            getStoredData(STORAGE_KEYS.VIDEO_DATA)
        ]);
        
        console.log('SERVICE WORKER: Raw data retrieved:', {
            consoleLogs: consoleLogs ? consoleLogs.length : 'null',
            networkLogs: networkLogs ? networkLogs.length : 'null',
            userActions: userActions ? userActions.length : 'null',
            environmentData: environmentData ? 'present' : 'null',
            videoData: videoData ? 'present (' + videoData.size + ' bytes)' : 'null'
        });
        
        // For Phase 2, create either HTML report with video or JSON fallback
        const reportData = {
            timestamp: new Date().toISOString(),
            consoleLogs: consoleLogs || [],
            networkLogs: networkLogs || [],
            userActions: userActions || [],
            environmentData: environmentData || {},
            videoData: videoData || null,
            metadata: {
                version: '1.0.0',
                phase: 'Phase 2 - Video Recording & Self-Contained Viewer'
            }
        };
        
        console.log('SERVICE WORKER: Report data prepared:', {
            consoleLogs: reportData.consoleLogs.length,
            networkLogs: reportData.networkLogs.length,
            userActions: reportData.userActions.length,
            hasEnvironmentData: !!reportData.environmentData,
            hasVideoData: !!reportData.videoData
        });
        
        // Create HTML report if we have video data, otherwise fallback to JSON
        if (videoData) {
            console.log('SERVICE WORKER: Creating HTML report with video...');
            const htmlReport = createHtmlReport(reportData);
            await downloadViaContentScript(htmlReport, 'html');
        } else {
            console.log('SERVICE WORKER: No video data, creating JSON report...');
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
        console.log('SERVICE WORKER: Starting video recording...');
        
        // Create offscreen document if it doesn't exist
        await ensureOffscreenDocument();
        
        // Send start recording message to offscreen document
        const response = await chrome.runtime.sendMessage({
            type: 'START_RECORDING',
            options: {
                includeSystemAudio: true,
                includeMicrophone: true
            }
        });
        
        if (!response.success) {
            throw new Error(response.error || 'Failed to start video recording');
        }
        
        console.log('SERVICE WORKER: Video recording started successfully');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error starting video recording:', error);
        throw error;
    }
}

async function stopVideoRecording() {
    try {
        console.log('SERVICE WORKER: Stopping video recording...');
        
        // Send stop recording message to offscreen document
        const response = await chrome.runtime.sendMessage({
            type: 'STOP_RECORDING'
        });
        
        if (!response.success) {
            console.warn('SERVICE WORKER: Failed to stop video recording:', response.error);
        }
        
        console.log('SERVICE WORKER: Video recording stop signal sent');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error stopping video recording:', error);
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
        console.log('SERVICE WORKER: Video data received:', {
            size: videoData.size,
            mimeType: videoData.mimeType,
            duration: videoData.duration
        });
        
        // Store video data in session storage
        await chrome.storage.session.set({
            [STORAGE_KEYS.VIDEO_DATA]: videoData
        });
        
        console.log('SERVICE WORKER: Video data stored in session');
        
    } catch (error) {
        console.error('SERVICE WORKER: Error handling video data:', error);
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
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
            }
            
            .container {
                padding: 10px;
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
        
        // Video synchronization
        const video = document.getElementById('mainVideo');
        if (video) {
            video.addEventListener('loadedmetadata', () => {
                const duration = Math.floor(video.duration);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                document.getElementById('videoDuration').textContent = 
                    minutes.toString().padStart(2, '0') + ':' + 
                    seconds.toString().padStart(2, '0');
            });
            
            video.addEventListener('timeupdate', () => {
                const currentTime = video.currentTime;
                const currentTimestamp = new Date(Date.now() - (video.duration - currentTime) * 1000).toISOString();
                
                // Highlight relevant logs and actions
                highlightRelevantData(currentTimestamp);
            });
        }
        
        function highlightRelevantData(currentTimestamp) {
            // Remove previous highlights
            document.querySelectorAll('.highlight').forEach(el => {
                el.classList.remove('highlight');
            });
            
            // Find and highlight relevant entries within a 2-second window
            const currentTime = new Date(currentTimestamp).getTime();
            const tolerance = 2000; // 2 seconds
            
            document.querySelectorAll('[data-timestamp]').forEach(element => {
                const elementTime = new Date(element.dataset.timestamp).getTime();
                if (Math.abs(currentTime - elementTime) < tolerance) {
                    element.classList.add('highlight');
                }
            });
        }
        
        // Initialize
        console.log('BugReel Report Viewer loaded');
        console.log('Report data:', JSON.parse(document.getElementById('report-data').textContent));
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