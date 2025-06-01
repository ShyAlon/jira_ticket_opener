// options.js

// When the page loads…
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Options] DOMContentLoaded – loading saved settings');
    chrome.storage.sync.get(
        ['email', 'token', 'host', 'projectKey'],
        (items) => {
            console.log('[Options] chrome.storage.sync.get result:', items);
            document.getElementById('email').value = items.email || '';
            document.getElementById('token').value = items.token || '';
            document.getElementById('host').value = items.host || '';
            document.getElementById('projectKey').value = items.projectKey || '';
        }
    );
});

// When the user clicks “Save”…
document.getElementById('save').addEventListener('click', () => {
    const email = document.getElementById('email').value.trim();
    const token = document.getElementById('token').value.trim();
    const host = document.getElementById('host').value.trim();
    const projectKey = document.getElementById('projectKey').value.trim();

    console.log('[Options] Saving settings:', { email, token, host, projectKey });
    chrome.storage.sync.set(
        { email, token, host, projectKey },
        () => {
            console.log('[Options] chrome.storage.sync.set callback fired');
            if (chrome.runtime.lastError) {
                console.error('[Options] Error saving settings:', chrome.runtime.lastError);
                alert('Error saving settings: ' + chrome.runtime.lastError.message);
            } else {
                console.log('[Options] Settings saved successfully');
                alert('Settings saved!');
            }
        }
    );
});