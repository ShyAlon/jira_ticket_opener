// popup.mjs

import { debug } from './debug.mjs';
import { createJiraIssue } from './issue.mjs';

console.log('[Popup] popup.mjs loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOMContentLoaded');
  initPopup();
});

async function initPopup() {
  debug('[Popup] initPopup()');

  // 1) Load stored issueData (for logs, screenshot, original URL, and tabId)
  let issueData = null;
  await new Promise((resolve) => {
    chrome.storage.local.get('issueData', ({ issueData: d }) => {
      issueData = d;
      if (!issueData) {
        debug('[Popup] No issueData in storage');
      } else {
        debug('[Popup] issueData loaded', {
          url:       issueData.url,
          logsCount: issueData.logs.length,
          tabId:     issueData.tabId
        });
      }
      resolve();
    });
  });

  // 2) Display the captured screenshot thumbnail (max-height: 256px).
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

  // 4) Fetch FE/BE versions from the original tab via scripting (if possible)
  let feVersion = '', beVersion = '';
  if (issueData && typeof issueData.tabId === 'number') {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: issueData.tabId },
        func: () => {
          const nodes = Array.from(document.querySelectorAll('p.--technology-version'));
          let fe = '', be = '';
          for (const p of nodes) {
            const text = p.textContent || '';
            if (text.startsWith('FE:')) fe = text.replace(/^FE:\s*/, '').trim();
            if (text.startsWith('BE:')) be = text.replace(/^BE:\s*/, '').trim();
          }
          return { feVersion: fe, beVersion: be };
        }
      });
      const versions = result.result || {};
      feVersion = versions.feVersion;
      beVersion = versions.beVersion;
      debug('[Popup] Versions from original page:', versions);
    } catch (err) {
      console.error('[Popup] Error fetching versions via scripting:', err);
    }
  } else {
    debug('[Popup] Skipping version fetch: no valid tabId');
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
    versions:   { feVersion, beVersion },
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

  // The fields object contains priority and possibly “Affected System”
  const fields = issuetype.fields || {};

  // 1) Populate Priority dropdown
  const priorityEl = document.getElementById('priority');
  priorityEl.innerHTML = ''; // clear existing
  const priorityField = fields.priority;
  if (priorityField && Array.isArray(priorityField.allowedValues)) {
    priorityField.allowedValues.forEach((p) => {
      const opt = document.createElement('option');
      opt.textContent = p.name;
      opt.value       = p.id;
      priorityEl.appendChild(opt);
    });
    // Default to “Medium” if present
    const mediumOption = Array.from(priorityEl.options).find((o) => o.text.toLowerCase() === 'medium');
    if (mediumOption) {
      priorityEl.value = mediumOption.value;
    }
  } else {
    // fallback
    const opt = document.createElement('option');
    opt.textContent = 'Default';
    opt.value       = '';
    priorityEl.appendChild(opt);
  }

  // 2) Populate Affected System dropdown by looking for a field
  //    whose name matches “Affected System” (case-insensitive)
  const systemEl = document.getElementById('affectedSystem');
  systemEl.innerHTML = ''; // clear existing

  const affectedKey = Object.keys(fields).find((fieldKey) => {
    const fld = fields[fieldKey];
    return (
      fld &&
      typeof fld.name === 'string' &&
      fld.name.trim().toLowerCase() === 'affected system'
    );
  });

  if (affectedKey) {
    const sysAllowed = fields[affectedKey]?.allowedValues || [];
    if (sysAllowed.length) {
      sysAllowed.forEach((s) => {
        const label = s.name || s.value || '';
        const opt = new Option(label, s.id);
        systemEl.add(opt);
      });
    }
  }

  // If no real Affected System values, add a single “None” option
  if (!systemEl.options.length) {
    systemEl.add(new Option('None', ''));
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
    feVersion    ? `* FE Version: ${feVersion}`     : null,
    beVersion    ? `* BE Version: ${beVersion}`     : null,
    environment  ? `* Environment: ${environment}`  : null,
    currentTabUrl? `* URL: ${currentTabUrl}`        : null
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
 *  - Read the summary, description, and affectedSystem fields
 *  - Call createJiraIssue(summary, description, affectedSystemId)
 */
async function onSubmitClick() {
  debug('[Popup] Submit clicked');

  const summaryEl       = document.getElementById('summary');
  const descEl          = document.getElementById('description');
  const affectedSelect  = document.getElementById('affectedSystem');

  const userSummary      = summaryEl.value.trim();
  const fullDescription  = descEl.value.trim();
  const affectedSystemId = affectedSelect.value;

  if (!userSummary) {
    alert('❗ Please enter a one-line Summary before submitting.');
    return;
  }

  try {
    await createJiraIssue(userSummary, fullDescription, affectedSystemId);
  } catch (err) {
    console.error('[Popup] Error in createJiraIssue:', err);
  }
}