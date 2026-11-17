import type { Channel, EpgMap, EpgProgram } from './types.ts';

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Parses XMLTV timestamp format: YYYYMMDDHHmmss [+-]HHMM
 */
export function parseXmltvDate(raw: string): number | null {
  const match = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);

  let utcMs = Date.UTC(year, month, day, hour, minute, second);

  if (match[7] && match[8] && match[9]) {
    const sign = match[7] === '+' ? 1 : -1;
    const offsetHours = Number.parseInt(match[8], 10);
    const offsetMinutes = Number.parseInt(match[9], 10);
    const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
    utcMs -= offsetMs;
  }

  return utcMs;
}

function extractTagContent(block: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = block.match(regex);
  if (!match) return undefined;
  return decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}

function extractAttr(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = attrs.match(regex);
  return match ? decodeXmlEntities((match[1] ?? match[2] ?? '').trim()) : undefined;
}

/**
 * Lightweight, dependency-free XMLTV parser compatible with Browser, Node, and React Native.
 */
export function parseXmltv(xmlContent: string): EpgMap {
  const epgMap: EpgMap = {};
  const programmeRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;

  while ((match = programmeRegex.exec(xmlContent)) !== null) {
    const rawAttrs = match[1];
    const body = match[2];

    const channelId = extractAttr(rawAttrs, 'channel');
    const startRaw = extractAttr(rawAttrs, 'start');
    const stopRaw = extractAttr(rawAttrs, 'stop');
    if (!channelId || !startRaw || !stopRaw) continue;

    const start = parseXmltvDate(startRaw);
    const stop = parseXmltvDate(stopRaw);
    if (start === null || stop === null) continue;

    const title = extractTagContent(body, 'title');
    if (!title) continue;

    const program: EpgProgram = {
      channelId,
      title,
      description: extractTagContent(body, 'desc'),
      category: extractTagContent(body, 'category'),
      start,
      stop,
    };

    const key = channelId.toLowerCase();
    if (!epgMap[key]) {
      epgMap[key] = [];
    }
    epgMap[key].push(program);
  }

  for (const key of Object.keys(epgMap)) {
    epgMap[key].sort((a, b) => a.start - b.start);
  }

  return epgMap;
}

export interface NowAndNext {
  current?: EpgProgram;
  next?: EpgProgram;
  upcoming: EpgProgram[];
}

export function getProgramsForChannel(epgMap: EpgMap, channel: Channel): EpgProgram[] {
  const candidates = [channel.tvgId, channel.tvgName, channel.name]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().toLowerCase());

  for (const key of candidates) {
    if (epgMap[key]?.length) {
      return epgMap[key];
    }
  }
  return [];
}

export function getNowAndNextPrograms(
  epgMap: EpgMap,
  channel: Channel,
  nowMs: number = Date.now(),
): NowAndNext {
  const programs = getProgramsForChannel(epgMap, channel);
  if (!programs.length) {
    return { upcoming: [] };
  }

  const currentIndex = programs.findIndex((p) => p.start <= nowMs && p.stop > nowMs);
  if (currentIndex !== -1) {
    return {
      current: programs[currentIndex],
      next: programs[currentIndex + 1],
      upcoming: programs.slice(currentIndex, currentIndex + 8),
    };
  }

  const nextIndex = programs.findIndex((p) => p.start > nowMs);
  if (nextIndex !== -1) {
    return {
      next: programs[nextIndex],
      upcoming: programs.slice(nextIndex, nextIndex + 8),
    };
  }

  return { upcoming: [] };
}
