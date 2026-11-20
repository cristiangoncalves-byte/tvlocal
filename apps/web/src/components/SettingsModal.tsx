import { useEffect, useState } from 'react';
import { Monitor, Palette, RefreshCw, RotateCcw, Server, Trash2, X } from 'lucide-react';
import type { PlaylistSource } from '@tv-local/core';
import type { WebPlayerSizeMode, WebVideoFit } from './VideoPlayer';
import { isDesktopApp } from '../utils/network';

export interface WebThemeSettings {
  presetName: string;
  bg: string;
  elevated: string;
  card: string;
  accent: string;
}

export const DEFAULT_WEB_THEME: WebThemeSettings = {
  presetName: 'Padrão (Azul Noturno)',
  bg: '#080c14',
  elevated: '#0f1624',
  card: '#151e30',
  accent: '#3b82f6',
};

export const WEB_THEME_PRESETS: WebThemeSettings[] = [
  DEFAULT_WEB_THEME,
  { presetName: 'Esmeralda', bg: '#07110e', elevated: '#0c1c17', card: '#122922', accent: '#10b981' },
  { presetName: 'Roxo Neon', bg: '#0c0916', elevated: '#140f24', card: '#1d1635', accent: '#8b5cf6' },
  { presetName: 'Rubi Escuro', bg: '#12080b', elevated: '#1c0e13', card: '#29151c', accent: '#ef4444' },
  { presetName: 'Âmbar Dourado', bg: '#110d07', elevated: '#1b150c', card: '#281f12', accent: '#f59e0b' },
  { presetName: 'Grafite Ciano', bg: '#0c0d10', elevated: '#14161b', card: '#1d2028', accent: '#06b6d4' },
];

interface SettingsModalProps {
  isOpen: boolean;
  sources: PlaylistSource[];
  theme: WebThemeSettings;
  isLoading: boolean;
  playerSizeMode: WebPlayerSizeMode;
  videoContentFit: WebVideoFit;
  forceLandscapeFullscreen: boolean;
  onChangePlayerSizeMode: (mode: WebPlayerSizeMode) => void;
  onChangeVideoContentFit: (fit: WebVideoFit) => void;
  onToggleForceLandscapeFullscreen: (enabled: boolean) => void;
  onClose: () => void;
  onOpenAddModal: () => void;
  onRefreshSource: (source: PlaylistSource) => Promise<void>;
  onRemoveSource: (sourceId: string) => void;
  onUpdateTheme: (theme: WebThemeSettings) => void;
  onResetTheme: () => void;
}

