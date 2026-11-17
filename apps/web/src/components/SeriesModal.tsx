import { useEffect, useState } from 'react';
import { Play, X } from 'lucide-react';
import {
  fetchXtreamSeriesInfo,
  type Channel,
  type SeriesDetails,
  type SeriesEpisode,
  type XtreamCredentials,
} from '@tv-local/core';
import { smartFetch } from '../utils/network';

interface SeriesModalProps {
  series: Channel | null;
  credentials?: XtreamCredentials;
  onClose: () => void;
  onPlayEpisode: (episodeChannel: Channel) => void;
}

export function SeriesModal({ series, credentials, onClose, onPlayEpisode }: SeriesModalProps) {
  const [details, setDetails] = useState<SeriesDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!series || !credentials || !series.seriesId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchXtreamSeriesInfo(credentials, series.seriesId, smartFetch)
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
        const firstSeason = Object.keys(res.seasons)
          .map(Number)
          .sort((a, b) => a - b)[0];
        if (firstSeason) setSelectedSeason(firstSeason);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar episódios.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [series, credentials]);

  if (!series) return null;

  const seasons = details ? Object.keys(details.seasons).map(Number).sort((a, b) => a - b) : [];
  const episodes: SeriesEpisode[] = details?.seasons[selectedSeason] ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{series.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {loading && <p className="muted">Carregando temporadas e episódios...</p>}
        {error && <div className="modal-error">{error}</div>}

        {details && (
          <>
            {details.plot && <p className="series-plot">{details.plot}</p>}
            <div className="season-tabs">
              {seasons.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={selectedSeason === s ? 'active' : ''}
                  onClick={() => setSelectedSeason(s)}
                >
                  Temporada {s}
                </button>
              ))}
            </div>
            <div className="episode-list">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  className="episode-item"
                  onClick={() => {
                    onPlayEpisode({
                      id: `${series.id}_ep_${ep.id}`,
                      name: `${series.name} • T${ep.season}E${ep.episodeNum} — ${ep.title}`,
                      url: ep.url,
                      logo: ep.cover || series.logo,
                      group: series.group,
                      kind: 'series',
                      sourceId: series.sourceId,
                    });
                    onClose();
                  }}
                >
                  <Play size={15} />
                  <span>
                    <strong>Episódio {ep.episodeNum}:</strong> {ep.title}
                  </span>
                  {ep.duration && <span className="muted">{ep.duration}</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
