// debug.mjs
export function debug(msg, obj) {
  console.log('[JiraReporter]', msg, obj || '');
  const el = document.getElementById('debug');
  if (!el) return;
  const line = document.createElement('div');
  line.textContent = msg + (obj ? ' ' + JSON.stringify(obj) : '');
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}