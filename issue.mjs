// issue.mjs

import { debug } from './debug.mjs';
// We no longer import a raw sysFieldKey. Instead, import the async getter:
import { getSysFieldKey } from './metadata.mjs';

/**
 * Creates a Jira issue in three steps:
 *   1) Create the issue (summary, project, issueType, priority, affectedSystem)
 *   2) Update the description field (bullets + logs)
 *   3) Attach the screenshot
 *
 * Finally, prompt the user via confirm(...) to open the ticket in a new tab.
 *
 * @param {string} userSummary        – One‐line summary from popup’s #summary
 * @param {string} fullBodyDesc       – The multi‐line description (bullets + logs) from #description
 * @param {string} affectedSystemId   – The ID of the selected “Affected System” from the popup
 */
export async function createJiraIssue(userSummary, fullBodyDesc, affectedSystemId) {
  // 0) First, retrieve the stored sysFieldKey from metadata storage
  const sysFieldKey = await getSysFieldKey();
  debug('Resolved sysFieldKey =', sysFieldKey);

  debug('Starting three‐step createJiraIssue()…', {
    userSummary,
    affectedSystemId,
    sysFieldKey
  });

  // 1) Load Jira credentials & settings
  const {
    email,
    token,
    host,
    projectKey = 'MYPROJ',
    issueType  = 'Bug'
  } = await chrome.storage.sync.get([
    'email',       // Atlassian user email
    'token',       // Atlassian API token
    'host',        // e.g. "qbiq.atlassian.net"
    'projectKey',  // e.g. "QBIQ"
    'issueType'    // typically "Bug"
  ]);

  if (!email || !token || !host || !projectKey) {
    alert('❌ Missing Jira credentials or projectKey in storage.');
    return;
  }

  const auth = btoa(`${email}:${token}`);
  const baseUrl = `https://${host}/rest/api/2/issue`;

  // 2) Ensure we have a summary
  if (!userSummary) {
    alert('❗ Please enter a one‐line Summary before submitting.');
    return;
  }

  // 3) Read Priority from the popup’s <select id="priority">
  const priorityId = document.getElementById('priority').value || '';

  // 4) Validate that Affected System was passed in
  if (!affectedSystemId) {
    alert('❌ Couldn’t create issue: AFFECTED SYSTEM is empty, please select a system in which the bug occurs');
    return;
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 1: Create the issue with minimal fields (no description yet)
  // ────────────────────────────────────────────────────────────────────────────────
  debug('STEP 1: POST /issue → creating issue without description');
  const createBody = {
    fields: {
      project:   { key: projectKey },
      summary:   userSummary,
      issuetype: { name: issueType },

      // Add priority if selected
      ...(priorityId && { priority: { id: priorityId } }),

      // Add Affected System if we have both a key and ID
      ...(sysFieldKey && affectedSystemId && { [sysFieldKey]: { id: affectedSystemId } })
    }
  };

  console.debug('[Issue] createBody.fields =', createBody.fields);

  let createResp;
  try {
    createResp = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(createBody)
    });
  } catch (err) {
    debug('Network error on step 1 (create)', err);
    alert('Network error while creating the issue. Check debug log.');
    return;
  }

  let createResult;
  try {
    createResult = await createResp.json();
  } catch (e) {
    debug('Failed to parse create response in step 1', e);
    alert(`Error: ${createResp.status} ${createResp.statusText}`);
    return;
  }

  debug('Step 1 create response', createResult);
  if (!createResp.ok || !createResult.key) {
    const errMsg = (createResult.errorMessages || []).join(', ') || JSON.stringify(createResult);
    alert(`❌ Couldn’t create issue: ${errMsg}`);
    debug('STEP 1 failed', createResult);
    return;
  }

  // Extract the new issue key and its browse URL
  const issueKey = createResult.key;
  const issueUrl = `https://${host}/browse/${issueKey}`;
  debug('STEP 1 successful, issueKey:', issueKey);

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update the description field of that new issue
  // ────────────────────────────────────────────────────────────────────────────────
  debug(`STEP 2: PUT /issue/${issueKey} → updating description`);
  const updateBody = {
    fields: {
      description: fullBodyDesc
    }
  };

  let updateResp;
  try {
    updateResp = await fetch(`${baseUrl}/${issueKey}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(updateBody)
    });
  } catch (err) {
    debug('Network error on step 2 (update description)', err);
    alert(`Issue ${issueKey} created, but network error updating description.`);
    // Continue to step 3 anyway
  }

  if (updateResp && !updateResp.ok) {
    const text = await updateResp.text();
    debug('STEP 2 failed', text);
    alert(`Issue ${issueKey} created, but failed to update description: ${text}`);
    // Continue to step 3
  } else {
    debug('STEP 2 successful: description updated for', issueKey);
  }

  // (Optional debug: fetch back the description for verification)
  if (updateResp && updateResp.ok) {
    try {
      const getResp = await fetch(
        `https://${host}/rest/api/2/issue/${issueKey}?fields=description`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept':        'application/json'
        }
      });
      if (!getResp.ok) {
        console.warn('[Issue] Could not GET issue to verify description:', getResp.status, getResp.statusText);
      } else {
        const getJson = await getResp.json();
        console.log('[Issue] Fetched description from Jira:', getJson.fields.description);
      }
    } catch (e) {
      console.error('[Issue] Error fetching issue description for debug:', e);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 3: Upload the screenshot (if present)
  // ────────────────────────────────────────────────────────────────────────────────
  debug('STEP 3: Uploading screenshot for', issueKey);

  const { issueData } = await chrome.storage.local.get(['issueData']);
  if (!issueData || !issueData.screenshot) {
    debug('No screenshot found in storage for issue', issueKey);
    alert(`Issue ${issueKey} created, but no screenshot available to attach.`);
  } else {
    try {
      // Convert the stored data URL into a Blob
      const blob = await (await fetch(issueData.screenshot)).blob();
      const form = new FormData();
      form.append('file', blob, 'screenshot.png');

      const attachResp = await fetch(
        `https://${host}/rest/api/2/issue/${issueKey}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization':     `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check'
        },
        body: form
      });

      if (!attachResp.ok) {
        const text = await attachResp.text();
        debug('STEP 3 attachment failed', text);
        alert(`Issue ${issueKey} created, but failed to attach screenshot: ${text}`);
      } else {
        debug('STEP 3 successful: screenshot attached for', issueKey);
      }
    } catch (err) {
      debug('Error during screenshot attachment in step 3', err);
      alert(`Issue ${issueKey} created, but error attaching screenshot.`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // FINAL: Let the user know everything is done, and offer to open the issue
  // ────────────────────────────────────────────────────────────────────────────────
  const openNow = confirm(
    `✔ Issue ${issueKey} created in backlog!` + '\n\n' +
    `👉 Click “OK” to open: ${issueUrl}`
  );
  if (openNow) {
    window.open(issueUrl, '_blank');
  }
}