window.tvLocalBlazorPlayer = {
  _hls: null,
  _slotHls: {},

  _attachStream: function (video, url, useProxy, startSeconds, muted, storeSlot) {
    const targetUrl = useProxy ? '/api/proxy?url=' + encodeURIComponent(url) : url;
    const clean = url.split('?')[0].toLowerCase();
    const isDirectFile = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'].some((ext) => clean.endsWith(ext));

    let pendingSeek = startSeconds && startSeconds > 0 ? startSeconds : 0;
    const applySeekAndPlay = () => {
      if (pendingSeek > 0) {
        const target = pendingSeek;
        pendingSeek = 0;
        try {
          video.currentTime = target;
        } catch {
          // Ignore invalid seek
        }
      }
      if (typeof muted === 'boolean') {
        video.muted = muted;
      }
      video.play().catch(() => {});
    };

    video.onloadedmetadata = () => {
      if (pendingSeek > 0) {
        const target = pendingSeek;
        pendingSeek = 0;
        try {
          video.currentTime = target;
        } catch {
          // Ignore
        }
      }
    };

    if (!isDirectFile && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
      if (storeSlot) {
        this._slotHls[video.id] = hls;
      } else {
        this._hls = hls;
      }
      hls.loadSource(targetUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, applySeekAndPlay);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !useProxy) {
          if (storeSlot) {
            this.playSlot(video.id, url, true, pendingSeek, video.muted);
          } else {
            this.play(video.id, url, true, pendingSeek);
          }
        }
      });
    } else {
      video.src = targetUrl;
      applySeekAndPlay();
    }
  },

  play: function (videoId, url, useProxy, startSeconds) {
    const video = document.getElementById(videoId);
    if (!video || !url) return;

    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }

    this._attachStream(video, url, useProxy, startSeconds || 0, undefined, false);
  },

  getTime: function (videoId) {
    const video = document.getElementById(videoId);
    return video && !Number.isNaN(video.currentTime) ? video.currentTime : 0;
  },

  pause: function (videoId) {
    const video = document.getElementById(videoId);
    if (video) video.pause();
  },

  seekAndPlay: function (videoId, seconds) {
    const video = document.getElementById(videoId);
    if (!video) return;
    if (seconds > 0) {
      try {
        video.currentTime = seconds;
      } catch {
        // Ignore
      }
    }
    video.play().catch(() => {});
  },

  seekBy: function (videoId, delta) {
    const video = document.getElementById(videoId);
    if (!video) return;
    video.currentTime = Math.max(0, (video.currentTime || 0) + delta);
  },

  setRate: function (videoId, rate) {
    const video = document.getElementById(videoId);
    if (video) video.playbackRate = rate;
  },

  playSlot: function (videoId, url, useProxy, startSeconds, muted) {
    const video = document.getElementById(videoId);
    if (!video || !url) return;

    if (this._slotHls[videoId]) {
      this._slotHls[videoId].destroy();
      delete this._slotHls[videoId];
    }

    this._attachStream(video, url, useProxy, startSeconds || 0, Boolean(muted), true);
  },

  stopSlot: function (videoId) {
    if (this._slotHls[videoId]) {
      this._slotHls[videoId].destroy();
      delete this._slotHls[videoId];
    }
    const video = document.getElementById(videoId);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },

  setSlotMuted: function (videoId, muted) {
    const video = document.getElementById(videoId);
    if (video) video.muted = Boolean(muted);
  },

  togglePlaySlot: function (videoId) {
    const video = document.getElementById(videoId);
    if (!video) return false;
    if (video.paused) {
      video.play().catch(() => {});
      return true;
    }
    video.pause();
    return false;
  },

  toggleFullscreen: async function (containerId, forceLandscape) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      try {
        screen.orientation?.unlock?.();
      } catch {}
    } else if (el.requestFullscreen) {
      await el.requestFullscreen().catch(() => {});
      if (forceLandscape) {
        try {
          await screen.orientation?.lock?.('landscape');
        } catch {}
      }
    }
  }
};
