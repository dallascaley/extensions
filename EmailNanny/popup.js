const DEFAULT = { lastRun: null, lastRunStatus: '' };

function refreshStatus() {
    chrome.storage.sync.get(DEFAULT, data => {
        const el = document.getElementById('status');
        if (data.lastRun) {
            el.textContent = `${data.lastRun} — ${data.lastRunStatus}`;
        } else {
            el.textContent = 'Never run';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    refreshStatus();

    document.getElementById('run-now').addEventListener('click', () => {
        document.getElementById('status').textContent = 'Running…';
        chrome.runtime.sendMessage({ action: 'runNow' }, () => refreshStatus());
    });

    document.getElementById('open-settings').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
});
