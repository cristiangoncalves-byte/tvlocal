window.tvLocalBlazorPlayer = {
  _hls: null,
  play: function (videoId, url, useProxy) {
    const video = document.getElementById(videoId);
    if (!video || !url) return;

    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }

    const targetUrl = useProxy ? '/api/proxy?url=' + encodeURIComponent(url) : url;
    const clean = url.split('?')[0].toLowerCase();
    const isDirectFile = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'].some((ext) => clean.endsWith(ext));

    if (!isDirectFile && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
      this._hls = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        video.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !useProxy) {
          this.play(videoId, url, true);
        }
      });
    } else {
      video.src = targetUrl;
      video.play().catch(() => {});
    }
  },
  toggleFullscreen: function (containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }
};
