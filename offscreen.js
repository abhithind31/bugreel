// offscreen.js - Screen recording in offscreen document
console.log('Offscreen: loaded');

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
    // keep debug logs local only; no page console forwarding
    statusElement.textContent = message;
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log('Offscreen: message', message.type, 'from:', sender);
    
    try {
        switch (message.type) {
            case 'START_RECORDING':
                console.log('Offscreen: start recording', message.options);
                await startRecording(message.options);
                console.log('Offscreen: recording started');
                sendResponse({ success: true });
                break;
                
            case 'STOP_RECORDING':
                console.log('Offscreen: stop recording');
                await stopRecording();
                console.log('Offscreen: recording stopped');
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_AUDIO_RECORDING':
                console.log('Offscreen: toggle audio', message.enabled);
                toggleSystemAudio(message.enabled);
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_MICROPHONE_RECORDING':
                console.log('Offscreen: toggle mic', message.enabled);
                toggleMicrophone(message.enabled);
                sendResponse({ success: true });
                break;
                
            case 'TOGGLE_PAUSE_RECORDING':
                console.log('Offscreen: toggle pause', message.paused);
                togglePause(message.paused);
                sendResponse({ success: true });
                break;
                
            case 'PING_OFFSCREEN':
                console.log('Offscreen: ping');
                sendResponse({ success: true, pong: true });
                break;
                
            default:
                console.warn('Offscreen: unknown message type', message.type);
                sendResponse({ success: false, error: 'Unknown message type' });
        }
    } catch (error) {
        console.error('Offscreen: message handler error', error);
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
        
        console.log('Offscreen: recording options', recordingOptions);
        
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
        
        console.log('Offscreen: display stream obtained');
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
                console.log('Offscreen: microphone stream obtained');
            } catch (micError) {
                console.warn('Offscreen: microphone access failed', micError);
                microphoneStream = null;
            }
        }
        
        // Build audio graph via WebAudio so toggles always work
        const videoTrack = displayStream.getVideoTracks()[0];
        const displayAudioTracks = displayStream.getAudioTracks();
        const microphoneAudioTracks = microphoneStream ? microphoneStream.getAudioTracks() : [];
        console.log('Offscreen: audio tracks - display', displayAudioTracks.length, 'mic', microphoneAudioTracks.length);
        const mixedTracks = await createMixedAudioTracks(displayAudioTracks, microphoneAudioTracks);
        combinedStream = new MediaStream([videoTrack, ...mixedTracks]);
        
        // Create MediaRecorder
        const mimeType = getSupportedMimeType();
        console.log('Offscreen: mime type', mimeType);
        
        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000, // 2.5 Mbps
            audioBitsPerSecond: 128000   // 128 kbps
        });
        
        // Set up event handlers
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
                console.log('Offscreen: recorded chunk', event.data.size, 'bytes');
            }
        };
        
        mediaRecorder.onstop = async () => {
            console.log('Offscreen: processing video');
            await processRecordedVideo();
        };
        
        mediaRecorder.onerror = (event) => {
            console.error('Offscreen: MediaRecorder error', event.error);
            updateStatus('Recording error: ' + event.error);
            
            // Send error details to service worker
            chrome.runtime.sendMessage({
                type: 'VIDEO_ERROR',
                payload: {
                    source: 'MediaRecorder',
                    error: event.error.toString(),
                    timestamp: new Date().toISOString()
                }
            }).catch(err => console.error('Failed to send error to service worker:', err));
        };
        
        // Start recording
        recordedChunks = [];
        mediaRecorder.start(1000); // Collect data every second
        
        updateStatus('Recording in progress...');
        console.log('Offscreen: recording started');
        
        // Handle stream ending (user stops sharing)
        displayStream.getVideoTracks()[0].addEventListener('ended', () => {
            console.log('Offscreen: user stopped screen sharing');
            stopRecording();
        });
        
    } catch (error) {
        console.error('Offscreen: start recording error', error);
        updateStatus('Error: ' + error.message);
        
        // Send error details to service worker with more context
        const errorDetails = {
            source: 'StartRecording',
            error: error.message,
            name: error.name,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            permissionDenied: error.name === 'NotAllowedError' || error.message.includes('Permission denied')
        };
        
        chrome.runtime.sendMessage({
            type: 'VIDEO_ERROR',
            payload: errorDetails
        }).catch(err => console.error('Failed to send error to service worker:', err));
        
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
        console.log('Offscreen: stopping');
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
        
        console.log('Offscreen: streams cleaned up');
        
    } catch (error) {
        console.error('Offscreen: stop recording error', error);
        throw error;
    }
}

async function createCombinedStream(videoTrack, displayAudioTracks, microphoneAudioTracks) {
    try {
        console.log('Offscreen: creating combined audio stream');
        
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
        
        console.log('Offscreen: combined stream ready');
        return combinedStream;
        
    } catch (error) {
        console.error('Offscreen: create combined stream error', error);
        throw error;
    }
}

