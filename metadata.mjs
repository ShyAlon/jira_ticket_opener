// metadata.mjs

import { debug } from './debug.mjs';

export async function getSysFieldKey() {
  // Read the persisted sysFieldKey from storage
  const { sysFieldKey = '' } = await chrome.storage.sync.get('sysFieldKey');
  debug('[Metadata] getSysFieldKey →', sysFieldKey);
  return sysFieldKey;
}

export async function loadMetadata() {
  debug('Loading metadata…');

  // 1) Read Jira credentials & project settings
  const {
    email,
    token,
    host,
    projectKey = 'MYPROJ',
    issueType  = 'Bug'
  } = await chrome.storage.sync.get([
    'email',
    'token',
    'host',
    'projectKey',
    'issueType'
  ]);

  if (!host || !email || !token) {
    debug('Missing Jira credentials; abort loadMetadata');
    return;
  }

  // 2) Call Jira’s create-meta endpoint
  const auth = btoa(`${email}:${token}`);
  const url = `https://${host}/rest/api/2/issue/createmeta`
    + `?projectKeys=${encodeURIComponent(projectKey)}`
    + `&issuetypeNames=${encodeURIComponent(issueType)}`
    + `&expand=projects.issuetypes.fields`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json'
      }
    });
  } catch (err) {
    debug('Network error fetching metadata', err);
    return;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    debug(`createmeta returned ${resp.status}: ${text}`);
    return;
  }

  const data = await resp.json();

  // 3) Drill down to fields for the chosen issueType
  const projectMeta = data.projects[0];
  if (!projectMeta) {
    debug('No projects in create-meta response');
    return;
  }

  const issuetypeObj = projectMeta.issuetypes.find((it) => it.name === issueType);
  if (!issuetypeObj) {
    debug(`IssueType "${issueType}" not found in create-meta`);
    return;
  }

  const fields = issuetypeObj.fields || {};

  // 4) Populate the Priority <select id="priority">
  const priorityAllowed = fields.priority?.allowedValues || [];
  const prioSel = document.getElementById('priority');
  prioSel.innerHTML = '';
  if (!priorityAllowed.length) {
    prioSel.add(new Option('No priorities found', ''));
  } else {
    priorityAllowed.forEach((p) => {
      prioSel.add(new Option(p.name, p.id));
    });
    // Default to “Medium” if it exists
    const mediumOption = Array.from(prioSel.options).find((o) => o.text.toLowerCase() === 'medium');
    if (mediumOption) {
      prioSel.value = mediumOption.value;
    }
  }

  // 5) Get the persisted sysFieldKey from storage (instead of recomputing here)
  const { sysFieldKey = '' } = await chrome.storage.sync.get('sysFieldKey');
  console.debug('[Metadata] Using stored sysFieldKey =', sysFieldKey);

  // 6) Populate the Affected System <select id="affectedSystem">
  const sysSel = document.getElementById('affectedSystem');
  sysSel.innerHTML = '';

  if (sysFieldKey && fields[sysFieldKey]) {
    const allowedSys = fields[sysFieldKey].allowedValues || [];
    if (allowedSys.length) {
      allowedSys.forEach((s) => {
        const label = s.name || s.value || '';
        const opt = new Option(label, s.id);
        sysSel.add(opt);
      });
    }
  }

  // 7) If no systems were found, default to “None”
  if (!sysSel.options.length) {
    sysSel.add(new Option('None', ''));
  }

  debug('Loaded metadata:', {
    priorities:     priorityAllowed.map((p) => p.name),
    affectedSystem: sysFieldKey
      ? (fields[sysFieldKey]?.allowedValues || []).map((s) => s.name || s.value)
      : []
  });
}