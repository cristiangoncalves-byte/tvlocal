using System.Text;
using System.Text.Json;
using TVLocal.Core.Clients;
using TVLocal.Core.Models;
using TVLocal.Core.Parsers;
using TVLocal.Core.Services;

namespace TVLocal.Core.Tests;

public class CoreTests
{
    [Fact]
    public void M3uParser_ParsesHeaderAttributesExtGrpAndVlcOpt()
    {
        const string sample = """
            #EXTM3U url-tvg="https://example.com/epg.xml"
            #EXTINF:-1 tvg-id="canal1.br" tvg-name="Canal Um" tvg-logo="https://example.com/1.png" group-title="Notícias",Canal Um HD
            #EXTVLCOPT:http-user-agent=TVLocalCSharp/1.0
            https://stream.example.com/live/canal1.m3u8

            #EXTINF:-1 tvg-id="filme1" group-title="Filmes",Aventura Espacial (2025)
            https://stream.example.com/movies/aventura.mp4

            #EXTINF:-1,Canal Sem Grupo
            #EXTGRP:Esportes
            https://stream.example.com/live/esporte.m3u8
            """;

        var result = M3uParser.Parse(sample, "src1");
        Assert.Equal("https://example.com/epg.xml", result.EpgUrl);
        Assert.Equal(3, result.Channels.Count);

        Assert.Equal("Canal Um HD", result.Channels[0].Name);
        Assert.Equal("Notícias", result.Channels[0].Group);
        Assert.Equal("canal1.br", result.Channels[0].TvgId);
        Assert.Equal(StreamKind.Live, result.Channels[0].Kind);
        Assert.Equal("TVLocalCSharp/1.0", result.Channels[0].HttpUserAgent);

        Assert.Equal(StreamKind.Vod, result.Channels[1].Kind);
        Assert.Equal("Esportes", result.Channels[2].Group);
    }

    [Fact]
    public void XmltvParser_ParsesDatesAndFindsNowAndNext()
    {
        var start = XmltvParser.ParseXmltvDate("20261116220000 -0300");
        var stop = XmltvParser.ParseXmltvDate("20261116230000 -0300");
        Assert.NotNull(start);
        Assert.NotNull(stop);
        Assert.Equal(TimeSpan.FromHours(1), stop.Value - start.Value);

        const string xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tv>
              <programme start="20261116220000 -0300" stop="20261116230000 -0300" channel="canal1.br">
                <title>Jornal da Noite &amp; Debate</title>
                <desc>Resumo das notícias.</desc>
                <category>Jornalismo</category>
              </programme>
              <programme start="20261116230000 -0300" stop="20261117000000 -0300" channel="canal1.br">
                <title>Documentário Especial</title>
              </programme>
            </tv>
            """;

        var epg = XmltvParser.Parse(xml);
        Assert.Equal(2, epg["canal1.br"].Count);
        Assert.Equal("Jornal da Noite & Debate", epg["canal1.br"][0].Title);

        var channel = new Channel("c1", "Canal 1", "https://example.com/1.m3u8", "Geral", StreamKind.Live, "src1", TvgId: "canal1.br");
        var guide = XmltvParser.GetNowAndNext(epg, channel, start.Value.AddMinutes(15));
        Assert.Equal("Jornal da Noite & Debate", guide.Current?.Title);
        Assert.Equal("Documentário Especial", guide.Next?.Title);
    }

    [Fact]
    public void XtreamAndDemo_HelpersWorkCorrectly()
    {
        Assert.Equal("http://iptv.example.com:8080", XtreamClient.NormalizeServerUrl("iptv.example.com:8080/"));
        Assert.Equal(
            "https://tv.local/xmltv.php?username=u1&password=p1",
            XtreamClient.BuildXmltvUrl(new XtreamCredentials("https://tv.local/", "u1", "p1")));

        var (source, channels, epg) = DemoPlaylistProvider.Create();
        Assert.Equal(PlaylistSourceType.Demo, source.Type);
        Assert.True(channels.Count >= 3);
        Assert.True(epg.ContainsKey("demo.bbb"));
    }

    [Fact]
    public async Task IptvLibraryService_ManagesRecentsRemovalAndClear()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"tvlocal_test_{Guid.NewGuid():N}.json");
        try
        {
            var lib = new IptvLibraryService(tempFile);
            await lib.RecordRecentAsync("c1");
            await lib.RecordRecentAsync("c2");
            Assert.Equal(["c2", "c1"], lib.Recents);

            await lib.RemoveRecentAsync("c2");
            Assert.Equal(["c1"], lib.Recents);
            Assert.False(lib.IsRecent("c2"));

            await lib.ClearRecentsAsync();
            Assert.Empty(lib.Recents);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    [Fact]
    public void XtreamClient_InfersCredentialsAndParsesShortEpg()
    {
        var fromPlaylist = XtreamClient.TryInferFromPlaylistUrl("http://tv.local:8080/get.php?username=cristian&password=123&type=m3u_plus");
        Assert.NotNull(fromPlaylist);
        Assert.Equal("http://tv.local:8080", fromPlaylist.ServerUrl);
        Assert.Equal("cristian", fromPlaylist.Username);
        Assert.Equal("123", fromPlaylist.Password);

        var fromStream = XtreamClient.TryInferFromStreamUrl("http://tv.local:8080/live/cristian/123/98765.m3u8");
        Assert.NotNull(fromStream);
        Assert.Equal("98765", fromStream.Value.StreamId);
        Assert.Equal("cristian", fromStream.Value.Creds.Username);

        var titleB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("NBA: Lakers vs Warriors"));
        var descB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("Jogo ao vivo da temporada regular."));
        var json = $$"""
            {
              "epg_listings": [
                {
                  "title": "{{titleB64}}",
                  "description": "{{descB64}}",
                  "start_timestamp": "1794877200",
                  "stop_timestamp": "1794884400"
                }
              ]
            }
            """;

        using var doc = JsonDocument.Parse(json);
        var progs = XtreamClient.ParseShortEpgDocument(doc.RootElement, "nba.pass");
        Assert.Single(progs);
        Assert.Equal("NBA: Lakers vs Warriors", progs[0].Title);
        Assert.Equal("Jogo ao vivo da temporada regular.", progs[0].Description);
    }
}
