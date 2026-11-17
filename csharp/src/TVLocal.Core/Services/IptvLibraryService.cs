using System.Net;
using System.Text.Json;
using TVLocal.Core.Clients;
using TVLocal.Core.Models;
using TVLocal.Core.Parsers;

namespace TVLocal.Core.Services;

public sealed class IptvLibraryService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _storagePath;
    private readonly HttpClient _http;
    private readonly XtreamClient _xtream;
    private readonly SemaphoreSlim _ioLock = new(1, 1);
    private IptvStoreSnapshot _snapshot = new();

    public IptvLibraryService(string? storagePath = null, HttpClient? httpClient = null)
    {
        _storagePath = storagePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TVLocal",
            "library.json");
        _http = httpClient ?? new HttpClient(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
        });
        _xtream = new XtreamClient(_http);
    }

    public IReadOnlyList<PlaylistSource> Sources => _snapshot.Sources;
    public IReadOnlyList<Channel> Channels => _snapshot.Channels;
    public IReadOnlyList<string> Favorites => _snapshot.Favorites;
    public IReadOnlyList<string> Recents => _snapshot.Recents;
    public IReadOnlyDictionary<string, List<EpgProgram>> Epg => _snapshot.Epg;

    public async Task LoadAsync(CancellationToken ct = default)
    {
        if (!File.Exists(_storagePath)) return;
        await _ioLock.WaitAsync(ct);
        try
        {
            var loaded = await Task.Run(async () =>
            {
                await using var stream = File.OpenRead(_storagePath);
                return await JsonSerializer.DeserializeAsync<IptvStoreSnapshot>(stream, JsonOptions, ct);
            }, ct);

            if (loaded is not null)
            {
                _snapshot = loaded;
                _snapshot.Epg ??= new Dictionary<string, List<EpgProgram>>(StringComparer.OrdinalIgnoreCase);
            }
        }
        catch
        {
            _snapshot = new IptvStoreSnapshot();
        }
        finally
        {
            _ioLock.Release();
        }
    }

    public async Task SaveAsync(CancellationToken ct = default)
    {
        await _ioLock.WaitAsync(ct);
        try
        {
            await Task.Run(async () =>
            {
                var dir = Path.GetDirectoryName(_storagePath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                var tempPath = _storagePath + ".tmp";
                await using (var stream = File.Create(tempPath))
                {
                    await JsonSerializer.SerializeAsync(stream, _snapshot, JsonOptions, ct);
                }
                File.Move(tempPath, _storagePath, overwrite: true);
            }, ct);
        }
        finally
        {
            _ioLock.Release();
        }
    }

    public async Task<PlaylistSource> LoadDemoAsync(CancellationToken ct = default)
    {
        var (source, channels, epg) = DemoPlaylistProvider.Create();
        _snapshot.Sources.RemoveAll(s => s.Id == source.Id);
        _snapshot.Channels.RemoveAll(c => c.SourceId == source.Id);
        _snapshot.Sources.Insert(0, source);
        _snapshot.Channels.InsertRange(0, channels);
        MergeEpg(epg);
        await SaveAsync(ct);
        return source;
    }

    public async Task<PlaylistSource> AddM3uFromContentAsync(
        string name,
        string content,
        string? originUrl = null,
        CancellationToken ct = default)
    {
        var sourceId = $"m3u_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}";
        var parsed = M3uParser.Parse(content, sourceId);
        if (parsed.Channels.Count == 0)
        {
            throw new InvalidOperationException("Nenhum canal válido encontrado na lista M3U.");
        }

        var inferredXtream = XtreamClient.TryInferFromPlaylistUrl(originUrl);
        var epgUrl = !string.IsNullOrWhiteSpace(parsed.EpgUrl)
            ? parsed.EpgUrl
            : (inferredXtream is not null ? XtreamClient.BuildXmltvUrl(inferredXtream) : null);

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var source = new PlaylistSource(
            Id: sourceId,
            Name: string.IsNullOrWhiteSpace(name) ? "Lista M3U" : name.Trim(),
            Type: originUrl is not null ? PlaylistSourceType.M3uUrl : PlaylistSourceType.M3uFile,
            Url: originUrl,
            EpgUrl: epgUrl,
            Xtream: inferredXtream,
            AddedAtUnixMs: nowMs,
            LastUpdatedAtUnixMs: nowMs,
            ChannelCount: parsed.Channels.Count);

        _snapshot.Sources.Insert(0, source);
        _snapshot.Channels.InsertRange(0, parsed.Channels);

        if (!string.IsNullOrWhiteSpace(epgUrl))
        {
            try
            {
                await ImportEpgFromUrlAsync(epgUrl, ct);
            }
            catch
            {
                // Best-effort EPG load
            }
        }

        await SaveAsync(ct);
        return source;
    }

    public async Task<PlaylistSource> AddM3uFromUrlAsync(string name, string url, CancellationToken ct = default)
    {
        var content = await _http.GetStringAsync(url.Trim(), ct);
        return await AddM3uFromContentAsync(name, content, url.Trim(), ct);
    }

    public async Task<PlaylistSource> AddXtreamSourceAsync(
        string name,
        XtreamCredentials creds,
        CancellationToken ct = default)
    {
        var sourceId = $"xt_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}";
        var res = await _xtream.FetchAllContentAsync(creds, sourceId, ct);
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var source = new PlaylistSource(
            Id: sourceId,
            Name: string.IsNullOrWhiteSpace(name) ? res.Account.Username : name.Trim(),
            Type: PlaylistSourceType.Xtream,
            EpgUrl: res.EpgUrl,
            Xtream: creds,
            AddedAtUnixMs: nowMs,
            LastUpdatedAtUnixMs: nowMs,
            ChannelCount: res.Channels.Count);

        _snapshot.Sources.Insert(0, source);
        _snapshot.Channels.InsertRange(0, res.Channels);

        if (!string.IsNullOrWhiteSpace(res.EpgUrl))
        {
            try
            {
                using var epgCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                epgCts.CancelAfter(TimeSpan.FromSeconds(25));
                await ImportEpgFromUrlAsync(res.EpgUrl, epgCts.Token);
            }
            catch
            {
                // Fallback: on-demand short EPG per channel
            }
        }

        await SaveAsync(ct);
        return source;
    }

    public Task<SeriesDetails> GetSeriesInfoAsync(Channel seriesChannel, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(seriesChannel.SeriesId))
        {
            throw new InvalidOperationException("Canal não possui identificador de série.");
        }
        var source = _snapshot.Sources.FirstOrDefault(s => s.Id == seriesChannel.SourceId)
            ?? throw new InvalidOperationException("Fonte Xtream da série não encontrada.");
        if (source.Xtream is null)
        {
            throw new InvalidOperationException("Credenciais Xtream indisponíveis.");
        }
        return _xtream.FetchSeriesInfoAsync(source.Xtream, seriesChannel.SeriesId, ct);
    }

    public async Task<VodDetails?> TryGetVodInfoAsync(Channel vodChannel, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(vodChannel.StreamId)) return null;
        var source = _snapshot.Sources.FirstOrDefault(s => s.Id == vodChannel.SourceId);
        if (source?.Xtream is null) return null;
        try
        {
            return await _xtream.FetchVodInfoAsync(source.Xtream, vodChannel.StreamId, ct);
        }
        catch
        {
            return null;
        }
    }

    public async Task<int> ImportEpgFromUrlAsync(string epgUrl, CancellationToken ct = default)
    {
        var xml = await _http.GetStringAsync(epgUrl.Trim(), ct);
        return await ImportEpgFromXmlAsync(xml, ct);
    }

    public async Task<int> ImportEpgFromXmlAsync(string xmlContent, CancellationToken ct = default)
    {
        var parsed = XmltvParser.Parse(xmlContent);
        MergeEpg(parsed);
        await SaveAsync(ct);
        return parsed.Count;
    }

    public async Task<int> RefreshEpgFromSourcesAsync(CancellationToken ct = default)
    {
        var totalChannels = 0;
        foreach (var source in _snapshot.Sources.ToList())
        {
            var epgUrl = source.EpgUrl;
            if (string.IsNullOrWhiteSpace(epgUrl))
            {
                var creds = source.Xtream ?? XtreamClient.TryInferFromPlaylistUrl(source.Url);
                if (creds is not null)
                {
                    epgUrl = XtreamClient.BuildXmltvUrl(creds);
                }
            }

            if (string.IsNullOrWhiteSpace(epgUrl)) continue;

            try
            {
                totalChannels += await ImportEpgFromUrlAsync(epgUrl, ct);
            }
            catch
            {
                // Continue with next source or short EPG fallback
            }
        }
        return totalChannels;
    }

    public async Task<IReadOnlyList<EpgProgram>> FetchChannelEpgFromAccountAsync(
        Channel channel,
        CancellationToken ct = default)
    {
        if (channel.Kind != StreamKind.Live) return [];

        var source = _snapshot.Sources.FirstOrDefault(s => s.Id == channel.SourceId);
        var creds = source?.Xtream ?? XtreamClient.TryInferFromPlaylistUrl(source?.Url);
        var streamId = channel.StreamId;

        if (creds is null || string.IsNullOrWhiteSpace(streamId))
        {
            var inferred = XtreamClient.TryInferFromStreamUrl(channel.Url);
            if (inferred is not null)
            {
                creds ??= inferred.Value.Creds;
                streamId ??= inferred.Value.StreamId;
            }
        }

        if (creds is null || string.IsNullOrWhiteSpace(streamId))
        {
            return [];
        }

        var key = !string.IsNullOrWhiteSpace(channel.TvgId)
            ? channel.TvgId
            : (!string.IsNullOrWhiteSpace(channel.TvgName) ? channel.TvgName : channel.Name);

        var programs = await _xtream.FetchShortEpgAsync(creds, streamId, key, limit: 12, ct: ct);
        if (programs.Count > 0)
        {
            _snapshot.Epg[key] = programs;
            if (!key.Equals(channel.Name, StringComparison.OrdinalIgnoreCase))
            {
                _snapshot.Epg[channel.Name] = programs;
            }
            await SaveAsync(ct);
        }

        return programs;
    }

    public async Task RemoveSourceAsync(string sourceId, CancellationToken ct = default)
    {
        _snapshot.Sources.RemoveAll(s => s.Id == sourceId);
        _snapshot.Channels.RemoveAll(c => c.SourceId == sourceId);
        await SaveAsync(ct);
    }

    public async Task ToggleFavoriteAsync(string channelId, CancellationToken ct = default)
    {
        if (_snapshot.Favorites.Contains(channelId))
        {
            _snapshot.Favorites.Remove(channelId);
        }
        else
        {
            _snapshot.Favorites.Insert(0, channelId);
        }
        await SaveAsync(ct);
    }

    public async Task RecordRecentAsync(string channelId, CancellationToken ct = default)
    {
        _snapshot.Recents.Remove(channelId);
        _snapshot.Recents.Insert(0, channelId);
        if (_snapshot.Recents.Count > 30)
        {
            _snapshot.Recents.RemoveRange(30, _snapshot.Recents.Count - 30);
        }
        await SaveAsync(ct);
    }

    public async Task RemoveRecentAsync(string channelId, CancellationToken ct = default)
    {
        if (_snapshot.Recents.Remove(channelId))
        {
            await SaveAsync(ct);
        }
    }

    public async Task ClearRecentsAsync(CancellationToken ct = default)
    {
        if (_snapshot.Recents.Count > 0)
        {
            _snapshot.Recents.Clear();
            await SaveAsync(ct);
        }
    }

    public bool IsFavorite(string channelId) => _snapshot.Favorites.Contains(channelId);

    public bool IsRecent(string channelId) => _snapshot.Recents.Contains(channelId);

    public NowAndNextPrograms GetGuide(Channel channel) => XmltvParser.GetNowAndNext(_snapshot.Epg, channel);

    private void MergeEpg(Dictionary<string, List<EpgProgram>> incoming)
    {
        foreach (var (key, programs) in incoming)
        {
            _snapshot.Epg[key] = programs;
        }
    }
}
