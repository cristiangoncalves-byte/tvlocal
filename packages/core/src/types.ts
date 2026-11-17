export type StreamKind = 'live' | 'vod' | 'series';

export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export interface PlaylistSource {
  id: string;
  name: string;
  type: 'm3u_url' | 'm3u_file' | 'xtream' | 'demo';
  url?: string;
  epgUrl?: string;
  xtream?: XtreamCredentials;
  addedAt: number;
  lastUpdatedAt?: number;
  channelCount: number;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
  tvgName?: string;
  kind: StreamKind;
  sourceId: string;
  streamId?: number | string;
  seriesId?: number | string;
  containerExtension?: string;
  rating?: string;
  plot?: string;
  catchup?: string;
  catchupDays?: number;
  httpUserAgent?: string;
  httpReferrer?: string;
}

export interface EpgProgram {
  channelId: string;
  title: string;
  description?: string;
  category?: string;
  start: number;
  stop: number;
}

export type EpgMap = Record<string, EpgProgram[]>;

export interface SeriesEpisode {
  id: string;
  episodeNum: number;
  season: number;
  title: string;
  url: string;
  containerExtension: string;
  duration?: string;
  plot?: string;
  cover?: string;
}

export interface SeriesDetails {
  seriesId: string | number;
  name: string;
  cover?: string;
  plot?: string;
  seasons: Record<number, SeriesEpisode[]>;
}

export interface XtreamAccountInfo {
  username: string;
  status: string;
  expDate?: string;
  isTrial?: boolean;
  activeConnections: number;
  maxConnections: number;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
