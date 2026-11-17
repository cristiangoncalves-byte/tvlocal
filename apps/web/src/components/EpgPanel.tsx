import { CalendarClock } from 'lucide-react';
import { getNowAndNextPrograms, type Channel, type EpgMap } from '@tv-local/core';

interface EpgPanelProps {
  channel: Channel | null;
  epg: EpgMap;
  onOpenEpgImport: () => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function EpgPanel({ channel, epg, onOpenEpgImport }: EpgPanelProps) {
  if (!channel) return null;

  const { upcoming } = getNowAndNextPrograms(epg, channel);

  return (
    <aside className="epg-panel">
      <div className="epg-header">
        <div className="epg-title">
          <CalendarClock size={16} />
          <strong>Guia de Programação (EPG)</strong>
        </div>
        <button type="button" className="btn-link" onClick={onOpenEpgImport}>
          Importar XMLTV
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p className="epg-empty">
          Nenhuma programação encontrada para <strong>{channel.name}</strong>. Você pode importar um
          arquivo ou URL XMLTV para visualizar horários e sinopses.
        </p>
      ) : (
        <div className="epg-list">
          {upcoming.map((prog, idx) => {
            const now = Date.now();
            const isNow = prog.start <= now && prog.stop > now;
            return (
              <div key={`${prog.start}-${idx}`} className={`epg-item ${isNow ? 'now' : ''}`}>
                <div className="epg-time">
                  {formatTime(prog.start)} – {formatTime(prog.stop)}
                  {isNow && <span className="epg-now-badge">AGORA</span>}
                </div>
                <div className="epg-prog-title">{prog.title}</div>
                {prog.description && <p className="epg-prog-desc">{prog.description}</p>}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
