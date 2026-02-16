# 🚀 DJ Music Discovery - Deployment Guide

## Current Status

**MVP is functional and ready for testing!** The core features are implemented:

✅ Search with autocomplete  
✅ Swipeable card interface  
✅ YouTube player integration  
✅ Vinyl stack sidebar  
✅ Local storage persistence  
✅ Dynamic stack growth on right swipe  
✅ Export liked tracks to YouTube playlist (OAuth)  
⚠️ Audio snippets (implemented but needs YouTube API permissions testing)

## Quick Start (Local Testing)

```bash
cd /home/ubuntu/dj-music-discovery
node server.js
```

Then visit `http://localhost:8080`

## Pre-build Checklist

**Before building or deploying, verify `.env` is not staged:**

```bash
git status
```

`.env` must **not** appear in the list of staged or untracked files. If it does:
1. Ensure `.env` is in `.gitignore`
2. Run `git reset HEAD .env` if it was staged
3. Do not commit `.env` — it contains secrets

Only proceed when `.env` is absent from `git status` output.

## Deployment Options

### Option 1: Simple Static Host (Recommended for MVP)

Since the app needs a backend proxy, you'll need a Node.js hosting service:

**Recommended platforms:**
1. **Railway** - Easiest, auto-detects Node.js
   - Connect GitHub repo
   - Auto-deploys on push
   - Free tier available

2. **Render** - Similar to Railway
   - Free tier with auto-sleep
   - Good for prototypes

3. **Fly.io** - More control
   - Global edge network
   - Free tier available

### Option 2: Vercel/Netlify + Serverless Functions

Convert the proxy to serverless functions:
- Create `/api/cosine.js` as a serverless function
- Deploy frontend to Vercel/Netlify
- API routes handled automatically

### Option 3: Docker Container

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

## Environment Variables

For **YouTube playlist export** (OAuth), set these in your hosting dashboard:

| Variable | Required | Description |
|----------|----------|-------------|
| `YOUTUBE_CLIENT_ID` | Yes (for export) | Google OAuth 2.0 Client ID |
| `YOUTUBE_CLIENT_SECRET` | Yes (for export) | Google OAuth 2.0 Client Secret |
| `REDIRECT_URI` | No | Defaults to `http://localhost:8080/api/auth/youtube/callback` locally. For production, set to `https://your-domain.com/api/auth/youtube/callback` |

**Production OAuth setup:**
1. Add your production redirect URI to [Google Cloud Console](https://console.cloud.google.com/) → Credentials → your OAuth client → Authorized redirect URIs
2. Add the exact URI, e.g. `https://your-app.railway.app/api/auth/youtube/callback`
3. Ensure YouTube Data API v3 is enabled for your project

Without these variables, the app runs but YouTube export will be disabled.

## File Structure

```
dj-music-discovery/
├── index.html          # Main HTML with React/Tailwind CDN
├── app.js              # React app with all game logic
├── server.js           # Node.js proxy server
├── README.md           # Feature documentation
├── PROGRESS.md         # Development progress
└── DEPLOYMENT.md       # This file
```

## Testing Checklist

Before deploying, test these flows:

- [ ] Search for a track
- [ ] Click a track from dropdown
- [ ] Card displays with track info
- [ ] Swipe left (should skip to next track)
- [ ] Swipe right (should add to liked tracks + fetch similar)
- [ ] Click vinyl icon to see liked tracks
- [ ] Click "Show Full Track" to play YouTube video
- [ ] Audio snippets play automatically (3x 5-second clips)
- [ ] Refresh page - liked tracks persist
- [ ] Export to YouTube: Vinyl Stack → Export → Sign in with Google → create playlist

## Known Limitations

1. **YouTube API Rate Limits** - If heavily used, may hit YouTube quota
2. **Audio Snippets** - Requires YouTube IFrame API permissions (may not work in all contexts)
3. **Mobile Touch** - Mouse drag works, but native touch gestures could be smoother
4. **No Backend Database** - Everything is client-side (localStorage)

## Future Enhancements

### Phase 2 (Post-MVP)
- [x] Export liked tracks to YouTube playlist
- [x] Keyboard shortcuts (arrow keys for swipe)
- [ ] Undo last swipe
- [ ] Better mobile touch gestures
- [ ] Loading states and error handling

### Phase 3 (Advanced)
- [ ] User accounts and cloud sync
- [ ] Share liked tracks with friends
- [ ] BPM/genre filtering
- [ ] Multiple seed tracks
- [ ] Analytics dashboard

## Troubleshooting

### "Failed to fetch" errors
- Check that server.js is running
- Verify proxy endpoint is accessible
- Check browser console for CORS errors

### Audio snippets not playing
- YouTube IFrame API may be blocked
- Check browser console for player errors
- Try clicking "Show Full Track" instead

### Swipe not working
- Ensure you're dragging the card (not clicking)
- Swipe threshold is 100px - drag further
- Check browser console for errors

## Support

For issues or questions:
1. Check browser console for errors
2. Review server logs: `tail -f /tmp/dj-server.log`
3. Test proxy directly: `curl http://localhost:8080/api/cosine/fragments/search-input?q=test`

## License

MIT - Use freely for personal or commercial projects!

---

**Built with:** React 18, Tailwind CSS, YouTube IFrame API, cosine.club API  
**Author:** Manus AI Agent  
**Date:** February 8, 2026
