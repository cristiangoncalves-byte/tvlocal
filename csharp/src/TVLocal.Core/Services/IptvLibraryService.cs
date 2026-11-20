using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TVLocal.Core.Clients;
using TVLocal.Core.Models;
using TVLocal.Core.Parsers;

namespace TVLocal.Core.Services;

public sealed class IptvLibraryService
{
    private const string EncryptedPrefix = "enc:v1:";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _storagePath;
    private readonly string _keyPath;
    private readonly HttpClient _http;
    private readonly XtreamClient _xtream;
    private readonly SemaphoreSlim _ioLock = new(1, 1);
    private IptvStoreSnapshot _snapshot = new();

    public IptvLibraryService(string? storagePath = null, HttpClient? httpClient = null)
    {
        var appDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TVLocal");
        _storagePath = storagePath ?? Path.Combine(appDataDir, "library.json");
        _keyPath = Path.Combine(appDataDir, ".tvlocal.key");
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
    public AppThemeSettings Theme => _snapshot.Theme ?? AppThemeSettings.Default;

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
                _snapshot.Theme ??= AppThemeSettings.Default;
                DecryptSourcesInPlace(_snapshot.Sources);
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

                var snapshotToPersist = new IptvStoreSnapshot
                {
                    Sources = _snapshot.Sources
                        .Select(s => s.Xtream is null
                            ? s
                            : s with { Xtream = s.Xtream with { Password = EncryptSecret(s.Xtream.Password) } })
                        .ToList(),
                    Channels = _snapshot.Channels,
                    Favorites = _snapshot.Favorites,
                    Recents = _snapshot.Recents,
                    Epg = _snapshot.Epg,
                    Theme = _snapshot.Theme,
                };

                var tempPath = _storagePath + ".tmp";
                await using (var stream = File.Create(tempPath))
                {
                    await JsonSerializer.SerializeAsync(stream, snapshotToPersist, JsonOptions, ct);
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

    public async Task<PlaylistSource> RefreshSourceAsync(string sourceId, CancellationToken ct = default)
    {
        var source = _snapshot.Sources.FirstOrDefault(s => s.Id == sourceId)
            ?? throw new InvalidOperationException("Fonte não encontrada.");

        if (source.Type == PlaylistSourceType.Demo)
        {
            return await LoadDemoAsync(ct);
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (source.Type == PlaylistSourceType.M3uUrl && !string.IsNullOrWhiteSpace(source.Url))
        {
            var content = await _http.GetStringAsync(source.Url, ct);
            var parsed = M3uParser.Parse(content, source.Id);
            if (parsed.Channels.Count == 0)
            {
                throw new InvalidOperationException("Nenhum canal encontrado ao atualizar a lista M3U.");
            }

            _snapshot.Channels.RemoveAll(c => c.SourceId == source.Id);
            _snapshot.Channels.InsertRange(0, parsed.Channels);

            var updated = source with
            {
                EpgUrl = parsed.EpgUrl ?? source.EpgUrl,
                LastUpdatedAtUnixMs = nowMs,
                ChannelCount = parsed.Channels.Count,
            };
            var idx = _snapshot.Sources.FindIndex(s => s.Id == source.Id);
            if (idx >= 0) _snapshot.Sources[idx] = updated;
            await SaveAsync(ct);
            return updated;
        }

        if (source.Type == PlaylistSourceType.Xtream && source.Xtream is not null)
        {
            var res = await _xtream.FetchAllContentAsync(source.Xtream, source.Id, ct);
            _snapshot.Channels.RemoveAll(c => c.SourceId == source.Id);
            _snapshot.Channels.InsertRange(0, res.Channels);

            var updated = source with
            {
                EpgUrl = res.EpgUrl,
                LastUpdatedAtUnixMs = nowMs,
                ChannelCount = res.Channels.Count,
            };
            var idx = _snapshot.Sources.FindIndex(s => s.Id == source.Id);
            if (idx >= 0) _snapshot.Sources[idx] = updated;
            await SaveAsync(ct);
            return updated;
        }

        return source;
    }

    public async Task<PlaylistSource> UpdateSourceAsync(
        string sourceId,
        string newName,
        string? newUrl = null,
        XtreamCredentials? newXtream = null,
        bool reloadChannels = true,
        CancellationToken ct = default)
    {
        var idx = _snapshot.Sources.FindIndex(s => s.Id == sourceId);
        if (idx < 0)
        {
            throw new InvalidOperationException("Conta/lista não encontrada.");
        }

        var existing = _snapshot.Sources[idx];
        var cleanName = string.IsNullOrWhiteSpace(newName) ? existing.Name : newName.Trim();
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (existing.Type == PlaylistSourceType.Xtream && newXtream is not null)
        {
            var credsChanged = existing.Xtream != newXtream;
            if (reloadChannels || credsChanged)
            {
                var res = await _xtream.FetchAllContentAsync(newXtream, existing.Id, ct);
                _snapshot.Channels.RemoveAll(c => c.SourceId == existing.Id);
                _snapshot.Channels.InsertRange(0, res.Channels);

                var updated = existing with
                {
                    Name = cleanName,
                    Xtream = newXtream,
                    EpgUrl = res.EpgUrl,
                    LastUpdatedAtUnixMs = nowMs,
                    ChannelCount = res.Channels.Count,
                };
                _snapshot.Sources[idx] = updated;
                await SaveAsync(ct);
                return updated;
            }

            var metaOnly = existing with { Name = cleanName, Xtream = newXtream };
            _snapshot.Sources[idx] = metaOnly;
            await SaveAsync(ct);
            return metaOnly;
        }

        if (existing.Type == PlaylistSourceType.M3uUrl && !string.IsNullOrWhiteSpace(newUrl))
        {
            var trimmedUrl = newUrl.Trim();
            var urlChanged = !string.Equals(existing.Url, trimmedUrl, StringComparison.Ordinal);
            if (reloadChannels || urlChanged)
            {
                var content = await _http.GetStringAsync(trimmedUrl, ct);
                var parsed = M3uParser.Parse(content, existing.Id);
                if (parsed.Channels.Count == 0)
                {
                    throw new InvalidOperationException("Nenhum canal válido encontrado na URL M3U informada.");
                }

                _snapshot.Channels.RemoveAll(c => c.SourceId == existing.Id);
                _snapshot.Channels.InsertRange(0, parsed.Channels);

                var inferredXtream = XtreamClient.TryInferFromPlaylistUrl(trimmedUrl);
                var epgUrl = !string.IsNullOrWhiteSpace(parsed.EpgUrl)
                    ? parsed.EpgUrl
                    : (inferredXtream is not null ? XtreamClient.BuildXmltvUrl(inferredXtream) : existing.EpgUrl);

                var updated = existing with
                {
                    Name = cleanName,
                    Url = trimmedUrl,
                    EpgUrl = epgUrl,
                    Xtream = inferredXtream ?? existing.Xtream,
                    LastUpdatedAtUnixMs = nowMs,
                    ChannelCount = parsed.Channels.Count,
                };
                _snapshot.Sources[idx] = updated;
                await SaveAsync(ct);
                return updated;
            }

            var metaOnly = existing with { Name = cleanName, Url = trimmedUrl };
            _snapshot.Sources[idx] = metaOnly;
            await SaveAsync(ct);
            return metaOnly;
        }

        var renamed = existing with { Name = cleanName };
        _snapshot.Sources[idx] = renamed;
        await SaveAsync(ct);
        return renamed;
    }

    public async Task UpdateThemeAsync(AppThemeSettings theme, CancellationToken ct = default)
    {
        _snapshot.Theme = theme;
        await SaveAsync(ct);
    }

    public Task ResetThemeAsync(CancellationToken ct = default) =>
        UpdateThemeAsync(AppThemeSettings.Default, ct);

    public string ExportBackupJson()
    {
        return JsonSerializer.Serialize(_snapshot, new JsonSerializerOptions { WriteIndented = true });
    }

    public async Task ImportBackupAsync(string json, CancellationToken ct = default)
    {
        var loaded = JsonSerializer.Deserialize<IptvStoreSnapshot>(json, JsonOptions)
            ?? throw new InvalidOperationException("Arquivo de backup inválido.");
        loaded.Epg ??= new Dictionary<string, List<EpgProgram>>(StringComparer.OrdinalIgnoreCase);
        loaded.Theme ??= AppThemeSettings.Default;
        DecryptSourcesInPlace(loaded.Sources);
        _snapshot = loaded;
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

    private byte[] GetOrCreateEncryptionKey()
    {
        if (File.Exists(_keyPath))
        {
            var existing = File.ReadAllBytes(_keyPath);
            if (existing.Length == 32)
            {
                return existing;
            }
        }

        var dir = Path.GetDirectoryName(_keyPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var key = RandomNumberGenerator.GetBytes(32);
        File.WriteAllBytes(_keyPath, key);
        return key;
    }

    private string EncryptSecret(string? plain)
    {
        if (string.IsNullOrEmpty(plain) || plain.StartsWith(EncryptedPrefix, StringComparison.Ordinal))
        {
            return plain ?? string.Empty;
        }

        var key = GetOrCreateEncryptionKey();
        var plainBytes = Encoding.UTF8.GetBytes(plain);

        if (AesGcm.IsSupported)
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var tag = new byte[16];
            var cipher = new byte[plainBytes.Length];
            using var aesGcm = new AesGcm(key, tag.Length);
            aesGcm.Encrypt(nonce, plainBytes, cipher, tag);

            var payload = new byte[nonce.Length + tag.Length + cipher.Length];
            Buffer.BlockCopy(nonce, 0, payload, 0, nonce.Length);
            Buffer.BlockCopy(tag, 0, payload, nonce.Length, tag.Length);
            Buffer.BlockCopy(cipher, 0, payload, nonce.Length + tag.Length, cipher.Length);
            return EncryptedPrefix + Convert.ToBase64String(payload);
        }

        using var aes = Aes.Create();
        aes.Key = key;
        aes.GenerateIV();
        using var encryptor = aes.CreateEncryptor();
        var encrypted = encryptor.TransformFinalBlock(plainBytes, 0, plainBytes.Length);
        var cbcPayload = new byte[aes.IV.Length + encrypted.Length];
        Buffer.BlockCopy(aes.IV, 0, cbcPayload, 0, aes.IV.Length);
        Buffer.BlockCopy(encrypted, 0, cbcPayload, aes.IV.Length, encrypted.Length);
        return EncryptedPrefix + Convert.ToBase64String(cbcPayload);
    }

    private string DecryptSecret(string? stored)
    {
        if (string.IsNullOrEmpty(stored))
        {
            return string.Empty;
        }
        if (!stored.StartsWith(EncryptedPrefix, StringComparison.Ordinal))
        {
            return stored;
        }

        try
        {
            if (!File.Exists(_keyPath))
            {
                return string.Empty;
            }
            var key = File.ReadAllBytes(_keyPath);
            if (key.Length != 32)
            {
                return string.Empty;
            }

            var payload = Convert.FromBase64String(stored[EncryptedPrefix.Length..]);
            if (AesGcm.IsSupported && payload.Length >= 28)
            {
                var nonce = payload.AsSpan(0, 12);
                var tag = payload.AsSpan(12, 16);
                var cipher = payload.AsSpan(28);
                var plain = new byte[cipher.Length];
                using var aesGcm = new AesGcm(key, 16);
                aesGcm.Decrypt(nonce, cipher, tag, plain);
                return Encoding.UTF8.GetString(plain);
            }

            if (!AesGcm.IsSupported && payload.Length >= 16)
            {
                using var aes = Aes.Create();
                aes.Key = key;
                aes.IV = payload[..16];
                using var decryptor = aes.CreateDecryptor();
                var plain = decryptor.TransformFinalBlock(payload, 16, payload.Length - 16);
                return Encoding.UTF8.GetString(plain);
            }
        }
        catch
        {
            // Return empty secret if key or ciphertext is invalid
        }

        return string.Empty;
    }

    private void DecryptSourcesInPlace(List<PlaylistSource> sources)
    {
        for (var i = 0; i < sources.Count; i++)
        {
            var src = sources[i];
            if (src.Xtream is not null)
            {
                sources[i] = src with
                {
                    Xtream = src.Xtream with { Password = DecryptSecret(src.Xtream.Password) },
                };
            }
        }
    }
}
