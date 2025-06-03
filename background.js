// background.js

console.log('[Background] Service worker loaded');

/**
 * Listen for toolbar icon clicks.
 * Steps:
 *   1) Focus & activate the target tab
 *   2) Wait until it’s active
 *   3) Capture a screenshot (PNG) from that tab’s window
 *   4) Download the PNG for debugging
 *   5) Request console logs from content_script.js (if present)
 *   6) Store { url, screenshot, logs, tabId } in chrome.storage.local
 *   7) Open popup.html in a new tab
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
 * Capture the visible tab, download for debugging, request logs,
 * store issueData (including tabId), and open popup.html.
 */
function doCapture(tab) {
  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Error capturing tab:', chrome.runtime.lastError);
      return;
    }
    console.log('[Background] Screenshot captured (length:', dataUrl.length, ')');

    // ── DEBUG: Download the captured image ───────────────────────────────────────
    console.log('[Background] About to download screenshot for debugging…');
    chrome.downloads.download({
      url: dataUrl,
      filename: 'jira-debug-screenshot.png',
      conflictAction: 'overwrite'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Download failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[Background] Download initiated, id=', downloadId);
        chrome.downloads.onChanged.addListener((delta) => {
          if (delta.id === downloadId) {
            if (delta.state && delta.state.current === 'complete') {
              console.log('[Background] Download completed successfully.');
            } else if (delta.error) {
              console.error('[Background] Download error:', delta.error.current);
            }
          }
        });
      }
    });
    console.log('[Background] Called chrome.downloads.download()');
    // ── END DEBUG DOWNLOAD ────────────────────────────────────────────────────

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
        url:        tab.url,
        screenshot: dataUrl,
        logs:       logs,
        tabId:      tab.id
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
  if (msg && msg.type === 'loadMetadata') {
    console.log('[Background] Received loadMetadata request');
    loadMetadataInBackground()
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        console.error('[Background] loadMetadataInBackground error:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true; // Keep channel open for sendResponse
  }
});

/**
 * Perform the Jira API call to fetch create-meta for the given project & issue type.
 * This runs in the background service-worker (no CORS issues, since we’ve granted host_permissions).
 */
async function loadMetadataInBackground() {
  // 1) Load Jira credentials and settings from sync storage
  //    These keys match what options.js actually saves: email, token, host, projectKey
  const {
    email: jiraEmail,
    token: jiraApiToken,
    host:  jiraHost,
    projectKey
  } = await chrome.storage.sync.get([
    'email',
    'token',
    'host',
    'projectKey'
  ]);

  if (!jiraEmail || !jiraApiToken || !jiraHost || !projectKey) {
    throw new Error('Missing Jira credentials or projectKey in storage');
  }

  const auth = btoa(`${jiraEmail}:${jiraApiToken}`);
  const url = `https://${jiraHost}/rest/api/2/issue/createmeta`
    + `?projectKeys=${encodeURIComponent(projectKey)}`
    + `&issuetypeNames=Bug&expand=projects.issuetypes.fields`;

  console.log('[Background] fetch create-meta from Jira:', url);

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept':        'application/json'
    }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`Jira create-meta request failed: ${resp.status} ${resp.statusText} — ${text}`);
  }

  const json = await resp.json();
  console.log('[Background] create-meta response received');
  return json;
}