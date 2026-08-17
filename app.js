const { useState, useEffect, useRef } = React;

const trackDisplayName = (track) =>
    track.name || [track.artist, track.track].filter(Boolean).join(' - ') || 'Unknown Track';

const mapSearchTrack = (track) => {
    if (!track || track.id == null) return null;
    return {
        id: String(track.id),
        name: trackDisplayName(track)
    };
};

const mapSimilarTrack = (track) => {
    if (!track || track.id == null || !track.video_id) return null;
    const score = typeof track.score === 'number'
        ? `${Math.round(track.score * 100)}%`
        : 'N/A';
    return {
        id: String(track.id),
        videoId: track.video_id,
        name: trackDisplayName(track),
        similarity: score,
        thumbnail: `https://img.youtube.com/vi/${track.video_id}/mqdefault.jpg`
    };
};

const cosineJson = async (url) => {
    const requestOnce = async () => {
        const response = await fetch(url);
        const retryAfter = Number(response.headers.get('Retry-After'));
        const body = await response.json().catch(() => ({}));
        return { response, retryAfter, body };
    };

    let { response, retryAfter, body } = await requestOnce();
    if (response.status === 429) {
        const waitMs = Math.min(60000, Math.max(1000, (retryAfter || 1) * 1000));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        ({ response, retryAfter, body } = await requestOnce());
    }

    if (!response.ok) {
        throw new Error(body.message || body.error || `Cosine request failed (${response.status})`);
    }
    return body;
};

