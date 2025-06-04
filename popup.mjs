// popup.mjs

import { debug } from './debug.mjs';
import { createJiraIssue } from './issue.mjs';

document.addEventListener('DOMContentLoaded', () => {
  initPopup();
});

async function initPopup() {
  debug('[Popup] initPopup()');

  // 1) Load stored issueData (screenshot, logs, original URL, tabId)
  let issueData = null;
  await new Promise((resolve) => {
    chrome.storage.local.get('issueData', ({ issueData: d }) => {
      issueData = d;
      debug('[Popup] issueData loaded:', issueData);
      resolve();
    });
  });

  // 2) Draw screenshot onto <canvas> and enable annotation
  const canvas = document.getElementById('annotation-canvas');
  const ctx = canvas.getContext('2d');

  if (issueData?.screenshot) {
    const img = new Image();
    img.onload = () => {
      const MAX_HEIGHT = 256;
      let drawWidth = img.width;
      let drawHeight = img.height;
      if (img.height > MAX_HEIGHT) {
        const ratio = MAX_HEIGHT / img.height;
        drawHeight = MAX_HEIGHT;
        drawWidth = img.width * ratio;
      }
      canvas.width = drawWidth;
      canvas.height = drawHeight;
      ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
      enableFreehandDrawing(canvas, ctx);
    };
    img.src = issueData.screenshot;
  } else {
    canvas.width = 300;
    canvas.height = 200;
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 3) Auto-generate description (bullets + logs)
  const currentTabUrl = issueData?.url || '';
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
      debug('[Popup] Versions from page:', { feVersion, beVersion });
    } catch (err) {
      console.error('[Popup] Error fetching versions via scripting:', err);
    }
  }

  let environment = '';
  try {
    environment = new URL(currentTabUrl).hostname;
  } catch {
    environment = currentTabUrl;
  }

  const descEl = document.getElementById('description');
  descEl.value = buildDescription({ feVersion, beVersion, environment, currentTabUrl, issueData });

  // 4) Fetch create-meta from background, then build dynamic picklists
  let metaJson = null;
  try {
    metaJson = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'loadMetadata' }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.success) return reject(resp?.error || 'Unknown error');
        resolve(resp.data);
      });
    });
    debug('[Popup] Received create-meta JSON');
    populateAllMetaFields(metaJson);
  } catch (err) {
    console.error('[Popup] loadMetadata failed:', err);
  }

  // 5) Settings button → open Options page
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 6) Submit button click handler
  document.getElementById('submit').addEventListener('click', async () => {
    const summaryEl = document.getElementById('summary');
    const userSummary = summaryEl.value.trim();
    if (!userSummary) {
      alert('❗ Please enter a one-line Summary before submitting.');
      return;
    }
    const fullDescription = descEl.value.trim();

    // 7) Collect dynamic fields into an object
    //    For single-select: { fieldKey: { id: ... } }
    //    For multi-select:  { fieldKey: [ { id: ... }, { id: ... }, ... ] }
    const dynamicFields = {};
    document.querySelectorAll('#meta-fields select[data-fieldkey]').forEach((sel) => {
      const fieldKey = sel.dataset.fieldkey;
      const isMulti = sel.dataset.isMulti === 'true';

      if (isMulti) {
        // Gather all selected option values
        const values = Array.from(sel.selectedOptions).map((opt) => opt.value);
        if (values.length) {
          dynamicFields[fieldKey] = values.map((id) => ({ id }));
        }
      } else {
        const val = sel.value;
        if (val) {
          dynamicFields[fieldKey] = { id: val };
        }
      }
    });

    // 8) Grab the annotated screenshot from the canvas
    const annotatedDataUrl = canvas.toDataURL('image/png');
    issueData.screenshot = annotatedDataUrl;
    await new Promise((resolve) => {
      chrome.storage.local.set({ issueData }, () => {
        resolve();
      });
    });

    // 9) Call createJiraIssue(summary, description, dynamicFields)
    try {
      await createJiraIssue(userSummary, fullDescription, dynamicFields);
    } catch (err) {
      console.error('[Popup] createJiraIssue error:', err);
    }
  });
}

