// issue.mjs

import { debug } from './debug.mjs';

/**
 * Creates a Jira issue in three steps:
 *   1) POST /issue with summary + project + issueType + all dynamicFields
 *   2) PUT /issue/{key} to update description (and any dynamicFields that are not set on create, if needed)
 *   3) Attach screenshot
 *
 * @param {string} userSummary      – One‐line summary
 * @param {string} fullBodyDesc     – Multi‐line description (bullets + logs)
 * @param {object} dynamicFields    – A map { fieldKey: { id: “…” } } for every picklist field
 */
export async function createJiraIssue(userSummary, fullBodyDesc, dynamicFields) {
  debug('createJiraIssue called:', {
    userSummary,
    dynamicFields
  });

  // 1) Load Jira credentials & settings
  const {
    email,
    token,
    host,
    projectKey = 'MYPROJ',
    issueType  = 'Bug'
  } = await chrome.storage.sync.get([
    'email', 'token', 'host', 'projectKey', 'issueType'
  ]);

  if (!email || !token || !host || !projectKey) {
    alert('❌ Missing Jira credentials or projectKey in storage.');
    return;
  }

  const auth = btoa(`${email}:${token}`);
  const baseUrl = `https://${host}/rest/api/2/issue`;

  // 2) Ensure we have a summary
  if (!userSummary) {
    alert('❗ Please enter a one-line Summary before submitting.');
    return;
  }

  // 3) Build the “create” payload with all dynamicFields spread into fields:
  const createBody = {
    fields: {
      project:   { key: projectKey },
      summary:   userSummary,
      issuetype: { name: issueType },
      ...dynamicFields
    }
  };

  console.debug('[Issue] STEP 1: create fields:', createBody.fields);

  // STEP 1: POST /issue
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
    debug('Network error on create step:', err);
    alert('Network error while creating the issue. Check debug log.');
    return;
  }

  let createResult;
  try {
    createResult = await createResp.json();
  } catch (e) {
    debug('Failed to parse create response:', e);
    alert(`Error: ${createResp.status} ${createResp.statusText}`);
    return;
  }

  debug('create response:', createResult);
  if (!createResp.ok || !createResult.key) {
    const errMsg = (createResult.errorMessages || []).join(', ') || JSON.stringify(createResult);
    alert(`❌ Couldn’t create issue: ${errMsg}`);
    return;
  }

  const issueKey = createResult.key;
  const issueUrl = `https://${host}/browse/${issueKey}`;
  debug('Issue created:', issueKey);

  // STEP 2: Update description
  debug('STEP 2: update description');
  const updatePayload = {
    fields: {
      description: fullBodyDesc
      // (if you want to change any dynamic field later, you could spread dynamicFields here again)
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
      body: JSON.stringify(updatePayload)
    });
  } catch (err) {
    debug('Network error updating description:', err);
    alert(`Issue ${issueKey} created, but network error updating description.`);
  }

  if (updateResp && !updateResp.ok) {
    const text = await updateResp.text();
    console.error('[Issue] Update description failed:', text);
    alert(`Issue ${issueKey} created, but failed to update description:\n${text}`);
  } else {
    debug('Description updated successfully');
  }

  // STEP 3: Attach screenshot
  debug('STEP 3: attach screenshot');
  const { issueData } = await chrome.storage.local.get(['issueData']);
  if (!issueData?.screenshot) {
    debug('No screenshot to attach');
  } else {
    try {
      const blob = await (await fetch(issueData.screenshot)).blob();
      const form = new FormData();
      form.append('file', blob, 'screenshot.png');

      const attachResp = await fetch(
        `${baseUrl}/${issueKey}/attachments`, {
          method: 'POST',
          headers: {
            'Authorization':     `Basic ${auth}`,
            'X-Atlassian-Token': 'no-check'
          },
          body: form
        }
      );
      if (!attachResp.ok) {
        const t = await attachResp.text();
        debug('Attachment failed:', t);
        alert(`Issue ${issueKey} created, but failed to attach screenshot:\n${t}`);
      } else {
        debug('Screenshot attached successfully');
      }
    } catch (err) {
      debug('Error attaching screenshot:', err);
      alert(`Issue ${issueKey} created, but error attaching screenshot`);
    }
  }

  // Finally, prompt user to open the new issue
  const openNow = confirm(
    `✔ Issue ${issueKey} created!\n\n` +
    `Click “OK” to open it in Jira.`
  );
  if (openNow) {
    window.open(issueUrl, '_blank');
  }
}