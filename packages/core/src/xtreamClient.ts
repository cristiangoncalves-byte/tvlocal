import type {
  Channel,
  EpgProgram,
  Fetcher,
  SeriesDetails,
  SeriesEpisode,
  VodDetails,
  XtreamAccountInfo,
  XtreamCredentials,
} from './types.ts';

interface XtreamCategory {
  category_id: string;
  category_name: string;
}

interface XtreamLiveStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  epg_channel_id?: string;
  category_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}

interface XtreamVodStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  container_extension?: string;
  rating?: string | number;
}

interface XtreamSeriesStream {
  series_id: number;
  name: string;
  cover?: string;
  category_id?: string;
  rating?: string | number;
  plot?: string;
}

export function normalizeXtreamServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function buildApiUrl(creds: XtreamCredentials, action?: string, extraParams?: Record<string, string>): string {
  const base = normalizeXtreamServerUrl(creds.serverUrl);
  const params = new URLSearchParams({
    username: creds.username.trim(),
    password: creds.password,
  });
  if (action) {
    params.set('action', action);
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      params.set(k, v);
    }
  }
  return `${base}/player_api.php?${params.toString()}`;
}

export function buildXtreamXmltvUrl(creds: XtreamCredentials): string {
  const base = normalizeXtreamServerUrl(creds.serverUrl);
  const params = new URLSearchParams({
    username: creds.username.trim(),
    password: creds.password,
  });
  return `${base}/xmltv.php?${params.toString()}`;
}

