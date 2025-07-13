// offscreen.js - Screen recording in offscreen document
console.log('OFFSCREEN: BugReel offscreen document loaded');

let mediaRecorder = null;
let recordedChunks = [];
let displayStream = null;
let microphoneStream = null;
let audioContext = null;
let combinedStream = null;
let displayGain = null;
let microphoneGain = null;
let isPaused = false;

const statusElement = document.getElementById('status');

function updateStatus(message) {
    console.log('OFFSCREEN:', message);
    statusElement.textContent = message;
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log('OFFSCREEN: Received message:', message.type, 'from:', sender);
    
    try {
        switch (message.type) {
            case 'START_RECORDING':
                console.log('OFFSCREEN: Starting recording with options:', message.options);
                await startRecording(message.options);
                console.log('OFFSCREEN: Recording started successfully, sending response');
                sendResponse({ success: true });
                break;
                
            case 'STOP_RECORDING':
                console.log('OFFSCREEN: Stopping recording');
                await stopRecording();
                console.log('OFFSCREEN: Recording stopped successfully, sending response');
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_AUDIO_RECORDING':
                console.log('OFFSCREEN: Toggling audio:', message.enabled);
                toggleSystemAudio(message.enabled);
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_MICROPHONE_RECORDING':
                console.log('OFFSCREEN: Toggling microphone:', message.enabled);
                toggleMicrophone(message.enabled);
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_PAUSE_RECORDING':
                console.log('OFFSCREEN: Toggling pause:', message.paused);
                togglePause(message.paused);
                sendResponse({ success: true });
                break;
                
            default:
                console.warn('OFFSCREEN: Unknown message type:', message.type);
                sendResponse({ success: false, error: 'Unknown message type' });
        }
    } catch (error) {
        console.error('OFFSCREEN: Error handling message:', error);
        sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep the message channel open for async response
});

async function startRecording(options = {}) {
    try {
        updateStatus('Please select "Current Tab" in the permission dialog...');
        
        // Default options
        const recordingOptions = {
            includeSystemAudio: options.includeSystemAudio !== false,
            includeMicrophone: options.includeMicrophone !== false,
            ...options
        };
        
        console.log('OFFSCREEN: Recording options:', recordingOptions);
        
        // Request tab capture with clearer guidance
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                mediaSource: 'tab', // Request tab capture specifically
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: recordingOptions.includeSystemAudio
        });
        
        console.log('OFFSCREEN: Display stream obtained');
        updateStatus('Recording started successfully!');
        
        // Get microphone stream if requested
        if (recordingOptions.includeMicrophone) {
            try {
                microphoneStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                console.log('OFFSCREEN: Microphone stream obtained');
            } catch (micError) {
                console.warn('OFFSCREEN: Could not get microphone access:', micError);
                microphoneStream = null;
            }
        }
        
        // Combine audio streams if we have multiple audio sources
        const videoTrack = displayStream.getVideoTracks()[0];
        const displayAudioTracks = displayStream.getAudioTracks();
        const microphoneAudioTracks = microphoneStream ? microphoneStream.getAudioTracks() : [];
        
        console.log('OFFSCREEN: Audio tracks - Display:', displayAudioTracks.length, 'Microphone:', microphoneAudioTracks.length);
        
        if (displayAudioTracks.length > 0 && microphoneAudioTracks.length > 0) {
            // Need to merge audio streams
            console.log('OFFSCREEN: Merging audio streams...');
            combinedStream = await createCombinedStream(videoTrack, displayAudioTracks, microphoneAudioTracks);
        } else if (displayAudioTracks.length > 0) {
            // Only display audio
            console.log('OFFSCREEN: Using display audio only');
            combinedStream = new MediaStream([videoTrack, ...displayAudioTracks]);
        } else if (microphoneAudioTracks.length > 0) {
            // Only microphone audio
            console.log('OFFSCREEN: Using microphone audio only');
            combinedStream = new MediaStream([videoTrack, ...microphoneAudioTracks]);
        } else {
            // No audio
            console.log('OFFSCREEN: No audio tracks, video only');
            combinedStream = new MediaStream([videoTrack]);
        }
        
        // Create MediaRecorder
        const mimeType = getSupportedMimeType();
        console.log('OFFSCREEN: Using MIME type:', mimeType);
        
        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000, // 2.5 Mbps
            audioBitsPerSecond: 128000   // 128 kbps
        });
        
        // Set up event handlers
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
                console.log('OFFSCREEN: Recorded chunk:', event.data.size, 'bytes');
            }
        };
        
        mediaRecorder.onstop = async () => {
            console.log('OFFSCREEN: Recording stopped, processing video...');
            await processRecordedVideo();
        };
        
        mediaRecorder.onerror = (event) => {
            console.error('OFFSCREEN: MediaRecorder error:', event.error);
            updateStatus('Recording error: ' + event.error);
        };
        
        // Start recording
        recordedChunks = [];
        mediaRecorder.start(1000); // Collect data every second
        
        updateStatus('Recording in progress...');
        console.log('OFFSCREEN: Recording started successfully');
        
        // Handle stream ending (user stops sharing)
        displayStream.getVideoTracks()[0].addEventListener('ended', () => {
            console.log('OFFSCREEN: User stopped screen sharing');
            stopRecording();
        });
        
    } catch (error) {
        console.error('OFFSCREEN: Error starting recording:', error);
        updateStatus('Error: ' + error.message);
        
        // Clean up any partially created streams
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        }
        if (combinedStream) {
            combinedStream.getTracks().forEach(track => track.stop());
            combinedStream = null;
        }
        
        throw error;
    }
}

