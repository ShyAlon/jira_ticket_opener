// issue.mjs

import { debug } from './debug.mjs';
import { sysFieldKey } from './metadata.mjs';

/**
 * Creates a Jira issue in three steps:
 *   1) Create the issue (summary, project, issueType, priority, affectedSystem)
 *   2) Update the description field (bullets + logs)
 *   3) Attach the screenshot
 * 
 * Finally, prompt the user via confirm(...) to open the ticket in a new tab.
 *
 * @param {string} userSummary   – one‐line summary from popup’s #summary
 * @param {string} fullBodyDesc  – the multi‐line description (bullets + logs) from #description
 */
export async function createJiraIssue(userSummary, fullBodyDesc) {
  debug('Starting three‐step createJiraIssue()…');

  // 1) Load Jira credentials & settings
  const {
    jiraEmail,
    jiraApiToken,
    jiraHost,
    projectKey = 'MYPROJ',
    issueType = 'Bug'
  } = await chrome.storage.sync.get([
    'jiraEmail', 'jiraApiToken', 'jiraHost', 'projectKey', 'issueType'
  ]);
  const auth = btoa(`${jiraEmail}:${jiraApiToken}`);

  // 2) Ensure we have a summary
  if (!userSummary) {
    alert('❗ Please enter a one‐line Summary before submitting.');
    return;
  }

  // 3) Read Priority and Affected System from the popup
  const priorityId = document.getElementById('priority').value;
  const systemFieldId = document.getElementById('affectedSystem').value;

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 1: Create the issue with minimal fields (no description yet)
  // ────────────────────────────────────────────────────────────────────────────────
  debug('STEP 1: POST /issue → creating issue without description');
  const createBody = {
    fields: {
      project: { key: projectKey },
      summary: userSummary,
      issuetype: { name: issueType },
      ...(priorityId && { priority: { id: priorityId } }),
      ...(systemFieldId && sysFieldKey && { [sysFieldKey]: { id: systemFieldId } })
    }
  };

  let createResp;
  try {
    createResp = await fetch(`https://${jiraHost}/rest/api/2/issue`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
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
    const errMsg = createResult.errorMessages || JSON.stringify(createResult);
    alert(`❌ Couldn’t create issue: ${errMsg}`);
    debug('STEP 1 failed', createResult);
    return;
  }

  // Extract the new issue key
  const issueKey = createResult.key;
  const issueUrl = `https://${jiraHost}/browse/${issueKey}`;
  debug('STEP 1 successful, issueKey:', issueKey);

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update the description field of that new issue
  // ────────────────────────────────────────────────────────────────────────────────
  debug('STEP 2: PUT /issue/' + issueKey + ' → updating description');
  const updateBody = {
    fields: {
      description: fullBodyDesc
    }
  };

  let updateResp;
  try {
    updateResp = await fetch(
      `https://${jiraHost}/rest/api/2/issue/${issueKey}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateBody)
    }
    );
  } catch (err) {
    debug('Network error on step 2 (update description)', err);
    alert(`Issue ${issueKey} created, but network error updating description.`);
    // We can still proceed to step 3 (attach icon/screenshot)
  }

  if (updateResp && !updateResp.ok) {
    const text = await updateResp.text();
    debug('STEP 2 failed', text);
    alert(`Issue ${issueKey} created, but failed to update description: ${text}`);
    // Still continue to step 3
  } else {
    debug('STEP 2 successful: description updated for', issueKey);
  }

  // issue.mjs, RIGHT AFTER updating description (Step 2)

  if (updateResp && updateResp.ok) {
    // Fetch the issue back from Jira, asking only for the description field
    try {
      const getResp = await fetch(
        `https://${jiraHost}/rest/api/2/issue/${issueKey}?fields=description`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      }
      );

      if (!getResp.ok) {
        console.warn('[Issue] Could not GET issue to verify description:', getResp.status, getResp.statusText);
      } else {
        const getJson = await getResp.json();
        console.log('[Issue] Fetched description from Jira:', getJson.fields.description);
        // Optionally, alert so you can see it:
        // alert('DEBUG: Jira stored description:\n\n' + getJson.fields.description);
      }
    } catch (e) {
      console.error('[Issue] Error fetching issue description for debug:', e);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // STEP 3: Upload the screenshot (here, we assume screenshot already in storage)
  // ────────────────────────────────────────────────────────────────────────────────
  debug('STEP 3: Uploading screenshot for', issueKey);

  // 3A) Retrieve the stored screenshot dataURL from local storage
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
        `https://${jiraHost}/rest/api/2/issue/${issueKey}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check'
        },
        body: form
      }
      );

      if (!attachResp.ok) {
        const text = await attachResp.text();
        debug('STEP 3 attachment failed', text);
        alert(`Issue ${issueKey} created, but failed to attach screenshot: ${text}`);
      } else {
        debug('STEP 3 successful: screenshot attached for', issueKey);
        // Final confirmation below
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
    // In a popup context, window.open will open in a new tab
    window.open(issueUrl, '_blank');
  }
}