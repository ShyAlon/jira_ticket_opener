// popup.mjs

import { debug } from './debug.mjs';
import { loadMetadata } from './metadata.mjs';
import { fetchVersionsFromPage } from './versions.mjs';
import { createJiraIssue } from './issue.mjs';

console.log('[Popup] popup.mjs loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOMContentLoaded');
  initPopup();
});

async function initPopup() {
  debug('[Popup] initPopup()');

  // 1) Load the stored issueData (for screenshot & logs)
  let issueData = null;
  await new Promise(resolve => {
    chrome.storage.local.get('issueData', ({ issueData: d }) => {
      issueData = d;
      if (!issueData) {
        debug('[Popup] No issueData in storage');
      } else {
        debug('[Popup] Retrieved issueData from storage', {
          url: issueData.url,
          logCount: issueData.logs.length
        });
      }
      resolve();
    });
  });

  // 2) Query the active tab to get its current URL
  const { currentTabUrl } = await new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0] || {};
      const url = tab.url || '';
      debug('[Popup] Active tab URL:', url);
      resolve({ currentTabUrl: url });
    });
  });

  // 3) Fetch FE/BE versions directly via executeScript
  let feVersion = '', beVersion = '';
  try {
    const versions = await fetchVersionsFromPage();
    feVersion = versions.feVersion;
    beVersion = versions.beVersion;
    debug('[Popup] Versions from page:', versions);
  } catch (err) {
    console.error('[Popup] Error fetching versions:', err);
  }

  // 4) Compute environment (hostname) from the currentTabUrl
  let environment = '';
  try {
    environment = new URL(currentTabUrl).hostname;
  } catch (e) {
    debug('[Popup] Failed to parse environment from URL', e);
    environment = currentTabUrl;
  }

  // 5) Build the full description text with <Summary> placeholder
  const fullDesc = generateTemplate({
    currentTabUrl,
    issueData,
    versions: { feVersion, beVersion },
    environment
  });

  // 6) Populate the description field (textarea or contenteditable)
  const descEl = document.getElementById('description');
  if (descEl.tagName.toLowerCase() === 'textarea') {
    descEl.value = fullDesc;
  } else {
    descEl.innerText = fullDesc;
  }

  // 7) Now load priorities & affected system
  await loadMetadata();

  // 8) Wire up buttons
  document.getElementById('submit').addEventListener('click', createJiraIssue);
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

/**
 * Generates the Jira‐formatted description string. Expects:
 * - currentTabUrl: the URL of the active tab
 * - issueData: { url, screenshot, logs }
 * - versions: { feVersion, beVersion }
 * - environment: hostname (or fallback URL)
 */
function generateTemplate({ currentTabUrl, issueData, versions, environment }) {
  const { feVersion, beVersion } = versions || {};

  // 1) Placeholder for user’s summary
  const summaryPlaceholder = '<Summary goes here>';

  // 2) Build bullets for FE/BE/Environment/URL
  //    Only include a bullet if its string is non-empty
  const bullets = [
    feVersion ? `* FE Version: ${feVersion}` : null,
    beVersion ? `* BE Version: ${beVersion}` : null,
    environment ? `* Environment: ${environment}` : null,
    currentTabUrl ? `* URL: ${currentTabUrl}` : null
  ].filter(Boolean).join('\n');

  // 3) Build the console‐logs block (if issueData/logs exist)
  let logsBlock = '';
  if (issueData && Array.isArray(issueData.logs)) {
    const logsText = issueData.logs
      .map(l => l.args.join(' '))
      .join('\n');
    logsBlock = `\n*Console Logs:*\n\`\`\`\n${logsText}\n\`\`\``;
  }

  // 4) Concatenate everything:
  //    <Summary>
  //    
  //    * FE Version: x.x.x
  //    * BE Version: y.y.y
  //    * Environment: host.name
  //    * URL: https://…
  //
  //    *Console Logs:*
  //    {code}
  //    ...logs...
  //    {code}
  return (
    `${summaryPlaceholder}\n\n` +
    `${bullets}${logsBlock}`
  );
}

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});