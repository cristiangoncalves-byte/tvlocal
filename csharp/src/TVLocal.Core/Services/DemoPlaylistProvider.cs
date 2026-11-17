using TVLocal.Core.Models;

namespace TVLocal.Core.Services;

public static class DemoPlaylistProvider
{
    public const string DemoSourceId = "demo_public_streams";

    public static (PlaylistSource Source, List<Channel> Channels, Dictionary<string, List<EpgProgram>> Epg) Create()
    {
        var now = DateTimeOffset.UtcNow;
        var nowMs = now.ToUnixTimeMilliseconds();

        var channels = new List<Channel>
        {
            new(
                Id: $"{DemoSourceId}_bbb",
                Name: "Big Buck Bunny (HLS Demo)",
                Url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
                Group: "Streams de Teste (Demo)",
                Kind: StreamKind.Live,
                SourceId: DemoSourceId,
                Logo: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217",
                TvgId: "demo.bbb"),
            new(
                Id: $"{DemoSourceId}_sintel",
                Name: "Sintel 4K Test (Unified Streaming)",
                Url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
                Group: "Streams de Teste (Demo)",
                Kind: StreamKind.Vod,
                SourceId: DemoSourceId,
                TvgId: "demo.sintel"),
            new(
                Id: $"{DemoSourceId}_tears",
                Name: "Tears of Steel (Open Movie)",
                Url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
                Group: "Filmes Open Source",
                Kind: StreamKind.Vod,
                SourceId: DemoSourceId,
                TvgId: "demo.tears"),
            new(
                Id: $"{DemoSourceId}_apple",
                Name: "Apple BipBop Multi-Audio HLS",
                Url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
                Group: "Streams Técnicos",
                Kind: StreamKind.Live,
                SourceId: DemoSourceId,
                TvgId: "demo.bipbop"),
        };

        var epg = new Dictionary<string, List<EpgProgram>>(StringComparer.OrdinalIgnoreCase)
        {
            ["demo.bbb"] =
            [
                new EpgProgram(
                    "demo.bbb",
                    "Big Buck Bunny — Maratona Open Movie",
                    now.AddMinutes(-30),
                    now.AddMinutes(30),
                    "Animação open-source da Blender Foundation para validação de player HLS adaptativo.",
                    "Animação"),
                new EpgProgram(
                    "demo.bbb",
                    "Bastidores Blender Studio",
                    now.AddMinutes(30),
                    now.AddMinutes(90),
                    "Documentário técnico sobre renderização e distribuição adaptativa.",
                    "Documentário"),
            ],
            ["demo.bipbop"] =
            [
                new EpgProgram(
                    "demo.bipbop",
                    "Teste de Qualidade fMP4 / ABR",
                    now.AddMinutes(-15),
                    now.AddMinutes(60),
                    "Stream de referência para testar troca de faixa de bitrate.",
                    "Engenharia"),
            ],
        };

        var source = new PlaylistSource(
            Id: DemoSourceId,
            Name: "Lista Demo (Streams Públicos Legais)",
            Type: PlaylistSourceType.Demo,
            AddedAtUnixMs: nowMs,
            LastUpdatedAtUnixMs: nowMs,
            ChannelCount: channels.Count);

        return (source, channels, epg);
    }
}
