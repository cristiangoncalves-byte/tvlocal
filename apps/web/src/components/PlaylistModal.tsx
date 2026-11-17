import { useState, type FormEvent } from 'react';
import { CalendarClock, FileUp, Globe, Server, Sparkles, X } from 'lucide-react';
import type { XtreamCredentials } from '@tv-local/core';

export type ModalTab = 'm3u_url' | 'm3u_file' | 'xtream' | 'epg' | 'demo';

interface PlaylistModalProps {
  isOpen: boolean;
  initialTab?: ModalTab;
  isLoading: boolean;
  onClose: () => void;
  onAddM3uUrl: (name: string, url: string) => Promise<unknown>;
  onAddM3uText: (name: string, content: string) => Promise<unknown>;
  onAddXtream: (name: string, creds: XtreamCredentials) => Promise<unknown>;
  onLoadEpgUrl: (url: string) => Promise<number>;
  onLoadEpgText: (xml: string) => number;
  onLoadDemo: () => void;
}

export function PlaylistModal({
  isOpen,
  initialTab = 'm3u_url',
  isLoading,
  onClose,
  onAddM3uUrl,
  onAddM3uText,
  onAddXtream,
  onLoadEpgUrl,
  onLoadEpgText,
  onLoadDemo,
}: PlaylistModalProps) {
  const [tab, setTab] = useState<ModalTab>(initialTab);
  const [error, setError] = useState<string | null>(null);

  // M3U URL state
  const [m3uName, setM3uName] = useState('Minha Lista IPTV');
  const [m3uUrl, setM3uUrl] = useState('');

  // Xtream state
  const [xtName, setXtName] = useState('Servidor Xtream');
  const [xtServer, setXtServer] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');

  // EPG state
  const [epgUrl, setEpgUrl] = useState('');

  if (!isOpen) return null;

  const handleM3uUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onAddM3uUrl(m3uName, m3uUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar lista M3U.');
    }
  };

  const handleXtreamSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onAddXtream(xtName, {
        serverUrl: xtServer,
        username: xtUser,
        password: xtPass,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar Xtream Codes.');
    }
  };

  const handleEpgUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onLoadEpgUrl(epgUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar EPG XMLTV.');
    }
  };

  const handleM3uFileUpload = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const content = await file.text();
      await onAddM3uText(file.name.replace(/\.(m3u8?|txt)$/i, ''), content);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ler arquivo M3U.');
    }
  };

  const handleNativeDesktopM3u = async () => {
    if (!window.tvLocalDesktop?.openM3uFile) return;
    setError(null);
    try {
      const result = await window.tvLocalDesktop.openM3uFile();
      if (!result) return;
      await onAddM3uText(result.name.replace(/\.(m3u8?|txt)$/i, ''), result.content);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao abrir arquivo local.');
    }
  };

  const handleEpgFileUpload = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const xml = await file.text();
      onLoadEpgText(xml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ler arquivo XMLTV.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Adicionar Lista / Fonte IPTV</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={tab === 'm3u_url' ? 'active' : ''}
            onClick={() => {
              setTab('m3u_url');
              setError(null);
            }}
          >
            <Globe size={14} /> URL M3U
          </button>
          <button
            type="button"
            className={tab === 'm3u_file' ? 'active' : ''}
            onClick={() => {
              setTab('m3u_file');
              setError(null);
            }}
          >
            <FileUp size={14} /> Arquivo .M3U
          </button>
          <button
            type="button"
            className={tab === 'xtream' ? 'active' : ''}
            onClick={() => {
              setTab('xtream');
              setError(null);
            }}
          >
            <Server size={14} /> Xtream Codes
          </button>
          <button
            type="button"
            className={tab === 'epg' ? 'active' : ''}
            onClick={() => {
              setTab('epg');
              setError(null);
            }}
          >
            <CalendarClock size={14} /> EPG (XMLTV)
          </button>
          <button
            type="button"
            className={tab === 'demo' ? 'active' : ''}
            onClick={() => {
              setTab('demo');
              setError(null);
            }}
          >
            <Sparkles size={14} /> Demo
          </button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        {tab === 'm3u_url' && (
          <form onSubmit={handleM3uUrlSubmit} className="modal-form">
            <label>
              Nome da lista
              <input
                type="text"
                value={m3uName}
                onChange={(e) => setM3uName(e.target.value)}
                required
              />
            </label>
            <label>
              URL da playlist (.m3u / .m3u8)
              <input
                type="url"
                placeholder="https://exemplo.com/minha-lista.m3u"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? 'Carregando...' : 'Importar Lista M3U'}
            </button>
          </form>
        )}

        {tab === 'm3u_file' && (
          <div className="modal-form">
            <p className="muted">
              Selecione um arquivo <code>.m3u</code>, <code>.m3u8</code> ou <code>.txt</code> do seu computador.
            </p>
            <input
              type="file"
              accept=".m3u,.m3u8,.txt"
              onChange={(e) => handleM3uFileUpload(e.target.files?.[0])}
            />
            {window.tvLocalDesktop?.openM3uFile && (
              <button type="button" className="btn btn-secondary" onClick={handleNativeDesktopM3u}>
                Abrir via Seletor Nativo Windows
              </button>
            )}
          </div>
        )}

        {tab === 'xtream' && (
          <form onSubmit={handleXtreamSubmit} className="modal-form">
            <label>
              Nome do perfil
              <input
                type="text"
                value={xtName}
                onChange={(e) => setXtName(e.target.value)}
                required
              />
            </label>
            <label>
              Servidor (URL)
              <input
                type="text"
                placeholder="http://servidor.exemplo.com:8080"
                value={xtServer}
                onChange={(e) => setXtServer(e.target.value)}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Usuário
                <input
                  type="text"
                  value={xtUser}
                  onChange={(e) => setXtUser(e.target.value)}
                  required
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={xtPass}
                  onChange={(e) => setXtPass(e.target.value)}
                  required
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? 'Conectando...' : 'Conectar Xtream Codes'}
            </button>
          </form>
        )}

        {tab === 'epg' && (
          <div className="modal-form">
            <form onSubmit={handleEpgUrlSubmit} className="modal-form">
              <label>
                URL do guia XMLTV (.xml)
                <input
                  type="url"
                  placeholder="https://exemplo.com/epg.xml"
                  value={epgUrl}
                  onChange={(e) => setEpgUrl(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={isLoading}>
                Carregar EPG por URL
              </button>
            </form>
            <div className="divider">ou envie um arquivo XML local</div>
            <input
              type="file"
              accept=".xml,.xmltv"
              onChange={(e) => handleEpgFileUpload(e.target.files?.[0])}
            />
          </div>
        )}

        {tab === 'demo' && (
          <div className="modal-form">
            <p>
              Carregue uma lista de demonstração com <strong>streams públicos e legais</strong> (Blender
              Open Movies & HLS de referência) para testar o player imediatamente.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onLoadDemo();
                onClose();
              }}
            >
              <Sparkles size={16} /> Carregar Lista Demo Agora
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
