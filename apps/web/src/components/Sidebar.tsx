import {
  Clock,
  Columns2,
  Film,
  Layers,
  Plus,
  Settings,
  Star,
  Tv,
  Clapperboard,
} from 'lucide-react';
import type { NavSection } from '../hooks/useIptvStore';

interface SidebarProps {
  section: NavSection;
  onSelectSection: (section: NavSection) => void;
  categories: Array<{ name: string; count: number }>;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  onOpenAddModal: () => void;
  onOpenMultiStream: () => void;
  onOpenSettings: () => void;
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
  onOpenAddModal,
  onOpenMultiStream,
  onOpenSettings,
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
      </div>
    </aside>
  );
}
