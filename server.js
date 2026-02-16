require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { google } = require('googleapis');

const PORT = 8080;

// OAuth Configuration
// Set these as environment variables or in a config file
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || 'YOUR_CLIENT_ID_HERE';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/api/auth/youtube/callback`;

// In-memory token storage (for MVP - use database in production)
const userTokens = new Map(); // sessionId -> { accessToken, refreshToken, expiry }

// OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI
);

// Generate session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// MIME types
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

// Proxy function to fetch from cosine.club
function proxyCosineClub(path, res) {
    const options = {
        hostname: 'cosine.club',
        port: 443,
        path: path,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        let data = '';

        proxyRes.on('data', (chunk) => {
            data += chunk;
        });

        proxyRes.on('end', () => {
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
        });
    });

    proxyReq.on('error', (error) => {
        console.error('Proxy error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + error.message);
    });

    proxyReq.end();
}

// Create server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Handle YouTube OAuth endpoints
    if (pathname === '/api/auth/youtube/init') {
        // Check if OAuth credentials are configured
        if (YOUTUBE_CLIENT_ID === 'YOUR_CLIENT_ID_HERE' || YOUTUBE_CLIENT_SECRET === 'YOUR_CLIENT_SECRET_HERE') {
            res.writeHead(500, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ 
                error: 'YouTube OAuth not configured. Please set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables.' 
            }));
            return;
        }
        
        const sessionId = generateSessionId();
        const scopes = ['https://www.googleapis.com/auth/youtube'];
        
        try {
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline', // Get refresh token
                scope: scopes,
                state: sessionId, // CSRF protection
                prompt: 'consent' // Force consent to get refresh token
            });
            
            // Store session ID in cookie
            res.writeHead(302, {
                'Location': authUrl,
                'Set-Cookie': `youtube_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`
            });
            res.end();
        } catch (error) {
            console.error('Error generating OAuth URL:', error);
            res.writeHead(500, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Failed to initialize OAuth' }));
        }
        return;
    }

    if (pathname === '/api/auth/youtube/callback') {
        const { code, state: sessionId } = parsedUrl.query;
        
        if (!code) {
            res.writeHead(302, { 'Location': '/?youtube_auth=error' });
            res.end();
            return;
        }
        
        // Exchange code for tokens
        oauth2Client.getToken(code, (err, tokens) => {
            if (err) {
                console.error('OAuth token error:', err);
                res.writeHead(302, { 'Location': '/?youtube_auth=error' });
                res.end();
                return;
            }
            
            // Store tokens with session ID
            userTokens.set(sessionId, {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiry: tokens.expiry_date || (Date.now() + 3600000)
            });
            
            // Redirect to frontend with session ID
            res.writeHead(302, {
                'Location': `/?youtube_auth=success&session=${sessionId}`
            });
            res.end();
        });
        return;
    }

    if (pathname === '/api/auth/youtube/token') {
        const { session: sessionId } = parsedUrl.query;
        const tokenData = userTokens.get(sessionId);
        
        if (!tokenData) {
            res.writeHead(401, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
        }
        
        // Check if token expired
        if (Date.now() >= tokenData.expiry) {
            // Check if we have a refresh token
            if (!tokenData.refreshToken) {
                res.writeHead(401, { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Token expired and no refresh token available' }));
                return;
            }
            
            // Refresh token
            oauth2Client.setCredentials({ refresh_token: tokenData.refreshToken });
            oauth2Client.refreshAccessToken((err, tokens) => {
                if (err) {
                    console.error('Token refresh error:', err);
                    res.writeHead(401, { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ error: 'Token refresh failed' }));
                    return;
                }
                
                // Update stored tokens
                tokenData.accessToken = tokens.access_token;
                tokenData.expiry = tokens.expiry_date || (Date.now() + 3600000);
                if (tokens.refresh_token) {
                    tokenData.refreshToken = tokens.refresh_token;
                }
                userTokens.set(sessionId, tokenData);
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ access_token: tokenData.accessToken }));
            });
        } else {
            // Token still valid
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ access_token: tokenData.accessToken }));
        }
        return;
    }

    if (pathname === '/api/auth/youtube/logout') {
        const { session: sessionId } = parsedUrl.query;
        if (sessionId) {
            userTokens.delete(sessionId);
        }
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Handle proxy requests
    if (pathname.startsWith('/api/cosine/')) {
        const cosinePath = pathname.replace('/api/cosine', '') + (parsedUrl.search || '');
        console.log('Proxying request to cosine.club:', cosinePath);
        proxyCosineClub(cosinePath, res);
        return;
    }

    // Serve static files
    let filePath = pathname === '/' ? './index.html' : path.join('.', pathname);

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
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
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log('Proxy endpoint: /api/cosine/*');
    console.log('OAuth endpoints: /api/auth/youtube/*');
    if (YOUTUBE_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
        console.warn('WARNING: YouTube OAuth not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables.');
    }
});
