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

export interface VodDetails {
  title: string;
  cover?: string;
  backdrop?: string;
  plot?: string;
  genre?: string;
  cast?: string;
  director?: string;
  releaseDate?: string;
  duration?: string;
  rating?: string;
  containerExtension?: string;
}

export interface AppThemeSettings {
  presetName: string;
  bg: string;
  surface: string;
  card: string;
  accent: string;
}

export const DEFAULT_APP_THEME: AppThemeSettings = {
  presetName: 'Padrão (Azul Noturno)',
  bg: '#080c14',
  surface: '#0f1624',
  card: '#151e30',
  accent: '#3b82f6',
};

export const APP_THEME_PRESETS: AppThemeSettings[] = [
  DEFAULT_APP_THEME,
  { presetName: 'Esmeralda', bg: '#07110e', surface: '#0c1c17', card: '#122922', accent: '#10b981' },
  { presetName: 'Roxo Neon', bg: '#0c0916', surface: '#140f24', card: '#1d1635', accent: '#8b5cf6' },
  { presetName: 'Rubi Escuro', bg: '#12080b', surface: '#1c0e13', card: '#29151c', accent: '#ef4444' },
  { presetName: 'Âmbar Dourado', bg: '#110d07', surface: '#1b150c', card: '#281f12', accent: '#f59e0b' },
  { presetName: 'Grafite Ciano', bg: '#0c0d10', surface: '#14161b', card: '#1d2028', accent: '#06b6d4' },
];

export interface XtreamAccountInfo {
  username: string;
  status: string;
  expDate?: string;
  isTrial?: boolean;
  activeConnections: number;
  maxConnections: number;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
