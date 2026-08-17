# 🎧 DJ Music Discovery Game

A Tinder-style music discovery tool for DJs, powered by [cosine.club](https://cosine.club)'s deep learning similarity search engine.

## Features

✅ **Smart Search** - Search 1.9M tracks with autocomplete  
✅ **Swipeable Cards** - Tinder-style interface for quick decisions  
✅ **Audio Previews** - 3x 5-second snippets from each track  
✅ **Dynamic Discovery** - Swiping right fetches similar tracks and shuffles them into the stack  
✅ **Vinyl Stack** - Beautiful sidebar showing your liked tracks  
✅ **YouTube Integration** - Full track playback on demand  
✅ **Local Persistence** - Your likes are saved in browser storage  

## How to Use

### 1. Run Locally

```bash
cd dj-music-discovery
node server.js
```

Then open `http://localhost:8080` in your browser. The Node server calls the official cosine.club API with `COSINE_API_KEY`.

### 2. Start Discovering

1. **Search** for a track you like (e.g., "Daft Punk - One More Time")
2. **Swipe right** (❤️) if you like it, **left** (✖️) to skip
3. Each right swipe fetches similar tracks and adds them to your stack
4. Click the 💿 icon to see your liked tracks
5. Click "Show Full Track" to hear the complete song on YouTube

### 3. Deploy

This app needs a backend for the cosine.club API and YouTube OAuth. On **Vercel**, `/api` serverless functions handle that (see `DEPLOYMENT.md`). Static-only hosts (GitHub Pages) will not work.

Set `COSINE_API_KEY` (from [cosine.club/account/api](https://cosine.club/account/api)) plus `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` for export. Before building, see `DEPLOYMENT.md` for the pre-build checklist (including verifying `.env` is not staged).

## Technical Details

### Stack
- **Frontend**: React 18 (via CDN)
- **Styling**: Tailwind CSS (via CDN)
- **API**: cosine.club official API (`/api/v1`)
- **Audio**: YouTube IFrame API

### How It Works

1. **Search**: `GET /api/v1/search` via Cosinder’s server (Bearer key stays server-side)
2. **Fetch Similar**: `GET /api/v1/tracks/{id}/similar` (includes YouTube `video_id`)
3. **Shuffle**: Mixes new tracks into the stack to keep it interesting
4. **Persist**: Saves liked tracks to `localStorage`

### File Structure

```
dj-music-discovery/
├── index.html    # Main HTML with CDN links
├── app.js        # React app with all game logic
├── server.js     # Local Node server
├── lib/          # Shared Cosine API + OAuth handler
├── api/          # Vercel serverless entry
├── package.json  # Dependencies (googleapis, dotenv)
├── .env.example  # Template for OAuth credentials
└── README.md     # This file
```

## Roadmap

### MVP (Current)
- [x] Search with autocomplete
- [x] Swipeable card interface
- [x] YouTube player integration
- [x] Vinyl stack sidebar
- [x] Local storage persistence
- [x] 3x 5-second audio snippets (fades TBD)
- [ ] Preloading/buffering for smooth playback

### Future Enhancements
- [x] Keyboard shortcuts (arrow keys)
- [x] Export liked tracks to YouTube playlist
- [ ] Undo last swipe
- [ ] Filter by BPM/year/genre
- [ ] Multiple seed tracks
- [ ] Session history
- [ ] Mobile-optimized touch gestures

## Credits

- **Music Data**: [cosine.club](https://cosine.club) - Electronic music similarity search engine
- **Concept**: Inspired by DJ crate digging and Tinder's swipe mechanics

## License

MIT - Feel free to use, modify, and distribute!

## Development Notes

This project follows Vibe Coding rules.  
See `CURSOR_RULES.md` for execution constraints.

## Planning Context

This README (Features, Roadmap, and Technical Details) is the canonical plan for:
- project intent
- success criteria
- scope and constraints

When making changes, defer to this plan and ask if intent is unclear.

---

**Note**: Cosinder uses cosine.club’s official API with a server-side key, `User-Agent: cosinder/1.0`, and 429 backoff. Do not put `COSINE_API_KEY` in the browser or in git.
