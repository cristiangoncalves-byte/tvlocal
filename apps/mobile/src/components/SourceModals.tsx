import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppThemeSettings, PlaylistSource, XtreamCredentials } from '@tv-local/core';

type AddMode = 'm3u_url' | 'xtream' | 'epg' | 'demo';

interface AddSourceModalProps {
  visible: boolean;
  theme: AppThemeSettings;
  loading: boolean;
  statusText?: string | null;
  onClose: () => void;
  onImportM3uUrl: (name: string, url: string) => Promise<void>;
  onPickLocalM3u: () => Promise<void>;
  onConnectXtream: (name: string, creds: XtreamCredentials) => Promise<void>;
  onImportEpgUrl: (url: string) => Promise<void>;
  onPickLocalEpg: () => Promise<void>;
  onLoadDemo: () => void;
}

export function AddSourceModal({
  visible,
  theme,
  loading,
  statusText,
  onClose,
  onImportM3uUrl,
  onPickLocalM3u,
  onConnectXtream,
  onImportEpgUrl,
  onPickLocalEpg,
  onLoadDemo,
}: AddSourceModalProps) {
  const [mode, setMode] = useState<AddMode>('m3u_url');
  const [m3uName, setM3uName] = useState('Minha Lista M3U');
  const [m3uUrl, setM3uUrl] = useState('');
  const [xtName, setXtName] = useState('Servidor Xtream');
  const [xtServer, setXtServer] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');
  const [epgUrl, setEpgUrl] = useState('');

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
            <Text style={styles.title}>Adicionar Lista / Fonte</Text>
            <Pressable disabled={loading} onPress={onClose}>
              <Text style={[styles.linkText, { color: theme.accent, opacity: loading ? 0.5 : 1 }]}>Fechar</Text>
            </Pressable>
          </View>

          {loading && (
            <View style={[styles.statusPill, { backgroundColor: theme.card, borderColor: theme.accent }]}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.statusPillText}>{statusText || 'Processando, aguarde...'}</Text>
            </View>
          )}

          <View style={styles.tabsRow}>
            {(
              [
                ['m3u_url', 'M3U'],
                ['xtream', 'Xtream'],
                ['epg', 'EPG'],
                ['demo', 'Demo'],
              ] as Array<[AddMode, string]>
            ).map(([id, label]) => (
              <Pressable
                key={id}
                style={[
                  styles.tabPill,
                  { backgroundColor: mode === id ? theme.accent : theme.card },
                ]}
                onPress={() => setMode(id)}
              >
                <Text style={[styles.tabText, mode === id && styles.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 380 }}>
            {mode === 'm3u_url' && (
              <View style={styles.gap}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="Nome da lista"
                  placeholderTextColor="#64748b"
                  value={m3uName}
                  onChangeText={setM3uName}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="https://exemplo.com/lista.m3u"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={m3uUrl}
                  onChangeText={setM3uUrl}
                />
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                  onPress={() => onImportM3uUrl(m3uName, m3uUrl)}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Importar URL M3U</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, { backgroundColor: theme.card }]}
                  onPress={onPickLocalM3u}
                >
                  <Text style={styles.secondaryBtnText}>Escolher Arquivo .M3U no Aparelho</Text>
                </Pressable>
              </View>
            )}

            {mode === 'xtream' && (
              <View style={styles.gap}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="Nome do perfil"
                  placeholderTextColor="#64748b"
                  value={xtName}
                  onChangeText={setXtName}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="http://servidor:8080"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={xtServer}
                  onChangeText={setXtServer}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="Usuário"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={xtUser}
                  onChangeText={setXtUser}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="Senha"
                  placeholderTextColor="#64748b"
                  secureTextEntry
                  value={xtPass}
                  onChangeText={setXtPass}
                />
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                  onPress={() =>
                    onConnectXtream(xtName, {
                      serverUrl: xtServer,
                      username: xtUser,
                      password: xtPass,
                    })
                  }
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Conectar Xtream Codes</Text>
                  )}
                </Pressable>
              </View>
            )}

            {mode === 'epg' && (
              <View style={styles.gap}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  placeholder="https://exemplo.com/epg.xml"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  value={epgUrl}
                  onChangeText={setEpgUrl}
                />
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                  onPress={() => onImportEpgUrl(epgUrl)}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Carregar EPG por URL</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, { backgroundColor: theme.card }]}
                  onPress={onPickLocalEpg}
                >
                  <Text style={styles.secondaryBtnText}>Escolher Arquivo .XML Local</Text>
                </Pressable>
              </View>
            )}

            {mode === 'demo' && (
              <View style={styles.gap}>
                <Text style={styles.helper}>
                  Carrega streams públicos e legais de demonstração para testar o player mobile.
                </Text>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                  onPress={onLoadDemo}
                >
                  <Text style={styles.primaryBtnText}>Carregar Lista Demo</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface EditSourceModalProps {
  source: PlaylistSource | null;
  theme: AppThemeSettings;
  loading: boolean;
  statusText?: string | null;
  onClose: () => void;
  onSave: (payload: {
    source: PlaylistSource;
    name: string;
    url?: string;
    xtream?: XtreamCredentials;
    reload: boolean;
  }) => Promise<void>;
}

export function EditSourceModal({
  source,
  theme,
  loading,
  statusText,
  onClose,
  onSave,
}: EditSourceModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [reload, setReload] = useState(true);

  useEffect(() => {
    if (!source) return;
    setName(source.name);
    setUrl(source.url ?? '');
    setServer(source.xtream?.serverUrl ?? '');
    setUser(source.xtream?.username ?? '');
    setPass(source.xtream?.password ?? '');
    setReload(source.type === 'xtream' || source.type === 'm3u_url');
  }, [source]);

  if (!source) return null;

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
            <Text style={styles.title}>Editar Conta / Lista</Text>
            <Pressable disabled={loading} onPress={onClose}>
              <Text style={[styles.linkText, { color: theme.accent, opacity: loading ? 0.5 : 1 }]}>Cancelar</Text>
            </Pressable>
          </View>

          {loading && (
            <View style={[styles.statusPill, { backgroundColor: theme.card, borderColor: theme.accent }]}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.statusPillText}>{statusText || 'Salvando alterações...'}</Text>
            </View>
          )}

          <View style={styles.gap}>
            <Text style={styles.label}>Nome da conta / lista</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.card }]}
              value={name}
              onChangeText={setName}
            />

            {source.type === 'm3u_url' && (
              <>
                <Text style={styles.label}>URL M3U</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  autoCapitalize="none"
                  value={url}
                  onChangeText={setUrl}
                />
              </>
            )}

            {source.type === 'xtream' && (
              <>
                <Text style={styles.label}>Servidor</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  autoCapitalize="none"
                  value={server}
                  onChangeText={setServer}
                />
                <Text style={styles.label}>Usuário</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  autoCapitalize="none"
                  value={user}
                  onChangeText={setUser}
                />
                <Text style={styles.label}>Senha</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card }]}
                  autoCapitalize="none"
                  value={pass}
                  onChangeText={setPass}
                />
              </>
            )}

            {(source.type === 'xtream' || source.type === 'm3u_url') && (
              <View style={styles.switchRow}>
                <Text style={styles.helper}>Recarregar canais ao salvar</Text>
                <Switch value={reload} onValueChange={setReload} />
              </View>
            )}

            <Pressable
              style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
              disabled={loading}
              onPress={() =>
                onSave({
                  source,
                  name,
                  url: source.type === 'm3u_url' ? url : undefined,
                  xtream:
                    source.type === 'xtream'
                      ? { serverUrl: server, username: user, password: pass }
                      : undefined,
                  reload,
                })
              }
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Salvar Alterações</Text>
              )}
            </Pressable>
          </View>
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
  linkText: { fontWeight: '700', fontSize: 14 },
  tabsRow: { flexDirection: 'row', gap: 6 },
  tabPill: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabText: { color: '#94a3b8', fontSize: 12.5, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  gap: { gap: 10 },
  label: { color: '#94a3b8', fontSize: 12 },
  input: {
    color: '#f8fafc',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  primaryBtn: { padding: 12, borderRadius: 9, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    padding: 12,
    borderRadius: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryBtnText: { color: '#cbd5e1', fontWeight: '600' },
  helper: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
  },
  statusPillText: { color: '#dbeafe', fontSize: 12.5, fontWeight: '600', flex: 1 },
});
