import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  ShieldCheck,
  Star,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  Tv,
} from 'lucide-react';
import { getNowAndNextPrograms, type Channel, type EpgMap } from '@tv-local/core';
import { hasLocalProxy, isDesktopApp, toProxiedUrl } from '../utils/network';

interface VideoPlayerProps {
  channel: Channel | null;
  epg: EpgMap;
  isFavorite: boolean;
  onToggleFavorite: (channelId: string) => void;
  onZap?: (direction: 'prev' | 'next') => void;
}

interface QualityOption {
  index: number;
  label: string;
}

function isLikelyDirectFile(url: string): boolean {
  const clean = url.split('?')[0].toLowerCase();
  return ['.mp4', '.webm', '.mov', '.m4v', '.mkv'].some((ext) => clean.endsWith(ext));
}

export function VideoPlayer({
  channel,
  epg,
  isFavorite,
  onToggleFavorite,
  onZap,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [useProxy, setUseProxy] = useState(() => isDesktopApp());
  const [reloadNonce, setReloadNonce] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);

  const nowAndNext = channel ? getNowAndNextPrograms(epg, channel) : { upcoming: [] };

  useEffect(() => {
    setErrorMsg(null);
    setQualities([]);
    setSelectedQuality(-1);
    setUseProxy(isDesktopApp());
  }, [channel?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel || !channel.url) return;

    let cancelled = false;
    const targetUrl = useProxy ? toProxiedUrl(channel.url) : channel.url;
    setErrorMsg(null);
    setIsBuffering(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const startDirectVideo = () => {
      video.src = targetUrl;
      video.play().catch(() => undefined);
    };

    if (!isLikelyDirectFile(channel.url) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: channel.kind === 'live',
        backBufferLength: 60,
      });
      hlsRef.current = hls;

      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (cancelled) return;
        const levels: QualityOption[] = data.levels.map((lvl, idx) => ({
          index: idx,
          label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)} kbps`,
        }));
        setQualities(levels);
        video.play().catch(() => undefined);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !useProxy && hasLocalProxy()) {
          setUseProxy(true);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        setIsBuffering(false);
        setErrorMsg(
          'Não foi possível reproduzir este stream. Verifique se a URL está online ou tente via Proxy Local.',
        );
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || isLikelyDirectFile(channel.url)) {
      startDirectVideo();
    } else {
      startDirectVideo();
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, useProxy, reloadNonce]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          if (v.paused) v.play().catch(() => undefined);
          else v.pause();
        }
      } else if (e.key.toLowerCase() === 'm') {
        setIsMuted((prev) => !prev);
      } else if (e.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        } else {
          containerRef.current?.requestFullscreen().catch(() => undefined);
        }
      } else if (e.key === 'ArrowUp' && onZap) {
        e.preventDefault();
        onZap('prev');
      } else if (e.key === 'ArrowDown' && onZap) {
        e.preventDefault();
        onZap('next');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onZap]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  const handleQualityChange = (levelIndex: number) => {
    setSelectedQuality(levelIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      containerRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  const togglePiP = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => undefined);
    } else if (video.requestPictureInPicture) {
      video.requestPictureInPicture().catch(() => undefined);
    }
  };

  if (!channel) {
    return (
      <div className="player-empty">
        <div className="player-empty-icon">
          <Tv size={42} />
        </div>
        <h3>Selecione um canal ou vídeo</h3>
        <p>Escolha um item na grade abaixo para iniciar a reprodução.</p>
      </div>
    );
  }

  return (
    <div className="player-shell" ref={containerRef}>
      <div className="player-stage">
        <video
          ref={videoRef}
          className="player-video"
          playsInline
          controls={channel.kind !== 'live'}
          onPlay={() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onError={() => {
            if (!useProxy && hasLocalProxy()) {
              setUseProxy(true);
            } else {
              setIsBuffering(false);
              setErrorMsg('Erro ao carregar o vídeo. Tente alternar o Proxy Local ou recarregar.');
            }
          }}
        />

        {isBuffering && !errorMsg && (
          <div className="player-overlay-status">
            <span className="spinner" /> Conectando ao stream...
          </div>
        )}

        {errorMsg && (
          <div className="player-error-overlay">
            <p>{errorMsg}</p>
            <div className="player-error-actions">
              <button type="button" className="btn btn-primary" onClick={() => setReloadNonce((n) => n + 1)}>
                <RefreshCw size={15} /> Recarregar
              </button>
              {hasLocalProxy() && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setUseProxy((p) => !p)}
                >
                  <ShieldCheck size={15} /> {useProxy ? 'Desativar Proxy' : 'Tentar via Proxy Local'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="player-bar">
        <div className="player-channel-meta">
          {channel.logo ? (
            <img src={channel.logo} alt={channel.name} className="player-logo" />
          ) : (
            <div className="player-logo-fallback">{channel.name.slice(0, 2).toUpperCase()}</div>
          )}
          <div>
            <div className="player-title-row">
              <strong>{channel.name}</strong>
              {channel.kind === 'live' && <span className="badge-live">AO VIVO</span>}
              <span className="badge-group">{channel.group}</span>
            </div>
            <div className="player-epg-line">
              {nowAndNext.current ? (
                <span>
                  Agora: <strong>{nowAndNext.current.title}</strong>
                  {nowAndNext.next ? ` • A seguir: ${nowAndNext.next.title}` : ''}
                </span>
              ) : (
                <span className="muted">Sem guia de programação para este canal</span>
              )}
            </div>
          </div>
        </div>

        <div className="player-controls">
          <button type="button" className="icon-btn" title="Play / Pausar (Espaço)" onClick={togglePlay}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>

          {onZap && (
            <>
              <button type="button" className="icon-btn" title="Canal anterior (↑)" onClick={() => onZap('prev')}>
                <ChevronUp size={18} />
              </button>
              <button type="button" className="icon-btn" title="Próximo canal (↓)" onClick={() => onZap('next')}>
                <ChevronDown size={18} />
              </button>
            </>
          )}

          <button type="button" className="icon-btn" title="Mudo (M)" onClick={() => setIsMuted((m) => !m)}>
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              setIsMuted(false);
              setVolume(Number(e.target.value));
            }}
            className="volume-slider"
            aria-label="Volume"
          />

          {qualities.length > 0 && (
            <select
              className="quality-select"
              value={selectedQuality}
              onChange={(e) => handleQualityChange(Number(e.target.value))}
              aria-label="Qualidade do vídeo"
            >
              <option value={-1}>Auto</option>
              {qualities.map((q) => (
                <option key={q.index} value={q.index}>
                  {q.label}
                </option>
              ))}
            </select>
          )}

          {hasLocalProxy() && (
            <button
              type="button"
              className={`icon-btn ${useProxy ? 'active' : ''}`}
              title={useProxy ? 'Proxy local ativo (evita bloqueio CORS)' : 'Ativar proxy local'}
              onClick={() => setUseProxy((p) => !p)}
            >
              <ShieldCheck size={18} />
            </button>
          )}

          <button
            type="button"
            className={`icon-btn ${isFavorite ? 'fav-active' : ''}`}
            title="Favoritar canal"
            onClick={() => onToggleFavorite(channel.id)}
          >
            <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>

          <button type="button" className="icon-btn" title="Picture-in-Picture" onClick={togglePiP}>
            <PictureInPicture2 size={18} />
          </button>

          <button type="button" className="icon-btn" title="Tela cheia (F)" onClick={toggleFullscreen}>
            <Maximize size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
