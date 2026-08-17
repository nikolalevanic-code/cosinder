require('dotenv').config();

const http = require('http');
const { createRequestHandler, getPort } = require('./lib/handler');

const PORT = getPort();
const server = http.createServer(createRequestHandler(__dirname));

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log('Cosine API: /api/cosine/search and /api/cosine/tracks/:id/similar');
    console.log('OAuth endpoints: /api/auth/youtube/*');
    if (!process.env.COSINE_API_KEY) {
        console.warn('WARNING: Cosine API not configured. Set COSINE_API_KEY.');
    }
    if (!process.env.YOUTUBE_CLIENT_ID) {
        console.warn('WARNING: YouTube OAuth not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables.');
    }
});
