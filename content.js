// content.js - Content script for capturing page-level data
(function() {
    'use strict';
    
    console.log('BugReel content script loaded');
    
    let isLogging = false;
    let originalConsole = {};
    
    // Store original console methods
    ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        originalConsole[level] = console[level];
    });
    
    // Safe JSON stringify function to handle circular references
    function safeJsonStringify(obj, maxDepth = 10) {
        const seen = new WeakSet();
        
        function replacer(key, value) {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            
            // Handle DOM elements
            if (value instanceof Element) {
                return `<${value.tagName.toLowerCase()}${value.id ? ' id="' + value.id + '"' : ''}${value.className ? ' class="' + value.className + '"' : ''}/>`;
            }
            
            // Handle other special objects
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
            }
            
            return value;
        }
        
        try {
            return JSON.stringify(obj, replacer, 2);
        } catch (error) {
            return '[Unable to serialize]';
        }
    }
    
    // Override console methods
    function overrideConsole() {
        ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
            console[level] = function(...args) {
                // Send to service worker if logging is active
                if (isLogging) {
                    try {
                        chrome.runtime.sendMessage({
                            type: 'CONSOLE_LOG',
                            payload: {
                                level: level,
                                message: safeJsonStringify(args),
                                timestamp: new Date().toISOString(),
                                url: window.location.href
                            }
                        });
                    } catch (error) {
                        // Silently handle errors to avoid breaking the page
                    }
                }
                
                // Call original console method
                originalConsole[level].apply(console, args);
            };
        });
    }
    
    // Restore original console methods
    function restoreConsole() {
        ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
            console[level] = originalConsole[level];
        });
    }
    
    // Get CSS selector for an element
    function getSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        if (element.className) {
            const classes = element.className.split(' ').filter(c => c.trim());
            if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
        }
        
        return element.tagName.toLowerCase();
    }
    
    // Track user actions
    function trackUserAction(event) {
        if (!isLogging) return;
        
        const target = event.target;
        const actionData = {
            type: event.type,
            selector: getSelector(target),
            timestamp: new Date().toISOString(),
            url: window.location.href,
            elementType: target.tagName.toLowerCase()
        };
        
        // Add specific data based on event type
        switch (event.type) {
            case 'click':
                actionData.text = target.textContent ? target.textContent.trim().substring(0, 50) : '';
                break;
            case 'input':
                actionData.inputType = target.type;
                actionData.value = target.type === 'password' ? '[PASSWORD]' : target.value.substring(0, 50);
                break;
            case 'keydown':
                actionData.key = event.key;
                actionData.ctrlKey = event.ctrlKey;
                actionData.shiftKey = event.shiftKey;
                actionData.altKey = event.altKey;
                break;
        }
        
        try {
            chrome.runtime.sendMessage({
                type: 'USER_ACTION',
                payload: actionData
            });
        } catch (error) {
            // Silently handle errors
        }
    }
    
    // Collect environment data
    function collectEnvironmentData() {
        const envData = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            language: navigator.language,
            languages: navigator.languages,
            platform: navigator.platform,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                availHeight: window.screen.availHeight,
                pixelDepth: window.screen.pixelDepth,
                colorDepth: window.screen.colorDepth
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio
            },
            document: {
                title: document.title,
                readyState: document.readyState,
                referrer: document.referrer
            }
        };
        
        // Add modern User-Agent Client Hints if available
        if (navigator.userAgentData) {
            envData.userAgentData = {
                brands: navigator.userAgentData.brands,
                mobile: navigator.userAgentData.mobile,
                platform: navigator.userAgentData.platform
            };
        }
        
        return envData;
    }
    
    // Track URL changes
    function trackUrlChange() {
        if (!isLogging) return;
        
        const actionData = {
            type: 'navigation',
            url: window.location.href,
            timestamp: new Date().toISOString()
        };
        
        try {
            chrome.runtime.sendMessage({
                type: 'USER_ACTION',
                payload: actionData
            });
        } catch (error) {
            // Silently handle errors
        }
    }
    
    // Start logging
    function startLogging() {
        console.log('BugReel: Starting logging');
        isLogging = true;
        
        // Override console methods
        overrideConsole();
        
        // Collect and send environment data
        const envData = collectEnvironmentData();
        try {
            chrome.runtime.sendMessage({
                type: 'ENVIRONMENT_DATA',
                payload: envData
            });
        } catch (error) {
            console.error('Error sending environment data:', error);
        }
        
        // Add event listeners for user actions
        document.addEventListener('click', trackUserAction, true);
        document.addEventListener('input', trackUserAction, true);
        document.addEventListener('keydown', trackUserAction, true);
        
        // Track URL changes
        window.addEventListener('popstate', trackUrlChange);
        window.addEventListener('hashchange', trackUrlChange);
        
        // Override history methods to track programmatic navigation
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            const result = originalPushState.apply(this, args);
            setTimeout(trackUrlChange, 0);
            return result;
        };
        
        history.replaceState = function(...args) {
            const result = originalReplaceState.apply(this, args);
            setTimeout(trackUrlChange, 0);
            return result;
        };
    }
    
    // Stop logging
    function stopLogging() {
        console.log('BugReel: Stopping logging');
        isLogging = false;
        
        // Restore original console methods
        restoreConsole();
        
        // Remove event listeners
        document.removeEventListener('click', trackUserAction, true);
        document.removeEventListener('input', trackUserAction, true);
        document.removeEventListener('keydown', trackUserAction, true);
        window.removeEventListener('popstate', trackUrlChange);
        window.removeEventListener('hashchange', trackUrlChange);
        
        // Note: We don't restore history methods as they might still be in use
        // This is acceptable as the logging check prevents data collection
    }
    
    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'START_LOGGING':
                startLogging();
                sendResponse({ success: true });
                break;
                
            case 'STOP_LOGGING':
                stopLogging();
                sendResponse({ success: true });
                break;
                
            default:
                console.warn('Unknown message type:', message.type);
        }
        
        return true;
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopLogging();
    });
    
})(); 