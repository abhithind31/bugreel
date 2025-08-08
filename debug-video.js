// Debug helper for video recording issues
// Run this in the browser console to diagnose problems

async function debugVideoRecording() {
    console.log('🔍 BugReel Video Recording Debug');
    console.log('================================');
    
    try {
        // Check extension permissions
        const permissions = await chrome.permissions.getAll();
        console.log('📋 Extension Permissions:', permissions);
        
        // Check if offscreen document exists
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        console.log('📄 Offscreen Documents:', contexts.length);
        
        // Check session storage
        const storage = await chrome.storage.session.get();
        console.log('💾 Session Storage Keys:', Object.keys(storage));
        
        // Check for video data
        if (storage.videoData) {
            console.log('📹 Video Data Found:', {
                type: typeof storage.videoData,
                hasVideoData: !!storage.videoData.videoData,
                size: storage.videoData.size,
                mimeType: storage.videoData.mimeType
            });
        } else {
            console.log('❌ No video data found');
        }
        
        // Check for video errors
        if (storage.videoError) {
            console.error('🚨 Video Error Found:', storage.videoError);
        } else {
            console.log('✅ No video errors recorded');
        }
        
        // Test media device access
        console.log('🎥 Testing Media Device Access...');
        
        try {
            const testStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            console.log('✅ Screen capture permission: GRANTED');
            testStream.getTracks().forEach(track => track.stop());
        } catch (mediaError) {
            console.error('❌ Screen capture permission: DENIED', mediaError);
        }
        
        // Test MediaRecorder support
        const supportedTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ];
        
        console.log('🎬 MediaRecorder Support:');
        supportedTypes.forEach(type => {
            console.log(`  ${type}: ${MediaRecorder.isTypeSupported(type) ? '✅' : '❌'}`);
        });
        
        console.log('================================');
        console.log('🔧 Debug Complete');
        
    } catch (error) {
        console.error('❌ Debug script error:', error);
    }
}

// Auto-run if in extension context
if (typeof chrome !== 'undefined' && chrome.runtime) {
    debugVideoRecording();
} else {
    console.log('ℹ️  Run debugVideoRecording() manually in extension context');
} 