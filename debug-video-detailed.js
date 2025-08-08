// Enhanced Video Recording Diagnostic Tool
// This script provides detailed diagnostics for video recording issues

console.log('🔍 BugReel Video Recording Diagnostic Tool - Enhanced Version');
console.log('=' .repeat(60));

async function runEnhancedDiagnostics() {
    const results = {
        timestamp: new Date().toISOString(),
        tests: [],
        errors: [],
        recommendations: []
    };

    // Helper function to add test result
    function addTest(name, status, details = '', error = null) {
        results.tests.push({ name, status, details, error: error?.message || error });
        console.log(`${status === 'PASS' ? '✅' : '❌'} ${name}: ${details}`);
        if (error) {
            console.error(`   Error: ${error}`);
            results.errors.push({ test: name, error: error.message || error });
        }
    }

    // Test 1: Check if extension is active
    try {
        const extensionId = chrome.runtime.id;
        addTest('Extension Active', 'PASS', `Extension ID: ${extensionId}`);
    } catch (error) {
        addTest('Extension Active', 'FAIL', 'Extension not accessible', error);
        return results;
    }

    // Test 2: Check service worker status
    try {
        const response = await chrome.runtime.sendMessage({ type: 'PING' });
        addTest('Service Worker Communication', 'PASS', 'Service worker responding');
    } catch (error) {
        addTest('Service Worker Communication', 'FAIL', 'Service worker not responding', error);
        results.recommendations.push('Reload the extension or restart Chrome');
    }

    // Test 3: Check offscreen document creation
    try {
        // Try to create offscreen document
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DISPLAY_MEDIA', 'USER_MEDIA'],
            justification: 'Recording screen and microphone for bug reporting'
        });
        addTest('Offscreen Document Creation', 'PASS', 'Offscreen document created successfully');
    } catch (error) {
        if (error.message.includes('Only a single offscreen document')) {
            addTest('Offscreen Document Creation', 'PASS', 'Offscreen document already exists');
        } else {
            addTest('Offscreen Document Creation', 'FAIL', 'Failed to create offscreen document', error);
            results.recommendations.push('Check if Chrome supports offscreen documents');
        }
    }

    // Test 4: Check offscreen document communication
    try {
        const response = await chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' });
        addTest('Offscreen Document Communication', 'PASS', 'Offscreen document responding');
    } catch (error) {
        addTest('Offscreen Document Communication', 'FAIL', 'Offscreen document not responding', error);
        results.recommendations.push('Try reloading the extension');
    }

    // Test 5: Check media device permissions
    try {
        const permissions = await navigator.permissions.query({ name: 'camera' });
        addTest('Media Permissions', 'PASS', `Permission state: ${permissions.state}`);
    } catch (error) {
        addTest('Media Permissions', 'FAIL', 'Could not check media permissions', error);
    }

    // Test 6: Check display media support
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            addTest('Display Media Support', 'PASS', 'getDisplayMedia API available');
        } else {
            addTest('Display Media Support', 'FAIL', 'getDisplayMedia API not available');
            results.recommendations.push('Update Chrome to latest version');
        }
    } catch (error) {
        addTest('Display Media Support', 'FAIL', 'Error checking display media support', error);
    }

    // Test 7: Check current recording state
    try {
        const recordingState = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' });
        addTest('Recording State', 'PASS', `Currently recording: ${recordingState?.isRecording || false}`);
    } catch (error) {
        addTest('Recording State', 'FAIL', 'Could not get recording state', error);
    }

    // Test 8: Test actual video recording start
    console.log('\n🎬 Testing Video Recording Start...');
    try {
        // Create a promise that will resolve when we get a response
        const testResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video recording test timed out after 15 seconds'));
            }, 15000);

            // Send test message to service worker
            chrome.runtime.sendMessage({ type: 'TEST_VIDEO_RECORDING' }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        if (testResponse && testResponse.success) {
            addTest('Video Recording Start Test', 'PASS', 'Video recording started successfully');
        } else {
            addTest('Video Recording Start Test', 'FAIL', 
                `Video recording failed: ${testResponse?.error || 'Unknown error'}`, 
                testResponse?.error);
            
            // Add specific recommendations based on error
            if (testResponse?.error?.includes('Permission denied') || 
                testResponse?.error?.includes('NotAllowedError')) {
                results.recommendations.push('Make sure to click "Allow" and select "Current Tab" in permission dialog');
            }
        }
    } catch (error) {
        addTest('Video Recording Start Test', 'FAIL', 'Video recording test failed', error);
        if (error.message.includes('timeout')) {
            results.recommendations.push('Offscreen document may not be responding - try reloading extension');
        }
    }

    // Test 9: Check storage space
    try {
        const storage = await chrome.storage.local.getBytesInUse();
        addTest('Storage Space', 'PASS', `Storage used: ${storage} bytes`);
    } catch (error) {
        addTest('Storage Space', 'FAIL', 'Could not check storage space', error);
    }

    // Test 10: Check for video errors in storage
    try {
        const videoErrors = await chrome.storage.session.get('videoErrors');
        if (videoErrors.videoErrors && videoErrors.videoErrors.length > 0) {
            const latestError = videoErrors.videoErrors[videoErrors.videoErrors.length - 1];
            addTest('Recent Video Errors', 'FAIL', 
                `Latest error: ${latestError.error} at ${latestError.timestamp}`,
                latestError.error);
        } else {
            addTest('Recent Video Errors', 'PASS', 'No recent video errors found');
        }
    } catch (error) {
        addTest('Recent Video Errors', 'FAIL', 'Could not check for video errors', error);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('='.repeat(60));
    
    const passedTests = results.tests.filter(t => t.status === 'PASS').length;
    const failedTests = results.tests.filter(t => t.status === 'FAIL').length;
    
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    
    if (results.errors.length > 0) {
        console.log('\n🚨 ERRORS FOUND:');
        results.errors.forEach((error, i) => {
            console.log(`${i + 1}. ${error.test}: ${error.error}`);
        });
    }
    
    if (results.recommendations.length > 0) {
        console.log('\n💡 RECOMMENDATIONS:');
        results.recommendations.forEach((rec, i) => {
            console.log(`${i + 1}. ${rec}`);
        });
    }

    return results;
}

// Add a message handler for the test
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TEST_VIDEO_RECORDING') {
        console.log('🧪 Test video recording request received');
        // This will be handled by the background script
        return false;
    }
});

// Run diagnostics
runEnhancedDiagnostics().then(results => {
    console.log('\n✅ Enhanced diagnostics complete');
    console.log('📋 Full results stored in results object');
    window.diagnosticResults = results;
}).catch(error => {
    console.error('❌ Diagnostic failed:', error);
}); 