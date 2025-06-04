// popup.mjs

import { debug } from './debug.mjs';
import { createJiraIssue } from './issue.mjs';

document.addEventListener('DOMContentLoaded', () => {
  initPopup();
});

async function initPopup() {
  debug('[Popup] initPopup()');

  // 1) Load stored issueData (screenshot + logs + original URL + tabId)
  let issueData = null;
  await new Promise((resolve) => {
    chrome.storage.local.get('issueData', ({ issueData: d }) => {
      issueData = d;
      resolve();
    });
  });

  // 2) Display screenshot as before…
  const screenshotEl = document.getElementById('screenshot');
  if (issueData && issueData.screenshot) {
    screenshotEl.src = issueData.screenshot;
    screenshotEl.addEventListener('click', () => {
      window.open(issueData.screenshot, '_blank');
    });
  } else {
    screenshotEl.alt = 'No screenshot available';
  }

  // 3) Reconstruct the original URL for description
  const currentTabUrl = issueData ? issueData.url : '';
  let feVersion = '', beVersion = '';
  if (issueData?.tabId) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: issueData.tabId },
        func: () => {
          const nodes = Array.from(document.querySelectorAll('p.--technology-version'));
          let fe = '', be = '';
          for (const p of nodes) {
            const txt = p.textContent || '';
            if (txt.startsWith('FE:')) fe = txt.replace(/^FE:\s*/, '').trim();
            if (txt.startsWith('BE:')) be = txt.replace(/^BE:\s*/, '').trim();
          }
          return { feVersion: fe, beVersion: be };
        }
      });
      ({ feVersion, beVersion } = res.result || {});
    } catch (e) {
      console.error('[Popup] Error fetching versions:', e);
    }
  }

  let environment = '';
  try {
    environment = new URL(currentTabUrl).hostname;
  } catch (_) {
    environment = currentTabUrl;
  }

  const descEl = document.getElementById('description');
  descEl.value = buildDescription({ feVersion, beVersion, environment, currentTabUrl, issueData });

  // 4) REQUEST create-meta via background
  let metaJson = null;
  try {
    metaJson = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'loadMetadata' }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.success) return reject(resp?.error || 'Unknown error');
        resolve(resp.data);
      });
    });
  } catch (err) {
    console.error('[Popup] loadMetadata failed:', err);
    return;
  }

  // 5) Build all dropdowns inside #meta-fields
  populateAllMetaFields(metaJson);

  // 6) Hook up settings cog and submit button
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('submit').addEventListener('click', onSubmitClick);
}

/**
 * Construct the “bulleted” description + logs.
 */
function buildDescription({ feVersion, beVersion, environment, currentTabUrl, issueData }) {
  const bullets = [
    feVersion    ? `* FE Version: ${feVersion}`     : null,
    beVersion    ? `* BE Version: ${beVersion}`     : null,
    environment  ? `* Environment: ${environment}`  : null,
    currentTabUrl? `* URL: ${currentTabUrl}`        : null
  ].filter(Boolean).join('\n');

  let logsBlock = '';
  if (issueData && Array.isArray(issueData.logs)) {
    const logsText = issueData.logs.map((l) => l.args.join(' ')).join('\n');
    logsBlock = `\n*Console Logs:*\n\`\`\`\n${logsText}\n\`\`\``;
  }

  return bullets + logsBlock;
}

/**
 * Given the raw create-meta JSON, build one <label>+<select> in #meta-fields
 * for each field that has allowedValues. The select’s data‐fieldkey attribute
 * will hold the Jira field key (e.g. 'customfield_12345').
 */
function populateAllMetaFields(json) {
  const container = document.getElementById('meta-fields');
  container.innerHTML = ''; // clear any old fields

  // Find the first project, first issuetype named "Bug"
  const proj = json.projects[0];
  const issuetypeObj = proj.issuetypes.find((it) => it.name === 'Bug');
  const fields = issuetypeObj?.fields || {};

  // For each fieldKey in fields:
  Object.entries(fields).forEach(([fieldKey, fieldObj]) => {
    // We only want picklist‐type fields that have allowedValues (array)
    if (Array.isArray(fieldObj.allowedValues) && fieldObj.allowedValues.length > 0) {
      // Create a wrapper <div class="field"> for styling:
      const wrapper = document.createElement('div');
      wrapper.className = 'field';

      // 1) Create & append a <label> using fieldObj.name
      const lbl = document.createElement('label');
      lbl.textContent = fieldObj.name;
      wrapper.appendChild(lbl);

      // 2) Create the <select> and set data‐fieldkey, id=fieldKey
      const sel = document.createElement('select');
      sel.id = fieldKey;
      sel.dataset.fieldkey = fieldKey;

      // Populate options: each allowedValue → <option value="id">name</option>
      fieldObj.allowedValues.forEach((optObj) => {
        const opt = document.createElement('option');
        opt.value = optObj.id;
        opt.textContent = optObj.name || optObj.value;
        sel.appendChild(opt);
      });

      wrapper.appendChild(sel);
      container.appendChild(wrapper);
    }
  });

  // If no picklist fields found, show a notice:
  if (container.children.length === 0) {
    const noFields = document.createElement('p');
    noFields.textContent = 'No picklist fields found in create‐meta.';
    container.appendChild(noFields);
  }
}

/**
 * Called when the user clicks Submit.
 * We gather:
 *   – summary
 *   – description
 *   – for each <select data-fieldkey>, read select.value
 * Then call createJiraIssue(...) with an object of all chosen fieldKey:value pairs.
 */
async function onSubmitClick() {
  const summaryEl = document.getElementById('summary');
  const descEl    = document.getElementById('description');

  const userSummary = summaryEl.value.trim();
  if (!userSummary) {
    alert('❗ Please enter a one-line Summary before submitting.');
    return;
  }
  const fullDescription = descEl.value.trim();

  // Build an object of “all custom‐fields” chosen by the user
  // We'll look under the container #meta-fields for any <select data-fieldkey>
  const dynamicFields = {};
  document.querySelectorAll('#meta-fields select[data-fieldkey]').forEach((sel) => {
    const key = sel.dataset.fieldkey;
    const val = sel.value;
    if (val) {
      // single‐select picklist → set { [key]: { id: val } }
      dynamicFields[key] = { id: val };
    }
  });

  // Pass the entire dynamicFields object to createJiraIssue:
  try {
    await createJiraIssue(userSummary, fullDescription, dynamicFields);
  } catch (err) {
    console.error('[Popup] createJiraIssue error:', err);
  }
}