async function stopRecording() {
    try {
        console.log('OFFSCREEN: Stopping recording...');
        updateStatus('Stopping recording...');
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        
        // Clean up streams
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }
        
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        }
        
        if (combinedStream) {
            combinedStream.getTracks().forEach(track => track.stop());
            combinedStream = null;
        }
        
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        
        console.log('OFFSCREEN: Recording stopped and streams cleaned up');
        
    } catch (error) {
        console.error('OFFSCREEN: Error stopping recording:', error);
        throw error;
    }
}

async function createCombinedStream(videoTrack, displayAudioTracks, microphoneAudioTracks) {
    try {
        console.log('OFFSCREEN: Creating combined audio stream...');
        
        // Create audio context
        audioContext = new AudioContext();
        
        // Create audio sources
        const displayAudioSource = audioContext.createMediaStreamSource(
            new MediaStream(displayAudioTracks)
        );
        const microphoneAudioSource = audioContext.createMediaStreamSource(
            new MediaStream(microphoneAudioTracks)
        );
        
        // Create destination for combined audio
        const destination = audioContext.createMediaStreamDestination();
        
        // Create gain nodes for volume control (store globally for later control)
        displayGain = audioContext.createGain();
        microphoneGain = audioContext.createGain();
        
        // Set initial gain levels
        displayGain.gain.value = 0.8;  // Slightly reduce system audio
        microphoneGain.gain.value = 1.0; // Keep microphone at full volume
        
        // Connect the audio graph
        displayAudioSource.connect(displayGain);
        microphoneAudioSource.connect(microphoneGain);
        displayGain.connect(destination);
        microphoneGain.connect(destination);
        
        // Create combined stream with video and mixed audio
        const combinedStream = new MediaStream([
            videoTrack,
            ...destination.stream.getAudioTracks()
        ]);
        
        console.log('OFFSCREEN: Combined stream created successfully');
        return combinedStream;
        
    } catch (error) {
        console.error('OFFSCREEN: Error creating combined stream:', error);
        throw error;
    }
}

async function processRecordedVideo() {
    try {
        console.log('OFFSCREEN: Processing', recordedChunks.length, 'video chunks');
        
        if (recordedChunks.length === 0) {
            console.warn('OFFSCREEN: No recorded chunks available');
            return;
        }
        
        // Create blob from recorded chunks
        const mimeType = getSupportedMimeType();
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('OFFSCREEN: Video blob created:', videoBlob.size, 'bytes');
        
        // Convert blob to base64 for transmission
        const base64Data = await blobToBase64(videoBlob);
        
        console.log('OFFSCREEN: Video converted to base64, length:', base64Data.length);
        
        // Send video data back to service worker
        const response = await chrome.runtime.sendMessage({
            type: 'VIDEO_RECORDED',
            payload: {
                videoData: base64Data,
                mimeType: mimeType,
                size: videoBlob.size,
                duration: calculateDuration()
            }
        });
        
        console.log('OFFSCREEN: Video data sent to service worker, response:', response);
        updateStatus('Recording completed and sent to service worker');
        
    } catch (error) {
        console.error('OFFSCREEN: Error processing video:', error);
        updateStatus('Error processing video: ' + error.message);
    }
}

function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];
    
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    
    return 'video/webm'; // Fallback
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function calculateDuration() {
    // Simple duration calculation based on chunks
    // In a real implementation, you might want to get this from the MediaRecorder
    return recordedChunks.length; // Approximate seconds
}

// Toolbar control functions
function toggleSystemAudio(enabled) {
    if (displayGain) {
        displayGain.gain.value = enabled ? 0.8 : 0;
        console.log('OFFSCREEN: System audio', enabled ? 'enabled' : 'disabled');
        updateStatus(enabled ? 'System audio enabled' : 'System audio disabled');
    }
}

function toggleMicrophone(enabled) {
    if (microphoneGain) {
        microphoneGain.gain.value = enabled ? 1.0 : 0;
        console.log('OFFSCREEN: Microphone', enabled ? 'enabled' : 'disabled');
        updateStatus(enabled ? 'Microphone enabled' : 'Microphone disabled');
    }
}

function togglePause(paused) {
    isPaused = paused;
    
    if (mediaRecorder) {
        if (paused && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            console.log('OFFSCREEN: Recording paused');
            updateStatus('Recording paused');
        } else if (!paused && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            console.log('OFFSCREEN: Recording resumed');
            updateStatus('Recording resumed');
        }
    }
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    console.log('OFFSCREEN: Page unloading, cleaning up...');
    stopRecording();
});

updateStatus('Ready for recording'); 