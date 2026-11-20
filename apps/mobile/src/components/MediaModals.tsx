import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fetchXtreamSeriesInfo,
  fetchXtreamVodInfo,
  type AppThemeSettings,
  type Channel,
  type PlaylistSource,
  type SeriesDetails,
  type SeriesEpisode,
  type VodDetails,
} from '@tv-local/core';
import { androidSmartFetch } from '../utils/mobileNetwork';

interface MovieDetailsModalProps {
  movie: Channel | null;
  sources: PlaylistSource[];
  theme: AppThemeSettings;
  isFavorite: boolean;
  onClose: () => void;
  onWatch: (movie: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
}

export function MovieDetailsModal({
  movie,
  sources,
  theme,
  isFavorite,
  onClose,
  onWatch,
  onToggleFavorite,
}: MovieDetailsModalProps) {
  const [details, setDetails] = useState<VodDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!movie) {
      setDetails(null);
      return;
    }

    const src = sources.find((s) => s.id === movie.sourceId);
    if (!src?.xtream || !movie.streamId) {
      setDetails(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchXtreamVodInfo(src.xtream, movie.streamId, androidSmartFetch)
      .then((res) => {
        if (!cancelled) setDetails(res);
      })
      .catch(() => {
        if (!cancelled) setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [movie, sources]);

  if (!movie) return null;

  const posterUrl = movie.logo || details?.cover || details?.backdrop;
  const rating = details?.rating || movie.rating;
  const plot = details?.plot || movie.plot || 'Sem sinopse disponível para este título.';
  const ext = (details?.containerExtension || movie.containerExtension)?.toUpperCase();

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Detalhes do Filme
            </Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.accent }]}>Voltar</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 480 }}>
            <View style={styles.heroRow}>
              {posterUrl ? (
                <Image source={{ uri: posterUrl }} style={styles.poster} resizeMode="cover" />
              ) : (
                <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.card }]}>
                  <Text style={styles.fallbackEmoji}>🎬</Text>
                </View>
              )}

              <View style={styles.heroMeta}>
                <Text style={styles.title}>{details?.title || movie.name}</Text>
                <View style={styles.badgesRow}>
                  <View style={[styles.badge, { backgroundColor: theme.card }]}>
                    <Text style={styles.badgeText}>{details?.genre || movie.group}</Text>
                  </View>
                  {rating && rating !== '0' && (
                    <View style={[styles.badge, { backgroundColor: '#2b2312' }]}>
                      <Text style={[styles.badgeText, { color: '#fbbf24' }]}>★ {rating}</Text>
                    </View>
                  )}
                  {details?.releaseDate && (
                    <View style={[styles.badge, { backgroundColor: theme.card }]}>
                      <Text style={styles.badgeText}>📅 {details.releaseDate}</Text>
                    </View>
                  )}
                  {details?.duration && (
                    <View style={[styles.badge, { backgroundColor: theme.card }]}>
                      <Text style={styles.badgeText}>⏱ {details.duration}</Text>
                    </View>
                  )}
                  {ext && (
                    <View style={[styles.badge, { backgroundColor: theme.card }]}>
                      <Text style={styles.badgeText}>{ext}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {loading && <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />}

            <Text style={styles.sectionLabel}>SINOPSE</Text>
            <Text style={styles.plotText}>{plot}</Text>

            {details?.director && (
              <>
                <Text style={styles.sectionLabel}>DIREÇÃO</Text>
                <Text style={styles.metaText}>{details.director}</Text>
              </>
            )}

            {details?.cast && (
              <>
                <Text style={styles.sectionLabel}>ELENCO</Text>
                <Text style={styles.metaText}>{details.cast}</Text>
              </>
            )}
          </ScrollView>

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: theme.accent, flex: 1 }]}
              onPress={() => onWatch(movie)}
            >
              <Text style={styles.btnText}>▶ Assistir Agora</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, { backgroundColor: theme.card }]}
              onPress={() => onToggleFavorite(movie.id)}
            >
              <Text style={[styles.btnText, isFavorite && { color: '#f59e0b' }]}>
                {isFavorite ? '★ Favorito' : '☆ Favoritar'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface SeriesDetailsModalProps {
  series: Channel | null;
  sources: PlaylistSource[];
  theme: AppThemeSettings;
  isFavorite: boolean;
  onClose: () => void;
  onPlayEpisode: (episodeChannel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
}

export function SeriesDetailsModal({
  series,
  sources,
  theme,
  isFavorite,
  onClose,
  onPlayEpisode,
  onToggleFavorite,
}: SeriesDetailsModalProps) {
  const [details, setDetails] = useState<SeriesDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!series || !series.seriesId) {
      setDetails(null);
      return;
    }

    const src = sources.find((s) => s.id === series.sourceId);
    if (!src?.xtream) return;

    let cancelled = false;
    setLoading(true);
    fetchXtreamSeriesInfo(src.xtream, series.seriesId, androidSmartFetch)
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
        const firstSeason = Object.keys(res.seasons)
          .map(Number)
          .sort((a, b) => a - b)[0];
        if (firstSeason) setSelectedSeason(firstSeason);
      })
      .catch(() => {
        if (!cancelled) setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [series, sources]);

  if (!series) return null;

  const seasons = details ? Object.keys(details.seasons).map(Number).sort((a, b) => a - b) : [];
  const episodes: SeriesEpisode[] = details?.seasons[selectedSeason] ?? [];
  const posterUrl = series.logo || details?.cover;

  const playEp = (ep: SeriesEpisode) => {
    onPlayEpisode({
      id: `${series.id}_ep_${ep.id}`,
      name: `${series.name} • T${ep.season}E${ep.episodeNum} — ${ep.title}`,
      url: ep.url,
      logo: ep.cover || series.logo,
      group: series.group,
      kind: 'series',
      sourceId: series.sourceId,
    });
    onClose();
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface, maxHeight: '88%' }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {details?.name || series.name}
            </Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.accent }]}>Voltar</Text>
            </Pressable>
          </View>

          <View style={styles.heroRow}>
            {posterUrl ? (
              <Image source={{ uri: posterUrl }} style={styles.seriesPoster} resizeMode="cover" />
            ) : (
              <View style={[styles.seriesPoster, styles.posterFallback, { backgroundColor: theme.card }]}>
                <Text style={styles.fallbackEmoji}>🎞</Text>
              </View>
            )}
            <View style={styles.heroMeta}>
              <Text style={styles.metaText}>{series.group}</Text>
              {(details?.plot || series.plot) && (
                <Text style={styles.plotText} numberOfLines={4}>
                  {details?.plot || series.plot}
                </Text>
              )}
              <Pressable
                style={[styles.secondaryBtn, { backgroundColor: theme.card, alignSelf: 'flex-start' }]}
                onPress={() => onToggleFavorite(series.id)}
              >
                <Text style={[styles.btnText, isFavorite && { color: '#f59e0b' }]}>
                  {isFavorite ? '★ Na Minha Lista' : '☆ Minha Lista'}
                </Text>
              </Pressable>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 16 }} />
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 40 }}>
                {seasons.map((s) => (
                  <Pressable
                    key={s}
                    style={[
                      styles.seasonPill,
                      { backgroundColor: selectedSeason === s ? theme.accent : theme.card },
                    ]}
                    onPress={() => setSelectedSeason(s)}
                  >
                    <Text style={styles.seasonText}>Temporada {s}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <FlatList
                data={episodes}
                keyExtractor={(ep) => ep.id}
                style={{ maxHeight: 280 }}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item: ep }) => (
                  <Pressable
                    style={[styles.epCard, { backgroundColor: theme.card }]}
                    onPress={() => playEp(ep)}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.epTitle}>
                        {ep.episodeNum}. {ep.title}
                      </Text>
                      {ep.duration && <Text style={styles.metaText}>⏱ {ep.duration}</Text>}
                      {ep.plot && (
                        <Text style={styles.epPlot} numberOfLines={2}>
                          {ep.plot}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.playPill, { color: theme.accent }]}>▶</Text>
                  </Pressable>
                )}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 16,
  },
  card: { borderRadius: 16, padding: 16, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '800', flex: 1 },
  closeText: { fontWeight: '700', fontSize: 14 },
  heroRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  poster: { width: 112, height: 166, borderRadius: 10 },
  seriesPoster: { width: 92, height: 136, borderRadius: 10 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackEmoji: { fontSize: 30 },
  heroMeta: { flex: 1, gap: 6 },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: '#cbd5e1', fontSize: 11, fontWeight: '600' },
  sectionLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 3 },
  plotText: { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },
  metaText: { color: '#94a3b8', fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  primaryBtn: { paddingVertical: 12, borderRadius: 9, alignItems: 'center' },
  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  seasonPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginRight: 8 },
  seasonText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  epCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 10,
  },
  epTitle: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700' },
  epPlot: { color: '#94a3b8', fontSize: 12 },
  playPill: { fontSize: 18, fontWeight: '800', paddingHorizontal: 6 },
});
