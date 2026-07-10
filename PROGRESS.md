# DJ Music Discovery - Progress Report

_Last updated: July 10, 2026_

## ✅ Working Features (MVP Core)

### 1. Search & Autocomplete
- ✅ Search bar with cosine.club integration
- ✅ Autocomplete dropdown showing 10 results
- ✅ Proxy server handling CORS issues
- ✅ Track selection triggers game start
- ✅ Bottom search bar for switching seed track mid-session

### 2. Card Stack Interface
- ✅ Card displays track name and similarity
- ✅ "Show Full Track" button
- ✅ Drag-to-swipe (mouse and touch), 100px threshold
- ✅ Keyboard shortcuts (arrow keys to swipe, space to mute)
- ✅ Error boundary around the card (a bad card shows a Retry fallback instead of killing the app)

### 3. Audio Playback
- ✅ 3x 5-second snippets via YouTube IFrame API
- ✅ Desktop: dual-player crossfades; autoplay per card
- ✅ Mobile: per-card play button (autoplay policy), single player, seek-based snippet advance
- ✅ Mute/unmute; hold a snippet dot to keep playing
- ✅ Auto-skip genuinely unavailable videos (error 2/5/100/101/150 before playback starts); errors after playback starts are ignored (v4 fix)

### 4. Dynamic Stack Growth
- ✅ Right swipe fetches 100 similar tracks, dedupes seen tracks, shuffles into the stack

### 5. Persistence & Playlists
- ✅ Liked tracks persist in localStorage
- ✅ Vinyl stack sidebar with saved playlists
- ✅ Export to YouTube playlist (OAuth via server)

## 🐛 Fixed (July 2026)

- **iOS card crash on play tap** — YT.Player replaces its target div with an iframe; the divs were React-rendered, so any re-render threw Safari `NotFoundError` and unmounted the whole tree. Player targets are now created imperatively inside stable containers React never reconciles.
- **Silent mobile audio** — first play tap now unmutes the session (`onSessionGesture`); volume was previously always set to 0 on mobile.
- **False-positive auto-skips** — v4 fix (gate on `hasStartedPlaybackRef`) is now actually implemented.
- **Deck frozen** — leftover `FREEZE_DECK` diagnostic flag removed.

## 🚧 Not Implemented / Nice to Have

- Preloading/buffering for smoother snippet starts
- Undo last swipe
- Filter by BPM/year/genre
- Multiple seed tracks, session history
- Server hardening: proxy passes through upstream status, timeouts, OAuth state verification, token persistence

## 🔍 Debugging

A HARD DEBUG overlay (top-left, outside React) logs errors and key events, persists to localStorage, and can be hidden/shown for demos (preference persists).
