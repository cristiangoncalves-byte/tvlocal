import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseM3u,
  parseXmltv,
  parseXmltvDate,
  getNowAndNextPrograms,
  normalizeXtreamServerUrl,
  buildXtreamXmltvUrl,
  createDemoPlaylist,
} from '../src/index.ts';

describe('@tv-local/core M3U parser', () => {
  it('parses EXTM3U header, EXTINF attributes, EXTGRP, and EXTVLCOPT', () => {
    const sample = `#EXTM3U url-tvg="https://example.com/epg.xml"
#EXTINF:-1 tvg-id="canal1.br" tvg-name="Canal Um" tvg-logo="https://example.com/1.png" group-title="Notícias",Canal Um HD
#EXTVLCOPT:http-user-agent=TVLocal/1.0
https://stream.example.com/live/canal1.m3u8

#EXTINF:-1 tvg-id="filme1" group-title="Filmes",Aventura Espacial (2025)
https://stream.example.com/movies/aventura.mp4

#EXTINF:-1,Canal Sem Grupo
#EXTGRP:Esportes
https://stream.example.com/live/esporte.m3u8`;

    const result = parseM3u(sample, 'src1');
    assert.equal(result.epgUrl, 'https://example.com/epg.xml');
    assert.equal(result.channels.length, 3);

    assert.equal(result.channels[0].name, 'Canal Um HD');
    assert.equal(result.channels[0].group, 'Notícias');
    assert.equal(result.channels[0].tvgId, 'canal1.br');
    assert.equal(result.channels[0].kind, 'live');
    assert.equal(result.channels[0].httpUserAgent, 'TVLocal/1.0');

    assert.equal(result.channels[1].kind, 'vod');
    assert.equal(result.channels[1].group, 'Filmes');

    assert.equal(result.channels[2].group, 'Esportes');
    assert.equal(result.channels[2].name, 'Canal Sem Grupo');
  });
});

describe('@tv-local/core XMLTV parser', () => {
  it('parses XMLTV dates and finds current/next programs', () => {
    const startMs = parseXmltvDate('20261116220000 -0300');
    const stopMs = parseXmltvDate('20261116230000 -0300');
    assert.ok(startMs !== null && stopMs !== null);
    assert.equal(stopMs - startMs, 3_600_000);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20261116220000 -0300" stop="20261116230000 -0300" channel="canal1.br">
    <title>Jornal da Noite &amp; Debate</title>
    <desc>Resumo das principais notícias.</desc>
    <category>Jornalismo</category>
  </programme>
  <programme start="20261116230000 -0300" stop="20261117000000 -0300" channel="canal1.br">
    <title>Documentário Especial</title>
  </programme>
</tv>`;

    const epg = parseXmltv(xml);
    assert.equal(epg['canal1.br'].length, 2);
    assert.equal(epg['canal1.br'][0].title, 'Jornal da Noite & Debate');

    const nowMs = startMs + 15 * 60_000;
    const guide = getNowAndNextPrograms(epg, {
      id: 'c1',
      name: 'Canal 1',
      url: 'https://example.com/1.m3u8',
      group: 'Geral',
      tvgId: 'canal1.br',
      kind: 'live',
      sourceId: 'src1',
    }, nowMs);

    assert.equal(guide.current?.title, 'Jornal da Noite & Debate');
    assert.equal(guide.next?.title, 'Documentário Especial');
  });
});

describe('@tv-local/core Xtream & Demo helpers', () => {
  it('normalizes Xtream server URLs and builds XMLTV URL', () => {
    assert.equal(normalizeXtreamServerUrl('iptv.example.com:8080/'), 'http://iptv.example.com:8080');
    assert.equal(
      buildXtreamXmltvUrl({ serverUrl: 'https://tv.local/', username: 'u1', password: 'p1' }),
      'https://tv.local/xmltv.php?username=u1&password=p1',
    );
  });

  it('creates legal demo playlist with EPG', () => {
    const demo = createDemoPlaylist();
    assert.ok(demo.channels.length >= 3);
    assert.equal(demo.source.type, 'demo');
    assert.ok(demo.epg['demo.bbb']?.length);
  });
});
