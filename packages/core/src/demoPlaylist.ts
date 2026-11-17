import type { Channel, EpgMap, PlaylistSource } from './types.ts';

export const DEMO_SOURCE_ID = 'demo_public_streams';

export function createDemoPlaylist(): {
  source: PlaylistSource;
  channels: Channel[];
  epg: EpgMap;
} {
  const now = Date.now();
  const hour = 3_600_000;

  const channels: Channel[] = [
    {
      id: `${DEMO_SOURCE_ID}_bbb`,
      name: 'Big Buck Bunny (HLS Demo)',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      logo: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217',
      group: 'Streams de Teste (Demo)',
      tvgId: 'demo.bbb',
      kind: 'live',
      sourceId: DEMO_SOURCE_ID,
    },
    {
      id: `${DEMO_SOURCE_ID}_sintel`,
      name: 'Sintel 4K Test (Unified Streaming)',
      url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
      group: 'Streams de Teste (Demo)',
      tvgId: 'demo.sintel',
      kind: 'vod',
      sourceId: DEMO_SOURCE_ID,
    },
    {
      id: `${DEMO_SOURCE_ID}_tears`,
      name: 'Tears of Steel (Open Movie)',
      url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      group: 'Filmes Open Source',
      tvgId: 'demo.tears',
      kind: 'vod',
      sourceId: DEMO_SOURCE_ID,
    },
    {
      id: `${DEMO_SOURCE_ID}_apple`,
      name: 'Apple BipBop Multi-Audio HLS',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      group: 'Streams Técnicos',
      tvgId: 'demo.bipbop',
      kind: 'live',
      sourceId: DEMO_SOURCE_ID,
    },
  ];

  const epg: EpgMap = {
    'demo.bbb': [
      {
        channelId: 'demo.bbb',
        title: 'Big Buck Bunny — Maratona Open Movie',
        description: 'Animação open-source da Blender Foundation para validação de player HLS adaptativo.',
        category: 'Animação',
        start: now - hour / 2,
        stop: now + hour / 2,
      },
      {
        channelId: 'demo.bbb',
        title: 'Bastidores Blender Studio',
        description: 'Documentário técnico sobre renderização e distribuição adaptativa.',
        category: 'Documentário',
        start: now + hour / 2,
        stop: now + hour * 1.5,
      },
    ],
    'demo.bipbop': [
      {
        channelId: 'demo.bipbop',
        title: 'Teste de Qualidade fMP4 / ABR',
        description: 'Stream de referência para testar troca de faixa de bitrate e legendas.',
        category: 'Engenharia',
        start: now - hour / 4,
        stop: now + hour,
      },
    ],
  };

  const source: PlaylistSource = {
    id: DEMO_SOURCE_ID,
    name: 'Lista Demo (Streams Públicos Legais)',
    type: 'demo',
    addedAt: now,
    lastUpdatedAt: now,
    channelCount: channels.length,
  };

  return { source, channels, epg };
}
