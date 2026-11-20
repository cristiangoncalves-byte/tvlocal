import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Headphones,
  Maximize,
  Minimize2,
  Pause,
  Play,
  RotateCw,
  Search,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Channel } from '@tv-local/core';
import { hasLocalProxy, isDesktopApp, toProxiedUrl } from '../utils/network';

export interface WebDualStreamCloseResult {
  channel: Channel | null;
  position: number;
}

interface MultiStreamModalProps {
  isOpen: boolean;
  channels: Channel[];
  initialChannel: Channel | null;
  initialPosition?: number;
  forceLandscapeFullscreen: boolean;
  onClose: (transferBack: WebDualStreamCloseResult | null) => void;
}

interface SlotState {
  channel: Channel | null;
  muted: boolean;
  playing: boolean;
}

function isLikelyDirectFile(url: string): boolean {
  const clean = url.split('?')[0].toLowerCase();
  return ['.mp4', '.webm', '.mov', '.m4v', '.mkv'].some((ext) => clean.endsWith(ext));
}

async function tryLockLandscape(): Promise<void> {
  try {
    const orientation = (screen as Screen & {
      orientation?: { lock?: (mode: string) => Promise<void> };
    }).orientation;
    await orientation?.lock?.('landscape');
  } catch {
    // Ignore on browsers/desktop where orientation lock is unsupported
  }
}

function tryUnlockOrientation(): void {
  try {
    const orientation = (screen as Screen & {
      orientation?: { unlock?: () => void };
    }).orientation;
    orientation?.unlock?.();
  } catch {
    // Ignore
  }
}

interface SlotTileProps {
  index: number;
  slot: SlotState;
  isSelected: boolean;
  initialSeekSeconds: number;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSelect: () => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSolo: () => void;
  onClear: () => void;
  onPlayingChange: (playing: boolean) => void;
}