/**
 * buildDescription({ feVersion, beVersion, environment, currentTabUrl, issueData })
 */
function buildDescription({ feVersion, beVersion, environment, currentTabUrl, issueData }) {
  const bullets = [
    feVersion ? `* FE Version: ${feVersion}` : null,
    beVersion ? `* BE Version: ${beVersion}` : null,
    environment ? `* Environment: ${environment}` : null,
    currentTabUrl ? `* URL: ${currentTabUrl}` : null
  ].filter(Boolean).join('\n');

  let logsBlock = '';
  if (issueData?.logs && Array.isArray(issueData.logs)) {
    const logsText = issueData.logs.map((l) => l.args.join(' ')).join('\n');
    logsBlock = `\n*Console Logs:*\n\`\`\`\n${logsText}\n\`\`\``;
  }

  return bullets + logsBlock;
}

/**
 * populateAllMetaFields(json):
 *   1) Locate project → issuetype “Bug” → fields (an object mapping fieldKey→fieldObj)
 *   2) For each fieldKey whose fieldObj.allowedValues is a non-empty array:
 *       a) Create a <div class="field">
 *       b) Append a <label> with text fieldObj.name (for=fieldKey)
 *       c) Create a <select id=fieldKey data-fieldkey=fieldKey>
 *       d) If fieldObj.schema.type === "array", set select.multiple = true and data-is-multi="true"
 *       e) For each allowedValue in fieldObj.allowedValues, append <option value=allowedValue.id>allowedValue.name</option>
 *       f) Append the select to the wrapper and wrapper to #meta-fields
 *   3) If no picklist fields found, show a single <p>No picklist fields available.</p>
 */
function populateAllMetaFields(json) {
  const container = document.getElementById('meta-fields');
  container.innerHTML = ''; // clear previous

  const proj = json.projects?.[0];
  const issuetypeObj = proj?.issuetypes?.find((it) => it.name === 'Bug');
  const fields = issuetypeObj?.fields || {};

  Object.entries(fields).forEach(([fieldKey, fieldObj]) => {
    if (Array.isArray(fieldObj.allowedValues) && fieldObj.allowedValues.length > 0) {
      const wrapper = document.createElement('div');
      wrapper.className = 'field';

      // Label:
      const lbl = document.createElement('label');
      lbl.textContent = fieldObj.name;
      lbl.htmlFor = fieldKey;
      wrapper.appendChild(lbl);

      // Select:
      const sel = document.createElement('select');
      sel.id = fieldKey;
      sel.dataset.fieldkey = fieldKey;

      // If fieldObj.schema.type === "array", allow multiple selection
      if (fieldObj.schema?.type === 'array') {
        sel.multiple = true;
        sel.dataset.isMulti = 'true';
      } else {
        sel.dataset.isMulti = 'false';
      }

      // Populate options:
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

  if (!container.children.length) {
    const notice = document.createElement('p');
    notice.textContent = 'No picklist fields available.';
    container.appendChild(notice);
  }

  debug('[Popup] Meta fields populated');
}

/**
 * enableFreehandDrawing(canvas, ctx):
 *   Attaches mouse/touch events so the user can draw freehand on the canvas.
 */
function enableFreehandDrawing(canvas, ctx) {
  let drawing = false;
  let lastX = 0, lastY = 0;

  function getCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  function startDraw(evt) {
    drawing = true;
    const { x, y } = getCoords(evt);
    lastX = x;
    lastY = y;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    evt.preventDefault();
  }

  function draw(evt) {
    if (!drawing) return;
    const { x, y } = getCoords(evt);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x;
    lastY = y;
    evt.preventDefault();
  }

  function endDraw(evt) {
    if (!drawing) return;
    ctx.closePath();
    drawing = false;
    evt.preventDefault();
  }

  // Mouse events
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseout', endDraw);

  // Touch events
  canvas.addEventListener('touchstart', (e) => startDraw(e.touches[0]));
  canvas.addEventListener('touchmove', (e) => draw(e.touches[0]));
  canvas.addEventListener('touchend', endDraw);
  canvas.addEventListener('touchcancel', endDraw);
}