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

    for (const rule of enabledRules) {
        try {
            const count = await processRule(token, rule, config.permanentDelete);
            totalDeleted += count;
        } catch (err) {
            if (err.message === 'TOKEN_EXPIRED') {
                await removeCachedToken(token);
                try {
                    token = await getAuthToken(false);
                    const count = await processRule(token, rule, config.permanentDelete);
                    totalDeleted += count;
                } catch (retryErr) {
                    errors.push(`${rule.name}: ${retryErr.message}`);
                }
            } else {
                errors.push(`${rule.name}: ${err.message}`);
            }
        }
    }

    const action = config.permanentDelete ? 'Permanently deleted' : 'Trashed';
    const status = errors.length > 0
        ? `${action} ${totalDeleted} emails. Errors: ${errors.join('; ')}`
        : `${action} ${totalDeleted} emails`;
    await setStatus(status);
}
