namespace TVLocal.Core.Models;

public enum StreamKind
{
    Live,
    Vod,
    Series,
}

public enum PlaylistSourceType
{
    M3uUrl,
    M3uFile,
    Xtream,
    Demo,
}

public sealed record XtreamCredentials(
    string ServerUrl,
    string Username,
    string Password);

public sealed record PlaylistSource(
    string Id,
    string Name,
    PlaylistSourceType Type,
    string? Url = null,
    string? EpgUrl = null,
    XtreamCredentials? Xtream = null,
    long AddedAtUnixMs = 0,
    long? LastUpdatedAtUnixMs = null,
    int ChannelCount = 0);

public sealed record Channel(
    string Id,
    string Name,
    string Url,
    string Group,
    StreamKind Kind,
    string SourceId,
    string? Logo = null,
    string? TvgId = null,
    string? TvgName = null,
    string? StreamId = null,
    string? SeriesId = null,
    string? ContainerExtension = null,
    string? Rating = null,
    string? Plot = null,
    string? HttpUserAgent = null,
    string? HttpReferrer = null);

public sealed record EpgProgram(
    string ChannelId,
    string Title,
    DateTimeOffset Start,
    DateTimeOffset Stop,
    string? Description = null,
    string? Category = null);

public sealed record NowAndNextPrograms(
    EpgProgram? Current,
    EpgProgram? Next,
    IReadOnlyList<EpgProgram> Upcoming);

public sealed record SeriesEpisode(
    string Id,
    int EpisodeNumber,
    int SeasonNumber,
    string Title,
    string Url,
    string ContainerExtension,
    string? Duration = null,
    string? Plot = null,
    string? Cover = null);

public sealed record SeriesDetails(
    string SeriesId,
    string Name,
    string? Cover,
    string? Plot,
    IReadOnlyDictionary<int, IReadOnlyList<SeriesEpisode>> Seasons);

public sealed record VodDetails(
    string Title,
    string? Cover,
    string? Backdrop,
    string? Plot,
    string? Genre,
    string? Cast,
    string? Director,
    string? ReleaseDate,
    string? Duration,
    string? Rating,
    string? ContainerExtension);

public sealed record XtreamAccountInfo(
    string Username,
    string Status,
    string? ExpDate,
    bool IsTrial,
    int ActiveConnections,
    int MaxConnections);

public sealed class IptvStoreSnapshot
{
    public List<PlaylistSource> Sources { get; set; } = [];
    public List<Channel> Channels { get; set; } = [];
    public List<string> Favorites { get; set; } = [];
    public List<string> Recents { get; set; } = [];
    public Dictionary<string, List<EpgProgram>> Epg { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
