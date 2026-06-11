const DEFAULT_CONFIG = {
    enabled: false,
    permanentDelete: false,
    intervalHours: 6,
    rules: [
        {
            id: 'default_1',
            name: 'Glassdoor Jobs',
            query: 'from:glassdoor',
            olderThan: '2m',
            enabled: true
        }
    ],
    lastRun: null,
    lastRunStatus: ''
};

let config = {};

function getConfig() {
    return new Promise(resolve => chrome.storage.sync.get(DEFAULT_CONFIG, data => {
        config = data;
        resolve(data);
    }));
}

function saveConfig() {
    config.enabled = document.getElementById('enabled').checked;
    config.permanentDelete = document.getElementById('permanentDelete').checked;
    config.intervalHours = parseInt(document.getElementById('intervalHours').value) || 6;
    return new Promise(resolve => chrome.storage.sync.set(config, resolve));
}

function setStatus(text) {
    document.getElementById('status').textContent = text;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderRules() {
    const list = document.getElementById('rules-list');
    list.innerHTML = '';

    if (!config.rules || config.rules.length === 0) {
        list.innerHTML = '<div class="no-rules">No rules yet.</div>';
        return;
    }

    config.rules.forEach((rule, i) => {
        const card = document.createElement('div');
        card.className = 'rule-card';
        card.innerHTML = `
            <div class="rule-header">
                <span class="rule-name">${escapeHtml(rule.name)}</span>
                <span style="display:flex;align-items:center;gap:6px">
                    <input type="checkbox" title="Enabled" ${rule.enabled ? 'checked' : ''}>
                    <button class="btn btn-red btn-sm">✕</button>
                </span>
            </div>
            <div class="rule-query">${escapeHtml(rule.query)} older_than:${escapeHtml(rule.olderThan)}</div>
        `;
        card.querySelector('input[type="checkbox"]').addEventListener('change', e => {
            config.rules[i].enabled = e.target.checked;
        });
        card.querySelector('button').addEventListener('click', () => {
            config.rules.splice(i, 1);
            renderRules();
        });
        list.appendChild(card);
    });
}

function refreshStatus() {
    const base = config.lastRun ? `Last run: ${config.lastRun}` : 'Never run';
    const detail = config.lastRunStatus ? ` — ${config.lastRunStatus}` : '';
    setStatus(base + detail);
}

document.addEventListener('DOMContentLoaded', async () => {
    await getConfig();

    document.getElementById('enabled').checked = config.enabled;
    document.getElementById('permanentDelete').checked = config.permanentDelete;
    document.getElementById('intervalHours').value = config.intervalHours;
    refreshStatus();
    renderRules();

    document.getElementById('auth-btn').addEventListener('click', () => {
        setStatus('Opening Google authorization…');
        chrome.runtime.sendMessage({ action: 'authorize' }, res => {
            setStatus(res.ok ? 'Authorized successfully.' : `Authorization failed: ${res.error}`);
        });
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
        await saveConfig();
        chrome.runtime.sendMessage({ action: 'settingsChanged' });
        setStatus('Settings saved.');
    });

    document.getElementById('run-now-btn').addEventListener('click', async () => {
        await saveConfig();
        chrome.runtime.sendMessage({ action: 'settingsChanged' });
        setStatus('Running…');
        chrome.runtime.sendMessage({ action: 'runNow' }, async () => {
            await getConfig();
            refreshStatus();
        });
    });

    document.getElementById('add-rule-btn').addEventListener('click', () => {
        const name  = document.getElementById('new-name').value.trim();
        const query = document.getElementById('new-query').value.trim();
        const age   = document.getElementById('new-age').value.trim();
        const unit  = document.getElementById('new-unit').value;

        if (!name || !query || !age) {
            setStatus('Please fill in all fields before adding a rule.');
            return;
        }

        config.rules.push({
            id: `rule_${Date.now()}`,
            name,
            query,
            olderThan: `${age}${unit}`,
            enabled: true
        });

        document.getElementById('new-name').value = '';
        document.getElementById('new-query').value = '';
        document.getElementById('new-age').value = '2';
        renderRules();
        setStatus(`Rule "${name}" added. Click Save Settings to keep it.`);
    });
});
