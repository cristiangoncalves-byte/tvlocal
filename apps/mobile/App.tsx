import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  buildXtreamXmltvUrl,
  createDemoPlaylist,
  DEFAULT_APP_THEME,
  fetchXtreamAllContent,
  fetchXtreamShortEpg,
  fuzzyFilterChannels,
  getNowAndNextPrograms,
  parseM3u,
  parseXmltv,
  tryInferXtreamFromPlaylistUrl,
  tryInferXtreamFromStreamUrl,
  type AppThemeSettings,
  type Channel,
  type EpgMap,
  type PlaylistSource,
  type XtreamCredentials,
} from '@tv-local/core';
import { androidSmartFetch } from './src/utils/mobileNetwork';
import { AddSourceModal, EditSourceModal } from './src/components/SourceModals';
import {
  SettingsModal,
  type MobilePlayerSizeMode,
  type MobileVideoFit,
} from './src/components/SettingsModal';
import { MovieDetailsModal, SeriesDetailsModal } from './src/components/MediaModals';
import { DualStreamModal, type DualStreamCloseResult } from './src/components/DualStreamModal';

type MobileSection = 'live' | 'vod' | 'series' | 'favorites' | 'recents';

const META_STORAGE_KEY = 'tv_local_meta_v2';
const LEGACY_STORAGE_KEY = 'tv_local_mobile_v2';
const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.75];

interface PersistedMobileMeta {
  sources: PlaylistSource[];
  favorites: string[];
  recents: string[];
  theme?: AppThemeSettings;
  playerSizeMode?: MobilePlayerSizeMode;
  videoContentFit?: MobileVideoFit;
  forceLandscapeFullscreen?: boolean;
}

interface PersistedMobileState extends PersistedMobileMeta {
  channels: Channel[];
  epg: EpgMap;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function stringifyArrayChunked<T>(
  items: T[],
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (items.length <= 1500) {
    return JSON.stringify(items);
  }
  const chunkSize = 1500;
  const parts: string[] = ['['];
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const serialized = JSON.stringify(slice);
    // Strip outer '[' and ']'
    parts.push(serialized.slice(1, -1));
    if (i + chunkSize < items.length) {
      parts.push(',');
    }
    onProgress?.(Math.min(99, Math.round(((i + slice.length) / items.length) * 100)));
    await yieldFrame();
  }
  parts.push(']');
  return parts.join('');
}

