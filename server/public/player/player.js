(() => {
  const APP_VERSION = '1.6.2-web';
  const POLL_MS = 10_000;
  const HEARTBEAT_MS = 30_000;
  const PAIRING_MS = 3_000;
  const WAKE_LOCK_MS = 30_000;
  const CACHE_NAME = 'hw-signage-media-v5';
  const DEFAULT_IMAGE_SEC = 10;
  const DEFAULT_VIDEO_SEC = 30;
  /** One-at-a-time downloads so 15 Mbps Wi‑Fi isn't contested */
  const DOWNLOAD_CONCURRENCY = 1;
  /** Give large MP4s time to finish before starting with partial set */
  const PRELOAD_TIMEOUT_MS = 12 * 60 * 1000;
  /** ~400 days — Pi Chromium often clears localStorage more aggressively than cookies */
  const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;
  const COOKIE_KEYS = new Set(['deviceId', 'pairingCode', 'deviceName', 'lastPairingCode']);
  const DEAD_CODES_KEY = 'hw_dead_pairing_codes';
  /** Offline playlist metadata — media blobs live in Cache API */
  const SNAPSHOT_KEY = 'hw_playlist_snapshot';

  const imageView = document.getElementById('imageView');
  const videoView = document.getElementById('videoView');
  const bgImage = document.getElementById('bgImage');
  const bgVideo = document.getElementById('bgVideo');
  const bgCanvas = document.getElementById('bgCanvas');
  const waitingPanel = document.getElementById('waitingPanel');
  const waitingText = document.getElementById('waitingText');
  const codeRail = document.getElementById('codeRail');
  const codeRailLabel = document.getElementById('codeRailLabel');
  const codeRailCode = document.getElementById('codeRailCode');
  const codeRailHint = document.getElementById('codeRailHint');
  const codeRailSub = document.getElementById('codeRailSub');
  const debugPanel = document.getElementById('debugPanel');
  const debugText = document.getElementById('debugText');

  function cookieName(key) {
    return `hw_${key}`;
  }

  function readCookie(name) {
    try {
      const parts = document.cookie ? document.cookie.split(';') : [];
      for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        if (k !== name) continue;
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function writeCookie(name, value) {
    try {
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }

  function clearCookie(name) {
    // Clear every common variant — Pi Chromium is picky about cookie clearing
    const variants = [
      name,
      encodeURIComponent(name),
      decodeURIComponent(name),
    ];
    const paths = ['/', '/player', '/player/'];
    for (const n of variants) {
      for (const p of paths) {
        try {
          document.cookie = `${n}=; path=${p}; max-age=0; SameSite=Lax`;
          document.cookie = `${n}=; path=${p}; max-age=0`;
          document.cookie = `${n}=; path=${p}; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Dual-write identity to localStorage + cookie so Pi kiosk survives reloads. */
  const store = {
    get(key, fallback = null) {
      let fromLs = null;
      try {
        fromLs = localStorage.getItem(key);
      } catch {
        /* ignore */
      }
      if (fromLs != null && fromLs !== '') {
        if (COOKIE_KEYS.has(key)) writeCookie(cookieName(key), fromLs);
        return fromLs;
      }
      if (COOKIE_KEYS.has(key)) {
        const fromCookie = readCookie(cookieName(key));
        if (fromCookie != null && fromCookie !== '') {
          try {
            localStorage.setItem(key, fromCookie);
          } catch {
            /* ignore */
          }
          return fromCookie;
        }
      }
      return fallback;
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore quota */
      }
      if (COOKIE_KEYS.has(key)) writeCookie(cookieName(key), value);
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      if (COOKIE_KEYS.has(key)) clearCookie(cookieName(key));
    },
  };

  let deviceId = store.get('deviceId');
  let pairingCode = store.get('pairingCode');
  let lastPairingCode = store.get('lastPairingCode');
  let deviceName = store.get('deviceName');
  let contentVersion = Number(store.get('contentVersion', '-1'));
  let cachedType = store.get('cachedType');
  let cachedObjectUrl = null;
  let showingMedia = false;
  let networkOk = false;
  let lastError = '';
  let wakeLock = null;
  let tapCount = 0;
  let tapTimer = null;
  let playlistItems = [];
  let playlistIndex = 0;
  let playMode = 'single';
  let slideTimer = null;
  let bgRaf = 0;
  let useCanvasBg = true;
  let wakeLockTimer = null;
  /** Bumps when a new video source is applied so late play() results are ignored */
  let videoPlayGeneration = 0;
  /** absoluteUrl → { objectUrl, type, blob } — in-memory for current session */
  const mediaMemory = new Map();
  /** absoluteUrl → timestamp when retry is allowed */
  const downloadBackoffUntil = new Map();
  let applyingContent = false;
  let advanceGeneration = 0;
  let isPreloading = false;
  let pendingVersionJob = 0;
  let downloadChain = Promise.resolve();
  let activeDownloads = 0;

  /** Codes that 404'd / were deleted — never poll pairing-status for these again */
  const deadCodes = new Set();
  try {
    const raw = sessionStorage.getItem(DEAD_CODES_KEY);
    if (raw) {
      JSON.parse(raw).forEach((c) => {
        if (c) deadCodes.add(String(c).toUpperCase());
      });
    }
  } catch {
    /* ignore */
  }

  function persistDeadCodes() {
    try {
      sessionStorage.setItem(DEAD_CODES_KEY, JSON.stringify([...deadCodes]));
    } catch {
      /* ignore */
    }
  }

  function normalizeCodeKey(code) {
    if (!code) return null;
    const alnum = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (alnum.length >= 8) {
      return `${alnum.slice(0, 4)}-${alnum.slice(4, 8)}`;
    }
    return String(code).toUpperCase().trim();
  }

  function markDeadCode(code) {
    const key = normalizeCodeKey(code);
    if (!key) return;
    deadCodes.add(key);
    const bare = key.replace(/[^A-Z0-9]/g, '');
    if (bare) deadCodes.add(bare);
    persistDeadCodes();
  }

  function isDeadCode(code) {
    const key = normalizeCodeKey(code);
    if (!key) return false;
    if (deadCodes.has(key)) return true;
    const bare = key.replace(/[^A-Z0-9]/g, '');
    return !!(bare && deadCodes.has(bare));
  }

  // Drop permanently-dead codes restored from cookie/localStorage on boot
  if (isDeadCode(pairingCode)) {
    pairingCode = null;
    store.remove('pairingCode');
  }
  if (isDeadCode(lastPairingCode)) {
    lastPairingCode = null;
    store.remove('lastPairingCode');
  }

  // Re-persist identity immediately on boot (heals missing localStorage or cookie)
  if (deviceId) store.set('deviceId', deviceId);
  if (pairingCode) store.set('pairingCode', pairingCode);
  if (lastPairingCode) store.set('lastPairingCode', lastPairingCode);
  if (deviceName) store.set('deviceName', deviceName);

  /** Format as XXXX-XXXX for admin Add Screen (never a deviceId hex suffix). */
  function formatPairCode(raw) {
    if (!raw) return null;
    const alnum = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (alnum.length >= 8) {
      return `${alnum.slice(0, 4)}-${alnum.slice(4, 8)}`;
    }
    return String(raw).toUpperCase().trim();
  }

  function displayPairCode() {
    const primary = formatPairCode(pairingCode);
    if (primary && !isDeadCode(primary)) return primary;
    const fallback = formatPairCode(lastPairingCode);
    if (fallback && !isDeadCode(fallback)) return fallback;
    return null;
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
  }

  function isRegistered() {
    return !!(deviceId && String(deviceId).trim());
  }

  function apiUrl(path) {
    if (!path) return path;
    if (path.startsWith('http')) return path;
    return path;
  }

  async function jsonFetch(path, options = {}) {
    const res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = Number(res.status);
      err.data = data;
      throw err;
    }
    return data;
  }

  function noteError(err, context) {
    const msg = `${context}: ${err && err.message ? err.message : String(err)}`;
    lastError = `${new Date().toISOString()} ${msg}`;
    console.warn('[hw-signage]', msg, err);
  }

  function mediaIsVisible() {
    const imgOk =
      imageView.style.display !== 'none' &&
      !imageView.hidden &&
      !!imageView.getAttribute('src') &&
      imageView.complete &&
      imageView.naturalWidth > 0;
    // Require a real decoded frame — src alone can leave a blank Chromium tab on Pi
    const vidOk =
      videoView.style.display !== 'none' &&
      !videoView.hidden &&
      !!videoView.getAttribute('src') &&
      videoView.readyState >= 2 &&
      videoView.videoWidth > 0;
    return imgOk || vidOk;
  }

  function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  /** Always-visible side rail: DEVICE CODE = XXXX-XXXX. Zero interaction required. */
  function updateCodeRail() {
    document.body.classList.add('has-code-rail');
    if (!codeRail) return;

    const pair = displayPairCode();
    codeRail.classList.add('code-rail--setup');
    codeRail.classList.remove('code-rail--live', 'code-rail--id-only');
    if (codeRailLabel) codeRailLabel.textContent = 'DEVICE CODE';
    if (pair) {
      if (codeRailCode) codeRailCode.textContent = pair;
      if (codeRailHint) {
        codeRailHint.textContent = isOnline()
          ? 'Phone → Screens → Add Screen → enter this code'
          : 'Offline — using last device code';
      }
    } else if (!isOnline()) {
      if (codeRailCode) codeRailCode.textContent = 'Offline';
      if (codeRailHint) codeRailHint.textContent = 'Waiting for network…';
    } else {
      if (codeRailCode) codeRailCode.textContent = 'Getting…';
      if (codeRailHint) {
        codeRailHint.textContent = 'Phone → Screens → Add Screen → enter this code';
      }
    }
    if (codeRailSub) {
      codeRailSub.textContent = isRegistered() && deviceName ? deviceName : '';
    }
  }

  function updateChrome() {
    updateCodeRail();
    if (!isRegistered()) {
      setVisible(waitingPanel, false);
      return;
    }
    if (isPreloading && !mediaIsVisible()) {
      setVisible(waitingPanel, true);
      return;
    }
    if (!mediaIsVisible()) {
      setVisible(waitingPanel, true);
      if (waitingText && !isPreloading) waitingText.textContent = 'Waiting for signage…';
    } else {
      setVisible(waitingPanel, false);
    }
  }

  function showWaiting(msg, { force = false } = {}) {
    if (!force && !isRegistered()) return;
    if (!force && mediaIsVisible()) {
      updateCodeRail();
      return;
    }
    setVisible(waitingPanel, true);
    if (msg && waitingText) waitingText.textContent = msg;
    updateCodeRail();
  }

  function showLoadingProgress(done, total) {
    if (!isRegistered()) return;
    // Never cover playing cached content during a background version update
    if (mediaIsVisible()) return;
    isPreloading = true;
    setVisible(waitingPanel, true);
    if (waitingText) waitingText.textContent = `Loading signage… ${done}/${total}`;
    updateCodeRail();
  }

  function stopBgCanvas() {
    if (bgRaf) {
      cancelAnimationFrame(bgRaf);
      bgRaf = 0;
    }
    setVisible(bgCanvas, false);
  }

  function drawCoverBlur(ctx, source, cw, ch) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return false;
    const scale = Math.max(cw / sw, ch / sh) * 1.2;
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    try {
      ctx.filter = 'blur(32px) saturate(1.2)';
    } catch {
      /* older browsers */
    }
    ctx.drawImage(source, dx, dy, dw, dh);
    try {
      ctx.filter = 'none';
    } catch {
      /* ignore */
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, cw, ch);
    return true;
  }

  function startBgCanvasFromVideo(video) {
    // Never let blur background block / break foreground video on Pi Chromium
    if (!useCanvasBg || !bgCanvas || !video) return;
    try {
      stopBgCanvas();
      setVisible(bgCanvas, true);
      setVisible(bgVideo, false);
      setVisible(bgImage, false);
      const ctx = bgCanvas.getContext('2d', { alpha: false });
      if (!ctx) {
        useCanvasBg = false;
        setVisible(bgCanvas, false);
        return;
      }

      let failCount = 0;
      const tick = () => {
        bgRaf = 0;
        if (!useCanvasBg || !showingMedia || cachedType !== 'video') return;
        const cw = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
        const ch = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
        if (bgCanvas.width !== cw) bgCanvas.width = cw;
        if (bgCanvas.height !== ch) bgCanvas.height = ch;
        try {
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, cw, ch);
          if (video.readyState >= 2 && video.videoWidth > 0) {
            drawCoverBlur(ctx, video, cw, ch);
            failCount = 0;
          }
        } catch (err) {
          failCount += 1;
          noteError(err, 'bgCanvas');
          if (failCount >= 3) {
            useCanvasBg = false;
            stopBgCanvas();
            return;
          }
        }
        bgRaf = requestAnimationFrame(tick);
      };
      bgRaf = requestAnimationFrame(tick);
    } catch (err) {
      noteError(err, 'startBgCanvasFromVideo');
      useCanvasBg = false;
      stopBgCanvas();
    }
  }

  function stopVideo() {
    stopBgCanvas();
    try {
      videoView.pause();
      videoView.removeAttribute('src');
      videoView.load();
    } catch {
      /* ignore */
    }
    try {
      bgVideo.pause();
      bgVideo.removeAttribute('src');
      bgVideo.load();
    } catch {
      /* ignore */
    }
  }

  function syncBackground(url, type) {
    if (type === 'video') {
      setVisible(bgImage, false);
      // Prefer canvas blur drawn from the foreground video (works on TVs that ignore CSS filter on <video>)
      if (useCanvasBg && bgCanvas) {
        setVisible(bgVideo, false);
        // canvas starts after foreground video has a frame
      } else {
        stopBgCanvas();
        setVisible(bgVideo, true);
        bgVideo.src = url;
        bgVideo.muted = true;
        bgVideo.defaultMuted = true;
        bgVideo.volume = 0;
        bgVideo.loop = true;
        bgVideo.playsInline = true;
        bgVideo.setAttribute('playsinline', '');
        bgVideo.setAttribute('webkit-playsinline', '');
        const playBg = () => {
          bgVideo.play().catch(() => {});
          try {
            if (Math.abs((bgVideo.currentTime || 0) - (videoView.currentTime || 0)) > 0.35) {
              bgVideo.currentTime = videoView.currentTime || 0;
            }
          } catch {
            /* ignore seek errors */
          }
        };
        bgVideo.onloadeddata = playBg;
        playBg();
      }
    } else {
      stopBgCanvas();
      try {
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
      } catch {
        /* ignore */
      }
      setVisible(bgVideo, false);
      setVisible(bgImage, true);
      bgImage.src = url;
    }
  }

  function isSameOriginUploadsUrl(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.startsWith('/uploads/');
    } catch {
      return false;
    }
  }

  function isPlayableMediaUrl(url) {
    if (!url) return false;
    const s = String(url);
    return s.startsWith('blob:') || isSameOriginUploadsUrl(s);
  }

  /** Pi Chromium often needs an explicit video/* MIME on the Blob for blob: playback. */
  function objectUrlFromBlob(blob, type) {
    let typed = blob;
    try {
      if (type === 'video' && (!blob.type || !blob.type.startsWith('video/'))) {
        typed = blob.slice(0, blob.size, 'video/mp4');
      } else if (type === 'image' && (!blob.type || !blob.type.startsWith('image/'))) {
        typed = blob.slice(0, blob.size, 'image/jpeg');
      } else if (type === 'video' && blob.type && !/mp4|webm|ogg/i.test(blob.type)) {
        typed = blob.slice(0, blob.size, 'video/mp4');
      }
    } catch {
      typed = blob;
    }
    return URL.createObjectURL(typed);
  }

  function findAbsoluteUrlForObjectUrl(objectUrl) {
    if (!objectUrl) return null;
    for (const [abs, entry] of mediaMemory.entries()) {
      if (entry && entry.objectUrl === objectUrl) return abs;
    }
    return null;
  }

  function videoCodecHint() {
    try {
      const probe = document.createElement('video');
      const mp4 =
        probe.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') ||
        probe.canPlayType('video/mp4; codecs="avc1.4D401E, mp4a.40.2"') ||
        probe.canPlayType('video/mp4');
      if (!mp4) {
        return 'This browser may not play MP4/H.264 — encode as H.264 AAC MP4.';
      }
    } catch {
      /* ignore */
    }
    return 'Use H.264 (Baseline/Main) + AAC in an MP4 for Raspberry Pi Chromium.';
  }

  function waitForVideoReady(video, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
        fn(arg);
      };
      const onReady = () => finish(resolve);
      const onError = () => {
        const code = video.error ? video.error.code : '?';
        finish(reject, new Error(`video element error code=${code}`));
      };
      const timer = setTimeout(() => finish(reject, new Error('video load timeout')), timeoutMs);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
      if (video.readyState >= 2 && video.videoWidth > 0) finish(resolve);
    });
  }

  async function safeVideoPlay(video) {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    try {
      await video.play();
      return true;
    } catch (err) {
      noteError(err, 'video.play');
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      try {
        await video.play();
        return true;
      } catch (err2) {
        noteError(err2, 'video.play.retryMuted');
        return false;
      }
    }
  }

  function revokeIfUnused(objectUrl) {
    if (!objectUrl || !String(objectUrl).startsWith('blob:')) return;
    for (const entry of mediaMemory.values()) {
      if (entry.objectUrl === objectUrl) return;
    }
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }

  /**
   * Play video from blob: (preferred) or same-origin /uploads/ fallback.
   * Pi Chromium often fails on blob: video even when the file downloaded fine.
   */
  async function playVideoSource(url, { loop = true, sourceUrl = null, allowFallback = true } = {}) {
    const gen = ++videoPlayGeneration;
    setVisible(imageView, false);
    setVisible(videoView, true);
    stopBgCanvas();

    videoView.muted = true;
    videoView.defaultMuted = true;
    videoView.volume = 0;
    videoView.loop = loop;
    videoView.playsInline = true;
    videoView.setAttribute('playsinline', '');
    videoView.setAttribute('webkit-playsinline', '');
    videoView.setAttribute('muted', '');
    videoView.setAttribute('autoplay', '');
    videoView.onloadeddata = null;
    videoView.onplaying = null;
    videoView.onerror = null;

    try {
      videoView.pause();
    } catch {
      /* ignore */
    }
    videoView.src = url;
    try {
      videoView.load();
    } catch {
      /* ignore */
    }

    try {
      await waitForVideoReady(videoView);
      if (gen !== videoPlayGeneration) return false;
      const played = await safeVideoPlay(videoView);
      if (gen !== videoPlayGeneration) return false;
      if (!played || videoView.videoWidth <= 0) {
        throw new Error('play failed or zero video dimensions');
      }

      cachedObjectUrl = url;
      cachedType = 'video';
      showingMedia = true;
      store.set('cachedType', 'video');
      if (isRegistered()) setVisible(waitingPanel, false);
      updateChrome();

      // Background blur is decorative only — never block foreground playback
      try {
        syncBackground(url, 'video');
        if (useCanvasBg) startBgCanvasFromVideo(videoView);
      } catch (err) {
        noteError(err, 'video.background');
        useCanvasBg = false;
        stopBgCanvas();
      }
      return true;
    } catch (err) {
      noteError(err, 'playVideoSource');
      if (allowFallback) {
        const fallback = sourceUrl || findAbsoluteUrlForObjectUrl(url);
        if (fallback && isSameOriginUploadsUrl(fallback) && fallback !== url) {
          noteError(new Error(`blob video failed; falling back to ${fallback}`), 'video.fallback');
          return playVideoSource(fallback, {
            loop,
            sourceUrl: null,
            allowFallback: false,
          });
        }
      }
      if (gen === videoPlayGeneration) {
        showingMedia = false;
        try {
          videoView.removeAttribute('src');
          videoView.load();
        } catch {
          /* ignore */
        }
        showWaiting(`Video won’t play. ${videoCodecHint()}`, { force: true });
      }
      return false;
    }
  }

  function displayMedia(url, type, options = {}) {
    // Prefer fully-downloaded blob: URLs; allow same-origin /uploads/ as Pi Chromium fallback
    if (!isPlayableMediaUrl(url)) {
      noteError(new Error('refused non-local playback URL'), 'displayMedia');
      return;
    }
    const loop = options.loop !== false;
    const sourceUrl = options.sourceUrl || findAbsoluteUrlForObjectUrl(url) || null;
    updateCodeRail();
    isPreloading = false;

    if (cachedObjectUrl && cachedObjectUrl !== url) {
      revokeIfUnused(cachedObjectUrl);
    }
    cachedObjectUrl = url;
    cachedType = type;
    store.set('cachedType', type);

    if (type === 'video') {
      // Optimistic hide of waiting only after frames decode (playVideoSource)
      showingMedia = false;
      void playVideoSource(url, { loop, sourceUrl, allowFallback: true });
    } else {
      videoPlayGeneration += 1;
      stopVideo();
      setVisible(videoView, false);
      setVisible(imageView, true);
      syncBackground(url, 'image');
      imageView.src = url;
      imageView.onload = () => {
        showingMedia = true;
        if (isRegistered()) setVisible(waitingPanel, false);
        updateChrome();
      };
      imageView.onerror = () => {
        noteError(new Error('image failed to load'), 'image');
        showingMedia = false;
        if (sourceUrl && isSameOriginUploadsUrl(sourceUrl) && sourceUrl !== url) {
          imageView.src = sourceUrl;
          return;
        }
        showWaiting('Image failed to load', { force: true });
        updateChrome();
      };
    }
  }

  function absoluteMediaUrl(url) {
    return new URL(url, location.origin).href;
  }

  function cacheRequestForUrl(url) {
    return new Request(`${location.origin}/__signage__/media?u=${encodeURIComponent(url)}`);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function cachePutUrl(url, type, blob) {
    if (!('caches' in window)) return;
    const cache = await caches.open(CACHE_NAME);
    const headers = new Headers({
      'Content-Type': type === 'video' ? 'video/mp4' : blob.type || 'image/jpeg',
      'X-Signage-Type': type,
      'X-Signage-Url': url,
    });
    await cache.put(cacheRequestForUrl(url), new Response(blob.slice(0), { headers }));
  }

  async function cacheGetUrl(url) {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(cacheRequestForUrl(url));
    if (!res) return null;
    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    const type =
      res.headers.get('X-Signage-Type') ||
      (blob.type && blob.type.startsWith('video') ? 'video' : 'image');
    const sourceUrl = res.headers.get('X-Signage-Url') || url;
    return { blob, type, objectUrl: objectUrlFromBlob(blob, type), sourceUrl };
  }

  async function cacheGetAny() {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const ours = keys.filter((r) => r.url.includes('/__signage__/media'));
    if (!ours.length) {
      const legacy = keys.filter(
        (r) => r.url.includes('/__cached__/') || r.url.includes('/__signage__/')
      );
      if (!legacy.length) return null;
      legacy.sort((a, b) => a.url.localeCompare(b.url));
      const res = await cache.match(legacy[legacy.length - 1]);
      if (!res) return null;
      const blob = await res.blob();
      if (!blob || blob.size <= 0) return null;
      const type =
        res.headers.get('X-Signage-Type') ||
        (blob.type && blob.type.startsWith('video') ? 'video' : 'image');
      const sourceUrl = res.headers.get('X-Signage-Url') || null;
      return { blob, type, objectUrl: objectUrlFromBlob(blob, type), sourceUrl };
    }
    const res = await cache.match(ours[ours.length - 1]);
    if (!res) return null;
    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    const type =
      res.headers.get('X-Signage-Type') ||
      (blob.type && blob.type.startsWith('video') ? 'video' : 'image');
    const sourceUrl = res.headers.get('X-Signage-Url') || null;
    return { blob, type, objectUrl: objectUrlFromBlob(blob, type), sourceUrl };
  }

  function clearMediaMemory(map = mediaMemory) {
    for (const entry of map.values()) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch {
        /* ignore */
      }
    }
    map.clear();
  }

  /** Full-file download into ArrayBuffer — never stream partial content into <video>. */
  async function downloadCompleteBlob(url, typeHint = null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength <= 0) throw new Error('empty download');
    let ctype = (res.headers.get('Content-Type') || '').split(';')[0].trim();
    if (typeHint === 'video' && (!ctype || !ctype.startsWith('video/'))) {
      ctype = 'video/mp4';
    } else if (typeHint === 'image' && (!ctype || !ctype.startsWith('image/'))) {
      ctype = 'image/jpeg';
    } else if (!ctype || ctype === 'application/octet-stream') {
      ctype = typeHint === 'video' ? 'video/mp4' : 'application/octet-stream';
    }
    return new Blob([buf], { type: ctype });
  }

  function enqueueDownload(task) {
    const run = downloadChain.then(async () => {
      while (activeDownloads >= DOWNLOAD_CONCURRENCY) {
        await sleep(50);
      }
      activeDownloads += 1;
      try {
        return await task();
      } finally {
        activeDownloads -= 1;
      }
    });
    downloadChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Memory → Cache API → full network download (with backoff).
   * Playback callers must use allowNetwork:false so Wi‑Fi never touches <video>/<img>.
   */
  async function resolveItemMedia(item, { allowNetwork = true, memoryMap = mediaMemory } = {}) {
    const url = absoluteMediaUrl(item.url);
    const mem = memoryMap.get(url);
    if (mem?.objectUrl?.startsWith('blob:')) {
      return { url, objectUrl: mem.objectUrl, type: mem.type || item.type, source: 'memory' };
    }

    try {
      const hit = await cacheGetUrl(url);
      if (hit?.objectUrl?.startsWith('blob:')) {
        memoryMap.set(url, {
          objectUrl: hit.objectUrl,
          type: hit.type || item.type,
          blob: hit.blob,
        });
        return {
          url: hit.sourceUrl || url,
          objectUrl: hit.objectUrl,
          type: hit.type || item.type,
          source: 'cache',
        };
      }
    } catch (err) {
      noteError(err, 'cacheGetUrl');
    }

    if (!allowNetwork) return null;

    const until = downloadBackoffUntil.get(url) || 0;
    if (Date.now() < until) return null;

    return enqueueDownload(async () => {
      const again = memoryMap.get(url);
      if (again?.objectUrl?.startsWith('blob:')) {
        return { url, objectUrl: again.objectUrl, type: again.type || item.type, source: 'memory' };
      }
      try {
        const cached = await cacheGetUrl(url);
        if (cached?.objectUrl?.startsWith('blob:')) {
          memoryMap.set(url, {
            objectUrl: cached.objectUrl,
            type: cached.type || item.type,
            blob: cached.blob,
          });
          return {
            url,
            objectUrl: cached.objectUrl,
            type: cached.type || item.type,
            source: 'cache',
          };
        }
      } catch {
        /* continue to network */
      }

      try {
        const blob = await downloadCompleteBlob(url, item.type);
        const objectUrl = objectUrlFromBlob(blob, item.type);
        memoryMap.set(url, { objectUrl, type: item.type, blob });
        downloadBackoffUntil.delete(url);
        try {
          await cachePutUrl(url, item.type, blob);
        } catch (err) {
          noteError(err, 'cachePutUrl');
        }
        return { url, objectUrl, type: item.type, source: 'network' };
      } catch (err) {
        noteError(err, 'resolveItemMedia');
        const prev = downloadBackoffUntil.get(url);
        const delay = prev && Date.now() < prev + 120_000 ? 120_000 : 15_000;
        downloadBackoffUntil.set(url, Date.now() + delay);
        return null;
      }
    });
  }

  /** Download every item fully (sequential). Updates progress for first-load UI. */
  async function preloadAllItems(
    items,
    { memoryMap = mediaMemory, onProgress, timeoutMs = PRELOAD_TIMEOUT_MS } = {}
  ) {
    const total = items.length;
    let ready = 0;
    const started = Date.now();
    if (onProgress) onProgress(0, total);

    for (const item of items) {
      if (Date.now() - started > timeoutMs) break;

      let media = await resolveItemMedia(item, { allowNetwork: true, memoryMap });
      for (let attempt = 0; !media && attempt < 3; attempt += 1) {
        if (Date.now() - started > timeoutMs) break;
        await sleep(Math.min(45_000, 4_000 * 2 ** attempt));
        downloadBackoffUntil.delete(absoluteMediaUrl(item.url));
        media = await resolveItemMedia(item, { allowNetwork: true, memoryMap });
      }
      if (media) ready += 1;
      if (onProgress) onProgress(ready, total);
    }
    return ready;
  }

  function itemsReadyFromMap(items, memoryMap) {
    return items.filter((it) => {
      const entry = memoryMap.get(absoluteMediaUrl(it.url));
      return entry?.objectUrl?.startsWith('blob:');
    });
  }

  function savePlaylistSnapshot(items, version, mode) {
    if (!items || !items.length) return;
    const snapshot = {
      version: Number(version) || 0,
      mode: mode || (items.length > 1 ? 'playlist' : 'single'),
      savedAt: new Date().toISOString(),
      items: items.map((it) => ({
        url: it.url,
        type: it.type,
        durationSec: it.durationSec ?? null,
        filename: it.filename || null,
        cacheKey: absoluteMediaUrl(it.url),
      })),
    };
    try {
      store.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (err) {
      noteError(err, 'savePlaylistSnapshot');
    }
  }

  function loadPlaylistSnapshot() {
    try {
      const raw = store.get(SNAPSHOT_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.items) || !snap.items.length) return null;
      return snap;
    } catch {
      return null;
    }
  }

  async function hydrateItemsFromCache(items) {
    let ready = 0;
    for (const item of items) {
      const media = await resolveItemMedia(item, { allowNetwork: false });
      if (media?.objectUrl?.startsWith('blob:')) ready += 1;
    }
    return ready;
  }

  /** Boot / offline: restore last playlist + blobs without network. */
  async function restoreOfflinePlaylist() {
    try {
      const snap = loadPlaylistSnapshot();
      if (snap) {
        const ready = await hydrateItemsFromCache(snap.items);
        if (ready > 0) {
          const savedIndex = Number(store.get('playlistIndex', '0')) || 0;
          if (activatePlaylist(snap.items, Number(snap.version) || 0, savedIndex)) {
            await showPlaylistItem(playlistIndex);
            updateChrome();
            return true;
          }
        }
      }
      // Fallback: any single cached media file
      const hit = await cacheGetAny();
      if (hit?.objectUrl?.startsWith('blob:')) {
        displayMedia(hit.objectUrl, hit.type, {
          loop: true,
          sourceUrl: hit.sourceUrl || null,
        });
        updateChrome();
        return true;
      }
    } catch (err) {
      noteError(err, 'restoreOfflinePlaylist');
    }
    return false;
  }

  async function restoreCache() {
    return restoreOfflinePlaylist();
  }

  function stopSlideTimer() {
    if (slideTimer) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
  }

  function itemDuration(item) {
    if (item.durationSec != null && Number(item.durationSec) > 0) {
      return Number(item.durationSec) * 1000;
    }
    return (item.type === 'video' ? DEFAULT_VIDEO_SEC : DEFAULT_IMAGE_SEC) * 1000;
  }

  function scheduleAdvance(item, isMulti) {
    stopSlideTimer();
    if (!isMulti) {
      videoView.onended = null;
      return;
    }
    const gen = ++advanceGeneration;
    const ms = itemDuration(item);
    if (item.type === 'video') {
      videoView.onended = () => {
        if (gen !== advanceGeneration) return;
        videoView.onended = null;
        stopSlideTimer();
        showPlaylistItem(playlistIndex + 1);
      };
    } else {
      videoView.onended = null;
    }
    slideTimer = setTimeout(() => {
      if (gen !== advanceGeneration) return;
      videoView.onended = null;
      showPlaylistItem(playlistIndex + 1);
    }, ms);
  }

  /** Play only from local blob cache — never fetch during rotation. */
  async function showPlaylistItem(index) {
    if (!playlistItems.length) return;
    const n = playlistItems.length;
    const isMulti = playMode === 'playlist' || n > 1;
    let idx = ((index % n) + n) % n;

    let media = null;
    for (let tried = 0; tried < n; tried += 1) {
      const candidate = playlistItems[idx];
      media = await resolveItemMedia(candidate, { allowNetwork: false });
      if (media?.objectUrl?.startsWith('blob:')) break;
      media = null;
      if (!isMulti) break;
      idx = (idx + 1) % n;
    }

    if (!media) {
      updateChrome();
      if (isMulti) {
        stopSlideTimer();
        slideTimer = setTimeout(() => showPlaylistItem(playlistIndex + 1), 5_000);
      }
      return;
    }

    playlistIndex = idx;
    store.set('playlistIndex', String(playlistIndex));
    store.set('playlistItemStartedAt', String(Date.now()));
    const item = playlistItems[playlistIndex];

    displayMedia(media.objectUrl, media.type || item.type, {
      loop: !isMulti,
      sourceUrl: media.url || absoluteMediaUrl(item.url),
    });
    updateChrome();
    scheduleAdvance(item, isMulti);
  }

  function normalizeItems(current) {
    if (Array.isArray(current.items) && current.items.length) return current.items;
    if (current.url) {
      return [
        {
          type: current.type,
          url: current.url,
          durationSec: current.durationSec ?? null,
          filename: current.filename,
        },
      ];
    }
    return [];
  }

  function activatePlaylist(items, version, startIndex) {
    const ready = itemsReadyFromMap(items, mediaMemory);
    if (!ready.length) return false;

    // Prefer full published list when everything cached; otherwise only ready blobs
    playlistItems = ready.length === items.length ? items : ready;
    playMode = playlistItems.length > 1 ? 'playlist' : 'single';
    let idx = startIndex;
    if (idx < 0 || idx >= playlistItems.length) idx = 0;
    if (ready.length !== items.length) {
      const want = absoluteMediaUrl(items[Math.min(startIndex, items.length - 1)].url);
      const found = playlistItems.findIndex((it) => absoluteMediaUrl(it.url) === want);
      idx = found >= 0 ? found : 0;
    }

    playlistIndex = idx;
    contentVersion = version;
    store.set('contentVersion', String(contentVersion));
    store.set('playlistIndex', String(idx));
    store.set('lastUpdate', new Date().toISOString());
    // Persist playlist order/durations for offline reboot
    savePlaylistSnapshot(playlistItems, version, playMode);
    return true;
  }

  async function applyCurrentPayload(current) {
    const items = normalizeItems(current);
    if (!items.length) {
      // Empty publish: keep offline cached playlist if we have one
      if (mediaIsVisible() && playlistItems.length) {
        updateChrome();
        return;
      }
      stopSlideTimer();
      playlistItems = [];
      if (!mediaIsVisible()) showWaiting('Waiting for signage…');
      updateChrome();
      return;
    }

    const nextVersion = Number(current.version);
    const versionChanged = nextVersion !== contentVersion;
    const playing = mediaIsVisible();

    const savedVersion = Number(store.get('contentVersion', '-1'));
    const savedIndex = Number(store.get('playlistIndex', '0'));
    let startIndex = 0;
    if (
      nextVersion === savedVersion &&
      Number.isFinite(savedIndex) &&
      savedIndex >= 0 &&
      savedIndex < items.length
    ) {
      startIndex = savedIndex;
    }

    // Same version already playing from cache — nothing to do
    if (!versionChanged && playing && playlistItems.length) {
      savePlaylistSnapshot(playlistItems, contentVersion, playMode);
      updateChrome();
      return;
    }

    // --- Version change while already playing: download in background, keep old content ---
    if (versionChanged && playing) {
      const jobId = ++pendingVersionJob;
      const staging = new Map();
      await preloadAllItems(items, {
        memoryMap: staging,
        timeoutMs: PRELOAD_TIMEOUT_MS,
      });
      if (jobId !== pendingVersionJob) {
        clearMediaMemory(staging);
        return;
      }

      const readyCount = itemsReadyFromMap(items, staging).length;
      if (readyCount === 0) {
        clearMediaMemory(staging);
        noteError(new Error('new version download failed; keeping previous'), 'version-swap');
        return;
      }

      clearMediaMemory(mediaMemory);
      for (const [k, v] of staging) mediaMemory.set(k, v);
      staging.clear();
      downloadBackoffUntil.clear();

      if (!activatePlaylist(items, nextVersion, startIndex)) return;
      isPreloading = false;
      await showPlaylistItem(playlistIndex);
      updateChrome();
      return;
    }

    // --- First load / nothing on screen: wait for full cache with progress ---
    isPreloading = true;
    showLoadingProgress(0, items.length);
    if (versionChanged) {
      clearMediaMemory(mediaMemory);
      downloadBackoffUntil.clear();
    }

    await preloadAllItems(items, {
      memoryMap: mediaMemory,
      onProgress: (done, total) => showLoadingProgress(done, total),
      timeoutMs: PRELOAD_TIMEOUT_MS,
    });

    if (!activatePlaylist(items, nextVersion, startIndex)) {
      // Fall back to any previously cached offline playlist
      isPreloading = false;
      const restored = await restoreOfflinePlaylist();
      if (!restored) {
        isPreloading = true;
        showWaiting('Loading signage… (retrying)', { force: true });
        setTimeout(() => {
          contentVersion = -1;
          pollOnce();
        }, 20_000);
      }
      return;
    }

    isPreloading = false;
    await showPlaylistItem(playlistIndex);
    updateChrome();
  }

  async function pollOnce() {
    if (applyingContent) return;
    if (!isOnline()) {
      networkOk = false;
      if (!mediaIsVisible()) await restoreOfflinePlaylist();
      updateChrome();
      return;
    }
    try {
      const current = await jsonFetch('/api/screen/current');
      networkOk = true;

      const hasContent =
        (Array.isArray(current.items) && current.items.length > 0) ||
        (current.url && current.type);

      if (!hasContent) {
        if (mediaIsVisible() && playlistItems.length) {
          updateChrome();
          return;
        }
        stopSlideTimer();
        if (!mediaIsVisible()) showWaiting('Waiting for signage…');
        updateChrome();
        return;
      }

      const sameVersion = current.version === contentVersion;
      if (sameVersion && mediaIsVisible() && playlistItems.length) {
        updateChrome();
        return;
      }

      applyingContent = true;
      try {
        await applyCurrentPayload(current);
      } finally {
        applyingContent = false;
      }
      updateChrome();
    } catch (err) {
      networkOk = false;
      noteError(err, 'poll');
      // Stay on local cached playlist — no error UI
      if (!mediaIsVisible()) await restoreOfflinePlaylist();
      updateChrome();
    }
  }

  function clearLocalIdentity() {
    deviceId = null;
    pairingCode = null;
    lastPairingCode = null;
    deviceName = null;
    store.remove('deviceId');
    store.remove('pairingCode');
    store.remove('deviceName');
    store.remove('lastPairingCode');
    clearCookie(cookieName('deviceId'));
    clearCookie(cookieName('pairingCode'));
    clearCookie(cookieName('deviceName'));
    clearCookie(cookieName('lastPairingCode'));
    clearCookie('hw_deviceId');
    clearCookie('hw_pairingCode');
    clearCookie('hw_deviceName');
    clearCookie('hw_lastPairingCode');
  }

  let pairingFetchPromise = null;
  let refreshingPairing = null;
  let pairingCheckGen = 0;
  let pairTimer = null;
  let pollTimer = null;
  let hbTimer = null;

  function stopPairTimer() {
    if (pairTimer) {
      clearInterval(pairTimer);
      pairTimer = null;
    }
  }

  function startPairTimer() {
    stopPairTimer();
    pairTimer = setInterval(() => {
      checkPairing().catch((err) => noteError(err, 'pairTimer'));
    }, PAIRING_MS);
  }

  function isGoneStatus(err) {
    const status = Number(err && err.status);
    const bodyStatus = err && err.data && err.data.status;
    return (
      status === 404 ||
      status === 410 ||
      status === 400 ||
      bodyStatus === 'unknown' ||
      bodyStatus === 'gone'
    );
  }

  /**
   * Screen deleted / code unknown: stop polling that code forever, clear identity,
   * fetch exactly one new DEVICE CODE, then resume polling.
   */
  async function beginFreshPairing(reason) {
    if (!isOnline()) {
      updateChrome();
      return;
    }
    if (refreshingPairing) return refreshingPairing;
    refreshingPairing = (async () => {
      console.warn('[hw-signage] fresh pairing:', reason, 'old=', pairingCode);
      stopPairTimer();
      pairingCheckGen += 1;

      if (pairingCode) markDeadCode(pairingCode);
      if (lastPairingCode) markDeadCode(lastPairingCode);

      clearLocalIdentity();
      if (codeRailCode) codeRailCode.textContent = 'Getting…';
      updateChrome();

      await ensurePairingCode({ force: true });
      startPairTimer();
      updateChrome();
    })().finally(() => {
      refreshingPairing = null;
    });
    return refreshingPairing;
  }

  async function ensurePairingCode(options = {}) {
    const force = !!options.force;

    // Offline: never wipe pairing or hammer the API — keep showing last code / content
    if (!isOnline()) {
      updateChrome();
      return;
    }

    if (pairingCode && isDeadCode(pairingCode)) {
      pairingCode = null;
      store.remove('pairingCode');
    }
    if (lastPairingCode && isDeadCode(lastPairingCode)) {
      lastPairingCode = null;
      store.remove('lastPairingCode');
    }

    if (!force && formatPairCode(pairingCode) && !isDeadCode(pairingCode)) {
      updateChrome();
      return;
    }
    if (pairingFetchPromise) return pairingFetchPromise;

    pairingFetchPromise = (async () => {
      if (force || deviceId || lastPairingCode || deviceName) {
        deviceId = null;
        deviceName = null;
        lastPairingCode = null;
        store.remove('deviceId');
        store.remove('deviceName');
        store.remove('lastPairingCode');
      }
      pairingCode = null;
      store.remove('pairingCode');
      updateChrome();

      try {
        const data = await jsonFetch('/api/devices/pairing-code', {
          method: 'POST',
          body: '{}',
        });
        const next = data.pairingCode;
        if (!next || isDeadCode(next)) {
          throw new Error('server returned unusable pairing code');
        }
        pairingCode = next;
        store.set('pairingCode', pairingCode);
        networkOk = true;
        updateChrome();
      } catch (err) {
        networkOk = false;
        noteError(err, 'pairing-code');
        if (codeRailCode && !mediaIsVisible()) codeRailCode.textContent = 'Retrying…';
        updateChrome();
      }
    })().finally(() => {
      pairingFetchPromise = null;
    });

    return pairingFetchPromise;
  }

  async function checkPairing() {
    if (refreshingPairing) return;
    if (!isOnline()) {
      updateChrome();
      return;
    }

    if (pairingCode && isDeadCode(pairingCode)) {
      await beginFreshPairing('dead-code-blocked');
      return;
    }
    if (!formatPairCode(pairingCode)) {
      await beginFreshPairing('no-pairing-code');
      return;
    }
    if (isRegistered()) {
      updateChrome();
      return;
    }

    const codeAtStart = formatPairCode(pairingCode);
    if (!codeAtStart || isDeadCode(codeAtStart)) {
      await beginFreshPairing('invalid-code');
      return;
    }

    const gen = ++pairingCheckGen;
    try {
      const data = await jsonFetch(
        '/api/devices/pairing-status/' + encodeURIComponent(codeAtStart)
      );
      if (gen !== pairingCheckGen) return;
      if (isDeadCode(codeAtStart)) return;
      if (formatPairCode(pairingCode) !== codeAtStart) return;

      networkOk = true;
      if (data.status === 'unknown' || data.status === 'gone') {
        markDeadCode(codeAtStart);
        pairingCode = null;
        store.remove('pairingCode');
        await beginFreshPairing('status-' + data.status);
        return;
      }
      if (data.status === 'registered' && data.deviceId) {
        deviceId = data.deviceId;
        store.set('deviceId', deviceId);
        if (data.name) {
          deviceName = data.name;
          store.set('deviceName', deviceName);
        }
        lastPairingCode = pairingCode;
        store.set('lastPairingCode', pairingCode);
        store.set('pairingCode', pairingCode);
        updateChrome();
        sendHeartbeat();
      } else {
        updateChrome();
      }
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-status');
      if (isGoneStatus(err)) {
        markDeadCode(codeAtStart);
        if (formatPairCode(pairingCode) === codeAtStart) {
          pairingCode = null;
          lastPairingCode = null;
          store.remove('pairingCode');
          store.remove('lastPairingCode');
        }
        await beginFreshPairing('status-' + (err.status || 'gone'));
      } else if (!pairingCode) {
        await beginFreshPairing('status-error-empty');
      } else {
        updateChrome();
      }
    }
  }

  async function sendHeartbeat() {
    if (!isRegistered()) return;
    if (refreshingPairing) return;
    if (!isOnline()) return;
    try {
      await jsonFetch('/api/screen/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          currentVersion: Math.max(contentVersion, 0),
          appVersion: APP_VERSION,
        }),
      });
      store.set('lastHeartbeat', new Date().toISOString());
      networkOk = true;
    } catch (err) {
      networkOk = false;
      noteError(err, 'heartbeat');
      if (isGoneStatus(err) || (err.data && err.data.error === 'Device not registered')) {
        if (pairingCode) markDeadCode(pairingCode);
        deviceId = null;
        store.remove('deviceId');
        await beginFreshPairing('heartbeat-gone');
      }
    }
  }

  function resetPairing() {
    if (pairingCode) markDeadCode(pairingCode);
    beginFreshPairing('manual-reset');
  }

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (hbTimer) clearInterval(hbTimer);
    stopPairTimer();
    if (wakeLockTimer) clearInterval(wakeLockTimer);
    stopSlideTimer();
    pollTimer = hbTimer = wakeLockTimer = null;
  }

  function startLoops() {
    clearTimers();
    updateChrome();
    ensurePairingCode();
    pollOnce();
    sendHeartbeat();
    requestWakeLock();
    pollTimer = setInterval(pollOnce, POLL_MS);
    hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    startPairTimer();
    wakeLockTimer = setInterval(() => {
      requestWakeLock();
    }, WAKE_LOCK_MS);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        if (wakeLock) {
          try {
            await wakeLock.release();
          } catch {
            /* ignore */
          }
          wakeLock = null;
        }
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch (err) {
      noteError(err, 'wakeLock');
    }
  }

  function enterFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).catch((err) => noteError(err, 'fullscreen'));
    }
  }

  function toggleDebug() {
    if (debugPanel.style.display !== 'none' && !debugPanel.hidden) {
      setVisible(debugPanel, false);
      return;
    }
    debugText.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = [
      'H&W Signage Web Player',
      `Device ID: ${deviceId || '(not registered)'}`,
      `Pairing code: ${displayPairCode() || '—'}`,
      `App version: ${APP_VERSION}`,
      `Persist: localStorage+cookie`,
      `Server: ${location.origin}`,
      `Signage version: ${contentVersion}`,
      `Mode: ${playMode} (${playlistItems.length} item(s), index ${playlistIndex})`,
      `Showing media: ${mediaIsVisible()}`,
      `Cached type: ${cachedType || '—'}`,
      `Last update: ${store.get('lastUpdate') || '—'}`,
      `Last heartbeat: ${store.get('lastHeartbeat') || '—'}`,
      `Network: ${networkOk ? 'OK' : 'Unavailable (using cache)'}`,
      `Last error: ${lastError || '—'}`,
      '',
      'Tap 3× or Esc to close',
    ].join('\n');
    debugText.appendChild(pre);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset pairing (new device code)';
    resetBtn.style.cssText =
      'margin-top:1.25rem;padding:0.85rem 1.25rem;font-size:1.1rem;font-weight:700;cursor:pointer;background:#1B5E3B;color:#fff;border:none;border-radius:8px;';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetPairing();
      setVisible(debugPanel, false);
    });
    debugText.appendChild(resetBtn);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Use Reset if you need a new code for Screens → Add Screen';
    debugText.appendChild(hint);

    setVisible(debugPanel, true);
  }

  document.addEventListener('click', (e) => {
    if (e.target && (e.target.closest('button') || e.target.closest('#debugPanel'))) {
      return;
    }
    enterFullscreen();
    requestWakeLock();
    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, 800);
    if (tapCount >= 3) {
      tapCount = 0;
      toggleDebug();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setVisible(debugPanel, false);
    if (e.key === 'f' || e.key === 'F') enterFullscreen();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      pollOnce();
      if (isOnline()) ensurePairingCode();
    }
  });

  window.addEventListener('online', () => {
    networkOk = true;
    updateChrome();
    pollOnce();
    ensurePairingCode();
  });

  window.addEventListener('offline', () => {
    networkOk = false;
    updateChrome();
  });

  async function boot() {
    setVisible(debugPanel, false);
    updateChrome();

    // Offline-first: start cached playlist immediately (no network wait)
    await restoreOfflinePlaylist();

    // Pairing / sync in parallel — never wipe cache when offline
    if (isOnline()) {
      ensurePairingCode().catch(() => {});
    } else {
      updateChrome();
    }

    startLoops();
    requestWakeLock();
    // Backup if window manager did not already put Chromium in --kiosk fullscreen
    enterFullscreen();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => noteError(err, 'sw'));
    }
  }

  boot();
})();