async function fetchJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status} ao consultar servidor Xtream.`);
  }
  return (await response.json()) as T;
}

export async function authenticateXtream(
  creds: XtreamCredentials,
  fetcher: Fetcher = fetch,
): Promise<XtreamAccountInfo> {
  const data = await fetchJson<{ user_info?: Record<string, unknown> }>(
    buildApiUrl(creds),
    fetcher,
  );
  const userInfo = data.user_info;
  if (!userInfo || Number(userInfo.auth) !== 1) {
    throw new Error('Falha na autenticação Xtream Codes. Verifique servidor, usuário e senha.');
  }

  return {
    username: String(userInfo.username ?? creds.username),
    status: String(userInfo.status ?? 'Active'),
    expDate: userInfo.exp_date ? String(userInfo.exp_date) : undefined,
    isTrial: String(userInfo.is_trial) === '1',
    activeConnections: Number(userInfo.active_cons ?? 0),
    maxConnections: Number(userInfo.max_connections ?? 1),
  };
}

export interface XtreamContentResult {
  account: XtreamAccountInfo;
  channels: Channel[];
  epgUrl: string;
}

function mapCategoryLookup(categories: XtreamCategory[] | unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(categories)) {
    for (const cat of categories) {
      if (cat && cat.category_id) {
        map.set(String(cat.category_id), String(cat.category_name || 'Sem Categoria'));
      }
    }
  }
  return map;
}

export async function fetchXtreamAllContent(
  creds: XtreamCredentials,
  sourceId: string,
  fetcher: Fetcher = fetch,
): Promise<XtreamContentResult> {
  const account = await authenticateXtream(creds, fetcher);
  const base = normalizeXtreamServerUrl(creds.serverUrl);
  const u = encodeURIComponent(creds.username.trim());
  const p = encodeURIComponent(creds.password);

  const [liveCats, liveStreams, vodCats, vodStreams, seriesCats, seriesList] = await Promise.all([
    fetchJson<XtreamCategory[]>(buildApiUrl(creds, 'get_live_categories'), fetcher).catch(() => []),
    fetchJson<XtreamLiveStream[]>(buildApiUrl(creds, 'get_live_streams'), fetcher).catch(() => []),
    fetchJson<XtreamCategory[]>(buildApiUrl(creds, 'get_vod_categories'), fetcher).catch(() => []),
    fetchJson<XtreamVodStream[]>(buildApiUrl(creds, 'get_vod_streams'), fetcher).catch(() => []),
    fetchJson<XtreamCategory[]>(buildApiUrl(creds, 'get_series_categories'), fetcher).catch(() => []),
    fetchJson<XtreamSeriesStream[]>(buildApiUrl(creds, 'get_series'), fetcher).catch(() => []),
  ]);

  const liveCatMap = mapCategoryLookup(liveCats);
  const vodCatMap = mapCategoryLookup(vodCats);
  const seriesCatMap = mapCategoryLookup(seriesCats);

  const channels: Channel[] = [];

  if (Array.isArray(liveStreams)) {
    for (const item of liveStreams) {
      channels.push({
        id: `${sourceId}_live_${item.stream_id}`,
        name: item.name || `Canal ${item.stream_id}`,
        url: `${base}/live/${u}/${p}/${item.stream_id}.m3u8`,
        logo: item.stream_icon || undefined,
        group: liveCatMap.get(String(item.category_id)) ?? 'TV ao Vivo',
        tvgId: item.epg_channel_id || undefined,
        kind: 'live',
        sourceId,
        streamId: item.stream_id,
        catchup: item.tv_archive ? 'default' : undefined,
        catchupDays: item.tv_archive_duration,
      });
    }
  }

  if (Array.isArray(vodStreams)) {
    for (const item of vodStreams) {
      const ext = item.container_extension || 'mp4';
      channels.push({
        id: `${sourceId}_vod_${item.stream_id}`,
        name: item.name || `Filme ${item.stream_id}`,
        url: `${base}/movie/${u}/${p}/${item.stream_id}.${ext}`,
        logo: item.stream_icon || undefined,
        group: vodCatMap.get(String(item.category_id)) ?? 'Filmes',
        kind: 'vod',
        sourceId,
        streamId: item.stream_id,
        containerExtension: ext,
        rating: item.rating ? String(item.rating) : undefined,
      });
    }
  }

  if (Array.isArray(seriesList)) {
    for (const item of seriesList) {
      channels.push({
        id: `${sourceId}_series_${item.series_id}`,
        name: item.name || `Série ${item.series_id}`,
        url: '',
        logo: item.cover || undefined,
        group: seriesCatMap.get(String(item.category_id)) ?? 'Séries',
        kind: 'series',
        sourceId,
        seriesId: item.series_id,
        rating: item.rating ? String(item.rating) : undefined,
        plot: item.plot || undefined,
      });
    }
  }

  return {
    account,
    channels,
    epgUrl: buildXtreamXmltvUrl(creds),
  };
}

export async function fetchXtreamSeriesInfo(
  creds: XtreamCredentials,
  seriesId: string | number,
  fetcher: Fetcher = fetch,
): Promise<SeriesDetails> {
  const data = await fetchJson<{
    info?: { name?: string; cover?: string; plot?: string };
    episodes?: Record<
      string,
      Array<{
        id: string;
        episode_num: number | string;
        title?: string;
        container_extension?: string;
        info?: { duration?: string; plot?: string; movie_image?: string };
      }>
    >;
  }>(buildApiUrl(creds, 'get_series_info', { series_id: String(seriesId) }), fetcher);

  const base = normalizeXtreamServerUrl(creds.serverUrl);
  const u = encodeURIComponent(creds.username.trim());
  const p = encodeURIComponent(creds.password);

  const seasons: Record<number, SeriesEpisode[]> = {};
  if (data.episodes && typeof data.episodes === 'object') {
    for (const [seasonKey, rawEpisodes] of Object.entries(data.episodes)) {
      const seasonNum = Number.parseInt(seasonKey, 10) || 1;
      if (!Array.isArray(rawEpisodes)) continue;
      seasons[seasonNum] = rawEpisodes.map((ep) => {
        const ext = ep.container_extension || 'mp4';
        return {
          id: String(ep.id),
          episodeNum: Number(ep.episode_num) || 1,
          season: seasonNum,
          title: ep.title || `Episódio ${ep.episode_num}`,
          url: `${base}/series/${u}/${p}/${ep.id}.${ext}`,
          containerExtension: ext,
          duration: ep.info?.duration,
          plot: ep.info?.plot,
          cover: ep.info?.movie_image,
        };
      });
    }
  }

  return {
    seriesId,
    name: data.info?.name || `Série ${seriesId}`,
    cover: data.info?.cover,
    plot: data.info?.plot,
    seasons,
  };
}

export async function fetchXtreamVodInfo(
  creds: XtreamCredentials,
  vodId: string | number,
  fetcher: Fetcher = fetch,
): Promise<VodDetails | null> {
  const data = await fetchJson<{
    info?: {
      name?: string;
      movie_image?: string;
      cover_big?: string;
      backdrop_path?: string[] | string;
      plot?: string;
      description?: string;
      genre?: string;
      cast?: string;
      actors?: string;
      director?: string;
      releasedate?: string;
      release_date?: string;
      duration?: string;
      rating?: string | number;
    };
    movie_data?: {
      name?: string;
      container_extension?: string;
    };
  }>(buildApiUrl(creds, 'get_vod_info', { vod_id: String(vodId) }), fetcher);

  if (!data.info) return null;
  const bp = data.info.backdrop_path;
  const backdrop = Array.isArray(bp) ? bp[0] : typeof bp === 'string' ? bp : undefined;

  return {
    title: data.movie_data?.name || data.info.name || '',
    cover: data.info.movie_image || data.info.cover_big,
    backdrop,
    plot: data.info.plot || data.info.description,
    genre: data.info.genre,
    cast: data.info.cast || data.info.actors,
    director: data.info.director,
    releaseDate: data.info.releasedate || data.info.release_date,
    duration: data.info.duration,
    rating: data.info.rating !== undefined ? String(data.info.rating) : undefined,
    containerExtension: data.movie_data?.container_extension,
  };
}

export function tryInferXtreamFromPlaylistUrl(playlistUrl?: string): XtreamCredentials | null {
  if (!playlistUrl) return null;
  try {
    const uri = new URL(playlistUrl.trim());
    const user = uri.searchParams.get('username');
    const pass = uri.searchParams.get('password');
    if (!user || !pass) return null;
    return {
      serverUrl: `${uri.protocol}//${uri.host}`,
      username: user,
      password: pass,
    };
  } catch {
    return null;
  }
}

