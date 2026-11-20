import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  APP_THEME_PRESETS,
  DEFAULT_APP_THEME,
  type AppThemeSettings,
  type PlaylistSource,
} from '@tv-local/core';
import { checkMobileAppUpdates, getMobileAppVersion } from '../utils/mobileUpdates';

export type MobilePlayerSizeMode = 'normal' | 'large' | 'expanded';
export type MobileVideoFit = 'contain' | 'cover';

interface SettingsModalProps {
  visible: boolean;
  sources: PlaylistSource[];
  theme: AppThemeSettings;
  loading: boolean;
  playerSizeMode: MobilePlayerSizeMode;
  videoContentFit: MobileVideoFit;
  forceLandscape: boolean;
  forceLandscapeFullscreen: boolean;
  onChangePlayerSizeMode: (mode: MobilePlayerSizeMode) => void;
  onChangeVideoContentFit: (fit: MobileVideoFit) => void;
  onToggleForceLandscape: () => void;
  onToggleForceLandscapeFullscreen: (enabled: boolean) => void;
  onClose: () => void;
  onAddNewSource: () => void;
  onEditSource: (source: PlaylistSource) => void;
  onRefreshSource: (source: PlaylistSource) => Promise<void>;
  onRemoveSource: (sourceId: string) => void;
  onExportBackup: () => Promise<void>;
  onImportBackup: () => Promise<void>;
  onUpdateTheme: (theme: AppThemeSettings) => void;
}

