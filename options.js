// options.js

// When the page loads…
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Options] DOMContentLoaded – loading saved settings');
    chrome.storage.sync.get(
        {
            email: '',
            token: '',
            host: '',
            projectKey: '',
            versionSelector: 'p.--technology-version',
            fePrefix: 'FE:',
            bePrefix: 'BE:'
        },
        (items) => {
            console.log('[Options] Loaded settings:', items);

            document.getElementById('email').value = items.email;
            document.getElementById('token').value = items.token;
            document.getElementById('host').value = items.host;
            document.getElementById('projectKey').value = items.projectKey;
            document.getElementById('versionSelector').value = items.versionSelector;
            document.getElementById('fePrefix').value = items.fePrefix;
            document.getElementById('bePrefix').value = items.bePrefix;
        }
    );
});

// When the user clicks “Save”…
document.getElementById('save').addEventListener('click', () => {
    const email = document.getElementById('email').value.trim();
    const token = document.getElementById('token').value.trim();
    const host = document.getElementById('host').value.trim();
    const projectKey = document.getElementById('projectKey').value.trim();
    const versionSelector = document.getElementById('versionSelector').value.trim() || 'p.--technology-version';
    const fePrefix = document.getElementById('fePrefix').value.trim() || 'FE:';
    const bePrefix = document.getElementById('bePrefix').value.trim() || 'BE:';

    console.log('[Options] Saving settings:', {
        email, token, host, projectKey, versionSelector, fePrefix, bePrefix
    }); chrome.storage.sync.set(
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