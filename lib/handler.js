const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const {
    readTokenData,
    storeTokenData,
    sessionCookie,
    clearAuthCookies,
    deleteTokenData,
    cookieHeader
} = require('./tokens');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function getPort() {
    return Number(process.env.PORT) || 8080;
}

function getRedirectUri() {
    if (process.env.REDIRECT_URI) return process.env.REDIRECT_URI;
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/auth/youtube/callback`;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}/api/auth/youtube/callback`;
    }
    return `http://localhost:${getPort()}/api/auth/youtube/callback`;
}

function getOAuthCredentials() {
    return {
        clientId: process.env.YOUTUBE_CLIENT_ID || 'YOUR_CLIENT_ID_HERE',
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE'
    };
}

function getOAuthClient() {
    const { clientId, clientSecret } = getOAuthCredentials();
    return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
}

function parseRequestUrl(req) {
    const forwarded = req.headers && (req.headers['x-forwarded-uri'] || req.headers['x-invoke-path']);
    const raw = req.url || '/';
    const parsed = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
    const query = {};
    parsed.searchParams.forEach((value, key) => {
        query[key] = value;
    });
    if (req.query && typeof req.query === 'object') {
        Object.keys(req.query).forEach((key) => {
            const value = req.query[key];
            if (typeof value === 'string') query[key] = value;
        });
    }

    let pathname = parsed.pathname;
    let search = parsed.search;

    const rewrittenPath = query.__path;
    if (rewrittenPath) {
        pathname = '/api/' + decodeURIComponent(String(rewrittenPath)).replace(/^\/+/, '');
        delete query.__path;
        const params = new URLSearchParams(search);
        params.delete('__path');
        search = params.toString() ? '?' + params.toString() : '';
    } else if (
        (pathname === '/api' || pathname === '/api/' || pathname === '/api/index') &&
        typeof forwarded === 'string' &&
        forwarded.startsWith('/api/') &&
        !forwarded.startsWith('/api/index')
    ) {
        const original = forwarded.startsWith('http')
            ? new URL(forwarded)
            : new URL(forwarded, 'http://localhost');
        pathname = original.pathname;
        search = original.search;
        original.searchParams.forEach((value, key) => {
            query[key] = value;
        });
    }

    return {
        pathname,
        search,
        query
    };
}

function json(res, status, body, extraHeaders) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...(extraHeaders || {})
    };
    const cookies = headers['Set-Cookie'];
    delete headers['Set-Cookie'];
    if (cookies) {
        res.setHeader('Set-Cookie', cookies);
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
}

const COSINE_API_BASE = 'https://cosine.club/api/v1';
const COSINE_USER_AGENT = 'cosinder/1.0';

function getCosineApiKey() {
    return process.env.COSINE_API_KEY || '';
}

function cosineRateLimitHeaders(upstream) {
    const headers = {};
    ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'].forEach((name) => {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
    });
    return headers;
}

function cosineLimit(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(1, Math.floor(n)));
}

async function fetchCosineApi(apiPath, res) {
    const apiKey = getCosineApiKey();
    if (!apiKey) {
        json(res, 500, { error: 'Cosine API not configured. Set COSINE_API_KEY.' });
        return;
    }

    try {
        const upstream = await fetch(COSINE_API_BASE + apiPath, {
            headers: {
                Authorization: 'Bearer ' + apiKey,
                'User-Agent': COSINE_USER_AGENT,
                Accept: 'application/json'
            }
        });
        const extra = cosineRateLimitHeaders(upstream);
        const text = await upstream.text();
        let body;
        try {
            body = text ? JSON.parse(text) : {};
        } catch (parseError) {
            json(res, 502, { error: 'Invalid response from cosine.club' }, extra);
            return;
        }
        json(res, upstream.status, body, extra);
    } catch (error) {
        console.error('Cosine API error:', error.message);
        json(res, 502, { error: 'Failed to reach cosine.club API' });
    }
}

function getTokenAsync(code) {
    return new Promise((resolve, reject) => {
        getOAuthClient().getToken(code, (err, tokens) => {
            if (err) reject(err);
            else resolve(tokens);
        });
    });
}

function refreshAccessTokenAsync(oauth2Client) {
    return new Promise((resolve, reject) => {
        oauth2Client.refreshAccessToken((err, tokens) => {
            if (err) reject(err);
            else resolve(tokens);
        });
    });
}

