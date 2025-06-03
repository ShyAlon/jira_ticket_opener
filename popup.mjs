// popup.mjs  [oai_citation:0‡popup.mjs](file-service://file-Pm4dg4gAsMGX1sRTiHEahc)

import { debug } from './debug.mjs';
import { sysFieldKey } from './metadata.mjs';
import { fetchVersionsFromPage } from './versions.mjs';
import { createJiraIssue } from './issue.mjs';

console.log('[Popup] popup.mjs loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOMContentLoaded');
  initPopup();
});

async function initPopup() {
  debug('[Popup] initPopup()');

  // 1) Load stored issueData (for logs, screenshot, and original URL)
  let issueData = null;
  await new Promise((resolve) => {
    chrome.storage.local.get('issueData', ({ issueData: d }) => {
      issueData = d;
      if (!issueData) {
        debug('[Popup] No issueData in storage');
      } else {
        debug('[Popup] issueData loaded', {
          url: issueData.url,
          logsCount: issueData.logs.length
        });
      }
      resolve();
    });
  });

  // 2) Display the captured screenshot thumbnail (max‐height: 256px).
  const screenshotEl = document.getElementById('screenshot');
  if (issueData && issueData.screenshot) {
    screenshotEl.src = issueData.screenshot;
    screenshotEl.addEventListener('click', () => {
      window.open(issueData.screenshot, '_blank');
    });
  } else {
    screenshotEl.alt = 'No screenshot available';
  }

  // 3) Use the ORIGINAL tab’s URL that the background saved
  const currentTabUrl = issueData ? issueData.url : '';
  debug('[Popup] Using stored original URL:', currentTabUrl);

  // 4) Fetch FE/BE versions from the original tab (if not an extension page)
  let feVersion = '', beVersion = '';
  if (currentTabUrl && !currentTabUrl.startsWith('chrome-extension://')) {
    try {
      // execute script in the original tab to scrape FE/BE
      const versions = await fetchVersionsFromPage();
      feVersion = versions.feVersion;
      beVersion = versions.beVersion;
      debug('[Popup] Versions from original page:', versions);
    } catch (err) {
      console.error('[Popup] Error fetching versions:', err);
    }
  } else {
    debug('[Popup] Skipping version fetch: no valid original URL');
  }

  // 5) Compute environment (hostname) from that original URL
  let environment = '';
  try {
    environment = new URL(currentTabUrl).hostname;
  } catch (e) {
    debug('[Popup] Invalid original URL for environment:', e);
    environment = currentTabUrl;
  }

  // 6) Build description (bullets + logs) and populate textarea
  const descEl = document.getElementById('description');
  descEl.value = generateDescription({
    currentTabUrl,
    issueData,
    versions: { feVersion, beVersion },
    environment
  });

  // 7) Load Priority & Affected System dropdowns (via background)
  try {
    const meta = await loadMetadataFromBackground();
    populateDropdowns(meta);
  } catch (err) {
    console.error('[Popup] loadMetadata failed:', err);
  }

  // 8) Hook up the settings cog (⚙️) to open Options page
  const settingsBtn = document.getElementById('settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // 9) Hook up the Submit button
  document.getElementById('submit').addEventListener('click', onSubmitClick);
}

/**
 * Send a message to the background service worker to fetch Jira create-meta.
 */
function loadMetadataFromBackground() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'loadMetadata' }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      if (!response || !response.success) {
        return reject(response?.error || 'Unknown error');
      }
      resolve(response.data);
    });
  });
}

/**
 * Given the create-meta JSON, populate the <select> elements for
 * Priority and Affected System.
 */
function populateDropdowns(meta) {
  const proj = meta.projects[0];
  if (!proj) {
    console.warn('[Popup] No project data in meta');
    return;
  }

  // Find the “Bug” issuetype:
  const issuetype = proj.issuetypes.find((it) => it.name === 'Bug');
  if (!issuetype) {
    console.warn('[Popup] Bug issuetype not found');
    return;
  }

  // The fields object contains priority and our custom sysFieldKey
  const fields = issuetype.fields || {};

  // 1) Priority dropdown
  const priorityEl = document.getElementById('priority');
  priorityEl.innerHTML = ''; // clear existing
  const priorityField = fields.priority;
  if (priorityField && Array.isArray(priorityField.allowedValues)) {
    priorityField.allowedValues.forEach((p) => {
      const opt = document.createElement('option');
      opt.textContent = p.name;
      opt.value = p.id;
      priorityEl.appendChild(opt);
    });
    // Default “Medium”
    for (let i = 0; i < priorityEl.options.length; i++) {
      if (priorityEl.options[i].text === 'Medium') {
        priorityEl.selectedIndex = i;
        break;
      }
    }
  } else {
    // fallback
    const opt = document.createElement('option');
    opt.textContent = 'Default';
    opt.value = '';
    priorityEl.appendChild(opt);
  }

  // 2) Affected System dropdown (custom field)
  const systemEl = document.getElementById('affectedSystem');
  systemEl.innerHTML = ''; // clear existing
  const sysField = fields[sysFieldKey];
  if (sysField && Array.isArray(sysField.allowedValues)) {
    sysField.allowedValues.forEach((s) => {
      const opt = document.createElement('option');
      opt.textContent = s.name || s.value;
      opt.value = s.id;
      systemEl.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option');
    opt.textContent = 'None';
    opt.value = '';
    systemEl.appendChild(opt);
  }

  debug('[Popup] Dropdowns populated: priority & affectedSystem');
}

/**
 * Builds the “bullets + logs” part of the description:
 * * FE Version: ...
 * * BE Version: ...
 * * Environment: ...
 * * URL: ...
 *
 * *Console Logs:*
 * ``` … ```
 */
function generateDescription({ currentTabUrl, issueData, versions, environment }) {
  const { feVersion, beVersion } = versions || {};

  const bullets = [
    feVersion ? `* FE Version: ${feVersion}` : null,
    beVersion ? `* BE Version: ${beVersion}` : null,
    environment ? `* Environment: ${environment}` : null,
    currentTabUrl ? `* URL: ${currentTabUrl}` : null
  ]
    .filter(Boolean)
    .join('\n');

  let logsBlock = '';
  if (issueData && Array.isArray(issueData.logs)) {
    const logsText = issueData.logs.map((l) => l.args.join(' ')).join('\n');
    logsBlock = `\n*Console Logs:*\n\`\`\`\n${logsText}\n\`\`\``;
  }

  return `${bullets}${logsBlock}`;
}

/**
 * When “Submit” is clicked:
 *  - Read the summary and description fields
 *  - Call createJiraIssue(summary, description)
 */
async function onSubmitClick() {
  debug('[Popup] Submit clicked');

  const summaryEl = document.getElementById('summary');
  const descEl = document.getElementById('description');

  const userSummary = summaryEl.value.trim();
  if (!userSummary) {
    alert('❗ Please enter a one-line Summary before submitting.');
    return;
  }

  const fullDescription = descEl.value.trim();

  try {
    await createJiraIssue(userSummary, fullDescription);
  } catch (err) {
    console.error('[Popup] Error in createJiraIssue:', err);
  }
}