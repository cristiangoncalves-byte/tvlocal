import { useCallback, useState } from 'react';
import { Tv, Sparkles, Plus } from 'lucide-react';
import { useIptvStore } from './hooks/useIptvStore';
import { Sidebar } from './components/Sidebar';
import { VideoPlayer } from './components/VideoPlayer';
import { ChannelGrid } from './components/ChannelGrid';
import { EpgPanel } from './components/EpgPanel';
import { PlaylistModal, type ModalTab } from './components/PlaylistModal';
import { SeriesModal } from './components/SeriesModal';

export function App() {
  const store = useIptvStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>('m3u_url');

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

  return (
    <div className="app-shell">
      <Sidebar
        section={store.section}
        onSelectSection={store.setSection}
        categories={store.categories}
        selectedCategory={store.selectedCategory}
        onSelectCategory={store.setSelectedCategory}
        sources={store.sources}
        onOpenAddModal={() => openModal('m3u_url')}
        onRefreshSource={store.refreshSource}
        onRemoveSource={store.removeSource}
        isLoading={store.isLoading}
      />

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
            <div className="stage-grid">
              <VideoPlayer
                channel={store.activeChannel}
                epg={store.epg}
                isFavorite={store.activeChannel ? store.favoriteSet.has(store.activeChannel.id) : false}
                onToggleFavorite={store.toggleFavorite}
                onZap={handleZap}
              />
              <EpgPanel
                channel={store.activeChannel}
                epg={store.epg}
                onOpenEpgImport={() => openModal('epg')}
              />
            </div>

            <ChannelGrid
              channels={store.filteredChannels}
              activeChannelId={store.activeChannel?.id}
              epg={store.epg}
              favoriteSet={store.favoriteSet}
              searchQuery={store.searchQuery}
              onSearchChange={store.setSearchQuery}
              onPlayChannel={store.playChannel}
              onToggleFavorite={store.toggleFavorite}
            />
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
    </div>
  );
}
export default App;
