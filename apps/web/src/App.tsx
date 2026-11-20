import { useCallback, useRef, useState } from 'react';
import { Tv, Sparkles, Plus } from 'lucide-react';
import { useIptvStore } from './hooks/useIptvStore';
import { Sidebar } from './components/Sidebar';
import { VideoPlayer, type VideoPlayerHandle } from './components/VideoPlayer';
import { ChannelGrid } from './components/ChannelGrid';
import { EpgPanel } from './components/EpgPanel';
import { PlaylistModal, type ModalTab } from './components/PlaylistModal';
import { SeriesModal } from './components/SeriesModal';
import { SettingsModal } from './components/SettingsModal';
import {
  MultiStreamModal,
  type WebDualStreamCloseResult,
} from './components/MultiStreamModal';

export function App() {
  const store = useIptvStore();
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>('m3u_url');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [multiStreamOpen, setMultiStreamOpen] = useState(false);
  const [multiStreamInitialPos, setMultiStreamInitialPos] = useState(0);

  const openModal = (tab: ModalTab = 'm3u_url') => {
    setModalTab(tab);
    setModalOpen(true);
  };

  const handleZap = useCallback(
    (direction: 'prev' | 'next') => {
      const list = store.filteredChannels;
      if (!list.length) return;
      const idx = store.activeChannel
        ? list.findIndex((c) => c.id === store.activeChannel?.id)
        : -1;
      const nextIdx =
        direction === 'next'
          ? (idx + 1) % list.length
          : (idx - 1 + list.length) % list.length;
      store.playChannel(list[nextIdx]);
    },
    [store],
  );

  const handleOpenMultiStream = useCallback(() => {
    const ch = store.activeChannel;
    const resumePos =
      ch && ch.kind !== 'live' ? Math.max(0, playerRef.current?.getCurrentTime() ?? 0) : 0;
    playerRef.current?.pause();
    setMultiStreamInitialPos(resumePos);
    setMultiStreamOpen(true);
  }, [store.activeChannel]);

  const handleCloseMultiStream = useCallback(
    (transferBack: WebDualStreamCloseResult | null) => {
      setMultiStreamOpen(false);
      if (!transferBack?.channel) return;

      const { channel, position } = transferBack;
      if (
        store.activeChannel &&
        channel.id === store.activeChannel.id &&
        channel.url === store.activeChannel.url
      ) {
        requestAnimationFrame(() => {
          playerRef.current?.seekAndPlay(channel.kind !== 'live' ? position : 0);
        });
      } else {
        playerRef.current?.setPendingSeek(channel.kind !== 'live' ? position : 0);
        store.playChannel(channel);
      }
    },
    [store],
  );

  const handleCyclePlayerSize = useCallback(() => {
    const next =
      store.playerSizeMode === 'normal'
        ? 'large'
        : store.playerSizeMode === 'large'
          ? 'expanded'
          : 'normal';
    store.setPlayerSizeMode(next);
  }, [store]);

  const isExpanded = Boolean(store.activeChannel) && store.playerSizeMode === 'expanded';
  const hideEpgForLarge = store.playerSizeMode !== 'normal';

  return (
    <div className={`app-shell ${isExpanded ? 'expanded-player' : ''}`}>
      {!isExpanded && (
        <Sidebar
          section={store.section}
          onSelectSection={store.setSection}
          categories={store.categories}
          selectedCategory={store.selectedCategory}
          onSelectCategory={store.setSelectedCategory}
          onOpenAddModal={() => openModal('m3u_url')}
          onOpenMultiStream={handleOpenMultiStream}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <main className="main-content">
        {store.statusMessage && (
          <div className="toast-banner">
            <span>{store.statusMessage}</span>
            <button type="button" onClick={() => store.setStatusMessage(null)}>
              Fechar
            </button>
          </div>
        )}

        {store.channels.length === 0 ? (
          <div className="welcome-hero">
            <div className="welcome-icon">
              <Tv size={48} />
            </div>
            <h2>Bem-vindo ao TV Local</h2>
            <p>
              Importe sua playlist M3U/M3U8, conecte um servidor Xtream Codes ou carregue os streams
              públicos de demonstração para testar agora mesmo.
            </p>
            <div className="welcome-actions">
              <button type="button" className="btn btn-primary" onClick={store.addDemoPlaylist}>
                <Sparkles size={16} /> Testar com Lista Demo
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => openModal('m3u_url')}>
                <Plus size={16} /> Adicionar M3U / Xtream
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`stage-grid ${hideEpgForLarge ? 'stage-full' : ''}`}>
              <VideoPlayer
                ref={playerRef}
                channel={store.activeChannel}
                epg={store.epg}
                isFavorite={store.activeChannel ? store.favoriteSet.has(store.activeChannel.id) : false}
                externalPaused={multiStreamOpen}
                playerSizeMode={store.playerSizeMode}
                videoContentFit={store.videoContentFit}
                forceLandscapeFullscreen={store.forceLandscapeFullscreen}
                onToggleFavorite={store.toggleFavorite}
                onZap={handleZap}
                onCyclePlayerSize={handleCyclePlayerSize}
                onToggleVideoFit={() =>
                  store.setVideoContentFit(store.videoContentFit === 'contain' ? 'cover' : 'contain')
                }
                onOpenMultiStream={handleOpenMultiStream}
              />
              {!hideEpgForLarge && (
                <EpgPanel
                  channel={store.activeChannel}
                  epg={store.epg}
                  onOpenEpgImport={() => openModal('epg')}
                />
              )}
            </div>

            {!isExpanded && (
              <ChannelGrid
                channels={store.filteredChannels}
                activeChannelId={store.activeChannel?.id}
                epg={store.epg}
                favoriteSet={store.favoriteSet}
                searchQuery={store.searchQuery}
                searchSuggestion={store.searchSuggestion}
                onSearchChange={store.setSearchQuery}
                onPlayChannel={store.playChannel}
                onToggleFavorite={store.toggleFavorite}
              />
            )}
          </>
        )}
      </main>

      <PlaylistModal
        isOpen={modalOpen}
        initialTab={modalTab}
        isLoading={store.isLoading}
        onClose={() => setModalOpen(false)}
        onAddM3uUrl={store.addM3uFromUrl}
        onAddM3uText={store.addM3uFromText}
        onAddXtream={store.addXtreamSource}
        onLoadEpgUrl={store.loadEpgFromUrl}
        onLoadEpgText={store.loadEpgFromText}
        onLoadDemo={store.addDemoPlaylist}
      />

      <SeriesModal
        series={store.activeSeries}
        credentials={store.activeSeriesCredentials}
        onClose={() => store.setActiveSeries(null)}
        onPlayEpisode={store.playChannel}
      />

      <SettingsModal
        isOpen={settingsOpen}
        sources={store.sources}
        theme={store.theme}
        isLoading={store.isLoading}
        playerSizeMode={store.playerSizeMode}
        videoContentFit={store.videoContentFit}
        forceLandscapeFullscreen={store.forceLandscapeFullscreen}
        onChangePlayerSizeMode={store.setPlayerSizeMode}
        onChangeVideoContentFit={store.setVideoContentFit}
        onToggleForceLandscapeFullscreen={store.setForceLandscapeFullscreen}
        onClose={() => setSettingsOpen(false)}
        onOpenAddModal={() => openModal('m3u_url')}
        onRefreshSource={store.refreshSource}
        onRemoveSource={store.removeSource}
        onUpdateTheme={store.updateTheme}
        onResetTheme={store.resetTheme}
      />

      <MultiStreamModal
        isOpen={multiStreamOpen}
        channels={store.channels}
        initialChannel={store.activeChannel}
        initialPosition={multiStreamInitialPos}
        forceLandscapeFullscreen={store.forceLandscapeFullscreen}
        onClose={handleCloseMultiStream}
      />
    </div>
  );
}
export default App;