function MultiSlotTile({
  index,
  slot,
  isSelected,
  initialSeekSeconds,
  videoRef,
  onSelect,
  onTogglePlay,
  onToggleMute,
  onSolo,
  onClear,
  onPlayingChange,
}: SlotTileProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pendingSeekRef = useRef<number>(initialSeekSeconds);
  const [useProxy, setUseProxy] = useState(() => isDesktopApp());

  useEffect(() => {
    pendingSeekRef.current =
      slot.channel && slot.channel.kind !== 'live' && initialSeekSeconds > 0
        ? initialSeekSeconds
        : 0;
  }, [slot.channel?.id, slot.channel?.url, initialSeekSeconds]);

  useEffect(() => {
    setUseProxy(isDesktopApp());
  }, [slot.channel?.id, slot.channel?.url]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !slot.channel?.url) return;

    let cancelled = false;
    const rawUrl = slot.channel.url;
    const targetUrl = useProxy ? toProxiedUrl(rawUrl) : rawUrl;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const applySeekAndPlay = () => {
      if (cancelled) return;
      if (pendingSeekRef.current > 0 && slot.channel?.kind !== 'live') {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = 0;
        try {
          video.currentTime = target;
        } catch {
          // Will retry on loadedmetadata
        }
      }
      video.play().catch(() => undefined);
    };

    const onLoadedMetadata = () => {
      if (pendingSeekRef.current > 0 && slot.channel?.kind !== 'live') {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = 0;
        try {
          video.currentTime = target;
        } catch {
          // Ignore invalid seek
        }
      }
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    if (!isLikelyDirectFile(rawUrl) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: slot.channel.kind === 'live',
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, applySeekAndPlay);
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (cancelled || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !useProxy && hasLocalProxy()) {
          setUseProxy(true);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        }
      });
    } else {
      video.src = targetUrl;
      applySeekAndPlay();
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [slot.channel?.id, slot.channel?.url, slot.channel?.kind, useProxy]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (video) {
      video.muted = slot.muted;
    }
  }, [slot.muted]);

  return (
    <div
      className={`multi-slot ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="multi-slot-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="multi-slot-label" onClick={onSelect}>
          <span className="multi-slot-num">{index + 1}</span>
          <span className="truncate">
            {slot.channel ? slot.channel.name : `Slot ${index + 1} (selecione na lista)`}
          </span>
        </button>

        <div className="multi-slot-actions">
          {slot.channel && (
            <>
              <button
                type="button"
                className="icon-btn-sm"
                title={slot.playing ? 'Pausar' : 'Reproduzir'}
                onClick={onTogglePlay}
              >
                {slot.playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                type="button"
                className={`icon-btn-sm ${!slot.muted ? 'active' : ''}`}
                title={slot.muted ? 'Ativar som' : 'Mutar'}
                onClick={onToggleMute}
              >
                {slot.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <button
                type="button"
                className="icon-btn-sm"
                title="Solo (ouvir apenas esta tela)"
                onClick={onSolo}
              >
                <Headphones size={14} />
              </button>
              <button
                type="button"
                className="icon-btn-sm danger"
                title="Limpar tela"
                onClick={onClear}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="multi-slot-stage">
        {slot.channel ? (
          <video
            ref={(el) => {
              localVideoRef.current = el;
              videoRef(el);
            }}
            className="multi-slot-video"
            playsInline
            muted={slot.muted}
            onPlay={() => onPlayingChange(true)}
            onPause={() => onPlayingChange(false)}
            onError={() => {
              if (!useProxy && hasLocalProxy()) {
                setUseProxy(true);
              }
            }}
          />
        ) : (
          <div className="multi-slot-empty">
            <Tv size={26} />
            <span>Clique aqui e escolha um item na lista</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function MultiStreamModal({
  isOpen,
  channels,
  initialChannel,
  initialPosition = 0,
  forceLandscapeFullscreen,
  onClose,
}: MultiStreamModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null, null, null]);

  const [layout, setLayout] = useState<'2x1' | '2x2'>('2x1');
  const [showPicker, setShowPicker] = useState(true);
  const [search, setSearch] = useState('');
  const [targetSlot, setTargetSlot] = useState<number>(initialChannel ? 1 : 0);
  const [slotInitialSeek, setSlotInitialSeek] = useState<number[]>([
    initialChannel && initialChannel.kind !== 'live' && initialPosition > 0 ? initialPosition : 0,
    0,
    0,
    0,
  ]);
  const [slots, setSlots] = useState<SlotState[]>(() => [
    { channel: initialChannel, muted: false, playing: Boolean(initialChannel) },
    { channel: null, muted: true, playing: false },
    { channel: null, muted: true, playing: false },
    { channel: null, muted: true, playing: false },
  ]);

  useEffect(() => {
    if (!isOpen) return;
    setSlots([
      { channel: initialChannel, muted: false, playing: Boolean(initialChannel) },
      { channel: null, muted: true, playing: false },
      { channel: null, muted: true, playing: false },
      { channel: null, muted: true, playing: false },
    ]);
    setSlotInitialSeek([
      initialChannel && initialChannel.kind !== 'live' && initialPosition > 0 ? initialPosition : 0,
      0,
      0,
      0,
    ]);
    setTargetSlot(initialChannel ? 1 : 0);
  }, [isOpen, initialChannel, initialPosition]);

  const visibleCount = layout === '2x1' ? 2 : 4;

  const playable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels
      .filter((c) => Boolean(c.url))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
      .slice(0, 150);
  }, [channels, search]);

  const handleClose = () => {
    const firstOccupiedIdx = slots.findIndex((s) => Boolean(s.channel?.url));
    const chosenIdx = slots[0].channel ? 0 : firstOccupiedIdx;
    if (chosenIdx >= 0 && slots[chosenIdx].channel) {
      const ch = slots[chosenIdx].channel!;
      const vid = videoRefs.current[chosenIdx];
      const pos = ch.kind !== 'live' && vid ? Math.max(0, vid.currentTime || 0) : 0;
      onClose({ channel: ch, position: pos });
    } else {
      onClose(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      tryUnlockOrientation();
    } else if (containerRef.current?.requestFullscreen) {
      await containerRef.current.requestFullscreen().catch(() => undefined);
      if (forceLandscapeFullscreen) {
        await tryLockLandscape();
      }
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={containerRef} className="multi-modal" onClick={(e) => e.stopPropagation()}>
        <div className="multi-header">
          <div className="multi-title-group">
            <strong>Multi-Tela</strong>
            <div className="modal-tabs">
              <button
                type="button"
                className={layout === '2x1' ? 'active' : ''}
                onClick={() => {
                  setLayout('2x1');
                  if (targetSlot >= 2) setTargetSlot(0);
                }}
              >
                2 Telas
              </button>
              <button
                type="button"
                className={layout === '2x2' ? 'active' : ''}
                onClick={() => setLayout('2x2')}
              >
                4 Telas
              </button>
            </div>
          </div>

          <div className="multi-header-actions">
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${!showPicker ? 'active' : ''}`}
              onClick={() => setShowPicker((v) => !v)}
            >
              {showPicker ? <Maximize size={14} /> : <Minimize2 size={14} />}
              {showPicker ? 'Ampliar Telas' : 'Mostrar Lista'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              title="Tela cheia"
              onClick={toggleFullscreen}
            >
              <RotateCw size={14} /> Tela Cheia
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleClose}>
              Voltar ao Player
            </button>
          </div>
        </div>

        <div className={`multi-body ${showPicker ? 'with-picker' : ''}`}>
          <div className={`multi-grid ${layout === '2x2' ? 'grid-2x2' : 'grid-2x1'}`}>
            {slots.slice(0, visibleCount).map((slot, idx) => (
              <MultiSlotTile
                key={idx}
                index={idx}
                slot={slot}
                isSelected={targetSlot === idx}
                initialSeekSeconds={slotInitialSeek[idx]}
                videoRef={(el) => {
                  videoRefs.current[idx] = el;
                }}
                onSelect={() => setTargetSlot(idx)}
                onTogglePlay={() => {
                  const vid = videoRefs.current[idx];
                  if (!vid) return;
                  if (vid.paused) vid.play().catch(() => undefined);
                  else vid.pause();
                }}
                onToggleMute={() => {
                  setSlots((prev) =>
                    prev.map((s, i) => (i === idx ? { ...s, muted: !s.muted } : s)),
                  );
                }}
                onSolo={() => {
                  setSlots((prev) =>
                    prev.map((s, i) => ({ ...s, muted: i !== idx })),
                  );
                }}
                onClear={() => {
                  setSlotInitialSeek((prev) => prev.map((v, i) => (i === idx ? 0 : v)));
                  setSlots((prev) =>
                    prev.map((s, i) =>
                      i === idx ? { channel: null, muted: i > 0, playing: false } : s,
                    ),
                  );
                  setTargetSlot(idx);
                }}
                onPlayingChange={(playing) => {
                  setSlots((prev) =>
                    prev.map((s, i) => (i === idx ? { ...s, playing } : s)),
                  );
                }}
              />
            ))}
          </div>

          {showPicker && (
            <aside className="multi-picker">
              <div className="multi-picker-head">
                <span>Enviando para: <strong>Tela {targetSlot + 1}</strong></span>
              </div>
              <div className="search-box">
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Buscar canal, filme ou série..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="multi-picker-list">
                {playable.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className="multi-picker-row"
                    onClick={() => {
                      const slotIdx = targetSlot;
                      setSlotInitialSeek((prev) =>
                        prev.map((v, i) => (i === slotIdx ? 0 : v)),
                      );
                      setSlots((prev) =>
                        prev.map((s, i) =>
                          i === slotIdx ? { ...s, channel: ch, playing: true } : s,
                        ),
                      );
                      const nextEmpty = slots.findIndex(
                        (s, i) => i < visibleCount && i !== slotIdx && !s.channel,
                      );
                      if (nextEmpty !== -1) {
                        setTargetSlot(nextEmpty);
                      } else {
                        setTargetSlot((slotIdx + 1) % visibleCount);
                      }
                    }}
                  >
                    <strong className="truncate">{ch.name}</strong>
                    <span className="truncate">{ch.group}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
