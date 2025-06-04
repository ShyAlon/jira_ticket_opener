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

  // We'll keep a reference to the loaded Image so we can redraw if we resize the canvas
  let loadedImage = null;

  if (issueData?.screenshot) {
    loadedImage = new Image();
    loadedImage.onload = () => {
      const MAX_HEIGHT = 256;
      let drawWidth = loadedImage.width;
      let drawHeight = loadedImage.height;
      if (loadedImage.height > MAX_HEIGHT) {
        const ratio = MAX_HEIGHT / loadedImage.height;
        drawHeight = MAX_HEIGHT;
        drawWidth = loadedImage.width * ratio;
      }
      // Set internal canvas resolution:
      canvas.width = drawWidth;
      canvas.height = drawHeight;
      // Draw the image scaled into that internal resolution:
      ctx.drawImage(loadedImage, 0, 0, drawWidth, drawHeight);
      // Enable drawing (with coordinate‐scaling)
      enableFreehandDrawing(canvas, ctx);
    };
    loadedImage.src = issueData.screenshot;
  } else {
    // No screenshot: blank canvas
    canvas.width = 300;
    canvas.height = 200;
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    enableFreehandDrawing(canvas, ctx);
  }

  // 2b) Handle double-click → toggle “expanded” on .screenshot-container
  canvas.addEventListener('dblclick', () => {
    const container = document.querySelector('.screenshot-container');
    if (!container) return;
    container.classList.toggle('expanded');

    // If we have a loadedImage, and we just expanded (container now has .expanded),
    // we want to resize the canvas to the image’s natural dimensions.
    if (loadedImage) {
      if (container.classList.contains('expanded')) {
        // Expanded: set canvas to natural size
        canvas.width = loadedImage.naturalWidth;
        canvas.height = loadedImage.naturalHeight;
      } else {
        // Collapsed: scale back to max‐256px height
        const MAX_HEIGHT = 256;
        let w = loadedImage.naturalWidth;
        let h = loadedImage.naturalHeight;
        if (h > MAX_HEIGHT) {
          const ratio = MAX_HEIGHT / h;
          h = MAX_HEIGHT;
          w = w * ratio;
        }
        canvas.width = w;
        canvas.height = h;
      }
      // Redraw the image into the new internal resolution
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loadedImage, 0, 0, canvas.width, canvas.height);
      // Keep the existing drawn strokes if you want—here we assume a fresh redraw
      // If you need to preserve user‐drawn lines, you must store them and redraw them here.
    }
  });

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
    const dynamicFields = {};
    document.querySelectorAll('#meta-fields select[data-fieldkey]').forEach((sel) => {
      const fieldKey = sel.dataset.fieldkey;
      const isMulti = sel.dataset.isMulti === 'true';

      if (isMulti) {
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

      // If multi-select, set multiple and data-is-multi="true"
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
 *   Modified getCoords(evt) to account for CSS scaling.
 */
function enableFreehandDrawing(canvas, ctx) {
  let drawing = false;
  let lastX = 0, lastY = 0;

  function getCoords(evt) {
    // Get bounding rectangle of the canvas in CSS pixels
    const rect = canvas.getBoundingClientRect();
    // Calculate CSS‐space coordinates
    const cssX = evt.clientX - rect.left;
    const cssY = evt.clientY - rect.top;
    // Now convert CSS coords to the internal pixel coords by scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: cssX * scaleX,
      y: cssY * scaleY
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