export default function App() {
  const [sources, setSources] = useState<PlaylistSource[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [epg, setEpg] = useState<EpgMap>({});
  const [theme, setTheme] = useState<AppThemeSettings>(DEFAULT_APP_THEME);
  const [hydrated, setHydrated] = useState(false);

  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

  const [section, setSection] = useState<MobileSection>('live');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(80);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [showEpgDetails, setShowEpgDetails] = useState(false);

  const [playerSizeMode, setPlayerSizeMode] = useState<MobilePlayerSizeMode>('normal');
  const [videoContentFit, setVideoContentFit] = useState<MobileVideoFit>('contain');
  const [forceLandscape, setForceLandscape] = useState(false);
  const [forceLandscapeFullscreen, setForceLandscapeFullscreen] = useState(true);
  const [inFullscreenMode, setInFullscreenMode] = useState(false);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<PlaylistSource | null>(null);
  const [moviePreview, setMoviePreview] = useState<Channel | null>(null);
  const [seriesPreview, setSeriesPreview] = useState<Channel | null>(null);
  const [dualStreamVisible, setDualStreamVisible] = useState(false);
  const [dualStreamInitialPos, setDualStreamInitialPos] = useState(0);

  const [loading, setLoading] = useState(false);
  const [activityMessage, setActivityMessage] = useState<string | null>('Carregando biblioteca...');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const channelsDirtyRef = useRef(false);
  const epgDirtyRef = useRef(false);
  const videoViewRef = useRef<VideoView | null>(null);
  const pendingMainSeekRef = useRef(0);
  const dualStreamOpenRef = useRef(false);

  const player = useVideoPlayer(null, (p) => {
    p.play();
  });

  const applyLandscapeLock = useCallback(async (enabled: boolean) => {
    if (Platform.OS === 'web') return;
    try {
      if (enabled) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } else {
        await ScreenOrientation.unlockAsync();
      }
    } catch {
      // Ignore if device/runtime does not support programmatic orientation lock
    }
  }, []);

  useEffect(() => {
    void applyLandscapeLock(forceLandscape || (inFullscreenMode && forceLandscapeFullscreen));
  }, [forceLandscape, inFullscreenMode, forceLandscapeFullscreen, applyLandscapeLock]);

  useEffect(() => {
    setFullscreenControlsVisible(true);
  }, [activeChannel?.id, playerSizeMode]);

  useEffect(() => {
    return () => {
      void applyLandscapeLock(false);
    };
  }, [applyLandscapeLock]);

  useEffect(() => {
    const playSub = player.addListener('playingChange', (ev) => {
      setIsPlaying(ev.isPlaying);
    });
    const statusSub = player.addListener('statusChange', (ev) => {
      if (ev.status === 'loading') {
        setActivityMessage('Conectando à transmissão...');
      } else if (ev.status === 'readyToPlay') {
        setActivityMessage((curr) => (curr === 'Conectando à transmissão...' ? null : curr));
        if (pendingMainSeekRef.current > 0) {
          const target = pendingMainSeekRef.current;
          pendingMainSeekRef.current = 0;
          player.currentTime = target;
        }
      } else if (ev.status === 'error') {
        setActivityMessage(null);
        if (ev.error?.message) {
          Alert.alert('Erro na transmissão', ev.error.message);
        }
      }
    });
    return () => {
      playSub.remove();
      statusSub.remove();
    };
  }, [player]);

  useEffect(() => {
    if (activeChannel?.url) {
      setSpeedIndex(0);
      player.playbackRate = 1.0;
      player
        .replaceAsync({ uri: activeChannel.url })
        .then(() => {
          if (
            pendingMainSeekRef.current > 0 &&
            activeChannel.kind !== 'live' &&
            player.status === 'readyToPlay'
          ) {
            const target = pendingMainSeekRef.current;
            pendingMainSeekRef.current = 0;
            player.currentTime = target;
          }
          if (!dualStreamOpenRef.current) {
            player.play();
          }
        })
        .catch(() => undefined);
    } else {
      pendingMainSeekRef.current = 0;
      player.pause();
    }
  }, [activeChannel?.url, activeChannel?.kind, player]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setDisplayLimit(80);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    (async () => {
      try {
        const metaRaw = await AsyncStorage.getItem(META_STORAGE_KEY);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw) as Partial<PersistedMobileMeta>;
          if (Array.isArray(meta.sources)) setSources(meta.sources);
          if (Array.isArray(meta.favorites)) setFavorites(meta.favorites);
          if (Array.isArray(meta.recents)) setRecents(meta.recents);
          if (meta.theme) setTheme(meta.theme);
          if (meta.playerSizeMode) setPlayerSizeMode(meta.playerSizeMode);
          if (meta.videoContentFit) setVideoContentFit(meta.videoContentFit);
          if (typeof meta.forceLandscapeFullscreen === 'boolean') {
            setForceLandscapeFullscreen(meta.forceLandscapeFullscreen);
          }
        } else {
          // Migrate legacy single-key storage if present
          const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyRaw) {
            const parsed = JSON.parse(legacyRaw) as Partial<PersistedMobileState>;
            if (Array.isArray(parsed.sources)) setSources(parsed.sources);
            if (Array.isArray(parsed.channels)) setChannels(parsed.channels);
            if (Array.isArray(parsed.favorites)) setFavorites(parsed.favorites);
            if (Array.isArray(parsed.recents)) setRecents(parsed.recents);
            if (parsed.epg) setEpg(parsed.epg);
            if (parsed.theme) setTheme(parsed.theme);
          }
        }

        const chFile = new ExpoFile(Paths.document, 'tvlocal-channels.json');
        if (chFile.exists) {
          const chRaw = await chFile.text();
          const parsedChannels = JSON.parse(chRaw) as Channel[];
          if (Array.isArray(parsedChannels)) setChannels(parsedChannels);
        }

        const epgFile = new ExpoFile(Paths.document, 'tvlocal-epg.json');
        if (epgFile.exists) {
          const epgRaw = await epgFile.text();
          const parsedEpg = JSON.parse(epgRaw) as EpgMap;
          if (parsedEpg && typeof parsedEpg === 'object') setEpg(parsedEpg);
        }
      } catch {
        // Ignore corrupt cache
      } finally {
        setHydrated(true);
        setActivityMessage(null);
      }
    })();
  }, []);

  // Save lightweight metadata immediately (no heavy channel array serialization)
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      META_STORAGE_KEY,
      JSON.stringify({
        sources,
        favorites,
        recents,
        theme,
        playerSizeMode,
        videoContentFit,
        forceLandscapeFullscreen,
      }),
    ).catch(() => undefined);
  }, [
    hydrated,
    sources,
    favorites,
    recents,
    theme,
    playerSizeMode,
    videoContentFit,
    forceLandscapeFullscreen,
  ]);

  // Save heavy channels array asynchronously only when mutated by user actions
  useEffect(() => {
    if (!hydrated || !channelsDirtyRef.current) return;
    channelsDirtyRef.current = false;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setActivityMessage(`Salvando biblioteca (${channels.length.toLocaleString('pt-BR')} itens)...`);
        const json = await stringifyArrayChunked(channels, (pct) => {
          if (!cancelled) {
            setActivityMessage(`Preparando biblioteca (${pct}%)...`);
          }
        });
        if (cancelled) return;
        const chUri = new ExpoFile(Paths.document, 'tvlocal-channels.json').uri;
        await LegacyFS.writeAsStringAsync(chUri, json);
      } catch {
        // Ignore disk write error
      } finally {
        if (!cancelled) {
          setActivityMessage((curr) =>
            curr?.startsWith('Salvando biblioteca') || curr?.startsWith('Preparando biblioteca')
              ? null
              : curr,
          );
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, channels]);

  // Save EPG asynchronously only when mutated
  useEffect(() => {
    if (!hydrated || !epgDirtyRef.current) return;
    epgDirtyRef.current = false;
    const timer = setTimeout(async () => {
      try {
        const epgUri = new ExpoFile(Paths.document, 'tvlocal-epg.json').uri;
        await LegacyFS.writeAsStringAsync(epgUri, JSON.stringify(epg));
      } catch {
        // Ignore disk write error
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, epg]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const sectionChannels = useMemo(() => {
    if (section === 'favorites') {
      return channels.filter((c) => favoriteSet.has(c.id));
    }
    if (section === 'recents') {
      const map = new Map(channels.map((c) => [c.id, c]));
      return recents.map((id) => map.get(id)).filter((c): c is Channel => Boolean(c));
    }
    return channels.filter((c) => c.kind === section);
  }, [channels, favoriteSet, recents, section]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const ch of sectionChannels) {
      set.add(ch.group);
    }
    const sorted = Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return ['Todas', ...sorted];
  }, [sectionChannels]);

  const { filteredChannels, searchSuggestion } = useMemo(() => {
    const byCategory =
      selectedCategory === 'Todas'
        ? sectionChannels
        : sectionChannels.filter((ch) => ch.group === selectedCategory);
    const res = fuzzyFilterChannels(byCategory, debouncedQuery);
    return {
      filteredChannels: res.items,
      searchSuggestion: res.correctedQuery,
    };
  }, [sectionChannels, selectedCategory, debouncedQuery]);

  const vodShelves = useMemo(() => {
    if (section !== 'vod' && section !== 'series') return [];
    if (selectedCategory !== 'Todas' || debouncedQuery.trim()) return [];
    const groups = new Map<string, Channel[]>();
    for (const ch of sectionChannels) {
      const list = groups.get(ch.group);
      if (list) list.push(ch);
      else groups.set(ch.group, [ch]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([group, items]) => ({ group, total: items.length, items: items.slice(0, 12) }));
  }, [section, selectedCategory, debouncedQuery, sectionChannels]);

  const heroCatalogItem = useMemo(() => {
    if (section !== 'vod' && section !== 'series') return null;
    return filteredChannels.find((c) => Boolean(c.logo)) ?? filteredChannels[0] ?? null;
  }, [section, filteredChannels]);

  const fetchShortEpgForChannel = useCallback(
    async (ch: Channel) => {
      if (ch.kind !== 'live') return;
      const src = sources.find((s) => s.id === ch.sourceId);
      let creds = src?.xtream ?? tryInferXtreamFromPlaylistUrl(src?.url);
      let streamId = ch.streamId;

      if (!creds || !streamId) {
        const inferred = tryInferXtreamFromStreamUrl(ch.url);
        if (inferred) {
          creds = creds ?? inferred.creds;
          streamId = streamId ?? inferred.streamId;
        }
      }

      if (!creds || !streamId) return;
      const key = (ch.tvgId || ch.tvgName || ch.name).trim().toLowerCase();
      try {
        const programs = await fetchXtreamShortEpg(creds, streamId, key, 10, androidSmartFetch);
        if (programs.length > 0) {
          epgDirtyRef.current = true;
          setEpg((prev) => ({
            ...prev,
            [key]: programs,
            [ch.name.toLowerCase()]: programs,
          }));
        }
      } catch {
        // Ignore transient EPG fetch errors
      }
    },
    [sources],
  );

  const playChannelDirectly = useCallback(
    (ch: Channel) => {
      setActiveChannel(ch);
      setRecents((prev) => [ch.id, ...prev.filter((id) => id !== ch.id)].slice(0, 30));
      if (ch.kind === 'live' && getNowAndNextPrograms(epg, ch).upcoming.length === 0) {
        void fetchShortEpgForChannel(ch);
      }
    },
    [epg, fetchShortEpgForChannel],
  );

  const handleOpenItem = useCallback(
    (item: Channel) => {
      if (item.kind === 'series' && !item.url) {
        setSeriesPreview(item);
        return;
      }
      if (item.kind === 'vod') {
        setMoviePreview(item);
        return;
      }
      playChannelDirectly(item);
    },
    [playChannelDirectly],
  );

  const handleLoadDemo = () => {
    const demo = createDemoPlaylist();
    channelsDirtyRef.current = true;
    epgDirtyRef.current = true;
    setSources((prev) => [demo.source, ...prev.filter((s) => s.id !== demo.source.id)]);
    setChannels((prev) => [...demo.channels, ...prev.filter((c) => c.sourceId !== demo.source.id)]);
    setEpg((prev) => ({ ...prev, ...demo.epg }));
    setSection('live');
    setSelectedCategory('Todas');
    playChannelDirectly(demo.channels[0]);
    setAddModalVisible(false);
  };

  const handleImportM3uUrl = async (name: string, url: string) => {
    if (!url.trim()) return;
    setLoading(true);
    setActivityMessage('1/2 Baixando playlist M3U...');
    try {
      const trimmed = url.trim();
      const res = await androidSmartFetch(trimmed);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setActivityMessage('2/2 Processando canais da lista...');
      await yieldFrame();

      const sourceId = `m3u_${Date.now().toString(36)}`;
      const parsed = parseM3u(text, sourceId);
      if (!parsed.channels.length) throw new Error('Lista M3U vazia ou inválida.');

      const inferredXtream = tryInferXtreamFromPlaylistUrl(trimmed) ?? undefined;
      const epgUrl = parsed.epgUrl || (inferredXtream ? buildXtreamXmltvUrl(inferredXtream) : undefined);

      const source: PlaylistSource = {
        id: sourceId,
        name: name.trim() || 'Lista M3U',
        type: 'm3u_url',
        url: trimmed,
        epgUrl,
        xtream: inferredXtream,
        addedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        channelCount: parsed.channels.length,
      };
      channelsDirtyRef.current = true;
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...parsed.channels, ...prev]);
      setAddModalVisible(false);
    } catch (err) {
      Alert.alert('Erro ao importar M3U', err instanceof Error ? err.message : 'Falha na importação');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handlePickLocalM3u = async () => {
    setLoading(true);
    setActivityMessage('Lendo arquivo M3U local...');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const file = new ExpoFile(asset.uri);
      const content = await file.text();
      setActivityMessage('Processando canais do arquivo...');
      await yieldFrame();

      const sourceId = `m3u_${Date.now().toString(36)}`;
      const parsed = parseM3u(content, sourceId);
      if (!parsed.channels.length) {
        Alert.alert('Lista inválida', 'Nenhum canal encontrado neste arquivo.');
        return;
      }
      const source: PlaylistSource = {
        id: sourceId,
        name: asset.name.replace(/\.(m3u8?|txt)$/i, ''),
        type: 'm3u_file',
        epgUrl: parsed.epgUrl,
        addedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        channelCount: parsed.channels.length,
      };
      channelsDirtyRef.current = true;
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...parsed.channels, ...prev]);
      setAddModalVisible(false);
    } catch (err) {
      Alert.alert('Erro ao ler arquivo', err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handleConnectXtream = async (name: string, creds: XtreamCredentials) => {
    if (!creds.serverUrl.trim() || !creds.username.trim()) return;
    setLoading(true);
    setActivityMessage('1/3 Conectando e baixando canais Xtream...');
    try {
      const sourceId = `xt_${Date.now().toString(36)}`;
      const cleanCreds = {
        serverUrl: creds.serverUrl.trim(),
        username: creds.username.trim(),
        password: creds.password,
      };
      const res = await fetchXtreamAllContent(cleanCreds, sourceId, androidSmartFetch);
      setActivityMessage(`2/3 Organizando ${res.channels.length.toLocaleString('pt-BR')} itens...`);
      await yieldFrame();

      const source: PlaylistSource = {
        id: sourceId,
        name: name.trim() || res.account.username,
        type: 'xtream',
        xtream: cleanCreds,
        epgUrl: res.epgUrl,
        addedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        channelCount: res.channels.length,
      };
      channelsDirtyRef.current = true;
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...res.channels, ...prev]);
      setAddModalVisible(false);
    } catch (err) {
      Alert.alert('Erro Xtream', err instanceof Error ? err.message : 'Falha na autenticação');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handleImportEpgUrl = async (epgUrl: string) => {
    if (!epgUrl.trim()) return;
    setLoading(true);
    setActivityMessage('Baixando guia XMLTV...');
    try {
      const res = await androidSmartFetch(epgUrl.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      setActivityMessage('Processando programação XMLTV...');
      await yieldFrame();
      epgDirtyRef.current = true;
      setEpg((prev) => ({ ...prev, ...parseXmltv(xml) }));
      setAddModalVisible(false);
    } catch (err) {
      Alert.alert('Erro EPG', err instanceof Error ? err.message : 'Falha ao carregar XMLTV');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handlePickLocalEpg = async () => {
    setLoading(true);
    setActivityMessage('Lendo arquivo XMLTV...');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const xml = await new ExpoFile(result.assets[0].uri).text();
      setActivityMessage('Processando programação XMLTV...');
      await yieldFrame();
      epgDirtyRef.current = true;
      setEpg((prev) => ({ ...prev, ...parseXmltv(xml) }));
      setAddModalVisible(false);
    } catch (err) {
      Alert.alert('Erro XMLTV', err instanceof Error ? err.message : 'Erro ao ler arquivo');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handleRefreshSource = async (src: PlaylistSource) => {
    if (src.type === 'demo') {
      handleLoadDemo();
      return;
    }
    setLoading(true);
    setActivityMessage(`Atualizando "${src.name}"...`);
    try {
      if (src.type === 'm3u_url' && src.url) {
        const res = await androidSmartFetch(src.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseM3u(await res.text(), src.id);
        setSources((prev) =>
          prev.map((s) =>
            s.id === src.id
              ? { ...s, lastUpdatedAt: Date.now(), channelCount: parsed.channels.length }
              : s,
          ),
        );
        channelsDirtyRef.current = true;
        setChannels((prev) => [
          ...parsed.channels,
          ...prev.filter((c) => c.sourceId !== src.id),
        ]);
      } else if (src.type === 'xtream' && src.xtream) {
        const res = await fetchXtreamAllContent(src.xtream, src.id, androidSmartFetch);
        setSources((prev) =>
          prev.map((s) =>
            s.id === src.id
              ? { ...s, lastUpdatedAt: Date.now(), channelCount: res.channels.length }
              : s,
          ),
        );
        channelsDirtyRef.current = true;
        setChannels((prev) => [
          ...res.channels,
          ...prev.filter((c) => c.sourceId !== src.id),
        ]);
      }
    } catch (err) {
      Alert.alert('Erro ao atualizar', err instanceof Error ? err.message : 'Falha na atualização');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handleSaveEditedSource = async (payload: {
    source: PlaylistSource;
    name: string;
    url?: string;
    xtream?: XtreamCredentials;
    reload: boolean;
  }) => {
    const cleanName = payload.name.trim() || payload.source.name;
    setLoading(true);
    setActivityMessage('Salvando alterações da conta...');
    try {
      if (payload.source.type === 'xtream' && payload.xtream) {
        if (payload.reload) {
          const res = await fetchXtreamAllContent(
            payload.xtream,
            payload.source.id,
            androidSmartFetch,
          );
          setSources((prev) =>
            prev.map((s) =>
              s.id === payload.source.id
                ? {
                    ...s,
                    name: cleanName,
                    xtream: payload.xtream,
                    epgUrl: res.epgUrl,
                    lastUpdatedAt: Date.now(),
                    channelCount: res.channels.length,
                  }
                : s,
            ),
          );
          channelsDirtyRef.current = true;
          setChannels((prev) => [
            ...res.channels,
            ...prev.filter((c) => c.sourceId !== payload.source.id),
          ]);
        } else {
          setSources((prev) =>
            prev.map((s) =>
              s.id === payload.source.id ? { ...s, name: cleanName, xtream: payload.xtream } : s,
            ),
          );
        }
      } else if (payload.source.type === 'm3u_url' && payload.url) {
        if (payload.reload) {
          const res = await androidSmartFetch(payload.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const parsed = parseM3u(await res.text(), payload.source.id);
          setSources((prev) =>
            prev.map((s) =>
              s.id === payload.source.id
                ? {
                    ...s,
                    name: cleanName,
                    url: payload.url,
                    lastUpdatedAt: Date.now(),
                    channelCount: parsed.channels.length,
                  }
                : s,
            ),
          );
          channelsDirtyRef.current = true;
          setChannels((prev) => [
            ...parsed.channels,
            ...prev.filter((c) => c.sourceId !== payload.source.id),
          ]);
        } else {
          setSources((prev) =>
            prev.map((s) =>
              s.id === payload.source.id ? { ...s, name: cleanName, url: payload.url } : s,
            ),
          );
        }
      } else {
        setSources((prev) =>
          prev.map((s) => (s.id === payload.source.id ? { ...s, name: cleanName } : s)),
        );
      }
      setEditingSource(null);
    } catch (err) {
      Alert.alert('Erro ao salvar', err instanceof Error ? err.message : 'Falha ao atualizar conta');
    } finally {
      setLoading(false);
      setActivityMessage(null);
    }
  };

  const handleRemoveSource = (sourceId: string) => {
    channelsDirtyRef.current = true;
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    setChannels((prev) => prev.filter((c) => c.sourceId !== sourceId));
    if (activeChannel?.sourceId === sourceId) {
      setActiveChannel(null);
    }
  };

  const handleExportBackup = async () => {
    try {
      const backupFile = new ExpoFile(Paths.cache, 'tvlocal-backup.json');
      backupFile.write(
        JSON.stringify({ sources, channels, favorites, recents, epg, theme }, null, 2),
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(backupFile.uri, { mimeType: 'application/json' });
      } else {
        Alert.alert('Backup salvo', backupFile.uri);
      }
    } catch (err) {
      Alert.alert('Erro no backup', err instanceof Error ? err.message : 'Falha ao exportar');
    }
  };

  const handleImportBackup = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const json = await new ExpoFile(res.assets[0].uri).text();
      const parsed = JSON.parse(json) as Partial<PersistedMobileState>;
      if (Array.isArray(parsed.sources)) setSources(parsed.sources);
      if (Array.isArray(parsed.channels)) {
        channelsDirtyRef.current = true;
        setChannels(parsed.channels);
      }
      if (Array.isArray(parsed.favorites)) setFavorites(parsed.favorites);
      if (Array.isArray(parsed.recents)) setRecents(parsed.recents);
      if (parsed.epg) {
        epgDirtyRef.current = true;
        setEpg(parsed.epg);
      }
      if (parsed.theme) setTheme(parsed.theme);
      Alert.alert('Backup', 'Backup restaurado com sucesso!');
    } catch (err) {
      Alert.alert('Erro ao importar', err instanceof Error ? err.message : 'Arquivo inválido');
    }
  };

  const toggleFavorite = (channelId: string) => {
    setFavorites((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [channelId, ...prev],
    );
  };

  const removeRecent = (channelId: string) => {
    setRecents((prev) => prev.filter((id) => id !== channelId));
  };

  const clearRecents = () => {
    setRecents([]);
  };

  const handleReloadActiveStream = () => {
    if (!activeChannel?.url) return;
    player
      .replaceAsync({ uri: activeChannel.url })
      .then(() => player.play())
      .catch(() => undefined);
  };

  const handleCycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    player.playbackRate = SPEEDS[next];
  };

  const handleSyncActiveEpg = async () => {
    if (!activeChannel) return;
    setActivityMessage('Sincronizando EPG da conta...');
    await fetchShortEpgForChannel(activeChannel);
    setActivityMessage(null);
  };

  const handleOpenDualStream = () => {
    const resumePos =
      activeChannel && activeChannel.kind !== 'live'
        ? Math.max(0, player.currentTime || 0)
        : 0;
    dualStreamOpenRef.current = true;
    player.pause();
    setDualStreamInitialPos(resumePos);
    setDualStreamVisible(true);
  };

  const handleCloseDualStream = (transferBack: DualStreamCloseResult | null) => {
    dualStreamOpenRef.current = false;
    setDualStreamVisible(false);
    if (!transferBack?.channel) return;

    const { channel, position } = transferBack;
    if (activeChannel && channel.id === activeChannel.id && channel.url === activeChannel.url) {
      if (channel.kind !== 'live' && position > 0) {
        if (player.status === 'readyToPlay') {
          player.currentTime = position;
        } else {
          pendingMainSeekRef.current = position;
        }
      }
      player.play();
    } else {
      pendingMainSeekRef.current = channel.kind !== 'live' && position > 0 ? position : 0;
      playChannelDirectly(channel);
    }
  };

  const handleCyclePlayerSize = () => {
    setPlayerSizeMode((curr) => {
      const next = curr === 'normal' ? 'large' : curr === 'large' ? 'expanded' : 'normal';
      if (next !== 'expanded') {
        setInFullscreenMode(false);
        setFullscreenControlsVisible(true);
      }
      return next;
    });
  };

  const handleToggleForceLandscape = () => {
    setForceLandscape((curr) => !curr);
  };

  const handleEnterFullscreen = () => {
    if (playerSizeMode === 'expanded') {
      setPlayerSizeMode('normal');
      setInFullscreenMode(false);
      setFullscreenControlsVisible(true);
    } else {
      setPlayerSizeMode('expanded');
      setInFullscreenMode(true);
      setFullscreenControlsVisible(true);
    }
  };

  const handleCloseActivePlayer = () => {
    player.pause();
    setActiveChannel(null);
    setShowEpgDetails(false);
    setInFullscreenMode(false);
    setFullscreenControlsVisible(true);
    if (playerSizeMode === 'expanded') {
      setPlayerSizeMode('normal');
    }
  };

  const activeGuide = activeChannel ? getNowAndNextPrograms(epg, activeChannel) : { upcoming: [] };
  const isExpandedPlayer = Boolean(activeChannel) && playerSizeMode === 'expanded';
  const topInset = isLandscape
    ? 4
    : Platform.OS === 'android'
      ? (RNStatusBar.currentHeight ?? 24) + 6
      : 0;
  const portraitVideoHeight =
    playerSizeMode === 'large'
      ? Math.min(380, Math.max(275, Math.round(winHeight * 0.42)))
      : 205;
  const playerSizeLabel =
    playerSizeMode === 'normal'
      ? '⤢ Aumentar'
      : playerSizeMode === 'large'
        ? '⤢ Expandir'
        : '⤡ Reduzir';

  const playerSection = activeChannel ? (
    <View
      style={[
        styles.playerBox,
        { backgroundColor: theme.surface },
        isExpandedPlayer && { flex: 1, marginBottom: 0, borderRadius: 0 },
        isLandscape && !isExpandedPlayer && { flex: playerSizeMode === 'large' ? 1.55 : 1.15, marginBottom: 0 },
      ]}
    >
      <View
        style={[
          styles.videoWrap,
          isExpandedPlayer || isLandscape
            ? { flex: 1, height: undefined }
            : { height: portraitVideoHeight },
        ]}
      >
        <VideoView
          ref={videoViewRef}
          style={{ flex: 1 }}
          player={player}
          contentFit={videoContentFit}
          fullscreenOptions={{
            enable: true,
            orientation: forceLandscape || forceLandscapeFullscreen ? 'landscape' : 'default',
          }}
          onFullscreenExit={() => {
            void applyLandscapeLock(forceLandscape || (inFullscreenMode && forceLandscapeFullscreen));
          }}
          allowsPictureInPicture
          controllerAutoShow
          nativeControls={!isExpandedPlayer || fullscreenControlsVisible}
        />
        {isExpandedPlayer && !fullscreenControlsVisible && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setFullscreenControlsVisible(true)}
          />
        )}
      </View>
      {(!isExpandedPlayer || fullscreenControlsVisible) && (
      <View style={[styles.playerInfo, (isExpandedPlayer || isLandscape) && styles.playerInfoCompact]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.playerChannelName, { flex: 1 }]} numberOfLines={1}>
            {activeChannel.name}
          </Text>
          {!isExpandedPlayer && (
            <Pressable onPress={() => setShowEpgDetails((v) => !v)}>
              <Text style={[styles.epgToggleLink, { color: theme.accent }]}>
                {showEpgDetails ? 'Ocultar EPG' : 'Ver EPG'}
              </Text>
            </Pressable>
          )}
        </View>
        {!isExpandedPlayer && (
          <Text style={styles.playerEpgText} numberOfLines={1}>
            {activeGuide.current
              ? `Agora: ${activeGuide.current.title}`
              : activeChannel.group}
          </Text>
        )}

        <View style={styles.transportRow}>
          <Pressable
            style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
            onPress={() => (isPlaying ? player.pause() : player.play())}
          >
            <Text style={styles.ctrlBtnText}>{isPlaying ? '⏸' : '▶'}</Text>
          </Pressable>
          <Pressable
            style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
            onPress={handleReloadActiveStream}
          >
            <Text style={styles.ctrlBtnText}>🔄</Text>
          </Pressable>
          {activeChannel.kind !== 'live' && (
            <>
              <Pressable
                style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
                onPress={() => {
                  player.currentTime = Math.max(0, player.currentTime - 10);
                }}
              >
                <Text style={styles.ctrlBtnText}>-10s</Text>
              </Pressable>
              <Pressable
                style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
                onPress={() => {
                  player.currentTime = player.currentTime + 10;
                }}
              >
                <Text style={styles.ctrlBtnText}>+10s</Text>
              </Pressable>
              <Pressable
                style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
                onPress={handleCycleSpeed}
              >
                <Text style={styles.ctrlBtnText}>{SPEEDS[speedIndex]}x</Text>
              </Pressable>
            </>
          )}
          <Pressable
            style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
            onPress={() => toggleFavorite(activeChannel.id)}
          >
            <Text
              style={[
                styles.ctrlBtnText,
                favoriteSet.has(activeChannel.id) && { color: '#f59e0b' },
              ]}
            >
              {favoriteSet.has(activeChannel.id) ? '★' : '☆'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.ctrlBtn,
              { backgroundColor: playerSizeMode === 'normal' ? theme.card : theme.accent },
            ]}
            onPress={handleCyclePlayerSize}
          >
            <Text style={styles.ctrlBtnText}>{playerSizeLabel}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.ctrlBtn,
              { backgroundColor: videoContentFit === 'cover' ? theme.accent : theme.card },
            ]}
            onPress={() => setVideoContentFit((f) => (f === 'contain' ? 'cover' : 'contain'))}
          >
            <Text style={styles.ctrlBtnText}>
              {videoContentFit === 'cover' ? '⬌ Ajustar' : '⬌ Preencher'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.ctrlBtn,
              { backgroundColor: forceLandscape ? theme.accent : theme.card },
            ]}
            onPress={handleToggleForceLandscape}
          >
            <Text style={styles.ctrlBtnText}>
              {forceLandscape ? '↻ Horizontal ON' : '↻ Horizontal'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.ctrlBtn,
              { backgroundColor: isExpandedPlayer ? theme.accent : theme.card },
            ]}
            onPress={handleEnterFullscreen}
          >
            <Text style={styles.ctrlBtnText}>
              {isExpandedPlayer ? '⤡ Sair Tela Cheia' : '⛶ Tela Cheia'}
            </Text>
          </Pressable>
          {isExpandedPlayer && (
            <Pressable
              style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
              onPress={() => setFullscreenControlsVisible(false)}
            >
              <Text style={styles.ctrlBtnText}>👁 Ocultar</Text>
            </Pressable>
          )}
          {isExpandedPlayer && (
            <Pressable
              style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
              onPress={handleOpenDualStream}
            >
              <Text style={styles.ctrlBtnText}>⊞ 2 Telas</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.ctrlBtn, { backgroundColor: theme.card }]}
            onPress={handleCloseActivePlayer}
          >
            <Text style={[styles.ctrlBtnText, { color: '#fca5a5' }]}>✕</Text>
          </Pressable>
        </View>

        {showEpgDetails && !isExpandedPlayer && (
          <View style={[styles.epgDrawer, { backgroundColor: theme.card }]}>
            <View style={styles.epgDrawerHeader}>
              <Text style={styles.epgDrawerTitle}>Programação</Text>
              <Pressable onPress={handleSyncActiveEpg}>
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                  🔄 Sincronizar Conta
                </Text>
              </Pressable>
            </View>
            {activeGuide.upcoming.length === 0 ? (
              <Text style={styles.epgEmpty}>Sem programação disponível para este canal.</Text>
            ) : (
              activeGuide.upcoming.slice(0, 4).map((p, idx) => (
                <Text key={`${p.start}-${idx}`} style={styles.epgRowText} numberOfLines={1}>
                  {formatTime(p.start)}–{formatTime(p.stop)} • {p.title}
                </Text>
              ))
            )}
          </View>
        )}
      </View>
      )}
    </View>
  ) : (
    channels.length === 0 && (
      <View style={[styles.emptyStage, { backgroundColor: theme.surface }]}>
        <Text style={styles.emptyTitle}>Nenhuma lista carregada</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            style={[styles.demoBtn, { backgroundColor: theme.accent }]}
            onPress={handleLoadDemo}
          >
            <Text style={styles.demoBtnText}>Testar Lista Demo</Text>
          </Pressable>
          <Pressable
            style={[styles.demoBtn, { backgroundColor: theme.card }]}
            onPress={() => setAddModalVisible(true)}
          >
            <Text style={styles.demoBtnText}>Adicionar M3U / Xtream</Text>
          </Pressable>
        </View>
      </View>
    )
  );

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.bg, paddingTop: isExpandedPlayer ? 0 : topInset },
        isExpandedPlayer && { paddingHorizontal: 0 },
      ]}
    >
      <StatusBar style="light" hidden={isExpandedPlayer} />

      {/* Header */}
      {!isExpandedPlayer && (
        <View style={[styles.header, isLandscape && styles.headerCompact]}>
          <View style={styles.brandRow}>
            <Image source={require('./assets/icon.png')} style={styles.brandLogo} />
            <View>
              <Text style={styles.brandTitle}>TV Local</Text>
              {!isLandscape && <Text style={styles.brandSub}>Mobile & Android TV</Text>}
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={[
                styles.iconPillBtn,
                { backgroundColor: forceLandscape ? theme.accent : theme.card },
              ]}
              onPress={handleToggleForceLandscape}
            >
              <Text style={styles.iconPillText}>↻</Text>
            </Pressable>
            <Pressable
              style={[styles.iconPillBtn, { backgroundColor: theme.card }]}
              onPress={handleOpenDualStream}
            >
              <Text style={styles.iconPillText}>⊞ 2 Telas</Text>
            </Pressable>
            <Pressable
              style={[styles.iconPillBtn, { backgroundColor: theme.card }]}
              onPress={() => setSettingsVisible(true)}
            >
              <Text style={styles.iconPillText}>⚙</Text>
            </Pressable>
            <Pressable
              style={[styles.addBtn, { backgroundColor: theme.accent }]}
              onPress={() => setAddModalVisible(true)}
            >
              <Text style={styles.addBtnText}>+ Lista</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Activity Feedback Banner */}
      {activityMessage && (
        <View style={[styles.activityBar, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
          <ActivityIndicator size="small" color={theme.accent} />
          <Text style={styles.activityText} numberOfLines={1}>
            {activityMessage}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.mainArea,
          isLandscape && activeChannel && !isExpandedPlayer && styles.mainAreaLandscape,
        ]}
      >
        {playerSection}

        {!isExpandedPlayer && (
          <View style={styles.browserColumn}>

      {/* Navigation Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.horizontalBarContent}
      >
        {(
          [
            ['live', 'Ao Vivo'],
            ['vod', 'Filmes'],
            ['series', 'Séries'],
            ['favorites', 'Favoritos'],
            ['recents', 'Recentes'],
          ] as Array<[MobileSection, string]>
        ).map(([id, label]) => (
          <Pressable
            key={id}
            style={[
              styles.tabBtn,
              { backgroundColor: section === id ? theme.accent : theme.surface },
            ]}
            onPress={() => {
              setSection(id);
              setSelectedCategory('Todas');
              setDisplayLimit(80);
            }}
          >
            <Text style={[styles.tabText, section === id && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Search & Clear Recents */}
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: theme.surface, flex: 1 }]}
          placeholder="Buscar canal, filme, série ou categoria..."
          placeholderTextColor="#64748b"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {section === 'recents' && recents.length > 0 && (
          <Pressable style={[styles.clearRecentsBtn, { backgroundColor: theme.card }]} onPress={clearRecents}>
            <Text style={styles.clearRecentsText}>Limpar</Text>
          </Pressable>
        )}
      </View>

      {searchSuggestion && (
        <Text style={styles.fuzzyHint}>
          Mostrando resultados aproximados para: "{searchSuggestion}"
        </Text>
      )}

      {/* Category Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catScroll}
        contentContainerStyle={styles.horizontalBarContent}
      >
        {categories.map((cat) => (
          <Pressable
            key={cat}
            style={[
              styles.catChip,
              { backgroundColor: selectedCategory === cat ? theme.accent : theme.surface },
            ]}
            onPress={() => {
              setSelectedCategory(cat);
              setDisplayLimit(80);
            }}
          >
            <Text style={[styles.catChipText, selectedCategory === cat && styles.catChipTextActive]}>
              {cat}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Catalog View (VOD & Series) OR Channel List */}
      {(section === 'vod' || section === 'series') && vodShelves.length > 0 ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 72, gap: 18 }}>
          {heroCatalogItem && (
            <Pressable
              style={[styles.heroCard, { backgroundColor: theme.surface }]}
              onPress={() => handleOpenItem(heroCatalogItem)}
            >
              {heroCatalogItem.logo ? (
                <Image source={{ uri: heroCatalogItem.logo }} style={styles.heroPoster} resizeMode="cover" />
              ) : (
                <View style={[styles.heroPoster, { backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 28 }}>🎬</Text>
                </View>
              )}
              <View style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
                <Text style={[styles.heroBadge, { color: theme.accent }]}>EM DESTAQUE</Text>
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {heroCatalogItem.name}
                </Text>
                <Text style={styles.channelSub} numberOfLines={1}>
                  {heroCatalogItem.group}
                </Text>
                <View style={[styles.heroCta, { backgroundColor: theme.accent }]}>
                  <Text style={styles.heroCtaText}>▶ Ver / Assistir</Text>
                </View>
              </View>
            </Pressable>
          )}

          {vodShelves.map((shelf) => (
            <View key={shelf.group} style={{ gap: 10 }}>
              <View style={styles.shelfHeader}>
                <Text style={styles.shelfTitle} numberOfLines={1}>
                  {shelf.group}
                </Text>
                <Pressable onPress={() => setSelectedCategory(shelf.group)}>
                  <Text style={{ color: theme.accent, fontSize: 12.5, fontWeight: '700' }}>
                    Ver tudo ({shelf.total}) →
                  </Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {shelf.items.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.posterCard}
                    onPress={() => handleOpenItem(item)}
                  >
                    {item.logo ? (
                      <Image source={{ uri: item.logo }} style={styles.posterImg} resizeMode="cover" />
                    ) : (
                      <View style={[styles.posterImg, { backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 26 }}>🎬</Text>
                      </View>
                    )}
                    <Text style={styles.posterTitle} numberOfLines={2}>
                      {item.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      ) : (
        <FlatList
          key={section === 'vod' || section === 'series' ? 'poster-grid' : 'channel-list'}
          numColumns={section === 'vod' || section === 'series' ? 3 : 1}
          data={filteredChannels.slice(0, displayLimit)}
          keyExtractor={(item) => item.id}
          initialNumToRender={14}
          maxToRenderPerBatch={14}
          windowSize={5}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={section === 'vod' || section === 'series' ? { gap: 10 } : undefined}
          ListFooterComponent={
            filteredChannels.length > displayLimit ? (
              <Pressable
                style={[styles.loadMoreBtn, { backgroundColor: theme.surface }]}
                onPress={() => setDisplayLimit((d) => d + 80)}
              >
                <Text style={styles.loadMoreText}>
                  Carregar mais ({filteredChannels.length - displayLimit} restantes)
                </Text>
              </Pressable>
            ) : undefined
          }
          renderItem={({ item }) => {
            if (section === 'vod' || section === 'series') {
              return (
                <Pressable style={styles.gridPosterItem} onPress={() => handleOpenItem(item)}>
                  {item.logo ? (
                    <Image source={{ uri: item.logo }} style={styles.gridPosterImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.gridPosterImg, { backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 24 }}>🎬</Text>
                    </View>
                  )}
                  <Text style={styles.posterTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            }

            const isFav = favoriteSet.has(item.id);
            const { current } = getNowAndNextPrograms(epg, item);
            const isActive = activeChannel?.id === item.id;
            return (
              <Pressable
                style={[
                  styles.channelRow,
                  { backgroundColor: theme.surface, borderColor: isActive ? theme.accent : 'transparent' },
                ]}
                onPress={() => handleOpenItem(item)}
                onLongPress={() => {
                  if (section === 'recents') {
                    Alert.alert(item.name, 'Remover este canal dos recentes?', [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Remover', style: 'destructive', onPress: () => removeRecent(item.id) },
                    ]);
                  }
                }}
              >
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={[styles.channelLogo, { backgroundColor: theme.card }]} resizeMode="contain" />
                ) : (
                  <View style={[styles.channelLogoFallback, { backgroundColor: theme.card }]}>
                    <Text style={styles.channelLogoText}>{item.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.channelMeta}>
                  <Text style={styles.channelName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.channelSub} numberOfLines={1}>
                    {current ? `${formatTime(current.start)} • ${current.title}` : item.group}
                  </Text>
                </View>
                <Pressable onPress={() => toggleFavorite(item.id)} style={styles.starBtn}>
                  <Text style={[styles.starText, isFav && styles.starActive]}>{isFav ? '★' : '☆'}</Text>
                </Pressable>
                {section === 'recents' && (
                  <Pressable onPress={() => removeRecent(item.id)} style={styles.starBtn}>
                    <Text style={{ color: '#fca5a5', fontSize: 15, fontWeight: '700' }}>✕</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          }}
        />
      )}
          </View>
        )}
      </View>

      {/* Modals (montados apenas quando abertos para não travar com players extras) */}
      {addModalVisible && (
        <AddSourceModal
          visible
          theme={theme}
          loading={loading}
          statusText={activityMessage}
          onClose={() => setAddModalVisible(false)}
          onImportM3uUrl={handleImportM3uUrl}
          onPickLocalM3u={handlePickLocalM3u}
          onConnectXtream={handleConnectXtream}
          onImportEpgUrl={handleImportEpgUrl}
          onPickLocalEpg={handlePickLocalEpg}
          onLoadDemo={handleLoadDemo}
        />
      )}

      {settingsVisible && (
        <SettingsModal
          visible
          sources={sources}
          theme={theme}
          loading={loading}
          playerSizeMode={playerSizeMode}
          videoContentFit={videoContentFit}
          forceLandscape={forceLandscape}
          forceLandscapeFullscreen={forceLandscapeFullscreen}
          onChangePlayerSizeMode={setPlayerSizeMode}
          onChangeVideoContentFit={setVideoContentFit}
          onToggleForceLandscape={handleToggleForceLandscape}
          onToggleForceLandscapeFullscreen={setForceLandscapeFullscreen}
          onClose={() => setSettingsVisible(false)}
          onAddNewSource={() => {
            setSettingsVisible(false);
            setAddModalVisible(true);
          }}
          onEditSource={(src) => setEditingSource(src)}
          onRefreshSource={handleRefreshSource}
          onRemoveSource={handleRemoveSource}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          onUpdateTheme={(next) => setTheme(next)}
        />
      )}

      {editingSource && (
        <EditSourceModal
          source={editingSource}
          theme={theme}
          loading={loading}
          statusText={activityMessage}
          onClose={() => setEditingSource(null)}
          onSave={handleSaveEditedSource}
        />
      )}

      {moviePreview && (
        <MovieDetailsModal
          movie={moviePreview}
          sources={sources}
          theme={theme}
          isFavorite={favoriteSet.has(moviePreview.id)}
          onClose={() => setMoviePreview(null)}
          onWatch={(m) => {
            setMoviePreview(null);
            playChannelDirectly(m);
          }}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {seriesPreview && (
        <SeriesDetailsModal
          series={seriesPreview}
          sources={sources}
          theme={theme}
          isFavorite={favoriteSet.has(seriesPreview.id)}
          onClose={() => setSeriesPreview(null)}
          onPlayEpisode={playChannelDirectly}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {dualStreamVisible && (
        <DualStreamModal
          visible
          channels={channels}
          initialChannel={activeChannel}
          initialPosition={dualStreamInitialPos}
          theme={theme}
          forceLandscape={forceLandscape}
          onToggleForceLandscape={handleToggleForceLandscape}
          onClose={handleCloseDualStream}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  headerCompact: {
    paddingVertical: 4,
  },
  mainArea: { flex: 1 },
  mainAreaLandscape: { flexDirection: 'row', gap: 10, paddingBottom: 6 },
  browserColumn: { flex: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandLogo: { width: 38, height: 38, borderRadius: 10 },
  brandTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  brandSub: { color: '#94a3b8', fontSize: 11.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconPillBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  iconPillText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12.5 },
  addBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  activityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 8,
  },
  activityText: { color: '#dbeafe', fontSize: 12.5, fontWeight: '600', flex: 1 },
  playerBox: { borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  videoWrap: { width: '100%', height: 205, backgroundColor: '#000', position: 'relative' },
  video: { width: '100%', height: 205, backgroundColor: '#000' },
  fuzzyHint: { color: '#93c5fd', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  playerInfo: { padding: 10, gap: 4 },
  playerInfoCompact: { paddingVertical: 6, paddingHorizontal: 10, gap: 3 },
  playerChannelName: { color: '#f8fafc', fontWeight: '700', fontSize: 14.5 },
  epgToggleLink: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  playerEpgText: { color: '#93c5fd', fontSize: 12 },
  transportRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  ctrlBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  ctrlBtnText: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  epgDrawer: { borderRadius: 8, padding: 10, marginTop: 6, gap: 4 },
  epgDrawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  epgDrawerTitle: { color: '#f8fafc', fontSize: 12.5, fontWeight: '700' },
  epgEmpty: { color: '#94a3b8', fontSize: 12 },
  epgRowText: { color: '#cbd5e1', fontSize: 12 },
  emptyStage: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  emptyTitle: { color: '#cbd5e1', fontSize: 14, marginBottom: 10 },
  demoBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  demoBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  tabScroll: { flexGrow: 0, flexShrink: 0, marginBottom: 8 },
  horizontalBarContent: { alignItems: 'center', paddingVertical: 2 },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  searchInput: {
    color: '#f8fafc',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  clearRecentsBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  clearRecentsText: { color: '#fca5a5', fontSize: 12.5, fontWeight: '700' },
  catScroll: { flexGrow: 0, flexShrink: 0, marginBottom: 10 },
  catChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 8,
  },
  catChipText: { color: '#94a3b8', fontSize: 12.5 },
  catChipTextActive: { color: '#fff', fontWeight: '700' },
  heroCard: { borderRadius: 14, padding: 12, flexDirection: 'row', gap: 12 },
  heroPoster: { width: 96, height: 140, borderRadius: 10 },
  heroBadge: { fontSize: 10.5, fontWeight: '800' },
  heroTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  heroCta: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginTop: 4 },
  heroCtaText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  shelfHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shelfTitle: { color: '#f8fafc', fontSize: 15.5, fontWeight: '700', flex: 1 },
  posterCard: { width: 112, marginRight: 10, gap: 5 },
  posterImg: { width: 112, height: 164, borderRadius: 9 },
  posterTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  gridPosterItem: { flex: 1, maxWidth: '32%', marginBottom: 12, gap: 5 },
  gridPosterImg: { width: '100%', aspectRatio: 2 / 3, borderRadius: 9 },
  listContent: { paddingBottom: 72, gap: 8 },
  loadMoreBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  loadMoreText: { color: '#93c5fd', fontWeight: '700', fontSize: 13 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
  },
  channelLogo: { width: 42, height: 42, borderRadius: 8 },
  channelLogoFallback: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLogoText: { color: '#93c5fd', fontWeight: '700' },
  channelMeta: { flex: 1 },
  channelName: { color: '#f8fafc', fontWeight: '600', fontSize: 14 },
  channelSub: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  starBtn: { padding: 6 },
  starText: { color: '#64748b', fontSize: 18 },
  starActive: { color: '#f59e0b' },
});
