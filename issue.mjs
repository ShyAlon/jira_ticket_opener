// issue.mjs

import { debug } from './debug.mjs';
import { sysFieldKey } from './metadata.mjs';

/**
 * Helper to ask the content script for FE/BE versions.
 * Returns an object: { feVersion, beVersion }.
 */
function fetchVersionsFromPage() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        debug('[Issue] No active tab for versions');
        return resolve({ feVersion: '', beVersion: '' });
      }
      chrome.tabs.sendMessage(tab.id, 'getVersions', (resp) => {
        if (chrome.runtime.lastError || !resp) {
          debug('[Issue] Error fetching versions:', chrome.runtime.lastError);
          return resolve({ feVersion: '', beVersion: '' });
        }
        resolve({
          feVersion: resp.feVersion || '',
          beVersion: resp.beVersion || ''
        });
      });
    });
  });
}

export async function createJiraIssue() {
  debug('Creating issue…');

  // 1) Load Jira credentials & settings
  const {
    jiraEmail,
    jiraApiToken,
    jiraHost,
    projectKey = 'MYPROJ',
    issueType = 'Bug'
  } = await chrome.storage.sync.get([
    'jiraEmail','jiraApiToken','jiraHost','projectKey','issueType'
  ]);
  const auth = btoa(`${jiraEmail}:${jiraApiToken}`);

  // 2) Load the captured context
  const { issueData } = await chrome.storage.local.get(['issueData']);
  if (!issueData) {
    debug('No issueData found', issueData);
    alert('⚠️ No issue context found. Capture from a page first.');
    return;
  }

  // 3) Pull user‐entered “summary” from the textarea
  const userSummary = document.getElementById('description').value.trim();
  if (!userSummary) {
    alert('❗ Please enter a Summary at the top before submitting.');
    return;
  }

  // 4) Pull selected priority and affected system
  const priorityId    = document.getElementById('priority').value;
  const systemFieldId = document.getElementById('affectedSystem').value;

  // 5) Fetch FE/BE versions from the page
  const { feVersion, beVersion } = await fetchVersionsFromPage();
  debug('Fetched versions', { feVersion, beVersion });

  // 6) Compute environment (hostname) from full URL
  let environment = '';
  try {
    environment = new URL(issueData.url).hostname;
  } catch (e) {
    debug('Failed to parse URL for environment', e);
    environment = issueData.url; // fallback to entire URL
  }

  // 7) Build the Jira‐style description
  const bulleted = [
    feVersion    ? `* FE Version: ${feVersion}`     : null,
    beVersion    ? `* BE Version: ${beVersion}`     : null,
    environment  ? `* Environment: ${environment}`  : null,
    issueData.url? `* URL: ${issueData.url}`        : null
  ]
  .filter(Boolean) // remove any null entries
  .join('\n');

  const logsText = issueData.logs
    .map(l => l.args.join(' '))
    .join('\n');

  const fullDescription =
    `${userSummary}\n\n` +            //  ➤ User fills this (“<Summary>”) in popup
    `${bulleted}\n\n` +              //  ➤ Automatically generated bullets
    `*Console Logs:*\n\`\`\`\n` +     //  ➤ Jira code block for logs
    `${logsText}\n\`\`\``;

  // 8) Build the create‐issue body (no screenshot yet)
  const createBody = {
    fields: {
      project:    { key: projectKey },
      summary:    userSummary,             // use the same userSummary as Jira’s “summary” field
      description: fullDescription,
      issuetype:  { name: issueType },
      ...(priorityId    && { priority:      { id: priorityId } }),
      ...(systemFieldId && sysFieldKey && { [sysFieldKey]: { id: systemFieldId } })
    }
  };
  debug('POST /issue', createBody);

  // 9) Send the “create issue” request
  let createResp, createResult;
  try {
    createResp = await fetch(`https://${jiraHost}/rest/api/2/issue`, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json'
      },
      body:    JSON.stringify(createBody)
    });
  } catch (err) {
    debug('Network error on create', err);
    alert('Network error creating issue. See debug log.');
    return;
  }

  try {
    createResult = await createResp.json();
  } catch (e) {
    debug('Failed to parse create response', e);
    alert(`Error: ${createResp.status} ${createResp.statusText}`);
    return;
  }

  debug('Create response', createResult);

  if (!createResp.ok || !createResult.key) {
    const errMsg = createResult.errorMessages || JSON.stringify(createResult);
    alert(`❌ Couldn’t create issue: ${errMsg}`);
    debug('Issue creation failed', createResult);
    return;
  }

  const issueKey = createResult.key;
  const issueUrl = `https://${jiraHost}/browse/${issueKey}`;
  debug('Issue created', { issueKey, issueUrl });

  // 10) Attach the screenshot (same as before)
  try {
    const blob = await (await fetch(issueData.screenshot)).blob();
    const form = new FormData();
    form.append('file', blob, 'screenshot.png');

    const attachResp = await fetch(
      `https://${jiraHost}/rest/api/2/issue/${issueKey}/attachments`,
      {
        method:  'POST',
        headers: {
          'Authorization':     `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check'
        },
        body: form
      }
    );

    if (!attachResp.ok) {
      const text = await attachResp.text();
      debug('Attachment failed', text);
      alert(`⚠️ Issue ${issueKey} created, but attachment failed.`);
    } else {
      debug('Screenshot attached');
      alert(`✔ Issue ${issueKey} created!\nAttached screenshot.\n${issueUrl}`);
    }
  } catch (err) {
    debug('Error during attachment', err);
    alert(`✔ Issue ${issueKey} created!\n—but error attaching screenshot.\n${issueUrl}`);
  }
}