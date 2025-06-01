// versions.mjs

/**
 * Run code in the current tab to look for <p class="--technology-version"> tags,
 * pick out FE: and BE: lines, and return them.
 */
export async function fetchVersionsFromPage() {
        console.log('[Versions] calling fetchVersionsFromPage()');

  // 1) Find the active tab in the current window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    console.warn('[Versions] No active tab found');
    return { feVersion: '', beVersion: '' };
  }

  // 2) Use executeScript to run in-page code
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // This function runs inside the page context
      const elems = document.querySelectorAll('p.--technology-version');
      let feVersion = '';
      let beVersion = '';

      console.log('[Versions] found', elems.length, 'version elements');

      elems.forEach(p => {
        const text = p.textContent.trim();
        if (text.startsWith('FE:')) {
          feVersion = text.substring(3).trim();
        } else if (text.startsWith('BE:')) {
          beVersion = text.substring(3).trim();
        }
      });

      return { feVersion, beVersion };
    },
  });

  // `results` is an array, but our func only ran once
  if (Array.isArray(results) && results.length > 0) {
    return results[0].result || { feVersion: '', beVersion: '' };
  }
  return { feVersion: '', beVersion: '' };
}