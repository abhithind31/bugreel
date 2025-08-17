document.addEventListener('DOMContentLoaded', async function() {
    const startBtn = document.getElementById('startBtn');
    const statusDiv = document.getElementById('status');
    
    await updateUIState();
    
    startBtn.addEventListener('click', async function() {
        try {
            const recordingMode = 'video';
            
            startBtn.disabled = true;
            statusDiv.textContent = 'Starting tab recording...';
            statusDiv.className = 'status recording';
            
            await chrome.runtime.sendMessage({
                type: 'START_CAPTURE',
                recordingMode: recordingMode
            });
            
            updateUIState(true, false);
            
        } catch (error) {
            console.error('Popup: failed to start capture:', error);
            statusDiv.textContent = 'Error: ' + (error.message || 'Failed to start recording');
            statusDiv.className = 'status idle';
            startBtn.disabled = false;
        }
    });
    
    async function updateUIState(forceRecording = null, previewMode = false) {
        let isRecording = forceRecording;
        
        if (isRecording === null) {
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'GET_RECORDING_STATE'
                });
                isRecording = response?.isRecording || false;
            } catch (error) {
                console.error('Popup: failed to get recording state:', error);
                isRecording = false;
            }
        }
        
        if (previewMode) {
            startBtn.disabled = false;
            statusDiv.textContent = 'Preview open - switch to the preview tab to save your report';
        } else if (isRecording) {
            startBtn.disabled = true;
            statusDiv.innerHTML = '<span class="recording-indicator"></span>Recording current tab...';
        } else {
            startBtn.disabled = false;
            statusDiv.textContent = 'Ready to record current tab';
        }
    }
    
    chrome.runtime.onMessage.addListener(function(message) {
        if (message.type === 'RECORDING_STATE_CHANGED') {
            updateUIState(message.isRecording, message.previewMode);
        }
    });
}); 