// Utility: Shuffle array
const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Search Component
function SearchBar({ onTrackSelect, placeholder }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const timeoutRef = useRef(null);
    
    const searchTracks = async (searchQuery) => {
        const q = searchQuery.trim();
        if (q.length < 2) {
            setResults([]);
            return;
        }
        
        setLoading(true);
        try {
            const body = await cosineJson(
                `/api/cosine/search?q=${encodeURIComponent(q)}&limit=10`
            );
            const tracks = (body.data || []).map(mapSearchTrack).filter(Boolean);
            setResults(tracks.slice(0, 10));
            setShowDropdown(true);
        } catch (error) {
            console.error('Search error:', error);
            setResults([]);
        } finally {
            setLoading(false);
        }
    };
    
    const handleInputChange = (e) => {
        const value = e.target.value;
        setQuery(value);
        
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        
        timeoutRef.current = setTimeout(() => {
            searchTracks(value);
        }, 300);
    };
    
    const handleSelect = (track) => {
        setQuery(track.name);
        setShowDropdown(false);
        onTrackSelect(track);
    };
    
    return (
        <div className="relative w-full max-w-2xl">
            <input
                type="text"
                value={query}
                onChange={handleInputChange}
                onFocus={() => results.length > 0 && setShowDropdown(true)}
                placeholder={placeholder || 'search for a track to start discovering'}
                className="w-full px-6 py-4 text-lg rounded-2xl bg-white border border-[#d4c8d0] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#e8d4db] focus:border-[#e8d4db] text-[#3d3a42]"
            />
            
            {loading && (
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                    <div className="loading-spinner"></div>
                </div>
            )}
            
            {showDropdown && results.length > 0 && (
                <div className="absolute w-full mt-2 bg-white rounded-2xl shadow-lg border border-[#d4c8d0] autocomplete-dropdown z-50">
                    {results.map((track, idx) => (
                        <button
                            key={`${track.id}-${idx}`}
                            onClick={() => handleSelect(track)}
                            className="w-full px-6 py-3 text-left hover:bg-[#f5e6ed] transition-colors first:rounded-t-2xl last:rounded-b-2xl text-[#3d3a42]"
                        >
                            <div className="font-medium">{track.name}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Helper: linear volume fade over duration (ms)
function fadeVolume(player, fromVol, toVol, durationMs, onDone) {
    if (!player || !player.setVolume) return;
    const steps = 20;
    const stepMs = durationMs / steps;
    const stepDelta = (toVol - fromVol) / steps;
    let step = 0;
    const interval = setInterval(() => {
        step++;
        const vol = Math.round(Math.min(100, Math.max(0, fromVol + stepDelta * step)));
        try { player.setVolume(vol); } catch (e) {}
        if (step >= steps) {
            clearInterval(interval);
            if (onDone) onDone();
        }
    }, stepMs);
    return () => clearInterval(interval);
}

// Audio Snippet Player Component
function AudioSnippetPlayer({
    videoId,
    onComplete,
    onError,
    autoPlay = true,
    isMuted,
    onMuteToggle,
    onSessionGesture,
    persistent = false,
    sessionAudioEnabled = false,
    controllerRef
}) {
    const playerARef = useRef(null);
    const playerBRef = useRef(null);
    // Stable React-rendered containers. The divs that YT.Player REPLACES with
    // iframes are created imperatively inside these, because React must never
    // reconcile a node the YouTube API has swapped out (causes Safari
    // NotFoundError "The object can not be found here." -> tree unmount).
    const containerARef = useRef(null);
    const containerBRef = useRef(null);
    const [currentSnippet, setCurrentSnippet] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playerReady, setPlayerReady] = useState(false);
    const [hasAudioEnabled, setHasAudioEnabled] = useState(!IS_MOBILE); // false on mobile (needs gesture), true on desktop (autoplay works)
    const hasAudioEnabledRef = useRef(!IS_MOBILE);
    const [holdingDot, setHoldingDot] = useState(null);
    const holdingDotRef = useRef(null);
    const snippetTimerRef = useRef(null);
    const fadeIntervalRef = useRef(null);
    const hasPlayedRef = useRef(false);
    const hasStartedPlaybackRef = useRef(false);
    const positionsRef = useRef([]);
    const activePlayerRef = useRef('A');
    const playersReadyRef = useRef(0);
    const advanceRef = useRef(null);
    const jumpToSnippetRef = useRef(null);
    const isInitialPlaybackSetupRef = useRef(false); // Guard to prevent useEffect setVolume during initial playback
    const isMutedRef = useRef(false);
    const pressedDotRef = useRef(null);
    const pressStartRef = useRef(0);
    const playButtonHandledRef = useRef(false);
    const seekTimeoutRef = useRef(null);
    const loadedVideoIdRef = useRef(null);
    const pendingAutoplayRef = useRef(false);
    // Bumped on every track change so in-flight playSnippets / advances abort
    const playGenerationRef = useRef(0);

    isMutedRef.current = isMuted ?? false;
    hasAudioEnabledRef.current = hasAudioEnabled;

    const getPlayer = (which) => which === 'A' ? playerARef.current : playerBRef.current;

    const clearSnippetTimers = () => {
        if (snippetTimerRef.current) clearTimeout(snippetTimerRef.current);
        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        if (fadeIntervalRef.current && typeof fadeIntervalRef.current === 'function') fadeIntervalRef.current();
        snippetTimerRef.current = null;
        seekTimeoutRef.current = null;
        fadeIntervalRef.current = null;
    };

    const stopAllPlayers = () => {
        [playerARef.current, playerBRef.current].forEach(p => {
            if (!p) return;
            try { p.pauseVideo?.(); } catch (e) {}
            try { p.stopVideo?.(); } catch (e) {}
        });
        activePlayerRef.current = 'A';
    };

    // Keep both A/B on the same videoId so desktop crossfades never play a previous track
    const loadVideoOnPlayers = (id) => {
        stopAllPlayers();
        const pa = playerARef.current;
        if (pa && typeof pa.loadVideoById === 'function') {
            pa.loadVideoById(id);
        }
        const pb = playerBRef.current;
        if (pb && typeof pb.loadVideoById === 'function') {
            pb.loadVideoById(id);
            // B is only used for crossfades — keep it cued/paused until advance()
            try { pb.pauseVideo?.(); } catch (e) {}
        }
        activePlayerRef.current = 'A';
    };

    const resetSnippetStateForNewTrack = () => {
        playGenerationRef.current += 1;
        hasPlayedRef.current = false;
        hasStartedPlaybackRef.current = false;
        setCurrentSnippet(0);
        setIsPlaying(false);
        setHoldingDot(null);
        isInitialPlaybackSetupRef.current = false;
        clearSnippetTimers();
        advanceRef.current = null;
        jumpToSnippetRef.current = null;
    };

    // Keep mobile session unlock in sync when using a persistent player
    useEffect(() => {
        if (!persistent || !IS_MOBILE) return;
        if (sessionAudioEnabled) {
            hasAudioEnabledRef.current = true;
            setHasAudioEnabled(true);
        }
    }, [sessionAudioEnabled, persistent]);

    useEffect(() => {
        if (!videoId) return;

        // Skip if beginTrack() already loaded this video (e.g. from swipe gesture)
        if (persistent && loadedVideoIdRef.current === videoId) return;
        loadedVideoIdRef.current = videoId;

        resetSnippetStateForNewTrack();

        if (persistent) {
            if (IS_MOBILE) {
                hasAudioEnabledRef.current = sessionAudioEnabled || hasAudioEnabledRef.current;
                setHasAudioEnabled(hasAudioEnabledRef.current);
            }
        } else {
            const initialAudioEnabled = !IS_MOBILE;
            setHasAudioEnabled(initialAudioEnabled);
            hasAudioEnabledRef.current = initialAudioEnabled;
            playersReadyRef.current = 0;
            setPlayerReady(false);
        }

        const initPlayer = () => {
            if (typeof YT === 'undefined' || !YT.Player) {
                setTimeout(initPlayer, 100);
                return;
            }

            const canAutoplay = () => IS_MOBILE ? hasAudioEnabledRef.current : true;

            const maybeAutoplay = () => {
                if (autoPlay && !hasPlayedRef.current && canAutoplay()) {
                    hasPlayedRef.current = true;
                    playSnippets();
                }
            };

            // Reuse existing iframes — load BOTH A and B so desktop crossfades
            // never fall back to a previous track still cued on player B
            if (persistent && playerARef.current && typeof playerARef.current.loadVideoById === 'function') {
                try {
                    loadVideoOnPlayers(videoId);
                    setPlayerReady(true);
                    playersReadyRef.current = IS_MOBILE ? 1 : 2;
                    pendingAutoplayRef.current = autoPlay && canAutoplay();
                    if (pendingAutoplayRef.current) maybeAutoplay();
                } catch (e) {
                    console.error('[snippets] loadVideoById error:', e);
                }
                return;
            }

            const makeOnReady = () => {
                return () => {
                    setPlayerReady(true);
                    playersReadyRef.current = (playersReadyRef.current || 0) + 1;
                    const needed = IS_MOBILE ? 1 : 2;
                    // On mobile, wait for user gesture (hasAudioEnabledRef) before autoplaying
                    const canAutoplay = IS_MOBILE ? hasAudioEnabledRef.current : true;
                    if (playersReadyRef.current >= needed && autoPlay && !hasPlayedRef.current && canAutoplay) {
                        hasPlayedRef.current = true;
                        playSnippets();
                    }
                };
            };
            const size = IS_MOBILE ? 250 : 1;
            const opts = {
                height: String(size), width: String(size), videoId,
                playerVars: { autoplay: 0, controls: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1, origin: window.location.origin, fs: 0 },
                events: {
                    onReady: makeOnReady(),
                    onStateChange: (ev) => {
                        if (ev.data === YT.PlayerState.PLAYING) {
                            console.log('[snippets] onStateChange: PLAYING');
                            setIsPlaying(true);
                            hasStartedPlaybackRef.current = true;
                        } else if (ev.data === YT.PlayerState.PAUSED || ev.data === YT.PlayerState.ENDED) {
                            setIsPlaying(false);
                        } else if (
                            pendingAutoplayRef.current &&
                            (ev.data === YT.PlayerState.CUED || ev.data === YT.PlayerState.PAUSED)
                        ) {
                            pendingAutoplayRef.current = false;
                            if (autoPlay && canAutoplay() && !hasPlayedRef.current) {
                                hasPlayedRef.current = true;
                                playSnippets();
                            }
                        }
                    },
                    onError: (ev) => {
                        const code = ev.data;
                        // Once playback has started, errors are false positives
                        // (e.g. error 150 firing mid-play on iOS) - never
                        // auto-skip a card the user is actively listening to.
                        if (hasStartedPlaybackRef.current) {
                            return;
                        }
                        // 2: invalid ID, 5: HTML5 player error, 100: not found,
                        // 101/150: embedding not allowed
                        const critical = [2, 5, 100, 101, 150].includes(code);
                        if (critical && onError) {
                            onError(code);
                            return;
                        }
                        onComplete();
                    }
                }
            };
            // Create the target divs imperatively inside the stable React
            // containers. YT.Player replaces these divs with iframes; since
            // React renders the containers empty, it never reconciles the
            // replaced nodes.
            const makeTarget = (container) => {
                if (!container) return null;
                container.innerHTML = '';
                const target = document.createElement('div');
                container.appendChild(target);
                return target;
            };
            try {
                const targetA = makeTarget(containerARef.current);
                if (!targetA) {
                    onComplete();
                    return;
                }
                playerARef.current = new YT.Player(targetA, opts);
                if (!IS_MOBILE) {
                    const targetB = makeTarget(containerBRef.current);
                    if (targetB) {
                        const optsB = { ...opts, events: { ...opts.events, onReady: makeOnReady() } };
                        playerBRef.current = new YT.Player(targetB, optsB);
                    }
                }
            } catch (e) {
                console.error('[snippets] Error creating players:', e);
                onComplete();
            }
        };
        initPlayer();

        return () => {
            if (persistent) {
                clearSnippetTimers();
                return;
            }
            clearSnippetTimers();
            [playerARef.current, playerBRef.current].forEach(p => {
                if (p && p.destroy) try { p.destroy(); } catch (e) {}
            });
            playerARef.current = null;
            playerBRef.current = null;
            [containerARef.current, containerBRef.current].forEach(c => {
                if (c) try { c.innerHTML = ''; } catch (e) {}
            });
        };
    }, [videoId, persistent, sessionAudioEnabled]);

    const playSnippets = async () => {
        const generation = playGenerationRef.current;
        const pa = playerARef.current;
        if (!pa || !pa.getDuration) return;
        const duration = await new Promise((resolve) => {
            const start = Date.now();
            const timeoutMs = IS_MOBILE ? 15000 : 10000;
            const check = () => {
                if (playGenerationRef.current !== generation) {
                    resolve(0);
                    return;
                }
                const d = pa.getDuration();
                if (d && d > 0) resolve(d);
                else if (Date.now() - start > timeoutMs) resolve(0);
                else setTimeout(check, 100);
            };
            check();
        });
        if (playGenerationRef.current !== generation) return;
        if (!duration || duration < 30) {
            onComplete();
            return;
        }
        const positions = [
            Math.floor(Math.random() * 10) + 5,
            Math.floor(duration / 2) + Math.floor(Math.random() * 10) - 5,
            Math.max(duration - 20 - Math.floor(Math.random() * 10), 15)
        ];
        positionsRef.current = positions;
        activePlayerRef.current = 'A';
        if (typeof pa.playVideo !== 'function' || typeof pa.seekTo !== 'function' || typeof pa.setVolume !== 'function') return;

        if (IS_MOBILE) {
            // iOS-safe call order: playVideo first (inside the user gesture if
            // possible), then seekTo + setVolume after a short delay.
            const currentPa = playerARef.current;
            if (!currentPa || currentPa !== pa) return; // player replaced during async wait
            if (playGenerationRef.current !== generation) return;
            if (!hasPlayedRef.current) {
                try {
                    currentPa.playVideo();
                    hasPlayedRef.current = true;
                } catch (e) {
                    console.error('[snippets] playVideo error:', e);
                    return;
                }
            }
            if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
            seekTimeoutRef.current = setTimeout(() => {
                seekTimeoutRef.current = null;
                if (playGenerationRef.current !== generation) return;
                const p = playerARef.current;
                if (!p) {
                    isInitialPlaybackSetupRef.current = false;
                    return;
                }
                try {
                    p.seekTo(positions[0], true);
                } catch (e) {
                    console.error('[snippets] seekTo error:', e);
                }
                try {
                    p.setVolume(isMutedRef.current ? 0 : 100);
                } catch (e) {
                    console.error('[snippets] setVolume error:', e);
                }
                // Initial setup done - the isMuted useEffect may manage volume from here on
                isInitialPlaybackSetupRef.current = false;
            }, 150);
        } else {
            if (playGenerationRef.current !== generation) return;
            // Desktop: seek and set volume up front, then play
            try {
                pa.seekTo(positions[0], true);
            } catch (e) {
                console.error('[snippets] seekTo error:', e);
            }
            try {
                pa.setVolume(isMutedRef.current ? 0 : 100);
            } catch (e) {
                console.error('[snippets] setVolume error:', e);
            }
            try {
                pa.playVideo();
            } catch (e) {
                console.error('[snippets] playVideo error:', e);
            }
        }
        if (playGenerationRef.current !== generation) return;
        setCurrentSnippet(0);

        const SNIPPET_FADE_MS = 500;
        const LOOP_FADE_MS = 1000;

        const advance = (index) => {
            if (playGenerationRef.current !== generation) return;
            if (snippetTimerRef.current) {
                clearTimeout(snippetTimerRef.current);
                snippetTimerRef.current = null;
            }
            const nextIndex = (index + 1) % 3;
            const pos = positions[nextIndex];
            const curr = activePlayerRef.current;
            const pCurr = getPlayer(curr);
            const targetVol = isMutedRef.current ? 0 : 100;

            if (IS_MOBILE) {
                try {
                    pCurr.seekTo(pos, true);
                    pCurr.setVolume(targetVol);
                } catch (e) {
                    console.error('[snippets] advance playVideo error:', e);
                }
                setCurrentSnippet(nextIndex);
                scheduleAdvance(nextIndex);
            } else {
                const isLoopBack = (index === 2 && nextIndex === 0);
                const fadeMs = isLoopBack ? LOOP_FADE_MS : SNIPPET_FADE_MS;
                const next = curr === 'A' ? 'B' : 'A';
                const pNext = getPlayer(next);
                if (fadeIntervalRef.current) fadeIntervalRef.current();
                fadeIntervalRef.current = fadeVolume(pCurr, isMutedRef.current ? 0 : 100, 0, fadeMs, () => {
                    if (playGenerationRef.current !== generation) return;
                    try { pCurr.pauseVideo(); } catch (e) {}
                    const useNext = pNext && pNext.seekTo;
                    const targetPlayer = useNext ? pNext : pCurr;
                    try {
                        targetPlayer.seekTo(pos, true);
                        if (useNext) {
                            targetPlayer.setVolume(0);
                            activePlayerRef.current = next;
                            fadeIntervalRef.current = fadeVolume(targetPlayer, 0, targetVol, fadeMs, () => {});
                        } else {
                            targetPlayer.setVolume(targetVol);
                            activePlayerRef.current = curr;
                            fadeIntervalRef.current = null;
                        }
                        targetPlayer.playVideo();
                    } catch (e) {
                        console.error('[snippets] advance playVideo error:', e);
                    }
                    setCurrentSnippet(nextIndex);
                    if (!useNext) fadeIntervalRef.current = null;
                    scheduleAdvance(nextIndex);
                });
            }
        };

        advanceRef.current = advance;

        const scheduleAdvance = (idx) => {
            if (playGenerationRef.current !== generation) return;
            snippetTimerRef.current = setTimeout(() => {
                if (playGenerationRef.current !== generation) return;
                if (holdingDotRef.current === idx) {
                    // Don't seek or reschedule - let playback continue indefinitely while held
                } else {
                    advance(idx);
                }
            }, 5000);
        };

        const jumpToSnippet = (idx) => {
            if (playGenerationRef.current !== generation) return;
            const positions = positionsRef.current;
            if (!positions || positions.length < 3) return;
            if (snippetTimerRef.current) {
                clearTimeout(snippetTimerRef.current);
                snippetTimerRef.current = null;
            }
            const curr = activePlayerRef.current;
            const pCurr = getPlayer(curr);
            const targetVol = isMutedRef.current ? 0 : 100;
            const pos = positions[idx];
            try {
                if (IS_MOBILE) {
                    pCurr.pauseVideo();
                    pCurr.seekTo(pos, true);
                    pCurr.setVolume(targetVol);
                    pCurr.playVideo();
                } else {
                    if (fadeIntervalRef.current) fadeIntervalRef.current();
                    pCurr.pauseVideo();
                    pCurr.seekTo(pos, true);
                    pCurr.setVolume(targetVol);
                    pCurr.playVideo();
                }
                setCurrentSnippet(idx);
                scheduleAdvance(idx);
            } catch (e) {
                console.error('[snippets] jumpToSnippet error:', e);
            }
        };

        jumpToSnippetRef.current = jumpToSnippet;

        scheduleAdvance(0);
    };

    const handleDotPointerDown = (i) => {
        pressedDotRef.current = i;
        pressStartRef.current = Date.now();
        if (i === currentSnippet && isPlaying) {
            holdingDotRef.current = i;
            setHoldingDot(i);
        }
    };
    const handleDotPointerUp = () => {
        const wasHolding = holdingDotRef.current;
        const pressDuration = Date.now() - pressStartRef.current;
        pressedDotRef.current = null;
        holdingDotRef.current = null;
        setHoldingDot(null);
        if (wasHolding !== null && pressDuration >= 400 && advanceRef.current) {
            advanceRef.current(wasHolding);
        }
    };
    const handleDotPointerLeave = () => {
        holdingDotRef.current = null;
        setHoldingDot(null);
    };

    useEffect(() => {
        if (isMuted === undefined) return;
        // Skip during initial playback setup - playSnippets sets the volume
        // itself once the player is ready
        if (isInitialPlaybackSetupRef.current) return;
        const p = getPlayer(activePlayerRef.current);
        if (p && p.setVolume) {
            try {
                p.setVolume(isMuted ? 0 : 100);
            } catch (e) {
                console.error('[useEffect] setVolume error:', e);
            }
        }
    }, [isMuted, currentSnippet, playerReady]);

    // Shared handler for play button (works for both touch and click)
    const handlePlayButtonClick = (e, source) => {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent?.stopImmediatePropagation?.();
        
        // Prevent double-firing (touchend + click both fire for one tap)
        if (playButtonHandledRef.current) return;
        playButtonHandledRef.current = true;
        setTimeout(() => { playButtonHandledRef.current = false; }, 300);
        
        // Call playVideo via RAF: gives the iframe a beat to settle while
        // staying within the user-gesture window iOS requires
        if (playerReady) {
            const pa = playerARef.current;
            if (pa && typeof pa.playVideo === 'function') {
                requestAnimationFrame(() => {
                    try {
                        pa.playVideo();
                        hasPlayedRef.current = true;
                    } catch (e) {
                        console.error('[play button] deferred playVideo error:', e);
                    }
                });
            }
        }
        
        const wasAudioDisabled = !hasAudioEnabledRef.current;
        hasAudioEnabledRef.current = true;
        requestAnimationFrame(() => setHasAudioEnabled(true));
        
        if (wasAudioDisabled) {
            // First tap: unmute at the App level (session gesture) so the
            // deferred setVolume in playSnippets targets 100, not 0
            isInitialPlaybackSetupRef.current = true;
            if (onSessionGesture) onSessionGesture();
        } else if (isMuted && onMuteToggle) {
            onMuteToggle();
        }
        
        // playSnippets handles seek/volume after React state flush
        if (playerReady) {
            requestAnimationFrame(() => {
                playSnippets();
            });
        }
    };

    // Called synchronously from swipe handlers while the user-gesture is active
    const beginTrack = (newVideoId, { fromGesture = false } = {}) => {
        if (!newVideoId) return;
        loadedVideoIdRef.current = newVideoId;
        resetSnippetStateForNewTrack();

        const pa = playerARef.current;
        if (!pa || typeof pa.loadVideoById !== 'function') return;

        try {
            loadVideoOnPlayers(newVideoId);
            setPlayerReady(true);
            playersReadyRef.current = IS_MOBILE ? 1 : 2;

            const canPlay = IS_MOBILE ? hasAudioEnabledRef.current : true;
            if (!autoPlay || !canPlay) return;

            if (fromGesture) {
                try {
                    pa.playVideo();
                    hasPlayedRef.current = true;
                } catch (e) {
                    console.error('[snippets] gesture playVideo error:', e);
                }
                playSnippets();
            } else {
                pendingAutoplayRef.current = true;
                playSnippets();
            }
        } catch (e) {
            console.error('[snippets] beginTrack error:', e);
        }
    };

    useEffect(() => {
        if (!controllerRef) return;
        controllerRef.current = { beginTrack };
        return () => { controllerRef.current = null; };
    });

    return (
        <div className="flex flex-col items-center gap-2 py-2">
            <div className="flex gap-2">
                {[0, 1, 2].map(i => (
                    <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        aria-label={i === currentSnippet && isPlaying ? `hold to hear more of snippet ${i + 1}` : `snippet ${i + 1}`}
                        onClick={(e) => { e.stopPropagation(); jumpToSnippetRef.current?.(i); }}
                        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); handleDotPointerDown(i); }}
                        onPointerUp={(e) => { e.stopPropagation(); handleDotPointerUp(); }}
                        onPointerLeave={(e) => { e.stopPropagation(); handleDotPointerLeave(); }}
                        onContextMenu={(e) => e.preventDefault()}
                        className={`w-3 h-3 rounded-full transition-all duration-300 cursor-pointer select-none touch-none ${
                            i === currentSnippet && isPlaying
                                ? 'bg-[#e8d4db] scale-125 shadow-md'
                                : i < currentSnippet ? 'bg-[#d4c8d0]' : 'bg-[#e0d6de]'
                        }`}
                    />
                ))}
            </div>
            <div className={`text-xs text-[#6b6570] ${holdingDot === currentSnippet ? 'snippet-status-pulsate' : ''}`}>
                {isPlaying ? `playing snippet ${currentSnippet + 1}/3` : playerReady ? 'ready' : 'loading'}
            </div>
            <p className="text-xs text-[#6b6570] opacity-80">hold dot to keep playing</p>
            {onMuteToggle && (
                <>
                    {/* Show play button on mobile before audio is enabled */}
                    {!hasAudioEnabled && IS_MOBILE && (
                        <div
                            data-no-swipe="true"
                            onPointerDownCapture={(e) => {
                                e.stopPropagation();
                            }}
                            onTouchStartCapture={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            <button
                                type="button"
                                onTouchStart={(e) => {
                                    // Don't preventDefault - we need the user gesture for YouTube audio
                                    e.stopPropagation();
                                    e.nativeEvent?.stopImmediatePropagation?.();
                                }}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.nativeEvent?.stopImmediatePropagation?.();
                                }}
                                onTouchEnd={(e) => {
                                    // onTouchEnd is more reliable than onClick on mobile Safari
                                    handlePlayButtonClick(e, 'onTouchEnd');
                                }}
                                onClick={(e) => {
                                    // onClick as fallback for desktop
                                    handlePlayButtonClick(e, 'onClick');
                                }}
                                className="p-1.5 rounded text-[#6b6570] hover:text-[#3d3a42] hover:bg-[#f5e6ed] transition-colors"
                                aria-label="play audio"
                                title="tap to play audio"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </button>
                        </div>
                    )}
                    {/* Show mute/unmute button after audio is enabled (or always on desktop) */}
                    {hasAudioEnabled && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                const newMuted = !isMuted;
                                const p = getPlayer(activePlayerRef.current);
                                if (p) {
                                    try {
                                        if (newMuted) {
                                            if (p.mute) p.mute();
                                            else p.setVolume(0);
                                        } else {
                                            if (p.unMute) p.unMute();
                                            if (p.setVolume) p.setVolume(100);
                                        }
                                    } catch (err) {}
                                }
                                onMuteToggle();
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-[#6b6570] hover:text-[#3d3a42] hover:bg-[#f5e6ed] transition-colors"
                            aria-label={isMuted ? 'unmute' : 'mute'}
                            title={isMuted ? (IS_MOBILE ? 'tap to unmute' : 'unmute (space)') : (IS_MOBILE ? 'tap to mute' : 'mute (space)')}
                        >
                            {isMuted ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                            )}
                        </button>
                    )}
                </>
            )}
            <div ref={containerARef} style={{ position: 'absolute', left: '-9999px', width: IS_MOBILE ? 250 : 1, height: IS_MOBILE ? 250 : 1 }} />
            <div ref={containerBRef} style={{ position: 'absolute', left: '-9999px', width: IS_MOBILE ? 250 : 1, height: IS_MOBILE ? 250 : 1 }} />
        </div>
    );
}

// Track Card Component
function TrackCard({
    track,
    onSwipe,
    style,
    showYouTube,
    onToggleYouTube,
    onSnippetComplete,
    onVideoError,
    isMuted,
    onMuteToggle,
    onSessionGesture,
    sessionAudioEnabled,
    audioControllerRef,
    exitDirection,
    onExitComplete,
    showSwipeCue,
    swipeCueText
}) {
    const cardRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const startPosRef = useRef({ x: 0, y: 0 });
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const hasDraggedRef = useRef(false);
    const localExitRef = useRef(false);
    dragOffsetRef.current = dragOffset;
    
    useEffect(() => {
        if (!exitDirection) return;
        localExitRef.current = true;
        if (prefersReducedMotion()) {
            onExitComplete?.();
            return;
        }
        const t = setTimeout(() => onExitComplete?.(), 200);
        return () => clearTimeout(t);
    }, [exitDirection, onExitComplete]);
    
    const handlePointerDown = (e) => {
        try {
            if (exitDirection || localExitRef.current) return;
            const target = e.target;
            if (!target) return;
            
            const closestButton = target.closest ? target.closest('button') : null;
            const closestLink = target.closest ? target.closest('a') : null;
            const closestNoSwipe = target.closest ? target.closest('[data-no-swipe="true"]') : null;
            
            if (closestButton || closestLink || closestNoSwipe || target.tagName === 'IFRAME' || target.tagName === 'BUTTON' || target.tagName === 'A') {
                return;
            }
            
            if (e.pointerId != null && e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function') {
                try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                } catch (captureErr) {
                    // Ignore capture errors - continue with drag handling
                }
            }
            
            startPosRef.current = { x: e.clientX, y: e.clientY };
            dragOffsetRef.current = { x: 0, y: 0 };
            hasDraggedRef.current = false;
            setIsDragging(true);
            setDragOffset({ x: 0, y: 0 });
        } catch (err) {
            console.error('[TrackCard] handlePointerDown error:', err);
        }
    };
    
    useEffect(() => {
        if (!isDragging) return;
        const onMove = (e) => {
            const start = startPosRef.current;
            const off = { x: e.clientX - start.x, y: e.clientY - start.y };
            if (Math.abs(off.x) > 10) hasDraggedRef.current = true;
            dragOffsetRef.current = off;
            setDragOffset(off);
        };
        const onUp = () => {
            const dx = dragOffsetRef.current.x;
            const hasDragged = hasDraggedRef.current;
            setIsDragging(false);
            if (hasDragged && Math.abs(dx) > 100) {
                // Keep current offset until parent applies exit class
                onSwipe(dx > 0 ? 'right' : 'left');
            } else {
                setDragOffset({ x: 0, y: 0 });
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [isDragging, onSwipe]);
    
    const rotation = dragOffset.x * 0.1;
    const opacity = 1 - Math.abs(dragOffset.x) / 300;
    
    const likeOpacity = Math.max(0, Math.min(1, dragOffset.x / 150));
    const dislikeOpacity = Math.max(0, Math.min(1, -dragOffset.x / 150));
    
    const exitClass = exitDirection === 'right'
        ? 'card-exit-right'
        : exitDirection === 'left'
            ? 'card-exit-left'
            : '';
    
    return (
        <div
            ref={cardRef}
            className={`swipe-card card-enter ${isDragging ? 'swiping' : ''} ${exitClass}`}
            style={{
                ...style,
                ...(exitDirection
                    ? {}
                    : {
                        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${rotation}deg)`,
                        opacity: opacity
                    })
            }}
            onPointerDown={handlePointerDown}
        >
            <div className="relative bg-white rounded-2xl shadow-sm border border-[#d4c8d0] overflow-hidden w-full max-w-md">
                {/* Track Info Header */}
                <div className="p-6 bg-[#f5e6ed] text-[#3d3a42] font-display">
                    <h2 className="text-2xl font-bold mb-2">{track.name}</h2>
                    <div className="flex items-center justify-end">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleYouTube();
                            }}
                            className="px-4 py-2 bg-[#e8d4db] hover:bg-[#e0d6de] rounded-lg text-sm font-medium text-[#3d3a42] transition-colors"
                        >
                            {showYouTube ? 'hide player' : 'show full track'}
                        </button>
                    </div>
                </div>
                
                {/* YouTube Player (optional) */}
                {showYouTube && (
                    <div className="aspect-video bg-black">
                        <iframe
                            width="100%"
                            height="100%"
                            src={`https://www.youtube.com/embed/${track.videoId}?autoplay=1`}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        ></iframe>
                    </div>
                )}
                
                {/* Track Artwork */}
                <div className="aspect-square bg-[#f5e6ed] relative overflow-hidden">
                    {track.thumbnail ? (
                        <img 
                            src={track.thumbnail} 
                            alt={track.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                e.target.style.display = 'none';
                            }}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#9b8bb5] text-6xl">
                            &#9834;
                        </div>
                    )}
                </div>
                
                {/* Audio Snippet Player */}
                <AudioSnippetPlayer 
                    videoId={track.videoId} 
                    onComplete={onSnippetComplete}
                    onError={onVideoError}
                    autoPlay={!showYouTube}
                    isMuted={isMuted || showYouTube}
                    onMuteToggle={onMuteToggle}
                    onSessionGesture={onSessionGesture}
                    persistent
                    sessionAudioEnabled={sessionAudioEnabled}
                    controllerRef={audioControllerRef}
                />
                
                {showSwipeCue && (
                    <div className="pt-0 px-6 pb-6 text-center text-[#6b6570] swipe-cue">
                        <p className="text-sm">{swipeCueText}</p>
                    </div>
                )}
            </div>
            
            {/* Swipe Indicators */}
            <div className="swipe-indicator like" style={{ opacity: likeOpacity }}>
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </div>
            <div className="swipe-indicator dislike" style={{ opacity: dislikeOpacity }}>
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
        </div>
    );
}

// Get access token from backend
const getAccessToken = async () => {
    const sessionId = localStorage.getItem('youtube_session_id');
    if (!sessionId) {
        throw new Error('Not authenticated');
    }
    
    const response = await fetch(`/api/auth/youtube/token?session=${sessionId}`);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get access token');
    }
    
    const data = await response.json();
    return data.access_token;
};

// YouTube API Functions
const createYouTubePlaylist = async (playlistName) => {
    const accessToken = await getAccessToken();
    
    const response = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            snippet: {
                title: playlistName,
                description: 'created from cosinder.'
            },
            status: {
                privacyStatus: 'private'
            }
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create playlist');
    }
    
    const data = await response.json();
    // The API returns the playlist object directly with an id field
    return data.id;
};

const addVideoToPlaylist = async (playlistId, videoId) => {
    const accessToken = await getAccessToken();
    
    const response = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            snippet: {
                playlistId: playlistId,
                resourceId: {
                    kind: 'youtube#video',
                    videoId: videoId
                }
            }
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        // Don't throw for duplicate videos or invalid video IDs - just log and continue
        if (error.error?.code === 409 || error.error?.code === 400) {
            console.warn(`Skipping video ${videoId}:`, error.error?.message);
            return false;
        }
        throw new Error(error.error?.message || 'Failed to add video to playlist');
    }
    
    return true;
};