// Always create a destination and route whatever sources are available through gain nodes
async function createMixedAudioTracks(displayAudioTracks, microphoneAudioTracks) {
    try {
        if (audioContext) {
            try { await audioContext.close(); } catch (e) {}
        }
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        // Display/system audio path
        displayGain = null;
        if (displayAudioTracks && displayAudioTracks.length > 0) {
            const displaySource = audioContext.createMediaStreamSource(new MediaStream(displayAudioTracks));
            displayGain = audioContext.createGain();
            displayGain.gain.value = 0.8;
            displaySource.connect(displayGain);
            displayGain.connect(destination);
        }

        // Microphone path
        microphoneGain = null;
        if (microphoneAudioTracks && microphoneAudioTracks.length > 0) {
            const micSource = audioContext.createMediaStreamSource(new MediaStream(microphoneAudioTracks));
            microphoneGain = audioContext.createGain();
            microphoneGain.gain.value = 1.0;
            micSource.connect(microphoneGain);
            microphoneGain.connect(destination);
        }

        return destination.stream.getAudioTracks();
    } catch (error) {
        console.error('Offscreen: mixed audio tracks error', error);
        return [...(displayAudioTracks || []), ...(microphoneAudioTracks || [])];
    }
}

async function processRecordedVideo() {
    try {
        console.log('Offscreen: processing', recordedChunks.length, 'chunks');
        
        if (recordedChunks.length === 0) {
            console.warn('Offscreen: no recorded chunks');
            return;
        }
        
        // Create blob from recorded chunks
        const mimeType = getSupportedMimeType();
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('Offscreen: video blob created', videoBlob.size, 'bytes');
        
        // Convert blob to base64 for transmission
        const base64Data = await blobToBase64(videoBlob);
        
        console.log('Offscreen: base64 length', base64Data.length);
        
        // Compute accurate duration from the encoded blob (in milliseconds)
        let durationMs = 0;
        try {
            durationMs = await getBlobDurationMs(videoBlob);
            console.log('Offscreen: duration(ms)', durationMs);
        } catch (durErr) {
            console.warn('Offscreen: duration compute failed, fallback', durErr);
            durationMs = recordedChunks && recordedChunks.length ? recordedChunks.length * 1000 : 0;
        }

        // Send video data back to service worker
        const response = await chrome.runtime.sendMessage({
            type: 'VIDEO_RECORDED',
            payload: {
                videoData: base64Data,
                mimeType: mimeType,
                size: videoBlob.size,
                duration: durationMs
            }
        });
        
        console.log('Offscreen: video data sent, response:', response);
        updateStatus('Recording completed and sent to service worker');
        
    } catch (error) {
        console.error('Offscreen: process video error', error);
        updateStatus('Error processing video: ' + error.message);
        
        // Send error details to service worker
        chrome.runtime.sendMessage({
            type: 'VIDEO_ERROR',
            payload: {
                source: 'ProcessVideo',
                error: error.message,
                name: error.name,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                chunksCount: recordedChunks ? recordedChunks.length : 0
            }
        }).catch(err => console.error('Failed to send error to service worker:', err));
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

// Derive accurate duration by loading the blob into a temporary <video>
function getBlobDurationMs(blob) {
    return new Promise((resolve, reject) => {
        try {
            const temp = document.createElement('video');
            temp.preload = 'metadata';
            temp.muted = true;
            temp.src = URL.createObjectURL(blob);
            const cleanup = () => {
                try { URL.revokeObjectURL(temp.src); } catch (_) {}
            };
            temp.onloadedmetadata = () => {
                const seconds = isFinite(temp.duration) ? temp.duration : 0;
                cleanup();
                resolve(Math.max(0, Math.round(seconds * 1000)));
            };
            temp.onerror = () => {
                cleanup();
                reject(new Error('metadata load failed'));
            };
        } catch (e) {
            reject(e);
        }
    });
}

// Toolbar control functions
function toggleSystemAudio(enabled) {
    if (displayGain) {
        displayGain.gain.value = enabled ? 0.8 : 0;
        console.log('Offscreen: system audio', enabled ? 'enabled' : 'disabled');
        updateStatus(enabled ? 'System audio enabled' : 'System audio disabled');
    }
}

function toggleMicrophone(enabled) {
    if (microphoneGain) {
        microphoneGain.gain.value = enabled ? 1.0 : 0;
        console.log('Offscreen: microphone', enabled ? 'enabled' : 'disabled');
        updateStatus(enabled ? 'Microphone enabled' : 'Microphone disabled');
    }
}

function togglePause(paused) {
    isPaused = paused;
    
    if (mediaRecorder) {
        if (paused && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            console.log('Offscreen: paused');
            updateStatus('Recording paused');
        } else if (!paused && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            console.log('Offscreen: resumed');
            updateStatus('Recording resumed');
        }
    }
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    console.log('Offscreen: unloading, cleanup');
    stopRecording();
});

updateStatus('Ready for recording'); 