export function SettingsModal({
  isOpen,
  sources,
  theme,
  isLoading,
  playerSizeMode,
  videoContentFit,
  forceLandscapeFullscreen,
  onChangePlayerSizeMode,
  onChangeVideoContentFit,
  onToggleForceLandscapeFullscreen,
  onClose,
  onOpenAddModal,
  onRefreshSource,
  onRemoveSource,
  onUpdateTheme,
  onResetTheme,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'accounts' | 'player' | 'theme'>('accounts');
  const [customTheme, setCustomTheme] = useState<WebThemeSettings>(theme);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    window.tvLocalDesktop?.getAppVersion?.().then(setAppVersion).catch(() => undefined);
  }, []);

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateMessage('Verificando atualizações...');
    try {
      if (isDesktopApp() && window.tvLocalDesktop?.checkForUpdates) {
        const res = await window.tvLocalDesktop.checkForUpdates();
        setUpdateMessage(res.message);
        return;
      }

      const hostedRes = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      const hostedJson = hostedRes?.ok ? ((await hostedRes.json()) as { version?: string }) : null;
      const ghRes = await fetch('https://api.github.com/repos/cristiangoncalves-byte/tvlocal/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      }).catch(() => null);
      const ghJson = ghRes?.ok ? ((await ghRes.json()) as { tag_name?: string }) : null;
      const latest = ghJson?.tag_name?.replace(/^v/i, '') || hostedJson?.version;

      if (hostedJson?.version && hostedJson.version !== appVersion) {
        setUpdateMessage(`Nova versão Web (${hostedJson.version}) publicada! Recarregue a página para aplicar.`);
      } else if (latest && latest !== appVersion) {
        setUpdateMessage(`Nova versão v${latest} disponível no GitHub Releases.`);
      } else {
        setUpdateMessage(`Você já está na versão mais recente (v${appVersion}).`);
      }
    } catch {
      setUpdateMessage('Não foi possível verificar atualizações agora.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configurações — TV Local</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={tab === 'accounts' ? 'active' : ''}
            onClick={() => setTab('accounts')}
          >
            <Server size={14} /> Contas e Listas Salvas
          </button>
          <button
            type="button"
            className={tab === 'player' ? 'active' : ''}
            onClick={() => setTab('player')}
          >
            <Monitor size={14} /> Player & Tela
          </button>
          <button
            type="button"
            className={tab === 'theme' ? 'active' : ''}
            onClick={() => {
              setCustomTheme(theme);
              setTab('theme');
            }}
          >
            <Palette size={14} /> Aparência e Cores
          </button>
        </div>

        {tab === 'accounts' ? (
          <div className="modal-form">
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onOpenAddModal();
                }}
              >
                + Nova Conta / Lista
              </button>
            </div>

            {sources.length === 0 ? (
              <p className="muted">Nenhuma conta ou lista salva ainda.</p>
            ) : (
              <div className="episode-list">
                {sources.map((src) => (
                  <div key={src.id} className="source-item">
                    <div className="source-info">
                      <strong>{src.name}</strong>
                      <span>
                        {src.xtream
                          ? `${src.xtream.serverUrl} • Usuário: ${src.xtream.username}`
                          : src.url || 'Lista local / Demo'}{' '}
                        ({src.channelCount} itens)
                      </span>
                    </div>
                    <div className="source-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Atualizar"
                        disabled={isLoading}
                        onClick={() => onRefreshSource(src)}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remover"
                        onClick={() => onRemoveSource(src.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'player' ? (
          <div className="modal-form">
            <div className="source-item">
              <div className="source-info">
                <strong>Forçar horizontal na Tela Cheia (Mobile Web)</strong>
                <span>Tenta girar o navegador para paisagem ao abrir tela cheia mesmo com trava de rotação.</span>
              </div>
              <input
                type="checkbox"
                checked={forceLandscapeFullscreen}
                onChange={(e) => onToggleForceLandscapeFullscreen(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
            </div>

            <div className="section-label">Tamanho da Tela de Transmissão</div>
            <div className="modal-tabs">
              {(
                [
                  ['normal', 'Normal'],
                  ['large', 'Grande'],
                  ['expanded', 'Expandida (Teatro)'],
                ] as Array<[WebPlayerSizeMode, string]>
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={playerSizeMode === mode ? 'active' : ''}
                  onClick={() => onChangePlayerSizeMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="section-label">Ajuste da Imagem</div>
            <div className="modal-tabs">
              {(
                [
                  ['contain', 'Ajustar (Original)'],
                  ['cover', 'Preencher Tela'],
                ] as Array<[WebVideoFit, string]>
              ).map(([fit, label]) => (
                <button
                  key={fit}
                  type="button"
                  className={videoContentFit === fit ? 'active' : ''}
                  onClick={() => onChangeVideoContentFit(fit)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="section-label">Atualização do Aplicativo</div>
            <div className="source-item">
              <div className="source-info">
                <strong>Versão v{appVersion}</strong>
                <span>{updateMessage || 'Verifica novas versões no GitHub / servidor web.'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={checkingUpdate}
                  onClick={handleCheckUpdates}
                >
                  <RefreshCw size={13} /> {checkingUpdate ? 'Buscando...' : 'Verificar'}
                </button>
                {!isDesktopApp() && updateMessage?.includes('Recarregue') && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => window.location.reload()}
                  >
                    Atualizar Agora
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-form">
            <div className="section-label">Temas Prontos</div>
            <div className="channel-grid">
              {WEB_THEME_PRESETS.map((preset) => (
                <button
                  key={preset.presetName}
                  type="button"
                  className="btn btn-secondary"
                  style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 12 }}
                  onClick={() => {
                    setCustomTheme(preset);
                    onUpdateTheme(preset);
                  }}
                >
                  <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: preset.bg, border: '1px solid #334155' }} />
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: preset.elevated, border: '1px solid #334155' }} />
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: preset.card, border: '1px solid #334155' }} />
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: preset.accent }} />
                  </div>
                  <span>{preset.presetName}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Cores Personalizadas</div>
            <div className="form-row">
              <label>
                Fundo Principal
                <input
                  type="color"
                  value={customTheme.bg}
                  onChange={(e) => setCustomTheme((t) => ({ ...t, presetName: 'Personalizado', bg: e.target.value }))}
                />
              </label>
              <label>
                Painéis (Menu / Player / EPG)
                <input
                  type="color"
                  value={customTheme.elevated}
                  onChange={(e) => setCustomTheme((t) => ({ ...t, presetName: 'Personalizado', elevated: e.target.value }))}
                />
              </label>
              <label>
                Cards
                <input
                  type="color"
                  value={customTheme.card}
                  onChange={(e) => setCustomTheme((t) => ({ ...t, presetName: 'Personalizado', card: e.target.value }))}
                />
              </label>
              <label>
                Cor de Destaque
                <input
                  type="color"
                  value={customTheme.accent}
                  onChange={(e) => setCustomTheme((t) => ({ ...t, presetName: 'Personalizado', accent: e.target.value }))}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onUpdateTheme(customTheme)}
              >
                Aplicar e Salvar Cor
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setCustomTheme(DEFAULT_WEB_THEME);
                  onResetTheme();
                }}
              >
                <RotateCcw size={14} /> Restaurar Cor Padrão
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
