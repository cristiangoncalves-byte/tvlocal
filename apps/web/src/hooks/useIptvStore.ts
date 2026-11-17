import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createDemoPlaylist,
  fetchXtreamAllContent,
  parseM3u,
  parseXmltv,
  type Channel,
  type EpgMap,
  type PlaylistSource,
  type XtreamCredentials,
} from '@tv-local/core';
import { smartFetch } from '../utils/network';

export type NavSection = 'live' | 'vod' | 'series' | 'favorites' | 'recents';

const STORAGE_KEY = 'tv_local_store_v1';

interface PersistedState {
  sources: PlaylistSource[];
  channels: Channel[];
  favorites: string[];
  recents: string[];
  epg: EpgMap;
}

function loadPersistedState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { sources: [], channels: [], favorites: [], recents: [], epg: {} };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
      epg: parsed.epg && typeof parsed.epg === 'object' ? parsed.epg : {},
    };
  } catch {
    return { sources: [], channels: [], favorites: [], recents: [], epg: {} };
  }
}

export function useIptvStore() {
  const [state, setState] = useState<PersistedState>(() => loadPersistedState());
  const [section, setSection] = useState<NavSection>('live');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activeSeries, setActiveSeries] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota exceeded on very large EPGs
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...state, epg: {} }),
        );
      } catch {
        // Ignore
      }
    }
  }, [state]);

  const loadEpgFromUrl = useCallback(async (epgUrl: string) => {
    const res = await smartFetch(epgUrl);
    if (!res.ok) {
      throw new Error(`Erro HTTP ${res.status} ao baixar EPG.`);
    }
    const xml = await res.text();
    const parsed = parseXmltv(xml);
    setState((prev) => ({
      ...prev,
      epg: { ...prev.epg, ...parsed },
    }));
    return Object.keys(parsed).length;
  }, []);

  const loadEpgFromText = useCallback((xmlContent: string) => {
    const parsed = parseXmltv(xmlContent);
    setState((prev) => ({
      ...prev,
      epg: { ...prev.epg, ...parsed },
    }));
    return Object.keys(parsed).length;
  }, []);

  const addDemoPlaylist = useCallback(() => {
    const demo = createDemoPlaylist();
    setState((prev) => {
      const otherSources = prev.sources.filter((s) => s.id !== demo.source.id);
      const otherChannels = prev.channels.filter((c) => c.sourceId !== demo.source.id);
      return {
        ...prev,
        sources: [demo.source, ...otherSources],
        channels: [...demo.channels, ...otherChannels],
        epg: { ...prev.epg, ...demo.epg },
      };
    });
    setSection('live');
    setSelectedCategory('Todas');
    setActiveChannel(demo.channels[0]);
    setStatusMessage('Lista demo carregada com sucesso!');
  }, []);

  const addM3uFromText = useCallback(
    async (name: string, content: string, originUrl?: string) => {
      const sourceId = `m3u_${Date.now().toString(36)}`;
      const parsed = parseM3u(content, sourceId);
      if (!parsed.channels.length) {
        throw new Error('Nenhum canal válido encontrado nesta lista M3U.');
      }

      const source: PlaylistSource = {
        id: sourceId,
        name: name.trim() || 'Lista M3U',
        type: originUrl ? 'm3u_url' : 'm3u_file',
        url: originUrl,
        epgUrl: parsed.epgUrl,
        addedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        channelCount: parsed.channels.length,
      };

      setState((prev) => ({
        ...prev,
        sources: [source, ...prev.sources],
        channels: [...parsed.channels, ...prev.channels],
      }));

      setSelectedCategory('Todas');
      if (parsed.epgUrl) {
        loadEpgFromUrl(parsed.epgUrl).catch(() => undefined);
      }
      setStatusMessage(`${parsed.channels.length} itens importados de "${source.name}".`);
      return source;
    },
    [loadEpgFromUrl],
  );

  const addM3uFromUrl = useCallback(
    async (name: string, url: string) => {
      setIsLoading(true);
      try {
        const res = await smartFetch(url.trim());
        if (!res.ok) {
          throw new Error(`Erro HTTP ${res.status} ao baixar lista M3U.`);
        }
        const text = await res.text();
        return await addM3uFromText(name, text, url.trim());
      } finally {
        setIsLoading(false);
      }
    },
    [addM3uFromText],
  );

  const addXtreamSource = useCallback(
    async (name: string, creds: XtreamCredentials) => {
      setIsLoading(true);
      try {
        const sourceId = `xt_${Date.now().toString(36)}`;
        const result = await fetchXtreamAllContent(creds, sourceId, smartFetch);
        const source: PlaylistSource = {
          id: sourceId,
          name: name.trim() || result.account.username,
          type: 'xtream',
          xtream: creds,
          epgUrl: result.epgUrl,
          addedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          channelCount: result.channels.length,
        };

        setState((prev) => ({
          ...prev,
          sources: [source, ...prev.sources],
          channels: [...result.channels, ...prev.channels],
        }));

        setSelectedCategory('Todas');
        setStatusMessage(
          `Xtream "${source.name}" conectado (${result.channels.length} itens).`,
        );
        return source;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const refreshSource = useCallback(
    async (source: PlaylistSource) => {
      if (source.type === 'demo') {
        addDemoPlaylist();
        return;
      }
      setIsLoading(true);
      try {
        if (source.type === 'm3u_url' && source.url) {
          const res = await smartFetch(source.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const parsed = parseM3u(await res.text(), source.id);
          setState((prev) => ({
            ...prev,
            sources: prev.sources.map((s) =>
              s.id === source.id
                ? { ...s, lastUpdatedAt: Date.now(), channelCount: parsed.channels.length }
                : s,
            ),
            channels: [
              ...parsed.channels,
              ...prev.channels.filter((c) => c.sourceId !== source.id),
            ],
          }));
          setStatusMessage(`Lista "${source.name}" atualizada (${parsed.channels.length} itens).`);
        } else if (source.type === 'xtream' && source.xtream) {
          const result = await fetchXtreamAllContent(source.xtream, source.id, smartFetch);
          setState((prev) => ({
            ...prev,
            sources: prev.sources.map((s) =>
              s.id === source.id
                ? { ...s, lastUpdatedAt: Date.now(), channelCount: result.channels.length }
                : s,
            ),
            channels: [
              ...result.channels,
              ...prev.channels.filter((c) => c.sourceId !== source.id),
            ],
          }));
          setStatusMessage(`Xtream "${source.name}" atualizado (${result.channels.length} itens).`);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [addDemoPlaylist],
  );

  const removeSource = useCallback((sourceId: string) => {
    setState((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== sourceId),
      channels: prev.channels.filter((c) => c.sourceId !== sourceId),
    }));
    setActiveChannel((curr) => (curr?.sourceId === sourceId ? null : curr));
  }, []);

  const toggleFavorite = useCallback((channelId: string) => {
    setState((prev) => {
      const exists = prev.favorites.includes(channelId);
      return {
        ...prev,
        favorites: exists
          ? prev.favorites.filter((id) => id !== channelId)
          : [channelId, ...prev.favorites],
      };
    });
  }, []);

  const playChannel = useCallback((channel: Channel) => {
    if (channel.kind === 'series' && !channel.url) {
      setActiveSeries(channel);
      return;
    }
    setActiveChannel(channel);
    setState((prev) => ({
      ...prev,
      recents: [channel.id, ...prev.recents.filter((id) => id !== channel.id)].slice(0, 30),
    }));
  }, []);

  const sectionChannels = useMemo(() => {
    if (section === 'favorites') {
      const favSet = new Set(state.favorites);
      return state.channels.filter((c) => favSet.has(c.id));
    }
    if (section === 'recents') {
      const map = new Map(state.channels.map((c) => [c.id, c]));
      return state.recents.map((id) => map.get(id)).filter((c): c is Channel => Boolean(c));
    }
    return state.channels.filter((c) => c.kind === section);
  }, [section, state.channels, state.favorites, state.recents]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ch of sectionChannels) {
      counts.set(ch.group, (counts.get(ch.group) ?? 0) + 1);
    }
    return [
      { name: 'Todas', count: sectionChannels.length },
      ...Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    ];
  }, [sectionChannels]);

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sectionChannels.filter((ch) => {
      if (selectedCategory !== 'Todas' && ch.group !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        ch.name.toLowerCase().includes(q) ||
        ch.group.toLowerCase().includes(q)
      );
    });
  }, [sectionChannels, selectedCategory, searchQuery]);

  const favoriteSet = useMemo(() => new Set(state.favorites), [state.favorites]);

  const activeSource = useMemo(
    () => (activeSeries ? state.sources.find((s) => s.id === activeSeries.sourceId) : undefined),
    [activeSeries, state.sources],
  );

  return {
    sources: state.sources,
    channels: state.channels,
    epg: state.epg,
    favoriteSet,
    section,
    setSection: (next: NavSection) => {
      setSection(next);
      setSelectedCategory('Todas');
    },
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    categories,
    filteredChannels,
    activeChannel,
    setActiveChannel,
    activeSeries,
    setActiveSeries,
    activeSeriesCredentials: activeSource?.xtream,
    isLoading,
    statusMessage,
    setStatusMessage,
    addDemoPlaylist,
    addM3uFromText,
    addM3uFromUrl,
    addXtreamSource,
    loadEpgFromUrl,
    loadEpgFromText,
    refreshSource,
    removeSource,
    toggleFavorite,
    playChannel,
  };
}