export function tryInferXtreamFromStreamUrl(
  streamUrl?: string,
): { creds: XtreamCredentials; streamId: string } | null {
  if (!streamUrl) return null;
  try {
    const uri = new URL(streamUrl.trim());
    const parts = uri.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return null;
    const isTyped = ['live', 'movie', 'series'].includes(parts[0].toLowerCase());
    if (isTyped && parts.length < 4) return null;
    const idx = isTyped ? 1 : 0;
    const username = decodeURIComponent(parts[idx]);
    const password = decodeURIComponent(parts[idx + 1]);
    const rawId = parts[idx + 2].split('.')[0];
    if (!username || !password || !/^\d+$/.test(rawId)) return null;
    return {
      creds: { serverUrl: `${uri.protocol}//${uri.host}`, username, password },
      streamId: rawId,
    };
  } catch {
    return null;
  }
}

function decodeBase64OrPlain(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.length % 4 !== 0 || trimmed.includes(' ')) return trimmed;
  try {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return trimmed;
    return decoded;
  } catch {
    return trimmed;
  }
}

export async function fetchXtreamShortEpg(
  creds: XtreamCredentials,
  streamId: string | number,
  channelKey: string,
  limit = 12,
  fetcher: Fetcher = fetch,
): Promise<EpgProgram[]> {
  const data = await fetchJson<{
    epg_listings?: Array<{
      title?: string;
      description?: string;
      start_timestamp?: string | number;
      stop_timestamp?: string | number;
      start?: string;
      end?: string;
    }>;
  }>(
    buildApiUrl(creds, 'get_short_epg', {
      stream_id: String(streamId),
      limit: String(limit),
    }),
    fetcher,
  );

  if (!Array.isArray(data.epg_listings)) return [];
  const programs: EpgProgram[] = [];

  for (const item of data.epg_listings) {
    const title = decodeBase64OrPlain(item.title);
    if (!title) continue;

    const startTs = item.start_timestamp ? Number(item.start_timestamp) * 1000 : Date.parse(item.start ?? '');
    const stopTs = item.stop_timestamp ? Number(item.stop_timestamp) * 1000 : Date.parse(item.end ?? '');
    if (!Number.isFinite(startTs) || !Number.isFinite(stopTs) || startTs <= 0 || stopTs <= 0) continue;

    programs.push({
      channelId: channelKey,
      title,
      description: decodeBase64OrPlain(item.description) || undefined,
      start: startTs,
      stop: stopTs,
    });
  }

  programs.sort((a, b) => a.start - b.start);
  return programs;
}
