import {
  Clock,
  Columns2,
  Film,
  Layers,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
  Tv,
  Clapperboard,
} from 'lucide-react';
import type { PlaylistSource } from '@tv-local/core';
import type { NavSection } from '../hooks/useIptvStore';

interface SidebarProps {
  section: NavSection;
  onSelectSection: (section: NavSection) => void;
  categories: Array<{ name: string; count: number }>;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  sources: PlaylistSource[];
  onOpenAddModal: () => void;
  onOpenMultiStream: () => void;
  onOpenSettings: () => void;
  onRefreshSource: (source: PlaylistSource) => void;
  onRemoveSource: (sourceId: string) => void;
  isLoading: boolean;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof Tv }> = [
  { id: 'live', label: 'TV ao Vivo', icon: Tv },
  { id: 'vod', label: 'Filmes (VOD)', icon: Film },
  { id: 'series', label: 'Séries', icon: Clapperboard },
  { id: 'favorites', label: 'Favoritos', icon: Star },
  { id: 'recents', label: 'Recentes', icon: Clock },
];

export function Sidebar({
  section,
  onSelectSection,
  categories,
  selectedCategory,
  onSelectCategory,
  sources,
  onOpenAddModal,
  onOpenMultiStream,
  onOpenSettings,
  onRefreshSource,
  onRemoveSource,
  isLoading,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="./logo.png" alt="TV Local" className="brand-logo" />
        <div>
          <h1>TV Local</h1>
          <span>Player IPTV Multiplataforma</span>
        </div>
      </div>

      <button type="button" className="btn btn-primary full-width" onClick={onOpenAddModal}>
        <Plus size={16} /> Adicionar Lista / EPG
      </button>
      <button type="button" className="btn btn-secondary full-width" onClick={onOpenMultiStream}>
        <Columns2 size={15} /> Multi-Tela (2 / 4 Telas)
      </button>
      <button type="button" className="btn btn-secondary full-width" onClick={onOpenSettings}>
        <Settings size={15} /> Configurações e Cores
      </button>

      <nav className="nav-section">
        <div className="section-label">Navegação</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${section === item.id ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-scroll">
        <div className="section-label">
          <Layers size={13} /> Categorias
        </div>
        <div className="category-list">
          {categories.map((cat) => (
            <button
              key={cat.name}
              type="button"
              className={`cat-btn ${selectedCategory === cat.name ? 'active' : ''}`}
              onClick={() => onSelectCategory(cat.name)}
            >
              <span className="truncate">{cat.name}</span>
              <span className="cat-count">{cat.count}</span>
            </button>
          ))}
        </div>

        {sources.length > 0 && (
          <div className="sources-block">
            <div className="section-label">Listas Conectadas</div>
            {sources.map((src) => (
              <div key={src.id} className="source-item">
                <div className="source-info">
                  <strong className="truncate">{src.name}</strong>
                  <span>{src.channelCount} itens</span>
                </div>
                <div className="source-actions">
                  <button
                    type="button"
                    className="icon-btn-sm"
                    title="Atualizar lista"
                    disabled={isLoading}
                    onClick={() => onRefreshSource(src)}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn-sm danger"
                    title="Remover lista"
                    onClick={() => onRemoveSource(src.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
