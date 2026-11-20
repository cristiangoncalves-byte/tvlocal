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
    public void M3uParser_RejectsUnsafeSchemesAndSanitizesHeaders()
    {
        const string sample = "#EXTM3U url-tvg=\"javascript:alert(1)\"\n"
            + "#EXTINF:-1 tvg-logo=\"file:///etc/passwd\",Unsafe File\n"
            + "file:///C:/Windows/win.ini\n"
            + "#EXTINF:-1,Unsafe JS\n"
            + "javascript:alert(1)\n"
            + "#EXTINF:-1,Safe Stream\n"
            + "#EXTVLCOPT:http-user-agent=TVLocal\"Agent\t\0X\n"
            + "https://stream.example.com/live/safe.m3u8\n";

        var result = M3uParser.Parse(sample, "src_sec");
        Assert.Null(result.EpgUrl);
        Assert.Single(result.Channels);
        Assert.Equal("Safe Stream", result.Channels[0].Name);
        Assert.Equal("TVLocalAgentX", result.Channels[0].HttpUserAgent);
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

    [Fact]
    public async Task IptvLibraryService_PersistsAndResetsThemeSettings()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"tvlocal_theme_{Guid.NewGuid():N}.json");
        try
        {
            var lib1 = new IptvLibraryService(tempFile);
            Assert.Equal("#3B82F6", lib1.Theme.AccentHex);

            var customTheme = new AppThemeSettings("Esmeralda", "#07110E", "#0C1C17", "#122922", "#10B981");
            await lib1.UpdateThemeAsync(customTheme);

            var lib2 = new IptvLibraryService(tempFile);
            await lib2.LoadAsync();
            Assert.Equal("Esmeralda", lib2.Theme.PresetName);
            Assert.Equal("#10B981", lib2.Theme.AccentHex);

            await lib2.ResetThemeAsync();
            var lib3 = new IptvLibraryService(tempFile);
            await lib3.LoadAsync();
            Assert.Equal(AppThemeSettings.Default.AccentHex, lib3.Theme.AccentHex);
            Assert.Equal("Padrao", lib3.Theme.PresetName);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task IptvLibraryService_UpdatesSavedSourceNameAndPersists()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"tvlocal_edit_{Guid.NewGuid():N}.json");
        try
        {
            var lib = new IptvLibraryService(tempFile);
            const string m3u = """
                #EXTM3U
                #EXTINF:-1 group-title="Geral",Canal Teste
                https://example.com/live/1.m3u8
                """;
            var src = await lib.AddM3uFromContentAsync("Lista Original", m3u);
            var updated = await lib.UpdateSourceAsync(src.Id, "Lista Renomeada", reloadChannels: false);
            Assert.Equal("Lista Renomeada", updated.Name);

            var libReloaded = new IptvLibraryService(tempFile);
            await libReloaded.LoadAsync();
            Assert.Single(libReloaded.Sources);
            Assert.Equal("Lista Renomeada", libReloaded.Sources[0].Name);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task IptvLibraryService_EncryptsXtreamPasswordAtRestAndDecryptsOnLoad()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"tvlocal_sec_{Guid.NewGuid():N}.json");
        try
        {
            const string secretPassword = "SuperSecretPassword!123";
            var backupSnapshot = new IptvStoreSnapshot
            {
                Sources =
                [
                    new PlaylistSource(
                        Id: "xt_sec_1",
                        Name: "Xtream Seguro",
                        Type: PlaylistSourceType.Xtream,
                        Xtream: new XtreamCredentials("https://tv.example.com", "usuario", secretPassword)),
                ],
            };
            var json = JsonSerializer.Serialize(backupSnapshot);

            var lib1 = new IptvLibraryService(tempFile);
            await lib1.ImportBackupAsync(json);

            var rawSaved = await File.ReadAllTextAsync(tempFile);
            Assert.DoesNotContain(secretPassword, rawSaved, StringComparison.Ordinal);
            Assert.Contains("enc:v1:", rawSaved, StringComparison.Ordinal);

            var lib2 = new IptvLibraryService(tempFile);
            await lib2.LoadAsync();
            Assert.Single(lib2.Sources);
            Assert.Equal(secretPassword, lib2.Sources[0].Xtream?.Password);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    [Fact]
    public void FuzzySearchService_MatchesMisspelledTitlesAndCategories()
    {
        var sample = new List<Channel>
        {
            new("1", "Aventura Espacial HD", "https://example.com/1.mp4", "Filmes", StreamKind.Vod, "s1"),
            new("2", "Canal Arena Live", "https://example.com/2.m3u8", "Esportes", StreamKind.Live, "s1"),
            new("3", "Jornal Central", "https://example.com/3.m3u8", "Notícias", StreamKind.Live, "s1"),
            new("4", "Série Ação Extrema", "https://example.com/4.mp4", "Séries", StreamKind.Series, "s1"),
        };

        var res1 = FuzzySearchService.FilterChannels(sample, "aventra espcial");
        Assert.Single(res1.Items);
        Assert.Equal("1", res1.Items[0].Id);
        Assert.Contains("Aventura", res1.CorrectedQuery, StringComparison.OrdinalIgnoreCase);

        var res2 = FuzzySearchService.FilterChannels(sample, "jornl central");
        Assert.Single(res2.Items);
        Assert.Equal("3", res2.Items[0].Id);
        Assert.Contains("Jornal", res2.CorrectedQuery, StringComparison.OrdinalIgnoreCase);

        var resCat = FuzzySearchService.FilterChannels(sample, "esprote");
        Assert.Single(resCat.Items);
        Assert.Equal("2", resCat.Items[0].Id);
        Assert.Equal("Esportes", resCat.CorrectedQuery);

        var resAccent = FuzzySearchService.FilterChannels(sample, "acao");
        Assert.Single(resAccent.Items);
        Assert.Equal("4", resAccent.Items[0].Id);
        Assert.Null(resAccent.CorrectedQuery);
    }
}
