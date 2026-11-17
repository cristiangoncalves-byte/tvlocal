import { useState } from 'react';
import { LayoutGrid, List, Play, Search, Star } from 'lucide-react';
import { getNowAndNextPrograms, type Channel, type EpgMap } from '@tv-local/core';

interface ChannelGridProps {
  channels: Channel[];
  activeChannelId?: string;
  epg: EpgMap;
  favoriteSet: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onPlayChannel: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
}

function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function ChannelGrid({
  channels,
  activeChannelId,
  epg,
  favoriteSet,
  searchQuery,
  onSearchChange,
  onPlayChannel,
  onToggleFavorite,
}: ChannelGridProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  return (
    <section className="channels-section">
      <div className="channels-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar canal, filme, série ou categoria..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="count-pill">{channels.length} itens</span>
          <div className="view-toggle">
            <button
              type="button"
              className={`icon-btn-sm ${viewMode === 'grid' ? 'active' : ''}`}
              title="Visualização em grade"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              className={`icon-btn-sm ${viewMode === 'list' ? 'active' : ''}`}
              title="Visualização em lista"
              onClick={() => setViewMode('list')}
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {channels.length === 0 ? (
        <div className="empty-filter">
          Nenhum item encontrado para este filtro.
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'channel-grid' : 'channel-list'}>
          {channels.slice(0, 400).map((ch) => {
            const isActive = ch.id === activeChannelId;
            const isFav = favoriteSet.has(ch.id);
            const { current } = getNowAndNextPrograms(epg, ch);
            const progress =
              current && current.stop > current.start
                ? Math.min(
                    100,
                    Math.max(0, ((Date.now() - current.start) / (current.stop - current.start)) * 100),
                  )
                : 0;

            return (
              <div
                key={ch.id}
                className={`channel-card ${viewMode} ${isActive ? 'active' : ''}`}
                onClick={() => onPlayChannel(ch)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPlayChannel(ch);
                  }
                }}
              >
                <div className="channel-thumb">
                  {ch.logo ? (
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span>{ch.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <div className="play-hover">
                    <Play size={16} fill="currentColor" />
                  </div>
                </div>

                <div className="channel-body">
                  <div className="channel-top">
                    <strong className="truncate">{ch.name}</strong>
                    <button
                      type="button"
                      className={`fav-btn ${isFav ? 'active' : ''}`}
                      title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(ch.id);
                      }}
                    >
                      <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="channel-sub truncate">
                    {current ? (
                      <>
                        {formatHour(current.start)} • {current.title}
                      </>
                    ) : (
                      ch.group
                    )}
                  </div>
                  {current && (
                    <div className="epg-progress-track">
                      <div className="epg-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
