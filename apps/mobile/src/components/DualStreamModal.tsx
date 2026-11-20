import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { fuzzyFilterChannels, type AppThemeSettings, type Channel } from '@tv-local/core';

export interface DualStreamCloseResult {
  channel: Channel | null;
  position: number;
}

interface DualStreamModalProps {
  visible: boolean;
  channels: Channel[];
  initialChannel: Channel | null;
  initialPosition?: number;
  theme: AppThemeSettings;
  forceLandscape: boolean;
  onToggleForceLandscape: () => void;
  onClose: (transferBack: DualStreamCloseResult | null) => void;
}

export function DualStreamModal({
  visible,
  channels,
  initialChannel,
  initialPosition = 0,
  theme,
  forceLandscape,
  onToggleForceLandscape,
  onClose,
}: DualStreamModalProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

  const [slot1, setSlot1] = useState<Channel | null>(initialChannel);
  const [slot2, setSlot2] = useState<Channel | null>(null);
  const [muted1, setMuted1] = useState(false);
  const [muted2, setMuted2] = useState(true);
  const [playing1, setPlaying1] = useState(false);
  const [playing2, setPlaying2] = useState(false);
  const [activeTargetSlot, setActiveTargetSlot] = useState<1 | 2>(initialChannel ? 2 : 1);
  const [showPicker, setShowPicker] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [search, setSearch] = useState('');

  const muted1Ref = useRef(muted1);
  const muted2Ref = useRef(muted2);
  const closingRef = useRef(false);
  const pendingSeek1Ref = useRef<number>(
    initialChannel && initialChannel.kind !== 'live' && initialPosition > 0 ? initialPosition : 0,
  );

  useEffect(() => {
    muted1Ref.current = muted1;
  }, [muted1]);

  useEffect(() => {
    muted2Ref.current = muted2;
  }, [muted2]);

  const p1 = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.muted = muted1Ref.current;
  });

  const p2 = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.muted = muted2Ref.current;
  });

  useEffect(() => {
    const play1Sub = p1.addListener('playingChange', (ev) => {
      setPlaying1(ev.isPlaying);
    });
    const status1Sub = p1.addListener('statusChange', (ev) => {
      if (ev.status === 'readyToPlay' && pendingSeek1Ref.current > 0) {
        const target = pendingSeek1Ref.current;
        pendingSeek1Ref.current = 0;
        p1.currentTime = target;
      }
    });
    const play2Sub = p2.addListener('playingChange', (ev) => {
      setPlaying2(ev.isPlaying);
    });
    return () => {
      play1Sub.remove();
      status1Sub.remove();
      play2Sub.remove();
    };
  }, [p1, p2]);

  useEffect(() => {
    if (!visible) {
      p1.pause();
      p2.pause();
    } else {
      closingRef.current = false;
      setControlsVisible(true);
    }
  }, [visible, p1, p2]);

  useEffect(() => {
    p1.muted = muted1;
  }, [muted1, p1]);

  useEffect(() => {
    p2.muted = muted2;
  }, [muted2, p2]);

  useEffect(() => {
    if (!visible || !slot1?.url) return;
    let cancelled = false;
    p1.replaceAsync({ uri: slot1.url })
      .then(() => {
        if (cancelled || closingRef.current) return;
        p1.audioMixingMode = 'mixWithOthers';
        p1.muted = muted1Ref.current;
        if (pendingSeek1Ref.current > 0 && slot1.kind !== 'live' && p1.status === 'readyToPlay') {
          const target = pendingSeek1Ref.current;
          pendingSeek1Ref.current = 0;
          p1.currentTime = target;
        }
        p1.play();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, slot1?.url, slot1?.kind, p1]);

  useEffect(() => {
    if (!visible || !slot2?.url) return;
    let cancelled = false;
    p2.replaceAsync({ uri: slot2.url })
      .then(() => {
        if (cancelled || closingRef.current) return;
        p2.audioMixingMode = 'mixWithOthers';
        p2.muted = muted2Ref.current;
        p2.play();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, slot2?.url, p2]);

  const allPlayable = useMemo(
    () => channels.filter((c) => Boolean(c.url)),
    [channels],
  );

  const categories = useMemo(() => {
    const groups = Array.from(new Set(allPlayable.map((c) => c.group || 'Geral'))).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return ['Todas', ...groups];
  }, [allPlayable]);

  useEffect(() => {
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory('Todas');
    }
  }, [categories, selectedCategory]);

  const { playable, correctedQuery } = useMemo(() => {
    const byCategory =
      selectedCategory === 'Todas'
        ? allPlayable
        : allPlayable.filter((c) => (c.group || 'Geral') === selectedCategory);
    const res = fuzzyFilterChannels(byCategory, search);
    return {
      playable: res.items.slice(0, 120),
      correctedQuery: res.correctedQuery,
    };
  }, [allPlayable, selectedCategory, search]);

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const transferChannel = slot1 ?? slot2;
    const transferPlayer = slot1 ? p1 : slot2 ? p2 : null;
    const pos =
      transferChannel && transferChannel.kind !== 'live' && transferPlayer
        ? Math.max(0, transferPlayer.currentTime || 0)
        : 0;
    p1.pause();
    p2.pause();
    onClose(transferChannel ? { channel: transferChannel, position: pos } : null);
  };

  const topPad = isLandscape
    ? 8
    : Platform.OS === 'android'
      ? (RNStatusBar.currentHeight ?? 24) + 8
      : 36;

  const landscapeSlotHeight = showPicker
    ? Math.max(145, Math.round(winHeight * 0.44))
    : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: controlsVisible ? topPad : 0, paddingHorizontal: controlsVisible ? 12 : 0 }]}>
        {controlsVisible && (
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            2 Telas
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[
                styles.headerPill,
                { backgroundColor: showPicker ? theme.card : theme.accent },
              ]}
              onPress={() => setShowPicker((v) => !v)}
            >
              <Text style={styles.headerPillText}>
                {showPicker ? '⤢ Ampliar Telas' : '☰ Canais'}
              </Text>
            </Pressable>
            {!showPicker && (
              <Pressable
                style={[styles.headerPill, { backgroundColor: theme.card }]}
                onPress={() => setControlsVisible(false)}
              >
                <Text style={styles.headerPillText}>👁 Ocultar</Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.headerPill,
                { backgroundColor: forceLandscape ? theme.accent : theme.card },
              ]}
              onPress={onToggleForceLandscape}
            >
              <Text style={styles.headerPillText}>↻ Horizontal</Text>
            </Pressable>
            <Pressable style={[styles.headerPill, { backgroundColor: theme.card }]} onPress={handleClose}>
              <Text style={[styles.closeText, { color: theme.accent }]}>Fechar</Text>
            </Pressable>
          </View>
        </View>
        )}

        <View
          style={[
            styles.slotsWrapper,
            isLandscape && styles.slotsWrapperLandscape,
            (!showPicker || !controlsVisible) && { flex: 1 },
            isLandscape && showPicker && controlsVisible && landscapeSlotHeight ? { height: landscapeSlotHeight } : null,
          ]}
        >
          {/* Slot 1 */}
          <View
            style={[
              styles.slotBox,
              isLandscape && { flex: 1 },
              (!showPicker || !controlsVisible) && { flex: 1 },
              {
                backgroundColor: theme.surface,
                borderColor: activeTargetSlot === 1 ? theme.accent : '#1e293b',
              },
            ]}
          >
            {controlsVisible && (
            <View style={styles.slotBar}>
              <Pressable style={{ flex: 1 }} onPress={() => setActiveTargetSlot(1)}>
                <Text style={styles.slotTitle} numberOfLines={1}>
                  1: {slot1?.name || 'Toque aqui para escolher'}
                </Text>
              </Pressable>
              {slot1?.url && (
                <Pressable
                  style={[styles.audioBtn, { backgroundColor: theme.card }]}
                  onPress={() => (playing1 ? p1.pause() : p1.play())}
                >
                  <Text style={styles.audioText}>{playing1 ? '⏸' : '▶'}</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.audioBtn, { backgroundColor: muted1 ? theme.card : theme.accent }]}
                onPress={() => setMuted1((m) => !m)}
              >
                <Text style={styles.audioText}>{muted1 ? '🔇' : '🔊'}</Text>
              </Pressable>
              <Pressable
                style={[styles.audioBtn, { backgroundColor: theme.card }]}
                onPress={() => {
                  setMuted1(false);
                  setMuted2(true);
                }}
              >
                <Text style={styles.audioText}>🎧 Solo</Text>
              </Pressable>
            </View>
            )}
            <View
              style={[
                styles.videoWrap,
                (!showPicker || isLandscape || !controlsVisible) && { flex: 1, height: undefined },
              ]}
            >
              <VideoView
                style={{ flex: 1 }}
                player={p1}
                nativeControls={controlsVisible}
                controllerAutoShow
              />
              {!controlsVisible && (
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => {
                    setActiveTargetSlot(1);
                    setControlsVisible(true);
                  }}
                />
              )}
            </View>
          </View>

          {/* Slot 2 */}
          <View
            style={[
              styles.slotBox,
              isLandscape && { flex: 1 },
              (!showPicker || !controlsVisible) && { flex: 1 },
              {
                backgroundColor: theme.surface,
                borderColor: activeTargetSlot === 2 ? theme.accent : '#1e293b',
              },
            ]}
          >
            {controlsVisible && (
            <View style={styles.slotBar}>
              <Pressable style={{ flex: 1 }} onPress={() => setActiveTargetSlot(2)}>
                <Text style={styles.slotTitle} numberOfLines={1}>
                  2: {slot2?.name || 'Toque aqui para escolher'}
                </Text>
              </Pressable>
              {slot2?.url && (
                <Pressable
                  style={[styles.audioBtn, { backgroundColor: theme.card }]}
                  onPress={() => (playing2 ? p2.pause() : p2.play())}
                >
                  <Text style={styles.audioText}>{playing2 ? '⏸' : '▶'}</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.audioBtn, { backgroundColor: muted2 ? theme.card : theme.accent }]}
                onPress={() => setMuted2((m) => !m)}
              >
                <Text style={styles.audioText}>{muted2 ? '🔇' : '🔊'}</Text>
              </Pressable>
              <Pressable
                style={[styles.audioBtn, { backgroundColor: theme.card }]}
                onPress={() => {
                  setMuted1(true);
                  setMuted2(false);
                }}
              >
                <Text style={styles.audioText}>🎧 Solo</Text>
              </Pressable>
            </View>
            )}
            <View
              style={[
                styles.videoWrap,
                (!showPicker || isLandscape || !controlsVisible) && { flex: 1, height: undefined },
              ]}
            >
              <VideoView
                style={{ flex: 1 }}
                player={p2}
                nativeControls={controlsVisible}
                controllerAutoShow
              />
              {!controlsVisible && (
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => {
                    setActiveTargetSlot(2);
                    setControlsVisible(true);
                  }}
                />
              )}
            </View>
          </View>
        </View>

        {showPicker && controlsVisible && (
          <>
            <Text style={styles.targetHint}>
              Enviando próximo item escolhido para: Tela {activeTargetSlot}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catScroll}
              contentContainerStyle={styles.catScrollContent}
            >
              {categories.map((cat) => (
                <Pressable
                  key={cat}
                  style={[
                    styles.catChip,
                    { backgroundColor: selectedCategory === cat ? theme.accent : theme.surface },
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text style={[styles.catChipText, selectedCategory === cat && styles.catChipTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              style={[styles.searchInput, { backgroundColor: theme.surface }]}
              placeholder="Buscar canal, filme, série ou categoria..."
              placeholderTextColor="#64748b"
              value={search}
              onChangeText={setSearch}
            />
            {correctedQuery && (
              <Text style={styles.fuzzyHint}>
                Resultados aproximados para: "{correctedQuery}"
              </Text>
            )}

            <FlatList
              data={playable}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ gap: 6, paddingBottom: 16 }}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.pickRow, { backgroundColor: theme.surface }]}
                  onPress={() => {
                    if (activeTargetSlot === 1) {
                      pendingSeek1Ref.current = 0;
                      setSlot1(item);
                      setActiveTargetSlot(2);
                    } else {
                      setSlot2(item);
                    }
                  }}
                >
                  <Text style={styles.pickName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.pickGroup}>{item.group}</Text>
                </Pressable>
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  headerPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  headerPillText: { color: '#f1f5f9', fontSize: 12, fontWeight: '700' },
  closeText: { fontWeight: '700', fontSize: 12.5 },
  slotsWrapper: { gap: 8 },
  slotsWrapperLandscape: { flexDirection: 'row', gap: 8 },
  slotBox: { borderRadius: 10, borderWidth: 1.5, overflow: 'hidden' },
  slotBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  slotTitle: { color: '#f1f5f9', fontSize: 12, fontWeight: '700' },
  audioBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
  audioText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  videoWrap: { width: '100%', height: 135, backgroundColor: '#000', position: 'relative' },
  video: { width: '100%', height: 135, backgroundColor: '#000' },
  targetHint: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  catScroll: { flexGrow: 0, flexShrink: 0 },
  catScrollContent: { alignItems: 'center', gap: 6, paddingVertical: 2 },
  catChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  catChipText: { color: '#94a3b8', fontSize: 12 },
  catChipTextActive: { color: '#fff', fontWeight: '700' },
  fuzzyHint: { color: '#93c5fd', fontSize: 11.5, fontWeight: '600' },
  searchInput: {
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  pickName: { color: '#f8fafc', fontSize: 13, fontWeight: '600', flex: 1 },
  pickGroup: { color: '#94a3b8', fontSize: 11 },
});
