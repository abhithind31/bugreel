// popup.js - Handles the popup UI interactions
document.addEventListener('DOMContentLoaded', async function() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('status');
    
    // Check current recording state when popup opens
    await updateUIState();
    
    // Start recording button handler
    startBtn.addEventListener('click', async function() {
        try {
            // Send message to service worker to start capture
            await chrome.runtime.sendMessage({
                type: 'START_CAPTURE'
            });
            
            // Update UI immediately
            updateUIState(true);
            
        } catch (error) {
            console.error('Error starting capture:', error);
            statusDiv.textContent = 'Error starting recording';
            statusDiv.className = 'status idle';
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
            
            // Update UI immediately
            updateUIState(false);
            
        } catch (error) {
            console.error('POPUP: Error stopping capture:', error);
            statusDiv.textContent = 'Error stopping recording';
            statusDiv.className = 'status idle';
        }
    });
    
    // Update UI based on recording state
    async function updateUIState(forceRecording = null) {
        let isRecording = forceRecording;
        
        if (isRecording === null) {
            // Check actual state from service worker
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'GET_RECORDING_STATE'
                });
                isRecording = response?.isRecording || false;
            } catch (error) {
                console.error('Error getting recording state:', error);
                isRecording = false;
            }
        }
        
        if (isRecording) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusDiv.innerHTML = '<span class="recording-indicator"></span>Recording in progress...';
            statusDiv.className = 'status recording';
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusDiv.textContent = 'Ready to record';
            statusDiv.className = 'status idle';
        }
    }
    
    // Listen for messages from service worker (in case state changes)
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'RECORDING_STATE_CHANGED') {
            updateUIState(message.isRecording);
        }
    });
}); 