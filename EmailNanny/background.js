const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const ALARM_NAME = 'emailNannyCheck';

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

chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(runCleanup);
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM_NAME) runCleanup();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'runNow') {
        runCleanup()
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
    if (msg.action === 'authorize') {
        getAuthToken(true)
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
    if (msg.action === 'settingsChanged') {
        setupAlarm().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (msg.action === 'dryRun') {
        runDryRun()
            .then(results => sendResponse({ ok: true, results }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});

async function setupAlarm() {
    const config = await getConfig();
    await chrome.alarms.clearAll();
    if (config.enabled) {
        chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: 1,
            periodInMinutes: (config.intervalHours || 6) * 60
        });
    }
}

function getConfig() {
    return new Promise(resolve => chrome.storage.sync.get(DEFAULT_CONFIG, resolve));
}

function setStatus(msg) {
    const now = new Date().toLocaleString();
    console.log(`[EmailNanny] ${now}: ${msg}`);
    return new Promise(resolve => chrome.storage.sync.set({ lastRun: now, lastRunStatus: msg }, resolve));
}

function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, token => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(token);
            }
        });
    });
}

function removeCachedToken(token) {
    return new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

async function gmailRequest(token, path, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Authorization': `Bearer ${token}` }
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const res = await fetch(`${GMAIL_API}${path}`, options);
    if (res.status === 401) throw new Error('TOKEN_EXPIRED');
    if (res.status === 204) return null;
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gmail API ${res.status}: ${text}`);
    }
    return res.json();
}

async function findMessages(token, query) {
    const messages = [];
    let pageToken = null;
    do {
        const params = new URLSearchParams({ q: query, maxResults: 500 });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await gmailRequest(token, `/messages?${params}`);
        if (data && data.messages) messages.push(...data.messages);
        pageToken = (data && data.nextPageToken) || null;
    } while (pageToken);
    return messages;
}

async function deleteMessage(token, messageId, permanent) {
    if (permanent) {
        await gmailRequest(token, `/messages/${messageId}`, 'DELETE');
    } else {
        await gmailRequest(token, `/messages/${messageId}/trash`, 'POST');
    }
}

async function fetchSample(token, messageIds) {
    return Promise.all(messageIds.slice(0, 5).map(async id => {
        try {
            const data = await gmailRequest(token,
                `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
            const headers = data.payload.headers;
            return {
                subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
                from:    headers.find(h => h.name === 'From')?.value || ''
            };
        } catch {
            return { subject: '(error fetching)', from: '' };
        }
    }));
}

async function processRule(token, rule, permanent) {
    const query = `${rule.query} older_than:${rule.olderThan}`;
    console.log(`[EmailNanny] Rule "${rule.name}": ${query}`);
    const messages = await findMessages(token, query);
    console.log(`[EmailNanny] Rule "${rule.name}": found ${messages.length} messages`);
    for (const msg of messages) {
        await deleteMessage(token, msg.id, permanent);
    }
    return messages.length;
}

async function logHistory(entry) {
    const data = await new Promise(r => chrome.storage.local.get({ runHistory: [] }, r));
    const history = data.runHistory;
    history.unshift(entry);
    if (history.length > 100) history.splice(100);
    await new Promise(r => chrome.storage.local.set({ runHistory: history }, r));
}

async function runCleanup() {
    const config = await getConfig();
    if (!config.enabled) return;

    const enabledRules = config.rules.filter(r => r.enabled);
    if (enabledRules.length === 0) {
        await setStatus('No enabled rules');
        return;
    }

    let token;
    try {
        token = await getAuthToken(false);
    } catch {
        await setStatus('Not authorized — open EmailNanny and click Authorize');
        return;
    }

    let totalDeleted = 0;
    const errors = [];
    const ruleDetails = [];

    for (const rule of enabledRules) {
        try {
            const count = await processRule(token, rule, config.permanentDelete);
            totalDeleted += count;
            ruleDetails.push({ name: rule.name, count, error: null });
        } catch (err) {
            if (err.message === 'TOKEN_EXPIRED') {
                await removeCachedToken(token);
                try {
                    token = await getAuthToken(false);
                    const count = await processRule(token, rule, config.permanentDelete);
                    totalDeleted += count;
                    ruleDetails.push({ name: rule.name, count, error: null });
                } catch (retryErr) {
                    errors.push(`${rule.name}: ${retryErr.message}`);
                    ruleDetails.push({ name: rule.name, count: 0, error: retryErr.message });
                }
            } else {
                errors.push(`${rule.name}: ${err.message}`);
                ruleDetails.push({ name: rule.name, count: 0, error: err.message });
            }
        }
    }

    const action = config.permanentDelete ? 'Permanently deleted' : 'Trashed';
    const status = errors.length > 0
        ? `${action} ${totalDeleted} emails. Errors: ${errors.join('; ')}`
        : `${action} ${totalDeleted} emails`;

    await setStatus(status);
    await logHistory({
        timestamp: new Date().toISOString(),
        permanent: config.permanentDelete,
        totalDeleted,
        rules: ruleDetails,
        errors
    });
}

async function runDryRun() {
    const config = await getConfig();
    const enabledRules = config.rules.filter(r => r.enabled);

    let token;
    try {
        token = await getAuthToken(false);
    } catch {
        throw new Error('Not authorized — open EmailNanny and click Authorize first');
    }

    const results = [];
    for (const rule of enabledRules) {
        const query = `${rule.query} older_than:${rule.olderThan}`;
        try {
            const messages = await findMessages(token, query);
            const sample = await fetchSample(token, messages.map(m => m.id));
            results.push({ name: rule.name, query, count: messages.length, sample, error: null });
        } catch (err) {
            results.push({ name: rule.name, query, count: 0, sample: [], error: err.message });
        }
    }
    return results;
}