export function SettingsModal({
  visible,
  sources,
  theme,
  loading,
  playerSizeMode,
  videoContentFit,
  forceLandscape,
  forceLandscapeFullscreen,
  onChangePlayerSizeMode,
  onChangeVideoContentFit,
  onToggleForceLandscape,
  onToggleForceLandscapeFullscreen,
  onClose,
  onAddNewSource,
  onEditSource,
  onRefreshSource,
  onRemoveSource,
  onExportBackup,
  onImportBackup,
  onUpdateTheme,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'accounts' | 'player' | 'theme'>('accounts');
  const [bgHex, setBgHex] = useState(theme.bg);
  const [surfaceHex, setSurfaceHex] = useState(theme.surface);
  const [cardHex, setCardHex] = useState(theme.card);
  const [accentHex, setAccentHex] = useState(theme.accent);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    setBgHex(theme.bg);
    setSurfaceHex(theme.surface);
    setCardHex(theme.card);
    setAccentHex(theme.accent);
  }, [theme]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Configurações</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.accent }]}>Fechar</Text>
            </Pressable>
          </View>

          <View style={styles.tabsRow}>
            <Pressable
              style={[
                styles.tabPill,
                { backgroundColor: tab === 'accounts' ? theme.accent : theme.card },
              ]}
              onPress={() => setTab('accounts')}
            >
              <Text style={[styles.tabText, tab === 'accounts' && styles.tabTextActive]}>
                Contas e Listas
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.tabPill,
                { backgroundColor: tab === 'player' ? theme.accent : theme.card },
              ]}
              onPress={() => setTab('player')}
            >
              <Text style={[styles.tabText, tab === 'player' && styles.tabTextActive]}>
                Player & Tela
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.tabPill,
                { backgroundColor: tab === 'theme' ? theme.accent : theme.card },
              ]}
              onPress={() => setTab('theme')}
            >
              <Text style={[styles.tabText, tab === 'theme' && styles.tabTextActive]}>
                Cores
              </Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }}>
            {tab === 'accounts' ? (
              <View style={styles.gap}>
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: theme.accent }]}
                    onPress={onAddNewSource}
                  >
                    <Text style={styles.btnText}>+ Nova Lista</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: theme.card }]}
                    onPress={onExportBackup}
                  >
                    <Text style={styles.btnText}>Exportar Backup</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: theme.card }]}
                    onPress={onImportBackup}
                  >
                    <Text style={styles.btnText}>Importar Backup</Text>
                  </Pressable>
                </View>

                {sources.length === 0 ? (
                  <Text style={styles.muted}>Nenhuma conta ou lista salva.</Text>
                ) : (
                  sources.map((src) => (
                    <View key={src.id} style={[styles.sourceCard, { backgroundColor: theme.card }]}>
                      <Text style={styles.sourceName}>{src.name}</Text>
                      <Text style={styles.muted} numberOfLines={1}>
                        {src.xtream
                          ? `${src.xtream.serverUrl} • ${src.xtream.username}`
                          : src.url || 'Lista local / Demo'}{' '}
                        ({src.channelCount} itens)
                      </Text>
                      <View style={styles.sourceBtns}>
                        <Pressable
                          style={[styles.miniBtn, { backgroundColor: theme.surface }]}
                          onPress={() => onEditSource(src)}
                        >
                          <Text style={styles.miniBtnText}>✏ Editar</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.miniBtn, { backgroundColor: theme.surface }]}
                          disabled={loading}
                          onPress={() => onRefreshSource(src)}
                        >
                          <Text style={styles.miniBtnText}>🔄 Atualizar</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.miniBtn, { backgroundColor: theme.surface }]}
                          onPress={() => onRemoveSource(src.id)}
                        >
                          <Text style={[styles.miniBtnText, { color: '#fca5a5' }]}>Remover</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : tab === 'player' ? (
              <View style={styles.gap}>
                <View style={[styles.settingRow, { backgroundColor: theme.card }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.settingTitle}>Forçar tela horizontal no App</Text>
                    <Text style={styles.muted}>
                      Gira o aplicativo para horizontal mesmo com a trava de rotação ativada no celular.
                    </Text>
                  </View>
                  <Switch
                    value={forceLandscape}
                    onValueChange={() => onToggleForceLandscape()}
                    trackColor={{ false: '#334155', true: theme.accent }}
                    thumbColor="#f8fafc"
                  />
                </View>

                <View style={[styles.settingRow, { backgroundColor: theme.card }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.settingTitle}>Forçar horizontal na Tela Cheia</Text>
                    <Text style={styles.muted}>
                      Ao abrir a tela cheia do vídeo, força orientação horizontal ignorando a trava do sistema.
                    </Text>
                  </View>
                  <Switch
                    value={forceLandscapeFullscreen}
                    onValueChange={onToggleForceLandscapeFullscreen}
                    trackColor={{ false: '#334155', true: theme.accent }}
                    thumbColor="#f8fafc"
                  />
                </View>

                <Text style={styles.sectionTitle}>TAMANHO DA TELA DE TRANSMISSÃO</Text>
                <View style={styles.optionRow}>
                  {(
                    [
                      ['normal', 'Normal'],
                      ['large', 'Grande'],
                      ['expanded', 'Expandida'],
                    ] as Array<[MobilePlayerSizeMode, string]>
                  ).map(([mode, label]) => (
                    <Pressable
                      key={mode}
                      style={[
                        styles.optionPill,
                        { backgroundColor: playerSizeMode === mode ? theme.accent : theme.card },
                      ]}
                      onPress={() => onChangePlayerSizeMode(mode)}
                    >
                      <Text
                        style={[
                          styles.optionPillText,
                          playerSizeMode === mode && styles.tabTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.sectionTitle}>AJUSTE DA IMAGEM</Text>
                <View style={styles.optionRow}>
                  {(
                    [
                      ['contain', 'Ajustar (Original)'],
                      ['cover', 'Preencher Tela'],
                    ] as Array<[MobileVideoFit, string]>
                  ).map(([fit, label]) => (
                    <Pressable
                      key={fit}
                      style={[
                        styles.optionPill,
                        { backgroundColor: videoContentFit === fit ? theme.accent : theme.card },
                      ]}
                      onPress={() => onChangeVideoContentFit(fit)}
                    >
                      <Text
                        style={[
                          styles.optionPillText,
                          videoContentFit === fit && styles.tabTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.sectionTitle}>ATUALIZAÇÃO DO APLICATIVO</Text>
                <View style={[styles.settingRow, { backgroundColor: theme.card }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.settingTitle}>Versão v{getMobileAppVersion()}</Text>
                    <Text style={styles.muted}>
                      {updateStatus || 'Busca e aplica atualizações OTA diretamente do Expo (u.expo.dev).'}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: theme.accent, opacity: checkingUpdate ? 0.6 : 1 }]}
                    disabled={checkingUpdate}
                    onPress={async () => {
                      setCheckingUpdate(true);
                      await checkMobileAppUpdates(setUpdateStatus);
                      setCheckingUpdate(false);
                    }}
                  >
                    <Text style={styles.btnText}>{checkingUpdate ? 'Buscando...' : '🔄 Atualizar'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.gap}>
                <Text style={styles.sectionTitle}>TEMAS PRONTOS</Text>
                <View style={styles.presetGrid}>
                  {APP_THEME_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.presetName}
                      style={[
                        styles.presetCard,
                        {
                          backgroundColor: theme.card,
                          borderColor:
                            theme.presetName === preset.presetName ? preset.accent : '#1e293b',
                        },
                      ]}
                      onPress={() => onUpdateTheme(preset)}
                    >
                      <View style={styles.swatchRow}>
                        <View style={[styles.swatch, { backgroundColor: preset.bg }]} />
                        <View style={[styles.swatch, { backgroundColor: preset.surface }]} />
                        <View style={[styles.swatch, { backgroundColor: preset.card }]} />
                        <View style={[styles.swatch, { backgroundColor: preset.accent }]} />
                      </View>
                      <Text style={styles.presetLabel}>{preset.presetName}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.sectionTitle}>CORES PERSONALIZADAS (HEX)</Text>
                <View style={styles.hexGrid}>
                  <View style={styles.hexField}>
                    <Text style={styles.muted}>Fundo</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.card }]}
                      value={bgHex}
                      onChangeText={setBgHex}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.hexField}>
                    <Text style={styles.muted}>Painéis</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.card }]}
                      value={surfaceHex}
                      onChangeText={setSurfaceHex}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.hexField}>
                    <Text style={styles.muted}>Cards</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.card }]}
                      value={cardHex}
                      onChangeText={setCardHex}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.hexField}>
                    <Text style={styles.muted}>Destaque</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.card }]}
                      value={accentHex}
                      onChangeText={setAccentHex}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                  onPress={() =>
                    onUpdateTheme({
                      presetName: 'Personalizado',
                      bg: bgHex.trim() || DEFAULT_APP_THEME.bg,
                      surface: surfaceHex.trim() || DEFAULT_APP_THEME.surface,
                      card: cardHex.trim() || DEFAULT_APP_THEME.card,
                      accent: accentHex.trim() || DEFAULT_APP_THEME.accent,
                    })
                  }
                >
                  <Text style={styles.btnText}>Aplicar e Salvar Cor</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, { backgroundColor: theme.card }]}
                  onPress={() => onUpdateTheme(DEFAULT_APP_THEME)}
                >
                  <Text style={styles.btnText}>Restaurar Cor Padrão</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: 16,
  },
  card: { borderRadius: 16, padding: 18, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  closeText: { fontWeight: '700', fontSize: 14 },
  tabsRow: { flexDirection: 'row', gap: 8 },
  tabPill: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  gap: { gap: 10 },
  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  muted: { color: '#94a3b8', fontSize: 12 },
  sourceCard: { borderRadius: 10, padding: 12, gap: 6 },
  sourceName: { color: '#f8fafc', fontWeight: '700', fontSize: 14.5 },
  sourceBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  miniBtnText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  sectionTitle: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 4 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetCard: {
    width: '48%',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1.5,
    gap: 6,
  },
  swatchRow: { flexDirection: 'row', gap: 4 },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: '#334155' },
  presetLabel: { color: '#f1f5f9', fontSize: 12.5, fontWeight: '600' },
  hexGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hexField: { width: '48%', gap: 4 },
  input: {
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  primaryBtn: { padding: 12, borderRadius: 9, alignItems: 'center' },
  secondaryBtn: {
    padding: 12,
    borderRadius: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    padding: 12,
  },
  settingTitle: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700' },
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  optionPill: {
    flex: 1,
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  optionPillText: { color: '#cbd5e1', fontSize: 12.5, fontWeight: '700' },
});
