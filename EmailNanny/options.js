const DEFAULT_CONFIG = {
    enabled: false,
    permanentDelete: false,
    intervalHours: 6,
    rules: [
        { id: 'default_1', name: 'Glassdoor Jobs', query: 'from:glassdoor', olderThan: '2m', enabled: true }
    ],
    lastRun: null,
    lastRunStatus: ''
};

let config = {};

// ── Storage helpers ────────────────────────────────────────────────────────────

function loadConfig() {
    return new Promise(resolve => chrome.storage.sync.get(DEFAULT_CONFIG, data => {
        config = data;
        resolve(data);
    }));
}

function saveConfig() {
    config.enabled         = document.getElementById('enabled').checked;
    config.permanentDelete = document.getElementById('permanentDelete').checked;
    config.intervalHours   = parseInt(document.getElementById('intervalHours').value) || 6;
    return new Promise(resolve => chrome.storage.sync.set(config, resolve));
}

function loadHistory() {
    return new Promise(resolve => chrome.storage.local.get({ runHistory: [] }, d => resolve(d.runHistory)));
}

// ── Tab switching ──────────────────────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'history') renderHistory();
        });
    });
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function initSettings() {
    document.getElementById('enabled').checked         = config.enabled;
    document.getElementById('permanentDelete').checked = config.permanentDelete;
    document.getElementById('intervalHours').value     = config.intervalHours;

    checkAuthStatus();

    document.getElementById('auth-btn').addEventListener('click', () => {
        document.getElementById('auth-btn').textContent = 'Authorizing…';
        chrome.runtime.sendMessage({ action: 'authorize' }, res => {
            document.getElementById('auth-btn').textContent = 'Authorize Gmail Access';
            if (res.ok) {
                setAuthStatus(true);
            } else {
                setAuthStatus(false, res.error);
            }
        });
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
        await saveConfig();
        chrome.runtime.sendMessage({ action: 'settingsChanged' });
        const alert = document.getElementById('save-alert');
        alert.style.display = 'block';
        setTimeout(() => { alert.style.display = 'none'; }, 3000);
    });
}

function checkAuthStatus() {
    chrome.runtime.sendMessage({ action: 'checkAuth' }, res => {
        setAuthStatus(!!(res && res.authorized));
    });
}

function setAuthStatus(ok, errorMsg) {
    const el = document.getElementById('auth-status');
    if (ok) {
        el.className = 'ok';
        el.textContent = 'Authorized';
    } else {
        el.className = '';
        el.textContent = errorMsg ? `Not authorized: ${errorMsg}` : 'Not authorized';
    }
}

// ── Rules tab ─────────────────────────────────────────────────────────────────

