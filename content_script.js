// Inject at document_start to capture logs
console.log('[ContentScript] I am running on this page:', location.href);

(function () {
    window.__extensionLogs__ = [];
    ["log", "warn", "error", "info"].forEach(level => {
        const orig = console[level];
        console[level] = function (...args) {
            window.__extensionLogs__.push({ level, args, timestamp: Date.now() });
            orig.apply(console, args);
        };
    });

    console.log('[ContentScript] Loaded and log‐wrapper installed');

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        console.log('[ContentScript] Received message:', msg);

        if (msg === 'getConsoleLogs') {
            console.log('[ContentScript] Sending console logs back:', window.__extensionLogs__.length, 'entries');
            sendResponse(window.__extensionLogs__);
            return; // no need to return true
        }

        if (msg === 'getVersions') {
            console.log('[ContentScript] Received "getVersions" request');

            const start = Date.now();
            const timeout = 2000; // 2 seconds max
            const attemptInterval = 200; // poll every 200ms

            function tryFind() {
                const { ready, feVersion, beVersion } = findVersions();
                if (ready) {
                    console.log('[ContentScript] Versions ready:', { feVersion, beVersion });
                    sendResponse({ feVersion, beVersion });
                } else if (Date.now() - start < timeout) {
                    // Not found yet, try again after a short delay
                    setTimeout(tryFind, attemptInterval);
                } else {
                    // Timed out: give up and return empty
                    console.warn('[ContentScript] Timed out waiting for versions; returning empty.');
                    sendResponse({ feVersion: '', beVersion: '' });
                }
            }

            // Start the first attempt
            tryFind();

            // Must return true to indicate we’ll sendResponse asynchronously
            return true;
        }
    });
})();