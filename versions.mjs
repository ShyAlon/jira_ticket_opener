// versions.mjs  [oai_citation:0‡versions.mjs](file-service://file-RZEUTPkNgFzdgcuEhmp7By)

/**
 * Fetches {versionSelector, fePrefix, bePrefix} from storage (with defaults),
 * then executes a small function in the page context that uses them to find FE/BE.
 */
export async function fetchVersionsFromPage() {
  // 1) Load the three settings from chrome.storage.sync
  const {
    versionSelector = 'p.--technology-version',
    fePrefix        = 'FE:',
    bePrefix        = 'BE:'
  } = await chrome.storage.sync.get({
    versionSelector: 'p.--technology-version',
    fePrefix: 'FE:',
    bePrefix: 'BE:'
  });

  console.log('[Versions] Using selector:', versionSelector,
    'FE prefix:', fePrefix, 'BE prefix:', bePrefix);

  // 2) Find the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    console.warn('[Versions] No active tab found');
    return { feVersion: '', beVersion: '' };
  }

  // 3) Inject code into the page that uses the dynamic selector & prefixes
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (selector, fePre, bePre) => {
      // This function runs in the page’s context; it cannot see chrome.storage directly
      const elems = document.querySelectorAll(selector);
      let feVersion = '';
      let beVersion = '';

      elems.forEach((el) => {
        const text = el.textContent.trim();
        if (text.startsWith(fePre)) {
          feVersion = text.substring(fePre.length).trim();
        } else if (text.startsWith(bePre)) {
          beVersion = text.substring(bePre.length).trim();
        }
      });

      return { feVersion, beVersion };
    },
    args: [versionSelector, fePrefix, bePrefix]
  });

  // 4) Return the result from the injected script
  if (Array.isArray(results) && results.length > 0) {
    return results[0].result || { feVersion: '', beVersion: '' };
  }
  return { feVersion: '', beVersion: '' };
}