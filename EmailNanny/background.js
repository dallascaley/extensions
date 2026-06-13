const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const ALARM_NAME = 'emailNannyCheck';
const CLIENT_ID = '155241565760-rt66cdmjemmkijdobdnbah0qtp6m3gnk.apps.googleusercontent.com';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_EXCHANGE_ENDPOINT = 'https://www.prosaurus.com/api/emailnanny/token';
const TOKEN_REFRESH_ENDPOINT = 'https://www.prosaurus.com/api/emailnanny/refresh';

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
    if (msg.action === 'checkAuth') {
        getStoredTokens().then(tokens => sendResponse({ authorized: !!(tokens && tokens.refreshToken) }));
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

function base64URLEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64URLEncode(array);
}

async function generateCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64URLEncode(digest);
}

function getStoredTokens() {
    return new Promise(resolve => chrome.storage.local.get({ oauthTokens: null }, d => resolve(d.oauthTokens)));
}

function storeTokens(tokens) {
    return new Promise(resolve => chrome.storage.local.set({ oauthTokens: tokens }, resolve));
}

async function launchOAuthFlow() {
    const codeVerifier = await generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;

    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://mail.google.com/');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const redirectUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, url => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(url);
        });
    });

    const code = new URL(redirectUrl).searchParams.get('code');
    if (!code) throw new Error('No authorization code received');

    const res = await fetch(TOKEN_EXCHANGE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri, code_verifier: codeVerifier })
    });

    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);

    const data = await res.json();
    await storeTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in * 1000)
    });
    return data.access_token;
}

async function getAuthToken(interactive = false) {
    const stored = await getStoredTokens();

    if (stored && stored.expiresAt > Date.now() + 300000) {
        return stored.accessToken;
    }

    if (stored && stored.refreshToken) {
        try {
            const res = await fetch(TOKEN_REFRESH_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: stored.refreshToken })
            });
            if (res.ok) {
                const data = await res.json();
                await storeTokens({ ...stored, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) });
                return data.access_token;
            }
        } catch { /* fall through */ }
    }

    if (!interactive) throw new Error('Not authorized');
    return launchOAuthFlow();
}

async function removeCachedToken(token) {
    const stored = await getStoredTokens();
    if (stored) await storeTokens({ ...stored, expiresAt: 0 });
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

async function deleteMessages(token, messageIds, permanent) {
    const BATCH_SIZE = 1000;
    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
        const ids = messageIds.slice(i, i + BATCH_SIZE);
        if (permanent) {
            await gmailRequest(token, '/messages/batchDelete', 'POST', { ids });
        } else {
            await gmailRequest(token, '/messages/batchModify', 'POST', { ids, addLabelIds: ['TRASH'] });
        }
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
    await deleteMessages(token, messages.map(m => m.id), permanent);
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