async function handleApiRequest(req, res) {
    const { pathname, search, query } = parseRequestUrl(req);

    if (pathname === '/api/auth/youtube/init') {
        const { clientId, clientSecret } = getOAuthCredentials();
        if (clientId === 'YOUR_CLIENT_ID_HERE' || clientSecret === 'YOUR_CLIENT_SECRET_HERE') {
            json(res, 500, {
                error: 'YouTube OAuth not configured. Please set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables.'
            });
            return true;
        }

        const sessionId = generateSessionId();
        const scopes = ['https://www.googleapis.com/auth/youtube'];

        try {
            const authUrl = getOAuthClient().generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                state: sessionId,
                prompt: 'consent'
            });

            res.writeHead(302, {
                Location: authUrl,
                'Set-Cookie': cookieHeader(sessionCookie(sessionId))
            });
            res.end();
        } catch (error) {
            console.error('Error generating OAuth URL:', error);
            json(res, 500, { error: 'Failed to initialize OAuth' });
        }
        return true;
    }

    if (pathname === '/api/auth/youtube/callback') {
        const { code, state: sessionId } = query;

        if (!code || !sessionId) {
            res.writeHead(302, { Location: '/?youtube_auth=error' });
            res.end();
            return true;
        }

        try {
            const tokens = await getTokenAsync(code);
            const oauthCookie = storeTokenData(sessionId, {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiry: tokens.expiry_date || (Date.now() + 3600000)
            });

            res.writeHead(302, {
                Location: `/?youtube_auth=success&session=${sessionId}`,
                'Set-Cookie': cookieHeader([sessionCookie(sessionId), oauthCookie])
            });
            res.end();
        } catch (err) {
            console.error('OAuth token error:', err);
            res.writeHead(302, { Location: '/?youtube_auth=error' });
            res.end();
        }
        return true;
    }

    if (pathname === '/api/auth/youtube/token') {
        const sessionId = query.session;
        const tokenData = readTokenData(req, sessionId);

        if (!tokenData) {
            json(res, 401, { error: 'Session not found' });
            return true;
        }

        const sendToken = (data, setCookie) => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            if (setCookie) headers['Set-Cookie'] = cookieHeader(setCookie);
            json(res, 200, { access_token: data.accessToken }, headers);
        };

        if (Date.now() < tokenData.expiry) {
            sendToken(tokenData);
            return true;
        }

        if (!tokenData.refreshToken) {
            json(res, 401, { error: 'Token expired and no refresh token available' });
            return true;
        }

        try {
            const oauth2Client = getOAuthClient();
            oauth2Client.setCredentials({ refresh_token: tokenData.refreshToken });
            const tokens = await refreshAccessTokenAsync(oauth2Client);
            const updated = {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || tokenData.refreshToken,
                expiry: tokens.expiry_date || (Date.now() + 3600000)
            };
            const sid = tokenData.sessionId || sessionId;
            const oauthCookie = storeTokenData(sid, updated);
            sendToken(updated, oauthCookie);
        } catch (err) {
            console.error('Token refresh error:', err);
            json(res, 401, { error: 'Token refresh failed' });
        }
        return true;
    }

    if (pathname === '/api/auth/youtube/logout') {
        deleteTokenData(query.session);
        json(res, 200, { success: true }, {
            'Set-Cookie': cookieHeader(clearAuthCookies())
        });
        return true;
    }

    if (pathname === '/api/cosine/search') {
        const q = String(query.q || '').trim();
        if (q.length < 2) {
            json(res, 400, { error: 'Query must be at least 2 characters' });
            return true;
        }
        const limit = cosineLimit(query.limit, 10);
        await fetchCosineApi(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, res);
        return true;
    }

    const trackMatch = pathname.match(/^\/api\/cosine\/tracks\/([^/]+)$/);
    if (trackMatch) {
        const trackId = encodeURIComponent(trackMatch[1]);
        await fetchCosineApi(`/tracks/${trackId}`, res);
        return true;
    }

    const similarMatch = pathname.match(/^\/api\/cosine\/tracks\/([^/]+)\/similar$/);
    if (similarMatch) {
        const trackId = encodeURIComponent(similarMatch[1]);
        const limit = cosineLimit(query.limit, 20);
        await fetchCosineApi(`/tracks/${trackId}/similar?limit=${limit}`, res);
        return true;
    }

    if (pathname.startsWith('/api/cosine/')) {
        json(res, 404, { error: 'Unknown cosine endpoint' });
        return true;
    }

    return false;
}

function serveStatic(req, res, rootDir) {
    const { pathname } = parseRequestUrl(req);
    const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(rootDir, safePath);
    const resolvedRoot = path.resolve(rootDir);
    const resolvedFile = path.resolve(filePath);

    if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const extname = String(path.extname(resolvedFile)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(resolvedFile, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                console.error('File not found:', filePath);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                console.error('Server error:', error);
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

function createRequestHandler(rootDir) {
    const root = rootDir || path.join(__dirname, '..');
    return async (req, res) => {
        const handled = await handleApiRequest(req, res);
        if (!handled) serveStatic(req, res, root);
    };
}

module.exports = {
    handleApiRequest,
    createRequestHandler,
    getPort,
    getRedirectUri
};