function renderRules() {
    const tbody = document.getElementById('rules-body');
    tbody.innerHTML = '';

    if (!config.rules || config.rules.length === 0) {
        tbody.innerHTML = '<tr class="no-rules-row"><td colspan="5">No rules yet. Add one below.</td></tr>';
        return;
    }

    config.rules.forEach((rule, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${esc(rule.name)}</td>
            <td class="rule-query">${esc(rule.query)} older_than:${esc(rule.olderThan)}</td>
            <td>${esc(rule.olderThan)}</td>
            <td><label class="toggle"><input type="checkbox" ${rule.enabled ? 'checked' : ''}><span class="slider"></span></label></td>
            <td><button class="btn btn-red btn-sm">Delete</button></td>
        `;
        tr.querySelector('input[type="checkbox"]').addEventListener('change', e => {
            config.rules[i].enabled = e.target.checked;
            saveConfig();
        });
        tr.querySelector('.btn-red').addEventListener('click', () => {
            config.rules.splice(i, 1);
            saveConfig();
            renderRules();
        });
        tbody.appendChild(tr);
    });
}

function initRules() {
    renderRules();

    document.getElementById('add-rule-btn').addEventListener('click', () => {
        const name  = document.getElementById('new-name').value.trim();
        const query = document.getElementById('new-query').value.trim();
        const age   = document.getElementById('new-age').value.trim();
        const unit  = document.getElementById('new-unit').value;
        const errEl = document.getElementById('rule-error');

        if (!name || !query || !age) {
            errEl.textContent = 'Please fill in all fields.';
            errEl.style.display = 'block';
            return;
        }
        errEl.style.display = 'none';

        config.rules.push({ id: `rule_${Date.now()}`, name, query, olderThan: `${age}${unit}`, enabled: true });
        saveConfig();
        renderRules();

        document.getElementById('new-name').value  = '';
        document.getElementById('new-query').value = '';
        document.getElementById('new-age').value   = '2';
    });
}

// ── Preview tab ───────────────────────────────────────────────────────────────

function initPreview() {
    document.getElementById('preview-btn').addEventListener('click', () => {
        const btn = document.getElementById('preview-btn');
        btn.textContent = 'Scanning…';
        btn.disabled = true;

        const results = document.getElementById('preview-results');
        results.innerHTML = '';

        chrome.runtime.sendMessage({ action: 'dryRun' }, res => {
            btn.textContent = 'Run Preview';
            btn.disabled = false;

            if (!res.ok) {
                results.innerHTML = `<div class="alert alert-error">${esc(res.error)}</div>`;
                return;
            }

            if (res.results.length === 0) {
                results.innerHTML = '<div class="alert alert-info">No enabled rules to preview.</div>';
                return;
            }

            res.results.forEach(rule => {
                const div = document.createElement('div');
                div.className = 'preview-rule';

                const countClass = rule.count === 0 ? 'zero' : '';
                const countText  = rule.count === 0 ? '0 matches' : `${rule.count} would be deleted`;

                let samplesHtml = '';
                if (rule.error) {
                    samplesHtml = `<div class="preview-error">Error: ${esc(rule.error)}</div>`;
                } else if (rule.sample && rule.sample.length > 0) {
                    samplesHtml = '<div class="preview-samples">'
                        + rule.sample.map(s => `
                            <div class="preview-sample-row">
                                <div>${esc(s.subject)}</div>
                                <div class="preview-sample-from">${esc(s.from)}</div>
                            </div>`).join('')
                        + (rule.count > 5 ? `<div class="preview-sample-row" style="color:#bbb">…and ${rule.count - 5} more</div>` : '')
                        + '</div>';
                } else if (rule.count === 0) {
                    samplesHtml = '<div class="preview-samples" style="color:#aaa;font-size:13px">No matching emails found.</div>';
                }

                div.innerHTML = `
                    <div class="preview-rule-header">
                        <span class="preview-rule-name">${esc(rule.name)}</span>
                        <span class="preview-count ${countClass}">${countText}</span>
                    </div>
                    <div class="preview-query">${esc(rule.query)}</div>
                    ${samplesHtml}
                `;
                results.appendChild(div);
            });
        });
    });
}

// ── History tab ───────────────────────────────────────────────────────────────

async function renderHistory() {
    const history = await loadHistory();
    const placeholder = document.getElementById('history-placeholder');
    const table = document.getElementById('history-table');
    const tbody = document.getElementById('history-body');

    if (history.length === 0) {
        placeholder.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    placeholder.style.display = 'none';
    table.style.display = 'table';
    tbody.innerHTML = '';

    history.forEach(entry => {
        const tr = document.createElement('tr');
        const date = new Date(entry.timestamp).toLocaleString();
        const modeTag = entry.permanent
            ? '<span class="tag tag-perm">Permanent</span>'
            : '<span class="tag tag-trash">Trash</span>';
        const rulesSummary = entry.rules.map(r =>
            `<div class="rule-detail">${esc(r.name)}: ${r.error ? '⚠ ' + esc(r.error) : r.count + ' deleted'}</div>`
        ).join('');

        tr.innerHTML = `
            <td>${esc(date)}</td>
            <td><strong>${entry.totalDeleted}</strong></td>
            <td>${modeTag}</td>
            <td>${rulesSummary}</td>
        `;
        tbody.appendChild(tr);
    });
}

function initHistory() {
    document.getElementById('clear-history-btn').addEventListener('click', () => {
        if (!confirm('Clear all run history?')) return;
        chrome.storage.local.set({ runHistory: [] }, () => renderHistory());
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    initTabs();
    initSettings();
    initRules();
    initPreview();
    initHistory();
});
