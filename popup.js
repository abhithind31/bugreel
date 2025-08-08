// popup.js - Handles the popup UI interactions
document.addEventListener('DOMContentLoaded', async function() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const debugBtn = document.getElementById('debugBtn');
    const statusDiv = document.getElementById('status');
    const recordingInfo = document.getElementById('recording-info');
    
    // Check current recording state when popup opens
    await updateUIState();
    
    // Start recording button handler
    startBtn.addEventListener('click', async function() {
        try {
            // Always use video recording mode
            const recordingMode = 'video';
            
            // Update UI to show starting state
            startBtn.disabled = true;
            statusDiv.textContent = 'Starting tab recording...';
            statusDiv.className = 'status recording';
            
            // Send message to service worker to start capture
            await chrome.runtime.sendMessage({
                type: 'START_CAPTURE',
                recordingMode: recordingMode
            });
            
            // Update UI immediately (clear preview mode)
            updateUIState(true, false);
            
        } catch (error) {
            console.error('POPUP: Error starting capture:', error);
            statusDiv.textContent = 'Error: ' + (error.message || 'Failed to start recording');
            statusDiv.className = 'status idle';
            startBtn.disabled = false;
        }
    });
    
    // Stop recording button handler
    stopBtn.addEventListener('click', async function() {
        try {
            console.log('POPUP: Stopping capture...');
            
            // Send message to service worker to stop capture
            const response = await chrome.runtime.sendMessage({
                type: 'STOP_CAPTURE'
            });
            
            console.log('POPUP: Stop capture response:', response);
            
            // Update UI to show preview mode
            updateUIState(false, true);
            
        } catch (error) {
            console.error('POPUP: Error stopping capture:', error);
            statusDiv.textContent = 'Error: ' + (error.message || 'Failed to stop recording');
            statusDiv.className = 'status idle';
        }
    });
    
    // Debug toolbar only button handler
    debugBtn.addEventListener('click', async function() {
        try {
            console.log('POPUP: Starting debug toolbar-only test...');
            
            // Update UI to show starting state
            debugBtn.disabled = true;
            statusDiv.textContent = 'Testing toolbar creation...';
            statusDiv.className = 'status recording';
            
            // Send message to service worker to test toolbar only
            await chrome.runtime.sendMessage({
                type: 'DEBUG_TOOLBAR_ONLY'
            });
            
            console.log('POPUP: Debug toolbar test completed');
            statusDiv.textContent = 'Debug test completed - check console and look for toolbar';
            statusDiv.className = 'status idle';
            debugBtn.disabled = false;
            
        } catch (error) {
            console.error('POPUP: Error in debug toolbar test:', error);
            statusDiv.textContent = 'Error: ' + (error.message || 'Debug test failed');
            statusDiv.className = 'status idle';
            debugBtn.disabled = false;
        }
    });
    
    // Update UI state based on recording status
    async function updateUIState(forceRecording = null, previewMode = false) {
        let isRecording = forceRecording;
        
        if (isRecording === null) {
            // Check actual state from service worker
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'GET_RECORDING_STATE'
                });
                isRecording = response?.isRecording || false;
            } catch (error) {
                console.error('POPUP: Error getting recording state:', error);
                isRecording = false;
            }
        }
        
        if (previewMode) {
            // Preview mode - recording stopped, preview is open
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusDiv.innerHTML = '👁️ Preview open - Check the preview tab to save your report';
            statusDiv.className = 'status preview';
            recordingInfo.style.display = 'none';
        } else if (isRecording) {
            // Recording in progress
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusDiv.innerHTML = '<span class="recording-indicator"></span>Recording current tab...';
            statusDiv.className = 'status recording';
            recordingInfo.style.display = 'block';
        } else {
            // Idle state - ready to record
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusDiv.textContent = 'Ready to record current tab';
            statusDiv.className = 'status idle';
            recordingInfo.style.display = 'none';
        }
    }
    
    // Listen for messages from service worker (in case state changes)
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'RECORDING_STATE_CHANGED') {
            updateUIState(message.isRecording, message.previewMode);
        }
    });
}); 