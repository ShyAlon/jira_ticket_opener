// background.js
console.log('[Background] Service worker loaded');

/**
 * Listen for toolbar icon clicks.
 * Steps:
 *   1) Focus & activate the target tab
 *   2) Wait until it’s active
 *   3) Capture a screenshot (PNG) from that tab’s window
 *   4) Request console logs from content_script.js (if present)
 *   5) Store { url, screenshot, logs, tabId } in chrome.storage.local
 *   6) Open popup.html in a new tab
 */
chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Icon clicked. Tab info:', tab);

  // 1) Focus the window containing the tab
  chrome.windows.update(tab.windowId, { focused: true }, (window) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Could not focus window:', chrome.runtime.lastError);
      // Continue anyway
    } else {
      console.log('[Background] Window focused:', window.id);
    }

    // 2) Activate the tab itself
    chrome.tabs.update(tab.id, { active: true }, (updatedTab) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Could not activate tab:', chrome.runtime.lastError);
        // Attempt capture anyway
        attemptCapture(tab);
      } else {
        console.log('[Background] Tab activation requested:', updatedTab.id);
        // Poll until tab.active === true
        waitForTabActiveAndCapture(tab);
      }
    });
  });
});

/**
 * Poll until the tab is truly active, then call doCapture().
 */
function waitForTabActiveAndCapture(tab) {
  chrome.tabs.get(tab.id, (current) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Error getting tab status:', chrome.runtime.lastError);
      return;
    }
    if (current.active) {
      console.log('[Background] Tab is now active; capturing screenshot.');
      doCapture(tab);
    } else {
      setTimeout(() => waitForTabActiveAndCapture(tab), 50);
    }
  });
}

/**
 * If activation fails, proceed to capture anyway.
 */
function attemptCapture(tab) {
  console.warn('[Background] Activation failed—attempting to capture anyway.');
  doCapture(tab);
}

/**
 * Capture the visible tab, request logs,
 * store issueData (including tabId), and open popup.html.
 */
function doCapture(tab) {
  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Error capturing tab:', chrome.runtime.lastError);
      return;
    }
    console.log('[Background] Screenshot captured (length:', dataUrl.length, ')');

    // ── NO MORE: chrome.downloads.download(...) ─────────────────────────────────
    // We no longer download to the user's folder. Instead, keep the PNG in memory/storage.

    // 3) Request console logs from content script
    chrome.tabs.sendMessage(tab.id, 'getConsoleLogs', (logs) => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[Background] No content-script listener for getConsoleLogs; defaulting to empty logs.',
          chrome.runtime.lastError
        );
        logs = [];
      }
      console.log('[Background] Console logs received:', logs);

      // 4) Store issueData (url, screenshot, logs, tabId) in local storage
      const issueData = {
        url: tab.url,
        screenshot: dataUrl,
        logs: logs,
        tabId: tab.id
      };
      chrome.storage.local.set({ issueData }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error saving issueData:', chrome.runtime.lastError);
          return;
        }
        console.log('[Background] issueData saved successfully:', issueData);

        // 5) Open popup.html in a new tab
        chrome.tabs.create({
          url: chrome.runtime.getURL('popup.html'),
          active: true
        }, (newTab) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] Error opening popup tab:', chrome.runtime.lastError);
          } else {
            console.log('[Background] Opened popup.html in new tab (id=' + newTab.id + ')');
          }
        });
      });
    });
  });
}

/**
 * Listen for messages from popup.js requesting metadata.
 * Popup should send { type: 'loadMetadata' }.
 * We respond asynchronously with { success: true, data } or { success: false, error }.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'loadMetadata') {
    loadMetadataInBackground()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep the message channel open for sendResponse
  }
});

/**
 * Perform the Jira API call to fetch create-meta for the given project & issue type.
 * This runs in the background service-worker (no CORS issues, since we’ve granted host_permissions).
 */
async function loadMetadataInBackground() {
  // (1) Read email/token/host/projectKey from storage  [oai_citation:0‡background.js](file-service://file-Wac6VDrZ3GRtUE85ojAHJs)
  const { email, token, host, projectKey } =
    await chrome.storage.sync.get(['email', 'token', 'host', 'projectKey']);
  if (!email || !token || !host || !projectKey) {
    throw new Error('Missing Jira credentials or projectKey in storage');
  }

  // (2) Fetch create-meta
  const auth = btoa(`${email}:${token}`);
  const url = `https://${host}/rest/api/2/issue/createmeta`
    + `?projectKeys=${encodeURIComponent(projectKey)}`
    + `&issuetypeNames=Bug&expand=projects.issuetypes.fields`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '<no body>');
    throw new Error(`Jira create-meta error ${resp.status}: ${txt}`);
  }
  return resp.json(); // Send the full JSON back to the popup  [oai_citation:1‡background.js](file-service://file-Wac6VDrZ3GRtUE85ojAHJs)
}