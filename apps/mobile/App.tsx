import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  createDemoPlaylist,
  fetchXtreamAllContent,
  fetchXtreamSeriesInfo,
  getNowAndNextPrograms,
  parseM3u,
  parseXmltv,
  type Channel,
  type EpgMap,
  type PlaylistSource,
  type SeriesDetails,
} from '@tv-local/core';

type MobileSection = 'live' | 'vod' | 'series' | 'favorites';
type AddMode = 'm3u_url' | 'xtream' | 'demo';

const STORAGE_KEY = 'tv_local_mobile_v1';

interface PersistedMobileState {
  sources: PlaylistSource[];
  channels: Channel[];
  favorites: string[];
  epg: EpgMap;
}

export default function App() {
  const [sources, setSources] = useState<PlaylistSource[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [epg, setEpg] = useState<EpgMap>({});

  const [section, setSection] = useState<MobileSection>('live');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('m3u_url');
  const [loading, setLoading] = useState(false);

  const [m3uName, setM3uName] = useState('Minha Lista M3U');
  const [m3uUrl, setM3uUrl] = useState('');
  const [xtName, setXtName] = useState('Servidor Xtream');
  const [xtServer, setXtServer] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');

  const [seriesModalChannel, setSeriesModalChannel] = useState<Channel | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  const player = useVideoPlayer(activeChannel?.url ? { uri: activeChannel.url } : null, (p) => {
    p.play();
  });

  useEffect(() => {
    if (activeChannel?.url) {
      player.replaceAsync({ uri: activeChannel.url }).then(() => player.play()).catch(() => undefined);
    }
  }, [activeChannel?.url, player]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<PersistedMobileState>;
        if (Array.isArray(parsed.sources)) setSources(parsed.sources);
        if (Array.isArray(parsed.channels)) setChannels(parsed.channels);
        if (Array.isArray(parsed.favorites)) setFavorites(parsed.favorites);
        if (parsed.epg) setEpg(parsed.epg);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const payload: PersistedMobileState = { sources, channels, favorites, epg };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
  }, [sources, channels, favorites, epg]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const sectionChannels = useMemo(() => {
    if (section === 'favorites') {
      return channels.filter((c) => favoriteSet.has(c.id));
    }
    return channels.filter((c) => c.kind === section);
  }, [channels, favoriteSet, section]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const ch of sectionChannels) {
      set.add(ch.group);
    }
    return ['Todas', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [sectionChannels]);

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sectionChannels.filter((ch) => {
      if (selectedCategory !== 'Todas' && ch.group !== selectedCategory) return false;
      if (!q) return true;
      return ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q);
    });
  }, [sectionChannels, selectedCategory, searchQuery]);

  const handleLoadDemo = () => {
    const demo = createDemoPlaylist();
    setSources((prev) => [demo.source, ...prev.filter((s) => s.id !== demo.source.id)]);
    setChannels((prev) => [...demo.channels, ...prev.filter((c) => c.sourceId !== demo.source.id)]);
    setEpg((prev) => ({ ...prev, ...demo.epg }));
    setSection('live');
    setSelectedCategory('Todas');
    setActiveChannel(demo.channels[0]);
    setModalVisible(false);
  };

  const handleImportM3uUrl = async () => {
    if (!m3uUrl.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(m3uUrl.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const sourceId = `m3u_${Date.now().toString(36)}`;
      const parsed = parseM3u(text, sourceId);
      if (!parsed.channels.length) throw new Error('Lista M3U vazia ou inválida.');

      const source: PlaylistSource = {
        id: sourceId,
        name: m3uName.trim() || 'Lista M3U',
        type: 'm3u_url',
        url: m3uUrl.trim(),
        epgUrl: parsed.epgUrl,
        addedAt: Date.now(),
        channelCount: parsed.channels.length,
      };
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...parsed.channels, ...prev]);

      if (parsed.epgUrl) {
        fetch(parsed.epgUrl)
          .then((r) => r.text())
          .then((xml) => setEpg((prev) => ({ ...prev, ...parseXmltv(xml) })))
          .catch(() => undefined);
      }
      setModalVisible(false);
    } catch (err) {
      Alert.alert('Erro ao importar M3U', err instanceof Error ? err.message : 'Falha na importação');
    } finally {
      setLoading(false);
    }
  };

  const handlePickLocalM3u = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const file = new ExpoFile(asset.uri);
      const content = await file.text();
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
        channelCount: parsed.channels.length,
      };
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...parsed.channels, ...prev]);
      setModalVisible(false);
    } catch (err) {
      Alert.alert('Erro ao ler arquivo', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  };

  const handleConnectXtream = async () => {
    if (!xtServer.trim() || !xtUser.trim()) return;
    setLoading(true);
    try {
      const sourceId = `xt_${Date.now().toString(36)}`;
      const creds = { serverUrl: xtServer.trim(), username: xtUser.trim(), password: xtPass };
      const res = await fetchXtreamAllContent(creds, sourceId);
      const source: PlaylistSource = {
        id: sourceId,
        name: xtName.trim() || res.account.username,
        type: 'xtream',
        xtream: creds,
        epgUrl: res.epgUrl,
        addedAt: Date.now(),
        channelCount: res.channels.length,
      };
      setSources((prev) => [source, ...prev]);
      setChannels((prev) => [...res.channels, ...prev]);
      setModalVisible(false);
    } catch (err) {
      Alert.alert('Erro Xtream', err instanceof Error ? err.message : 'Falha na autenticação');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChannel = async (channel: Channel) => {
    if (channel.kind === 'series' && !channel.url && channel.seriesId) {
      const src = sources.find((s) => s.id === channel.sourceId);
      if (!src?.xtream) return;
      setSeriesModalChannel(channel);
      setSeriesDetails(null);
      try {
        const details = await fetchXtreamSeriesInfo(src.xtream, channel.seriesId);
        setSeriesDetails(details);
        const firstSeason = Object.keys(details.seasons).map(Number).sort((a, b) => a - b)[0];
        if (firstSeason) setSelectedSeason(firstSeason);
      } catch (err) {
        Alert.alert('Erro', err instanceof Error ? err.message : 'Erro ao carregar série');
      }
      return;
    }
    setActiveChannel(channel);
  };

  const toggleFavorite = (channelId: string) => {
    setFavorites((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [channelId, ...prev],
    );
  };

  const activeNowNext = activeChannel ? getNowAndNextPrograms(epg, activeChannel) : { upcoming: [] };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brandTitle}>TV Local</Text>
          <Text style={styles.brandSub}>Mobile & Android TV</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.addBtnText}>+ Lista</Text>
        </Pressable>
      </View>

      {activeChannel ? (
        <View style={styles.playerBox}>
          <VideoView
            style={styles.video}
            player={player}
            fullscreenOptions={{ enable: true }}
            allowsPictureInPicture
            nativeControls
          />
          <View style={styles.playerInfo}>
            <Text style={styles.playerChannelName} numberOfLines={1}>
              {activeChannel.name}
            </Text>
            <Text style={styles.playerEpgText} numberOfLines={1}>
              {activeNowNext.current
                ? `Agora: ${activeNowNext.current.title}`
                : activeChannel.group}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.emptyStage}>
          <Text style={styles.emptyTitle}>
            {channels.length === 0 ? 'Nenhuma lista carregada' : 'Selecione um canal para assistir'}
          </Text>
          {channels.length === 0 && (
            <Pressable style={styles.demoBtn} onPress={handleLoadDemo}>
              <Text style={styles.demoBtnText}>Testar com Lista Demo Legal</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.tabRow}>
        {(
          [
            ['live', 'Ao Vivo'],
            ['vod', 'Filmes'],
            ['series', 'Séries'],
            ['favorites', 'Favoritos'],
          ] as Array<[MobileSection, string]>
        ).map(([id, label]) => (
          <Pressable
            key={id}
            style={[styles.tabBtn, section === id && styles.tabBtnActive]}
            onPress={() => {
              setSection(id);
              setSelectedCategory('Todas');
            }}
          >
            <Text style={[styles.tabText, section === id && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar canal, filme ou série..."
        placeholderTextColor="#64748b"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
        {categories.map((cat) => (
          <Pressable
            key={cat}
            style={[styles.catChip, selectedCategory === cat && styles.catChipActive]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text style={[styles.catChipText, selectedCategory === cat && styles.catChipTextActive]}>
              {cat}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={filteredChannels.slice(0, 300)}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isFav = favoriteSet.has(item.id);
          const { current } = getNowAndNextPrograms(epg, item);
          return (
            <Pressable
              style={[
                styles.channelRow,
                activeChannel?.id === item.id && styles.channelRowActive,
              ]}
              onPress={() => handleOpenChannel(item)}
            >
              {item.logo ? (
                <Image source={{ uri: item.logo }} style={styles.channelLogo} resizeMode="contain" />
              ) : (
                <View style={styles.channelLogoFallback}>
                  <Text style={styles.channelLogoText}>{item.name.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.channelMeta}>
                <Text style={styles.channelName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.channelSub} numberOfLines={1}>
                  {current ? current.title : item.group}
                </Text>
              </View>
              <Pressable onPress={() => toggleFavorite(item.id)} style={styles.starBtn}>
                <Text style={[styles.starText, isFav && styles.starActive]}>
                  {isFav ? '★' : '☆'}
                </Text>
              </Pressable>
            </Pressable>
          );
        }}
      />

      {/* Add Source Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adicionar Lista IPTV</Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <Text style={styles.closeText}>Fechar</Text>
              </Pressable>
            </View>

            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tabBtn, addMode === 'm3u_url' && styles.tabBtnActive]}
                onPress={() => setAddMode('m3u_url')}
              >
                <Text style={styles.tabText}>URL M3U</Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, addMode === 'xtream' && styles.tabBtnActive]}
                onPress={() => setAddMode('xtream')}
              >
                <Text style={styles.tabText}>Xtream</Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, addMode === 'demo' && styles.tabBtnActive]}
                onPress={() => setAddMode('demo')}
              >
                <Text style={styles.tabText}>Demo</Text>
              </Pressable>
            </View>

            {addMode === 'm3u_url' && (
              <View style={styles.formGap}>
                <TextInput
                  style={styles.input}
                  placeholder="Nome da lista"
                  placeholderTextColor="#64748b"
                  value={m3uName}
                  onChangeText={setM3uName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="https://exemplo.com/lista.m3u"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={m3uUrl}
                  onChangeText={setM3uUrl}
                />
                <Pressable style={styles.primaryBtn} onPress={handleImportM3uUrl} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Importar URL M3U</Text>
                  )}
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={handlePickLocalM3u}>
                  <Text style={styles.secondaryBtnText}>Escolher Arquivo .M3U no Aparelho</Text>
                </Pressable>
              </View>
            )}

            {addMode === 'xtream' && (
              <View style={styles.formGap}>
                <TextInput
                  style={styles.input}
                  placeholder="Nome do perfil"
                  placeholderTextColor="#64748b"
                  value={xtName}
                  onChangeText={setXtName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="http://servidor:8080"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={xtServer}
                  onChangeText={setXtServer}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Usuário"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={xtUser}
                  onChangeText={setXtUser}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Senha"
                  placeholderTextColor="#64748b"
                  secureTextEntry
                  value={xtPass}
                  onChangeText={setXtPass}
                />
                <Pressable style={styles.primaryBtn} onPress={handleConnectXtream} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Conectar Xtream Codes</Text>
                  )}
                </Pressable>
              </View>
            )}

            {addMode === 'demo' && (
              <View style={styles.formGap}>
                <Text style={styles.helperText}>
                  Carrega streams públicos e legais de demonstração para testar o player mobile.
                </Text>
                <Pressable style={styles.primaryBtn} onPress={handleLoadDemo}>
                  <Text style={styles.primaryBtnText}>Carregar Lista Demo</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Series Modal */}
      <Modal visible={Boolean(seriesModalChannel)} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{seriesModalChannel?.name}</Text>
              <Pressable onPress={() => setSeriesModalChannel(null)}>
                <Text style={styles.closeText}>Fechar</Text>
              </Pressable>
            </View>
            {!seriesDetails ? (
              <ActivityIndicator color="#3b82f6" />
            ) : (
              <>
                <ScrollView horizontal style={styles.catScroll}>
                  {Object.keys(seriesDetails.seasons)
                    .map(Number)
                    .sort((a, b) => a - b)
                    .map((s) => (
                      <Pressable
                        key={s}
                        style={[styles.catChip, selectedSeason === s && styles.catChipActive]}
                        onPress={() => setSelectedSeason(s)}
                      >
                        <Text style={styles.catChipText}>Temporada {s}</Text>
                      </Pressable>
                    ))}
                </ScrollView>
                <FlatList
                  data={seriesDetails.seasons[selectedSeason] ?? []}
                  keyExtractor={(ep) => ep.id}
                  style={{ maxHeight: 320 }}
                  renderItem={({ item: ep }) => (
                    <Pressable
                      style={styles.channelRow}
                      onPress={() => {
                        if (!seriesModalChannel) return;
                        setActiveChannel({
                          id: `${seriesModalChannel.id}_ep_${ep.id}`,
                          name: `${seriesModalChannel.name} • T${ep.season}E${ep.episodeNum}`,
                          url: ep.url,
                          logo: ep.cover || seriesModalChannel.logo,
                          group: seriesModalChannel.group,
                          kind: 'series',
                          sourceId: seriesModalChannel.sourceId,
                        });
                        setSeriesModalChannel(null);
                      }}
                    >
                      <Text style={styles.channelName}>
                        Ep. {ep.episodeNum} — {ep.title}
                      </Text>
                    </Pressable>
                  )}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080c14', paddingHorizontal: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  brandTitle: { color: '#f8fafc', fontSize: 20, fontWeight: '800' },
  brandSub: { color: '#94a3b8', fontSize: 12 },
  addBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700' },
  playerBox: { backgroundColor: '#0f1624', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  video: { width: '100%', height: 210, backgroundColor: '#000' },
  playerInfo: { padding: 10 },
  playerChannelName: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  playerEpgText: { color: '#93c5fd', fontSize: 12, marginTop: 2 },
  emptyStage: {
    backgroundColor: '#0f1624',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  emptyTitle: { color: '#cbd5e1', fontSize: 14, marginBottom: 10 },
  demoBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  demoBtnText: { color: '#fff', fontWeight: '700' },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: {
    flex: 1,
    backgroundColor: '#0f1624',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: '#2563eb' },
  tabText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  searchInput: {
    backgroundColor: '#0f1624',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  catScroll: { maxHeight: 40, marginBottom: 8 },
  catChip: {
    backgroundColor: '#0f1624',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6,
    alignSelf: 'center',
  },
  catChipActive: { backgroundColor: '#1d4ed8' },
  catChipText: { color: '#94a3b8', fontSize: 12 },
  catChipTextActive: { color: '#fff', fontWeight: '700' },
  listContent: { paddingBottom: 24, gap: 8 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1624',
    padding: 10,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  channelRowActive: { borderColor: '#3b82f6', backgroundColor: '#172554' },
  channelLogo: { width: 42, height: 42, borderRadius: 8, backgroundColor: '#151e30' },
  channelLogoFallback: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#151e30',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: { backgroundColor: '#0f1624', borderRadius: 14, padding: 16, gap: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  closeText: { color: '#60a5fa', fontWeight: '600' },
  formGap: { gap: 10 },
  input: {
    backgroundColor: '#151e30',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  primaryBtn: { backgroundColor: '#3b82f6', padding: 12, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: '#151e30',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryBtnText: { color: '#cbd5e1', fontWeight: '600' },
  helperText: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },
});
