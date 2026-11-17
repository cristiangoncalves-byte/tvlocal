using System.Text;
using System.Text.Json;
using TVLocal.Core.Models;

namespace TVLocal.Core.Clients;

public sealed record XtreamContentResult(
    XtreamAccountInfo Account,
    IReadOnlyList<Channel> Channels,
    string EpgUrl);

public sealed class XtreamClient
{
    private readonly HttpClient _http;

    public XtreamClient(HttpClient? httpClient = null)
    {
        _http = httpClient ?? new HttpClient();
    }

    public static string NormalizeServerUrl(string serverUrl)
    {
        var trimmed = serverUrl.Trim().TrimEnd('/');
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }
        return $"http://{trimmed}";
    }

    public static string BuildXmltvUrl(XtreamCredentials creds)
    {
        var baseUrl = NormalizeServerUrl(creds.ServerUrl);
        return $"{baseUrl}/xmltv.php?username={Uri.EscapeDataString(creds.Username.Trim())}&password={Uri.EscapeDataString(creds.Password)}";
    }

    public static XtreamCredentials? TryInferFromPlaylistUrl(string? playlistUrl)
    {
        if (string.IsNullOrWhiteSpace(playlistUrl) || !Uri.TryCreate(playlistUrl.Trim(), UriKind.Absolute, out var uri))
        {
            return null;
        }

        var query = ParseQuery(uri.Query);
        if (!query.TryGetValue("username", out var user) || !query.TryGetValue("password", out var pass))
        {
            return null;
        }
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(pass))
        {
            return null;
        }

        var baseUrl = $"{uri.Scheme}://{uri.Authority}";
        return new XtreamCredentials(baseUrl, user, pass);
    }

    public static (XtreamCredentials Creds, string StreamId)? TryInferFromStreamUrl(string? streamUrl)
    {
        if (string.IsNullOrWhiteSpace(streamUrl) || !Uri.TryCreate(streamUrl.Trim(), UriKind.Absolute, out var uri))
        {
            return null;
        }

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 3) return null;

        int userIdx = 0;
        if (segments[0].Equals("live", StringComparison.OrdinalIgnoreCase) ||
            segments[0].Equals("movie", StringComparison.OrdinalIgnoreCase) ||
            segments[0].Equals("series", StringComparison.OrdinalIgnoreCase))
        {
            if (segments.Length < 4) return null;
            userIdx = 1;
        }

        var user = Uri.UnescapeDataString(segments[userIdx]);
        var pass = Uri.UnescapeDataString(segments[userIdx + 1]);
        var last = segments[userIdx + 2];
        var dot = last.IndexOf('.');
        var streamId = dot > 0 ? last[..dot] : last;

        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(pass) || !streamId.All(char.IsDigit))
        {
            return null;
        }

        var baseUrl = $"{uri.Scheme}://{uri.Authority}";
        return (new XtreamCredentials(baseUrl, user, pass), streamId);
    }

    public async Task<List<EpgProgram>> FetchShortEpgAsync(
        XtreamCredentials creds,
        string streamId,
        string channelKey,
        int limit = 12,
        CancellationToken ct = default)
    {
        var url = BuildApiUrl(creds, "get_short_epg", $"stream_id={Uri.EscapeDataString(streamId)}&limit={limit}");
        using var doc = await FetchJsonAsync(url, ct);
        return ParseShortEpgDocument(doc.RootElement, channelKey);
    }

    public static List<EpgProgram> ParseShortEpgDocument(JsonElement root, string channelKey)
    {
        var programs = new List<EpgProgram>();
        if (!root.TryGetProperty("epg_listings", out var listings) || listings.ValueKind != JsonValueKind.Array)
        {
            return programs;
        }

        foreach (var item in listings.EnumerateArray())
        {
            var rawTitle = GetString(item, "title");
            var title = DecodeBase64OrPlain(rawTitle);
            if (string.IsNullOrWhiteSpace(title)) continue;

            var start = ParseXtreamTimestamp(item, "start_timestamp", "start");
            var stop = ParseXtreamTimestamp(item, "stop_timestamp", "end")
                ?? ParseXtreamTimestamp(item, "stop_timestamp", "stop");

            if (start is null || stop is null) continue;

            var desc = DecodeBase64OrPlain(GetString(item, "description"));
            programs.Add(new EpgProgram(
                ChannelId: channelKey,
                Title: title,
                Start: start.Value,
                Stop: stop.Value,
                Description: string.IsNullOrWhiteSpace(desc) ? null : desc));
        }

        programs.Sort((a, b) => a.Start.CompareTo(b.Start));
        return programs;
    }

    private static DateTimeOffset? ParseXtreamTimestamp(JsonElement item, string tsProp, string textProp)
    {
        var tsRaw = GetString(item, tsProp);
        if (!string.IsNullOrWhiteSpace(tsRaw) && long.TryParse(tsRaw, out var unixSec) && unixSec > 0)
        {
            return DateTimeOffset.FromUnixTimeSeconds(unixSec);
        }

        var textRaw = GetString(item, textProp);
        if (!string.IsNullOrWhiteSpace(textRaw) && DateTimeOffset.TryParse(textRaw, out var dto))
        {
            return dto;
        }

        return null;
    }

    private static string? DecodeBase64OrPlain(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return raw;
        var trimmed = raw.Trim();
        if (trimmed.Length % 4 != 0 || trimmed.Contains(' '))
        {
            return trimmed;
        }

        try
        {
            var bytes = Convert.FromBase64String(trimmed);
            var decoded = Encoding.UTF8.GetString(bytes);
            if (decoded.Any(ch => char.IsControl(ch) && ch is not ('\r' or '\n' or '\t')))
            {
                return trimmed;
            }
            return decoded.Trim();
        }
        catch
        {
            return trimmed;
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0) continue;
            var k = Uri.UnescapeDataString(part[..eq]);
            var v = Uri.UnescapeDataString(part[(eq + 1)..]);
            dict[k] = v;
        }
        return dict;
    }

    private static string BuildApiUrl(XtreamCredentials creds, string? action = null, string? extraQuery = null)
    {
        var baseUrl = NormalizeServerUrl(creds.ServerUrl);
        var url = $"{baseUrl}/player_api.php?username={Uri.EscapeDataString(creds.Username.Trim())}&password={Uri.EscapeDataString(creds.Password)}";
        if (!string.IsNullOrEmpty(action))
        {
            url += $"&action={Uri.EscapeDataString(action)}";
        }
        if (!string.IsNullOrEmpty(extraQuery))
        {
            url += $"&{extraQuery}";
        }
        return url;
    }

    public async Task<XtreamAccountInfo> AuthenticateAsync(XtreamCredentials creds, CancellationToken ct = default)
    {
        using var doc = await FetchJsonAsync(BuildApiUrl(creds), ct);
        if (!doc.RootElement.TryGetProperty("user_info", out var userInfo) ||
            userInfo.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Falha na autenticação Xtream Codes.");
        }

        var auth = GetInt(userInfo, "auth");
        if (auth != 1)
        {
            throw new InvalidOperationException("Credenciais Xtream inválidas ou conta inativa.");
        }

        return new XtreamAccountInfo(
            Username: GetString(userInfo, "username") ?? creds.Username,
            Status: GetString(userInfo, "status") ?? "Active",
            ExpDate: GetString(userInfo, "exp_date"),
            IsTrial: GetString(userInfo, "is_trial") == "1",
            ActiveConnections: GetInt(userInfo, "active_cons"),
            MaxConnections: Math.Max(1, GetInt(userInfo, "max_connections")));
    }

    public async Task<XtreamContentResult> FetchAllContentAsync(
        XtreamCredentials creds,
        string sourceId,
        CancellationToken ct = default)
    {
        var account = await AuthenticateAsync(creds, ct);
        var baseUrl = NormalizeServerUrl(creds.ServerUrl);
        var u = Uri.EscapeDataString(creds.Username.Trim());
        var p = Uri.EscapeDataString(creds.Password);

        var liveCatsTask = TryFetchCategoryMapAsync(BuildApiUrl(creds, "get_live_categories"), ct);
        var liveStreamsTask = TryFetchArrayAsync(BuildApiUrl(creds, "get_live_streams"), ct);
        var vodCatsTask = TryFetchCategoryMapAsync(BuildApiUrl(creds, "get_vod_categories"), ct);
        var vodStreamsTask = TryFetchArrayAsync(BuildApiUrl(creds, "get_vod_streams"), ct);
        var seriesCatsTask = TryFetchCategoryMapAsync(BuildApiUrl(creds, "get_series_categories"), ct);
        var seriesListTask = TryFetchArrayAsync(BuildApiUrl(creds, "get_series"), ct);

        await Task.WhenAll(liveCatsTask, liveStreamsTask, vodCatsTask, vodStreamsTask, seriesCatsTask, seriesListTask);

        var liveCats = await liveCatsTask;
        var vodCats = await vodCatsTask;
        var seriesCats = await seriesCatsTask;

        var channels = new List<Channel>();

        foreach (var item in await liveStreamsTask)
        {
            var streamId = GetString(item, "stream_id");
            if (string.IsNullOrEmpty(streamId)) continue;
            var catId = GetString(item, "category_id") ?? string.Empty;
            channels.Add(new Channel(
                Id: $"{sourceId}_live_{streamId}",
                Name: GetString(item, "name") ?? $"Canal {streamId}",
                Url: $"{baseUrl}/live/{u}/{p}/{streamId}.m3u8",
                Group: liveCats.GetValueOrDefault(catId) ?? "TV ao Vivo",
                Kind: StreamKind.Live,
                SourceId: sourceId,
                Logo: GetString(item, "stream_icon"),
                TvgId: GetString(item, "epg_channel_id"),
                StreamId: streamId));
        }

        foreach (var item in await vodStreamsTask)
        {
            var streamId = GetString(item, "stream_id");
            if (string.IsNullOrEmpty(streamId)) continue;
            var ext = GetString(item, "container_extension") ?? "mp4";
            var catId = GetString(item, "category_id") ?? string.Empty;
            channels.Add(new Channel(
                Id: $"{sourceId}_vod_{streamId}",
                Name: GetString(item, "name") ?? $"Filme {streamId}",
                Url: $"{baseUrl}/movie/{u}/{p}/{streamId}.{ext}",
                Group: vodCats.GetValueOrDefault(catId) ?? "Filmes",
                Kind: StreamKind.Vod,
                SourceId: sourceId,
                Logo: GetString(item, "stream_icon"),
                StreamId: streamId,
                ContainerExtension: ext,
                Rating: GetString(item, "rating")));
        }

        foreach (var item in await seriesListTask)
        {
            var seriesId = GetString(item, "series_id");
            if (string.IsNullOrEmpty(seriesId)) continue;
            var catId = GetString(item, "category_id") ?? string.Empty;
            channels.Add(new Channel(
                Id: $"{sourceId}_series_{seriesId}",
                Name: GetString(item, "name") ?? $"Série {seriesId}",
                Url: string.Empty,
                Group: seriesCats.GetValueOrDefault(catId) ?? "Séries",
                Kind: StreamKind.Series,
                SourceId: sourceId,
                Logo: GetString(item, "cover"),
                SeriesId: seriesId,
                Rating: GetString(item, "rating"),
                Plot: GetString(item, "plot")));
        }

        return new XtreamContentResult(account, channels, BuildXmltvUrl(creds));
    }

    public async Task<SeriesDetails> FetchSeriesInfoAsync(
        XtreamCredentials creds,
        string seriesId,
        CancellationToken ct = default)
    {
        using var doc = await FetchJsonAsync(
            BuildApiUrl(creds, "get_series_info", $"series_id={Uri.EscapeDataString(seriesId)}"),
            ct);

        var baseUrl = NormalizeServerUrl(creds.ServerUrl);
        var u = Uri.EscapeDataString(creds.Username.Trim());
        var p = Uri.EscapeDataString(creds.Password);

        var root = doc.RootElement;
        string? name = null;
        string? cover = null;
        string? plot = null;

        if (root.TryGetProperty("info", out var info) && info.ValueKind == JsonValueKind.Object)
        {
            name = GetString(info, "name");
            cover = GetString(info, "cover");
            plot = GetString(info, "plot");
        }

        var seasons = new Dictionary<int, IReadOnlyList<SeriesEpisode>>();
        if (root.TryGetProperty("episodes", out var episodesEl) && episodesEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in episodesEl.EnumerateObject())
            {
                if (!int.TryParse(prop.Name, out var seasonNum)) seasonNum = 1;
                if (prop.Value.ValueKind != JsonValueKind.Array) continue;

                var epList = new List<SeriesEpisode>();
                foreach (var ep in prop.Value.EnumerateArray())
                {
                    var id = GetString(ep, "id") ?? string.Empty;
                    var ext = GetString(ep, "container_extension") ?? "mp4";
                    var epNum = GetInt(ep, "episode_num", 1);
                    string? epDuration = null;
                    string? epPlot = null;
                    string? epCover = null;
                    if (ep.TryGetProperty("info", out var epInfo) && epInfo.ValueKind == JsonValueKind.Object)
                    {
                        epDuration = GetString(epInfo, "duration");
                        epPlot = GetString(epInfo, "plot");
                        epCover = GetString(epInfo, "movie_image");
                    }

                    epList.Add(new SeriesEpisode(
                        Id: id,
                        EpisodeNumber: epNum,
                        SeasonNumber: seasonNum,
                        Title: GetString(ep, "title") ?? $"Episódio {epNum}",
                        Url: $"{baseUrl}/series/{u}/{p}/{id}.{ext}",
                        ContainerExtension: ext,
                        Duration: epDuration,
                        Plot: epPlot,
                        Cover: epCover));
                }

                seasons[seasonNum] = epList;
            }
        }

        return new SeriesDetails(seriesId, name ?? $"Série {seriesId}", cover, plot, seasons);
    }

    public async Task<VodDetails?> FetchVodInfoAsync(
        XtreamCredentials creds,
        string vodId,
        CancellationToken ct = default)
    {
        using var doc = await FetchJsonAsync(
            BuildApiUrl(creds, "get_vod_info", $"vod_id={Uri.EscapeDataString(vodId)}"),
            ct);

        var root = doc.RootElement;
        if (!root.TryGetProperty("info", out var info) || info.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? title = null;
        string? ext = null;
        if (root.TryGetProperty("movie_data", out var movieData) && movieData.ValueKind == JsonValueKind.Object)
        {
            title = GetString(movieData, "name");
            ext = GetString(movieData, "container_extension");
        }

        string? backdrop = null;
        if (info.TryGetProperty("backdrop_path", out var bp))
        {
            if (bp.ValueKind == JsonValueKind.Array && bp.GetArrayLength() > 0)
            {
                backdrop = bp[0].GetString();
            }
            else if (bp.ValueKind == JsonValueKind.String)
            {
                backdrop = bp.GetString();
            }
        }

        return new VodDetails(
            Title: title ?? GetString(info, "name") ?? string.Empty,
            Cover: GetString(info, "movie_image") ?? GetString(info, "cover_big"),
            Backdrop: backdrop,
            Plot: GetString(info, "plot") ?? GetString(info, "description"),
            Genre: GetString(info, "genre"),
            Cast: GetString(info, "cast") ?? GetString(info, "actors"),
            Director: GetString(info, "director"),
            ReleaseDate: GetString(info, "releasedate") ?? GetString(info, "release_date"),
            Duration: GetString(info, "duration"),
            Rating: GetString(info, "rating"),
            ContainerExtension: ext);
    }

    private async Task<JsonDocument> FetchJsonAsync(string url, CancellationToken ct)
    {
        using var response = await _http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    private async Task<Dictionary<string, string>> TryFetchCategoryMapAsync(string url, CancellationToken ct)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var el in await TryFetchArrayAsync(url, ct))
        {
            var id = GetString(el, "category_id");
            var name = GetString(el, "category_name");
            if (!string.IsNullOrEmpty(id))
            {
                map[id] = string.IsNullOrWhiteSpace(name) ? "Sem Categoria" : name;
            }
        }
        return map;
    }

    private async Task<List<JsonElement>> TryFetchArrayAsync(string url, CancellationToken ct)
    {
        try
        {
            using var doc = await FetchJsonAsync(url, ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            return doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static string? GetString(JsonElement el, string propName)
    {
        if (!el.TryGetProperty(propName, out var val)) return null;
        return val.ValueKind switch
        {
            JsonValueKind.String => val.GetString(),
            JsonValueKind.Number => val.GetRawText(),
            _ => null,
        };
    }

    private static int GetInt(JsonElement el, string propName, int fallback = 0)
    {
        if (!el.TryGetProperty(propName, out var val)) return fallback;
        if (val.ValueKind == JsonValueKind.Number && val.TryGetInt32(out var n)) return n;
        if (val.ValueKind == JsonValueKind.String && int.TryParse(val.GetString(), out var parsed)) return parsed;
        return fallback;
    }
}
