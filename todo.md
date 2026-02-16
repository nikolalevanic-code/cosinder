# DJ Music Discovery - Todo List

## User-Requested Fixes

- [x] Add keyboard shortcuts (left/right arrow keys for swiping) - WORKING
- [x] Fix audio snippets not playing (YouTube API troubleshooting) - WORKING
- [x] Add automatic skip for unavailable YouTube videos - IMPLEMENTED
- [x] Replace treble clef placeholder with dynamic track artwork (YouTube thumbnails) - WORKING

## Investigation Notes

### Audio Snippets Issue
- YouTube API is loaded (`YT` and `YT.Player` are defined)
- `youtubeAPIReady` flag is `false` - the callback may not be firing
- `onYouTubeIframeAPIReady` function exists but might not be executing
- Need to check player initialization and autoplay policies

### Potential Causes
1. Global callback not firing properly (scope issue)
2. YouTube API loading after React renders
3. Browser autoplay restrictions
4. Player initialization timing issue

### Solution Approach
1. Move YouTube API initialization into React lifecycle
2. Add console logging to track player state
3. Handle autoplay restrictions with user interaction
4. Add visual feedback for audio playback status

## New Issues

- [x] Investigate false positive auto-skips (2 tracks with audio were skipped) - FIXED
  - Root cause: Error 150 thrown mid-playback (false positive)
  - Solution: Only auto-skip on errors 100, 101, or 150 before playback starts
  - Now ignores error 150 if snippets have already started playing

## New Features

- [x] Add persistent search box at bottom of page with autocomplete dropdown - WORKING

## Bug Fixes

- [x] Fix bottom search box positioning (change from fixed to static) - FIXED
