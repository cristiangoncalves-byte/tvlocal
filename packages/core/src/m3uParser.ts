import type { Channel, StreamKind } from './types.ts';

export interface ParsedM3uResult {
  channels: Channel[];
  epgUrl?: string;
}

const VOD_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
const ALLOWED_STREAM_SCHEME_REGEX = /^(https?|rtmps?|rtsp|mmsh?):\/\//i;
const ALLOWED_HTTP_SCHEME_REGEX = /^https?:\/\//i;

function sanitizeHeaderValue(raw: string): string | undefined {
  const cleaned = raw.replace(/[\r\n\0\t"]/g, '').trim();
  if (!cleaned) return undefined;
  return cleaned.length > 256 ? cleaned.slice(0, 256) : cleaned;
}

function sanitizeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return ALLOWED_HTTP_SCHEME_REGEX.test(trimmed) ? trimmed : undefined;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseAttributes(rawHeader: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawHeader)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (value) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function extractDisplayName(extinfLine: string): string {
  let inQuotes = false;
  let quoteChar = '';
  let lastCommaOutsideQuotes = -1;

  for (let i = 0; i < extinfLine.length; i += 1) {
    const ch = extinfLine[i];
    if ((ch === '"' || ch === "'") && extinfLine[i - 1] !== '\\') {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else if (quoteChar === ch) {
        inQuotes = false;
        quoteChar = '';
      }
    } else if (ch === ',' && !inQuotes) {
      lastCommaOutsideQuotes = i;
    }
  }

  if (lastCommaOutsideQuotes === -1) {
    return '';
  }
  return extinfLine.slice(lastCommaOutsideQuotes + 1).trim();
}

function inferKind(url: string, group: string, attrs: Record<string, string>): StreamKind {
  const explicitType = attrs['type']?.toLowerCase();
  if (explicitType === 'vod' || explicitType === 'movie') return 'vod';
  if (explicitType === 'series') return 'series';

  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.includes('/movie/')) return 'vod';
  if (cleanUrl.includes('/series/')) return 'series';
  if (VOD_EXTENSIONS.some((ext) => cleanUrl.endsWith(ext))) {
    return 'vod';
  }

  const lowerGroup = group.toLowerCase();
  if (lowerGroup.includes('serie') || lowerGroup.includes('série')) return 'series';
  if (lowerGroup.includes('filme') || lowerGroup.includes('movie') || lowerGroup.includes('vod')) {
    return 'vod';
  }

  return 'live';
}

/**
 * Parses M3U / M3U8 playlist text into structured channels and optional EPG URL.
 */
export function parseM3u(content: string, sourceId: string): ParsedM3uResult {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const channels: Channel[] = [];
  let epgUrl: string | undefined;

  let pendingAttrs: Record<string, string> = {};
  let pendingName = '';
  let pendingGroup = '';
  let pendingUserAgent: string | undefined;
  let pendingReferrer: string | undefined;
  let hasExtInf = false;

  const resetPending = () => {
    pendingAttrs = {};
    pendingName = '';
    pendingGroup = '';
    pendingUserAgent = undefined;
    pendingReferrer = undefined;
    hasExtInf = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const headerAttrs = parseAttributes(line);
      epgUrl = sanitizeHttpUrl(
        headerAttrs['url-tvg'] ?? headerAttrs['x-tvg-url'] ?? headerAttrs['tvg-url'],
      );
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      pendingAttrs = parseAttributes(line);
      pendingName = extractDisplayName(line) || pendingAttrs['tvg-name'] || 'Canal sem nome';
      pendingGroup = pendingAttrs['group-title'] || '';
      hasExtInf = true;
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      const grp = line.slice('#EXTGRP:'.length).trim();
      if (grp) {
        pendingGroup = grp;
      }
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length).trim();
      if (opt.toLowerCase().startsWith('http-user-agent=')) {
        pendingUserAgent = sanitizeHeaderValue(opt.slice('http-user-agent='.length));
      } else if (opt.toLowerCase().startsWith('http-referrer=')) {
        pendingReferrer = sanitizeHeaderValue(opt.slice('http-referrer='.length));
      }
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // Stream URL line
    if (ALLOWED_STREAM_SCHEME_REGEX.test(line)) {
      const group = pendingGroup || pendingAttrs['group-title'] || 'Sem Categoria';
      const name = pendingName || `Canal ${channels.length + 1}`;
      const catchupDaysRaw = pendingAttrs['catchup-days']
        ? Number.parseInt(pendingAttrs['catchup-days'], 10)
        : undefined;

      channels.push({
        id: `${sourceId}_${hashString(`${line}|${name}|${channels.length}`)}`,
        name,
        url: line,
        logo: sanitizeHttpUrl(pendingAttrs['tvg-logo'] || pendingAttrs['logo']),
        group,
        tvgId: pendingAttrs['tvg-id'],
        tvgName: pendingAttrs['tvg-name'],
        kind: inferKind(line, group, pendingAttrs),
        sourceId,
        catchup: pendingAttrs['catchup'],
        catchupDays: Number.isFinite(catchupDaysRaw) ? catchupDaysRaw : undefined,
        httpUserAgent: pendingUserAgent,
        httpReferrer: pendingReferrer,
      });

      resetPending();
    } else if (hasExtInf) {
      resetPending();
    }
  }

  return { channels, epgUrl };
}
