// metadata.mjs
import { debug } from './debug.mjs';

export let sysFieldKey = '';

export async function loadMetadata() {
  debug('Loading metadata…');
  const { jiraHost, jiraEmail, jiraApiToken, projectKey = 'MYPROJ', issueType = 'Bug' } =
    await chrome.storage.sync.get([
      'jiraHost','jiraEmail','jiraApiToken','projectKey','issueType'
    ]);
  const auth = btoa(`${jiraEmail}:${jiraApiToken}`);

  const url = `https://${jiraHost}/rest/api/2/issue/createmeta`
    + `?projectKeys=${projectKey}`
    + `&issuetypeNames=${encodeURIComponent(issueType)}`
    + `&expand=projects.issuetypes.fields`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    debug('Network error fetching metadata', err);
    return;
  }

  if (!resp.ok) {
    const text = await resp.text();
    debug('createmeta error', text);
    return;
  }

  const data = await resp.json();
  const meta = data.projects[0].issuetypes.find(t => t.name === issueType).fields;

  // — Populate Priority:
  const priorityAllowed = meta.priority.allowedValues || [];
  const prioSel = document.getElementById('priority');
  prioSel.innerHTML = '';
  if (!priorityAllowed.length) {
    prioSel.add(new Option('No priorities found', ''));
  } else {
    priorityAllowed.forEach(p => prioSel.add(new Option(p.name, p.id)));
    prioSel.selectedIndex = 2;
  }

  // — Populate Affected System:
  sysFieldKey = Object.keys(meta)
    .find(f => meta[f].name.toLowerCase() === 'affected system');
  const sysAllowed = sysFieldKey
    ? (meta[sysFieldKey].allowedValues || [])
    : [];
  const sysSel = document.getElementById('affectedSystem');
  sysSel.innerHTML = '';
  if (!sysFieldKey || !sysAllowed.length) {
    sysSel.add(new Option('No systems found', ''));
  } else {
    sysAllowed.forEach(s => sysSel.add(new Option(s.value, s.id)));
  }

  debug('Loaded fields', {
    priorities: priorityAllowed.map(p => p.name),
    affectedSystem: sysAllowed.map(s => s.name)
  });
}