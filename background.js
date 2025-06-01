// background.js
console.log('[Background] Service worker loaded');
// Listener for toolbar icon clicks
chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Toolbar icon clicked. Tab info:', tab);

  // Capture a screenshot of the current tab
  chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Error capturing tab:', chrome.runtime.lastError);
      return;
    }
    console.log('[Background] Screenshot captured. Data URL length:', dataUrl.length);

    // Request console logs from the content script
    chrome.tabs.sendMessage(tab.id, 'getConsoleLogs', (logs) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Error retrieving logs:', chrome.runtime.lastError);
        return;
      }
      console.log('[Background] Console logs received:', logs);

      // Store the issue data locally for the popup to consume
      const issueData = {
        url: tab.url,
        screenshot: dataUrl,
        logs: logs
      };
      chrome.storage.local.set({ issueData }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error saving issueData:', chrome.runtime.lastError);
          return;
        }
        console.log('[Background] issueData saved successfully:', issueData);
      });
    });
  });
});