const YT_EXPORT_PENDING_KEY = 'cosinder_youtube_export_pending';

const readPendingYouTubeExport = () => {
    try {
        return JSON.parse(sessionStorage.getItem(YT_EXPORT_PENDING_KEY) || 'null');
    } catch (e) {
        return null;
    }
};

const clearPendingYouTubeExport = () => {
    try {
        sessionStorage.removeItem(YT_EXPORT_PENDING_KEY);
    } catch (e) {}
};

// Export to YouTube Modal Component
function ExportToYouTubeModal({ isOpen, onClose, likedTracks }) {
    const [playlistName, setPlaylistName] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState(null);
    const [exportSuccess, setExportSuccess] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [pendingAutoExport, setPendingAutoExport] = useState(false);
    const autoExportStartedRef = useRef(false);
    
    // Set default playlist name on open
    useEffect(() => {
        if (isOpen && !playlistName) {
            const date = new Date().toLocaleDateString();
            setPlaylistName(`cosinder. - ${date}`);
        }
    }, [isOpen]);
    
    // Check for OAuth callback and existing session
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const authStatus = params.get('youtube_auth');
        const sessionId = params.get('session');
        const pending = readPendingYouTubeExport();
        
        if (authStatus === 'success' && sessionId) {
            localStorage.setItem('youtube_session_id', sessionId);
            setIsAuthenticated(true);
            setExportError(null);
            if (pending?.playlistName) {
                setPlaylistName(pending.playlistName);
            }
            if (pending?.autoExport) {
                setPendingAutoExport(true);
            }
            window.history.replaceState({}, '', window.location.pathname);
        } else if (authStatus === 'error') {
            setExportError('authentication failed. please try again.');
            if (pending?.playlistName) {
                setPlaylistName(pending.playlistName);
            }
            clearPendingYouTubeExport();
            window.history.replaceState({}, '', window.location.pathname);
        } else {
            const existingSession = localStorage.getItem('youtube_session_id');
            if (existingSession) {
                setIsAuthenticated(true);
            }
        }
    }, []);
    
    const runExport = async (name) => {
        if (!name) {
            setExportError('please enter a playlist name');
            return;
        }
        
        if (!localStorage.getItem('youtube_session_id')) {
            setExportError('please sign in with google first');
            return;
        }
        
        if (likedTracks.length === 0) {
            setExportError('no tracks to export');
            return;
        }
        
        setIsExporting(true);
        setExportError(null);
        setExportSuccess(null);
        
        try {
            setProgress({ current: 0, total: likedTracks.length });
            const playlistId = await createYouTubePlaylist(name);
            
            let successCount = 0;
            for (let i = 0; i < likedTracks.length; i++) {
                const track = likedTracks[i];
                if (track.videoId) {
                    try {
                        const added = await addVideoToPlaylist(playlistId, track.videoId);
                        if (added) successCount++;
                    } catch (error) {
                        console.warn(`Failed to add track ${track.name}:`, error);
                    }
                }
                setProgress({ current: i + 1, total: likedTracks.length });
            }
            
            const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
            setExportSuccess({
                message: `Successfully created playlist with ${successCount} tracks!`,
                url: playlistUrl
            });
        } catch (error) {
            if (error.message.includes('Not authenticated') || error.message.includes('Session not found')) {
                setIsAuthenticated(false);
                localStorage.removeItem('youtube_session_id');
                setExportError('authentication expired. please sign in again.');
            } else {
                setExportError(error.message || 'failed to export playlist. please try again.');
            }
        } finally {
            setIsExporting(false);
        }
    };
    
    // After Google redirects back, reopen triggers isOpen and we resume export
    useEffect(() => {
        if (!isOpen || !pendingAutoExport || !isAuthenticated) return;
        if (autoExportStartedRef.current) return;
        const name = playlistName.trim();
        if (!name) return;
        
        autoExportStartedRef.current = true;
        setPendingAutoExport(false);
        clearPendingYouTubeExport();
        runExport(name);
    }, [isOpen, pendingAutoExport, isAuthenticated, playlistName, likedTracks]);
    
    const handleGoogleSignIn = () => {
        const name = playlistName.trim() || `cosinder. - ${new Date().toLocaleDateString()}`;
        try {
            sessionStorage.setItem(YT_EXPORT_PENDING_KEY, JSON.stringify({
                playlistName: name,
                autoExport: true
            }));
        } catch (e) {}
        window.location.href = '/api/auth/youtube/init';
    };
    
    const handleExport = () => {
        runExport(playlistName.trim());
    };
    
    const handleClose = () => {
        if (!isExporting) {
            setPlaylistName('');
            setExportError(null);
            setExportSuccess(null);
            setProgress({ current: 0, total: 0 });
            onClose();
        }
    };
    
    const handleLogout = async () => {
        const sessionId = localStorage.getItem('youtube_session_id');
        if (sessionId) {
            try {
                await fetch(`/api/auth/youtube/logout?session=${sessionId}`);
            } catch (error) {
                console.warn('Logout error:', error);
            }
        }
        localStorage.removeItem('youtube_session_id');
        setIsAuthenticated(false);
    };
    
    if (!isOpen) return null;
    
    return (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={handleClose}>
            <div className="bg-[#fdf8f8] text-[#3d3a42] rounded-2xl p-6 max-w-md w-full mx-4 shadow-lg border border-[#d4c8d0]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold font-display">export to youtube</h3>
                    <button
                        onClick={handleClose}
                        disabled={isExporting}
                        className="text-2xl text-[#6b6570] hover:text-[#3d3a42] transition-colors disabled:opacity-50"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                
                {exportSuccess ? (
                    <div className="space-y-4">
                        <div className="bg-[#e8f5e9] border border-[#c8e6c9] rounded-lg p-4">
                            <p className="text-[#2e7d32] mb-2">{exportSuccess.message}</p>
                            <a
                                href={exportSuccess.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#1565c0] hover:underline"
                            >
                                open playlist →
                            </a>
                        </div>
                        <button
                            onClick={handleClose}
                            className="w-full py-3 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0]"
                        >
                            close
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-[#3d3a42]">playlist name</label>
                            <input
                                type="text"
                                value={playlistName}
                                onChange={(e) => setPlaylistName(e.target.value)}
                                disabled={isExporting}
                                placeholder="enter playlist name"
                                className="w-full px-4 py-2 bg-white border border-[#d4c8d0] rounded-lg text-[#3d3a42] focus:outline-none focus:ring-2 focus:ring-[#e8d4db] focus:border-[#e8d4db] disabled:opacity-50"
                            />
                        </div>
                        
                        {!isAuthenticated && (
                            <div>
                                <button
                                    onClick={handleGoogleSignIn}
                                    disabled={isExporting}
                                    className="w-full py-3 bg-white border border-[#d4c8d0] text-[#3d3a42] rounded-lg font-medium hover:bg-[#f5e6ed] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                    </svg>
                                    sign in with google
                                </button>
                            </div>
                        )}
                        
                        {isAuthenticated && (
                            <div className="bg-[#e8f5e9] border border-[#c8e6c9] rounded-lg p-3 flex items-center justify-between">
                                <p className="text-[#2e7d32] text-sm flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    signed in with google
                                </p>
                                <button
                                    onClick={handleLogout}
                                    className="text-xs text-[#2e7d32] hover:underline"
                                >
                                    sign out
                                </button>
                            </div>
                        )}
                        
                        {exportError && (
                            <div className="bg-[#ffebee] border border-[#ffcdd2] rounded-lg p-3">
                                <p className="text-[#c62828] text-sm">{exportError}</p>
                            </div>
                        )}
                        
                        {isExporting && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <div className="loading-spinner"></div>
                                    <span className="text-sm text-[#3d3a42]">
                                        {progress.current === 0 && 'creating playlist'}
                                        {progress.current > 0 && progress.current <= progress.total && 
                                            `adding tracks ${progress.current}/${progress.total}`}
                                    </span>
                                </div>
                                <div className="w-full bg-[#e0d6de] rounded-full h-2">
                                    <div
                                        className="bg-[#e8d4db] h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}
                        
                        <button
                            onClick={handleExport}
                            disabled={isExporting || !playlistName.trim() || !isAuthenticated}
                            className="w-full py-3 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExporting ? 'exporting' : 'create playlist'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// Vinyl Stack Sidebar
function VinylStack({ currentList, savedPlaylists, onUpdatePlaylists, pulseToken }) {
    const [isOpen, setIsOpen] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [activeView, setActiveView] = useState('current'); // 'current' or saved playlist id
    const [pulse, setPulse] = useState(false);
    
    // Reopen export UI after Google OAuth redirect
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const authStatus = params.get('youtube_auth');
        const pending = readPendingYouTubeExport();
        if (authStatus === 'success' || authStatus === 'error' || pending?.autoExport) {
            setIsOpen(true);
            setShowExportModal(true);
        }
    }, []);
    
    useEffect(() => {
        if (!pulseToken || prefersReducedMotion()) return;
        setPulse(true);
        const t = setTimeout(() => setPulse(false), 150);
        return () => clearTimeout(t);
    }, [pulseToken]);
    
    const activePlaylist = activeView === 'current' ? null : savedPlaylists.find(p => p.id === activeView);
    const activeTracks = activeView === 'current'
        ? currentList
        : (activePlaylist?.tracks || []);
    const isViewingCurrent = activeView === 'current';
    
    const handleSaveAsPlaylist = () => {
        const name = saveName.trim();
        if (!name || currentList.length === 0) return;
        const newPlaylist = {
            id: Date.now().toString(),
            name,
            tracks: [...currentList],
            createdAt: new Date().toISOString()
        };
        onUpdatePlaylists(prev => ({
            ...prev,
            savedPlaylists: [...prev.savedPlaylists, newPlaylist]
        }));
        setSaveName('');
        setShowSaveModal(false);
    };
    
    const handleNewPlaylist = () => {
        onUpdatePlaylists(prev => ({ ...prev, currentList: [] }));
        setActiveView('current');
    };
    
    const handleClearCurrent = () => {
        onUpdatePlaylists(prev => ({ ...prev, currentList: [] }));
    };
    
    const handleDeletePlaylist = (id) => {
        onUpdatePlaylists(prev => ({
            ...prev,
            savedPlaylists: prev.savedPlaylists.filter(p => p.id !== id)
        }));
        if (activeView === id) setActiveView('current');
    };
    
    const totalCurrent = currentList.length;
    
    return (
        <>
            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed top-6 right-6 z-50 bg-white rounded-full p-4 shadow-sm border border-[#d4c8d0] hover:bg-[#f5e6ed] transition-colors ${pulse ? 'vinyl-pulse' : ''}`}
            >
                <div className="relative">
                    <svg className="w-8 h-8 text-[#3d3a42]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" strokeWidth={2} />
                        <circle cx="12" cy="12" r="3" strokeWidth={2} />
                    </svg>
                    {totalCurrent > 0 && (
                        <span className="absolute -top-2 -right-2 bg-[#e8d4db] text-[#3d3a42] text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border border-[#d4c8d0]">
                            {totalCurrent}
                        </span>
                    )}
                </div>
            </button>
            
            {/* Sidebar */}
            <div
                className={`fixed top-0 right-0 h-full w-96 bg-[#faf5f5] text-[#3d3a42] shadow-lg border-l border-[#d4c8d0] transform transition-transform duration-300 z-40 ${
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="p-6 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold font-display">liked tracks</h2>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-[#6b6570] hover:text-[#3d3a42] transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    {/* Playlist switcher */}
                    <div className="mb-4">
                        <select
                            value={activeView}
                            onChange={(e) => setActiveView(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-[#d4c8d0] rounded-lg text-[#3d3a42] text-sm focus:outline-none focus:ring-2 focus:ring-[#e8d4db]"
                        >
                            <option value="current">current ({totalCurrent})</option>
                            {savedPlaylists.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.tracks.length})</option>
                            ))}
                        </select>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mb-4">
                        {activeTracks.length > 0 && (
                            <button
                                onClick={() => setShowExportModal(true)}
                                className="px-3 py-1.5 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg text-sm font-medium transition-colors border border-[#d4c8d0]"
                                title="export to youtube"
                            >
                                export
                            </button>
                        )}
                        {isViewingCurrent && (
                            <>
                                <button
                                    onClick={() => setShowSaveModal(true)}
                                    disabled={currentList.length === 0}
                                    className="px-3 py-1.5 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg text-sm font-medium transition-colors border border-[#d4c8d0] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    save as playlist
                                </button>
                                <button
                                    onClick={handleNewPlaylist}
                                    className="px-3 py-1.5 bg-[#e8dff5] hover:bg-[#c9bde0] text-[#3d3a42] rounded-lg text-sm font-medium transition-colors border border-[#d4c8d0]"
                                >
                                    new playlist
                                </button>
                            </>
                        )}
                        {!isViewingCurrent && (
                            <button
                                onClick={() => handleDeletePlaylist(activeView)}
                                className="px-3 py-1.5 bg-[#ffebee] hover:bg-[#ffcdd2] text-[#c62828] rounded-lg text-sm font-medium transition-colors border border-[#ffcdd2]"
                            >
                                delete playlist
                            </button>
                        )}
                    </div>
                    
                    {activeTracks.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-[#6b6570]">
                            <p className="text-center">
                                {isViewingCurrent ? (
                                    <>no liked tracks yet.<br />start swiping!</>
                                ) : (
                                    'this playlist is empty.'
                                )}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 overflow-y-auto space-y-2">
                                {activeTracks.map((track, idx) => {
                                    const youtubeUrl = track.videoId ? `https://www.youtube.com/watch?v=${track.videoId}` : null;
                                    const rowContent = (
                                        <>
                                            <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-[#e0d6de]">
                                                {track.thumbnail ? (
                                                    <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[#9b8bb5] text-lg">&#9834;</div>
                                                )}
                                            </div>
                                            <span className="text-sm text-[#3d3a42] font-medium truncate flex-1">{track.name}</span>
                                        </>
                                    );
                                    return (
                                        <div key={`${track.id}-${idx}`}>
                                            {youtubeUrl ? (
                                                <a
                                                    href={youtubeUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="open in youtube"
                                                    className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-[#f5e6ed]/50"
                                                >
                                                    {rowContent}
                                                </a>
                                            ) : (
                                                <div className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-[#f5e6ed]/50">
                                                    {rowContent}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            
                            {isViewingCurrent && (
                                <button
                                    onClick={handleClearCurrent}
                                    className="mt-4 w-full py-3 bg-[#ffebee] hover:bg-[#ffcdd2] text-[#c62828] rounded-lg font-medium transition-colors border border-[#ffcdd2]"
                                >
                                    clear all
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
            
            {/* Save as playlist modal */}
            {showSaveModal && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowSaveModal(false)}>
                    <div className="bg-[#fdf8f8] text-[#3d3a42] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-lg border border-[#d4c8d0]" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold font-display mb-4">save as playlist</h3>
                        <input
                            type="text"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            placeholder="playlist name"
                            className="w-full px-4 py-2 mb-4 bg-white border border-[#d4c8d0] rounded-lg text-[#3d3a42] focus:outline-none focus:ring-2 focus:ring-[#e8d4db]"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveAsPlaylist()}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setShowSaveModal(false); setSaveName(''); }}
                                className="flex-1 py-2 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0]"
                            >
                                cancel
                            </button>
                            <button
                                onClick={handleSaveAsPlaylist}
                                disabled={!saveName.trim() || currentList.length === 0}
                                className="flex-1 py-2 bg-[#e8d4db] hover:bg-[#e0d6de] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                save
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Export Modal */}
            <ExportToYouTubeModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                likedTracks={activeTracks}
            />
        </>
    );
}

const PLAYLISTS_KEY = 'cosinder_playlists';
const IS_MOBILE = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) || ('ontouchstart' in window);

function loadPlaylists() {
    const saved = localStorage.getItem(PLAYLISTS_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (_) {}
    }
    // Migrate from legacy likedTracks
    const legacy = localStorage.getItem('likedTracks');
    if (legacy) {
        try {
            const tracks = JSON.parse(legacy);
            localStorage.removeItem('likedTracks');
            return { currentList: tracks, savedPlaylists: [] };
        } catch (_) {}
    }
    return { currentList: [], savedPlaylists: [] };
}

// Error boundary: catches render/lifecycle errors in the card subtree so an
// uncaught error no longer unmounts the entire React tree (the "card vanishes,
// app dead" symptom). componentDidCatch gives us the real error + component
// stack that window.onerror can't see for cross-origin "Script error." cases.
class CardErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    
    static getDerivedStateFromError(error) {
        return { error: error || new Error('unknown') };
    }
    
    componentDidUpdate(prevProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null });
        }
    }
    
    componentDidCatch(error, errorInfo) {
        console.error('CardErrorBoundary:', error, errorInfo?.componentStack);
    }
    
    render() {
        if (this.state.error) {
            return (
                <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-2xl shadow-lg max-w-sm text-center">
                    <p className="text-[#3d3a42] font-semibold">Something went wrong with this card.</p>
                    <p className="text-[#6b6570] text-sm break-words">{String(this.state.error?.message || this.state.error)}</p>
                    <button
                        type="button"
                        className="px-4 py-2 rounded-full bg-[#3d3a42] text-white text-sm"
                        onClick={() => this.setState({ error: null })}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Main App
function App() {
    const [stack, setStack] = useState([]);
    const [playlists, setPlaylists] = useState(() => loadPlaylists());
    const { currentList, savedPlaylists } = playlists;
    const [loading, setLoading] = useState(false);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [showYouTube, setShowYouTube] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [snippetComplete, setSnippetComplete] = useState(false);
    const [isMuted, setIsMuted] = useState(IS_MOBILE);
    const [mobileSessionAudioEnabled, setMobileSessionAudioEnabled] = useState(false);
    const [showSessionNamePrompt, setShowSessionNamePrompt] = useState(false);
    const [showSaveSessionModal, setShowSaveSessionModal] = useState(false);
    const [sessionSaveName, setSessionSaveName] = useState('');
    const [cardExit, setCardExit] = useState(null);
    const [vinylPulseToken, setVinylPulseToken] = useState(0);
    const [showSwipeCue, setShowSwipeCue] = useState(false);
    const seenTrackIdsRef = useRef(new Set());
    const similarCacheRef = useRef(new Map());
    const audioControllerRef = useRef(null);
    const sessionNamePromptShownRef = useRef(false);
    const deckBusyRef = useRef(false);
    const swipeExitPendingRef = useRef(null);
    
    const handleSessionGesture = () => {
        setMobileSessionAudioEnabled(true);
        setIsMuted(false);
    };
    
    const tryAutoplayNextTrack = (nextTrack, fromGesture = true) => {
        if (!nextTrack?.videoId) return;
        if (IS_MOBILE && !mobileSessionAudioEnabled) return;
        audioControllerRef.current?.beginTrack(nextTrack.videoId, { fromGesture });
    };
    
    // Persist playlists to localStorage
    useEffect(() => {
        localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
    }, [playlists]);
    
    // Soft prompt when the session first reaches 10 likes
    useEffect(() => {
        if (currentList.length === 10 && !sessionNamePromptShownRef.current) {
            sessionNamePromptShownRef.current = true;
            setShowSessionNamePrompt(true);
        }
    }, [currentList.length]);
    
    // Auto-dismiss the soft prompt after 5 seconds
    useEffect(() => {
        if (!showSessionNamePrompt) return;
        const t = setTimeout(() => setShowSessionNamePrompt(false), 5000);
        return () => clearTimeout(t);
    }, [showSessionNamePrompt]);
    
    const handleSaveSessionAsPlaylist = () => {
        const name = sessionSaveName.trim();
        if (!name || currentList.length === 0) return;
        const newPlaylist = {
            id: Date.now().toString(),
            name,
            tracks: [...currentList],
            createdAt: new Date().toISOString()
        };
        setPlaylists(prev => ({
            ...prev,
            savedPlaylists: [...prev.savedPlaylists, newPlaylist]
        }));
        setSessionSaveName('');
        setShowSaveSessionModal(false);
    };
    
    const openSessionNameModal = () => {
        setShowSessionNamePrompt(false);
        setSessionSaveName('');
        setShowSaveSessionModal(true);
    };
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore when user is typing in an input or textarea
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (!hasStarted || currentCardIndex >= stack.length) return;
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                requestSwipe('left');
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                requestSwipe('right');
            } else if (e.key === ' ') {
                e.preventDefault();
                setIsMuted(prev => !prev);
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasStarted, currentCardIndex, stack]);
    
    // First-card cue auto-hides after 4s
    useEffect(() => {
        if (!showSwipeCue) return;
        const t = setTimeout(() => setShowSwipeCue(false), 4000);
        return () => clearTimeout(t);
    }, [showSwipeCue]);
    
    // Mark tracks as seen when they're displayed
    useEffect(() => {
        if (hasStarted && stack.length > 0 && currentCardIndex < stack.length) {
            const currentTrack = stack[currentCardIndex];
            if (currentTrack && currentTrack.id) {
                seenTrackIdsRef.current.add(currentTrack.id);
            }
        }
    }, [currentCardIndex, stack, hasStarted]);
    
    const fetchSimilarTracks = async (track, { quiet = false } = {}) => {
        if (!track?.id) return [];
        const cacheKey = String(track.id);
        if (similarCacheRef.current.has(cacheKey)) {
            return similarCacheRef.current.get(cacheKey);
        }
        if (!quiet) setLoading(true);
        try {
            const body = await cosineJson(
                `/api/cosine/tracks/${encodeURIComponent(track.id)}/similar?limit=20`
            );
            const tracks = (body.data?.similar_tracks || []).map(mapSimilarTrack).filter(Boolean);
            similarCacheRef.current.set(cacheKey, tracks);
            return tracks;
        } catch (error) {
            console.error('Error fetching similar tracks:', error);
            return [];
        } finally {
            if (!quiet) setLoading(false);
        }
    };
    
    const handleTrackSelect = async (track) => {
        setHasStarted(true);
        setMobileSessionAudioEnabled(false);
        sessionNamePromptShownRef.current = false;
        setShowSessionNamePrompt(false);
        setShowSaveSessionModal(false);
        setSessionSaveName('');
        setShowSwipeCue(true);
        setCardExit(null);
        swipeExitPendingRef.current = null;
        seenTrackIdsRef.current = new Set();
        const similarTracks = await fetchSimilarTracks(track);
        setStack(similarTracks);
        setCurrentCardIndex(0);
        setSnippetComplete(false);
    };
    
    const handleSwipe = async (direction) => {
        if (deckBusyRef.current) return;
        setShowSwipeCue(false);
        if (!IS_MOBILE) setIsMuted(false);
        const currentTrack = stack[currentCardIndex];
        if (!currentTrack) {
            setCardExit(null);
            return;
        }
        
        if (currentTrack.id) {
            seenTrackIdsRef.current.add(currentTrack.id);
        }
        
        if (direction === 'right') {
            setPlaylists(prev => ({
                ...prev,
                currentList: [...prev.currentList, currentTrack]
            }));
            setVinylPulseToken(t => t + 1);
            
            // Await fetch without full-screen loading so the persistent player stays mounted.
            // Block further swipes until merge+shuffle finishes to avoid stack races.
            // Keep cardExit set during the await so the old card stays off-screen (no boomerang).
            deckBusyRef.current = true;
            const likedIndex = currentCardIndex;
            try {
                const similarTracks = await fetchSimilarTracks(currentTrack, { quiet: true });
                let nextTrack = null;
                setStack(prev => {
                    const remaining = prev.slice(likedIndex + 1);
                    const newTracks = similarTracks.filter(t => !seenTrackIdsRef.current.has(t.id));
                    const shuffled = shuffleArray([...remaining, ...newTracks]);
                    nextTrack = shuffled[0] || null;
                    return shuffled;
                });
                setCurrentCardIndex(0);
                // Session already unlocked: persistent player can start without a fresh gesture
                if (nextTrack) tryAutoplayNextTrack(nextTrack, false);
            } finally {
                deckBusyRef.current = false;
                setCardExit(null);
            }
        } else {
            const nextIndex = currentCardIndex + 1;
            const nextTrack = stack[nextIndex];
            tryAutoplayNextTrack(nextTrack);
            setCurrentCardIndex(nextIndex);
            setCardExit(null);
        }
        
        setShowYouTube(false);
        setSnippetComplete(false);
    };
    
    const requestSwipe = (direction) => {
        if (deckBusyRef.current || swipeExitPendingRef.current || cardExit) return;
        if (prefersReducedMotion()) {
            handleSwipe(direction);
            return;
        }
        swipeExitPendingRef.current = direction;
        setCardExit(direction);
    };
    
    const handleCardExitComplete = () => {
        const direction = swipeExitPendingRef.current || cardExit;
        swipeExitPendingRef.current = null;
        // Do not clear cardExit here — keep the card off-screen until handleSwipe advances the deck
        if (direction) handleSwipe(direction);
    };
    
    const handleVideoError = (errorCode) => {
        // Auto-skip to next track (swipe left) after a small delay to show the error state
        setTimeout(() => requestSwipe('left'), 500);
    };
    
    const currentTrack = stack[currentCardIndex];
    const swipeCueText = IS_MOBILE && !mobileSessionAudioEnabled
        ? 'tap play, then swipe right to keep · left to skip'
        : 'swipe right to keep · left to skip';
    
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#fdf8f8]">
            {/* Header */}
            <div className="text-center mb-8">
                <h1 className="text-5xl font-bold text-[#3d3a42] mb-4 font-display">cosinder.</h1>
                <p className="text-[#6b6570] text-lg">powered by cosine.club&apos;s deep learning engine</p>
            </div>
            
            {/* Search Bar */}
            {!hasStarted && (
                <SearchBar onTrackSelect={handleTrackSelect} placeholder="search for a track to start discovering" />
            )}
            
            {/* Loading State */}
            {loading && (
                <div className="flex flex-col items-center gap-4">
                    <div className="loading-spinner"></div>
                    <p className="text-[#3d3a42] text-lg">finding similar tracks</p>
                </div>
            )}
            
            {/* Card Stack */}
            {!loading && currentTrack && (
                <div className="card-stack relative">
                    <CardErrorBoundary resetKey={currentTrack.id}>
                        <TrackCard
                            key={currentTrack.id}
                            track={currentTrack}
                            onSwipe={requestSwipe}
                            exitDirection={cardExit}
                            onExitComplete={handleCardExitComplete}
                            showSwipeCue={showSwipeCue}
                            swipeCueText={swipeCueText}
                            showYouTube={showYouTube}
                            onToggleYouTube={() => setShowYouTube(!showYouTube)}
                            onSnippetComplete={() => setSnippetComplete(true)}
                            onVideoError={handleVideoError}
                            isMuted={isMuted}
                            onMuteToggle={() => setIsMuted(prev => !prev)}
                            onSessionGesture={IS_MOBILE ? handleSessionGesture : undefined}
                            sessionAudioEnabled={mobileSessionAudioEnabled}
                            audioControllerRef={audioControllerRef}
                            style={{ position: 'relative', zIndex: 10 }}
                        />
                    </CardErrorBoundary>
                </div>
            )}
            
            {showSessionNamePrompt && (
                <button
                    type="button"
                    onClick={openSessionNameModal}
                    className="mt-4 px-4 py-2 text-sm text-[#6b6570] bg-[#f5e6ed]/90 border border-[#d4c8d0] rounded-full shadow-sm hover:bg-[#e8d4db] hover:text-[#3d3a42] transition-colors"
                    style={{ animation: 'sessionPromptFadeIn 0.3s ease-out' }}
                >
                    name this session?
                </button>
            )}
            
            {showSaveSessionModal && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => { setShowSaveSessionModal(false); setSessionSaveName(''); }}>
                    <div className="bg-[#fdf8f8] text-[#3d3a42] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-lg border border-[#d4c8d0]" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold font-display mb-4">name this session</h3>
                        <input
                            type="text"
                            value={sessionSaveName}
                            onChange={(e) => setSessionSaveName(e.target.value)}
                            placeholder="playlist name"
                            autoFocus
                            className="w-full px-4 py-2 mb-4 bg-white border border-[#d4c8d0] rounded-lg text-[#3d3a42] focus:outline-none focus:ring-2 focus:ring-[#e8d4db]"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveSessionAsPlaylist()}
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowSaveSessionModal(false); setSessionSaveName(''); }}
                                className="flex-1 py-2 bg-[#f5e6ed] hover:bg-[#e8d4db] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0]"
                            >
                                cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveSessionAsPlaylist}
                                disabled={!sessionSaveName.trim() || currentList.length === 0}
                                className="flex-1 py-2 bg-[#e8d4db] hover:bg-[#e0d6de] text-[#3d3a42] rounded-lg font-medium transition-colors border border-[#d4c8d0] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                save
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* No more tracks */}
            {!loading && hasStarted && currentCardIndex >= stack.length && (
                <div className="text-center text-[#3d3a42]">
                    <p className="text-2xl mb-4 font-display">you&apos;ve reached the end</p>
                    {currentList.length > 0 && (
                        <p className="text-[#6b6570] text-sm mb-4">open the vinyl stack to export what you kept</p>
                    )}
                    <button
                        onClick={() => setHasStarted(false)}
                        className="px-8 py-4 bg-[#f5e6ed] text-[#3d3a42] rounded-2xl font-bold hover:bg-[#e8d4db] transition-colors border border-[#d4c8d0]"
                    >
                        start new search
                    </button>
                </div>
            )}
            
            {/* Vinyl Stack Sidebar */}
            <VinylStack
                currentList={currentList}
                savedPlaylists={savedPlaylists}
                onUpdatePlaylists={setPlaylists}
                pulseToken={vinylPulseToken}
            />
            
            {/* Bottom Search Bar - Always visible when game has started */}
            {hasStarted && (
                <div className="w-full max-w-2xl mx-auto mt-12 px-4">
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#d4c8d0]">
                        <p className="text-[#6b6570] text-sm mb-2 text-center">want to explore a different track?</p>
                        <SearchBar onTrackSelect={handleTrackSelect} />
                    </div>
                </div>
            )}
            
        </div>
    );
}

// Render App
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
