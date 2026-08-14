const crypto = require('crypto');

const OAUTH_COOKIE = 'youtube_oauth';
const SESSION_COOKIE = 'youtube_session';
const memoryTokens = new Map();

function cookieSecret() {
    return process.env.SESSION_SECRET || process.env.YOUTUBE_CLIENT_SECRET || 'dev-insecure-secret';
}

function cookieFlags() {
    const secure = process.env.VERCEL ? '; Secure' : '';
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        try {
            out[key] = decodeURIComponent(value);
        } catch (e) {
            out[key] = value;
        }
    });
    return out;
}

function encrypt(data) {
    const key = crypto.createHash('sha256').update(cookieSecret()).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encoded = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encoded]).toString('base64url');
}

function decrypt(payload) {
    const buf = Buffer.from(payload, 'base64url');
    if (buf.length < 29) return null;
    const key = crypto.createHash('sha256').update(cookieSecret()).digest();
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encoded = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(encoded), decipher.final()]).toString('utf8');
    return JSON.parse(json);
}

function readTokenData(req, sessionId) {
    if (sessionId && memoryTokens.has(sessionId)) {
        return memoryTokens.get(sessionId);
    }
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[OAUTH_COOKIE]) {
        try {
            const data = decrypt(cookies[OAUTH_COOKIE]);
            if (data && data.accessToken) {
                if (sessionId && data.sessionId && data.sessionId !== sessionId) {
                    return null;
                }
                if (data.sessionId) memoryTokens.set(data.sessionId, data);
                return data;
            }
        } catch (e) {
            console.error('OAuth cookie decrypt failed:', e.message);
        }
    }
    return null;
}

function storeTokenData(sessionId, tokenData) {
    const data = { ...tokenData, sessionId };
    memoryTokens.set(sessionId, data);
    return `${OAUTH_COOKIE}=${encrypt(data)}; ${cookieFlags()}`;
}

function sessionCookie(sessionId) {
    return `${SESSION_COOKIE}=${sessionId}; ${cookieFlags()}`;
}

function clearAuthCookies() {
    const expired = 'HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
    const secure = process.env.VERCEL ? '; Secure' : '';
    return [
        `${OAUTH_COOKIE}=; ${expired}${secure}`,
        `${SESSION_COOKIE}=; ${expired}${secure}`
    ];
}

function deleteTokenData(sessionId) {
    if (sessionId) memoryTokens.delete(sessionId);
}

function cookieHeader(cookies) {
    return Array.isArray(cookies) ? cookies : [cookies];
}

module.exports = {
    readTokenData,
    storeTokenData,
    sessionCookie,
    clearAuthCookies,
    deleteTokenData,
    cookieHeader
};
