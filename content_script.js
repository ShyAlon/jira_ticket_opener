// content_script.js

// Only collect console logs (no version polling)
(function () {
  window.__extensionLogs__ = [];
  ['log','warn','error','info'].forEach(level => {
    const orig = console[level];
    console[level] = function (...args) {
      window.__extensionLogs__.push({ level, args, timestamp: Date.now() });
      orig.apply(console, args);
    };
  });

  console.log('[ContentScript] Loaded (logging only)');

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg === 'getConsoleLogs') {
      // return the entire window.__extensionLogs__ array
      sendResponse(window.__extensionLogs__);
    }
    // (no more getVersions logic here)
  });
})();