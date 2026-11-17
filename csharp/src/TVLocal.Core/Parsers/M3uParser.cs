using System.Text.RegularExpressions;
using TVLocal.Core.Models;

namespace TVLocal.Core.Parsers;

public sealed record ParsedM3uResult(IReadOnlyList<Channel> Channels, string? EpgUrl);

public static partial class M3uParser
{
    private static readonly string[] VodExtensions = [".mp4", ".mkv", ".avi", ".mov", ".webm"];

    [GeneratedRegex(@"([a-zA-Z0-9_-]+)=(?:""([^""]*)""|'([^']*)'|([^\s,]*))", RegexOptions.Compiled)]
    private static partial Regex AttributeRegex();

    [GeneratedRegex(@"^[a-zA-Z][a-zA-Z0-9+.-]*://", RegexOptions.Compiled)]
    private static partial Regex UrlSchemeRegex();

    public static ParsedM3uResult Parse(string content, string sourceId)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return new ParsedM3uResult([], null);
        }

        var lines = content.TrimStart('\uFEFF').Split(["\r\n", "\n"], StringSplitOptions.None);
        var channels = new List<Channel>();
        string? epgUrl = null;

        Dictionary<string, string> pendingAttrs = new(StringComparer.OrdinalIgnoreCase);
        var pendingName = string.Empty;
        var pendingGroup = string.Empty;
        string? pendingUserAgent = null;
        string? pendingReferrer = null;
        var hasExtInf = false;

        void ResetPending()
        {
            pendingAttrs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            pendingName = string.Empty;
            pendingGroup = string.Empty;
            pendingUserAgent = null;
            pendingReferrer = null;
            hasExtInf = false;
        }

        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();
            if (string.IsNullOrEmpty(line)) continue;

            if (line.StartsWith("#EXTM3U", StringComparison.OrdinalIgnoreCase))
            {
                var headerAttrs = ParseAttributes(line);
                epgUrl = headerAttrs.GetValueOrDefault("url-tvg")
                    ?? headerAttrs.GetValueOrDefault("x-tvg-url")
                    ?? headerAttrs.GetValueOrDefault("tvg-url");
                continue;
            }

            if (line.StartsWith("#EXTINF:", StringComparison.OrdinalIgnoreCase))
            {
                pendingAttrs = ParseAttributes(line);
                var display = ExtractDisplayName(line);
                pendingName = !string.IsNullOrWhiteSpace(display)
                    ? display
                    : pendingAttrs.GetValueOrDefault("tvg-name") ?? "Canal sem nome";
                pendingGroup = pendingAttrs.GetValueOrDefault("group-title") ?? string.Empty;
                hasExtInf = true;
                continue;
            }

            if (line.StartsWith("#EXTGRP:", StringComparison.OrdinalIgnoreCase))
            {
                var grp = line["#EXTGRP:".Length..].Trim();
                if (!string.IsNullOrEmpty(grp))
                {
                    pendingGroup = grp;
                }
                continue;
            }

            if (line.StartsWith("#EXTVLCOPT:", StringComparison.OrdinalIgnoreCase))
            {
                var opt = line["#EXTVLCOPT:".Length..].Trim();
                if (opt.StartsWith("http-user-agent=", StringComparison.OrdinalIgnoreCase))
                {
                    pendingUserAgent = opt["http-user-agent=".Length..].Trim();
                }
                else if (opt.StartsWith("http-referrer=", StringComparison.OrdinalIgnoreCase))
                {
                    pendingReferrer = opt["http-referrer=".Length..].Trim();
                }
                continue;
            }

            if (line.StartsWith('#'))
            {
                continue;
            }

            if (UrlSchemeRegex().IsMatch(line) || hasExtInf)
            {
                var group = !string.IsNullOrWhiteSpace(pendingGroup)
                    ? pendingGroup
                    : pendingAttrs.GetValueOrDefault("group-title") ?? "Sem Categoria";
                var name = !string.IsNullOrWhiteSpace(pendingName)
                    ? pendingName
                    : $"Canal {channels.Count + 1}";

                channels.Add(new Channel(
                    Id: $"{sourceId}_{ComputeHash($"{line}|{name}|{channels.Count}")}",
                    Name: name,
                    Url: line,
                    Group: group,
                    Kind: InferKind(line, group, pendingAttrs),
                    SourceId: sourceId,
                    Logo: pendingAttrs.GetValueOrDefault("tvg-logo") ?? pendingAttrs.GetValueOrDefault("logo"),
                    TvgId: pendingAttrs.GetValueOrDefault("tvg-id"),
                    TvgName: pendingAttrs.GetValueOrDefault("tvg-name"),
                    HttpUserAgent: pendingUserAgent,
                    HttpReferrer: pendingReferrer));

                ResetPending();
            }
        }

        return new ParsedM3uResult(channels, epgUrl);
    }

    private static Dictionary<string, string> ParseAttributes(string header)
    {
        var attrs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in AttributeRegex().Matches(header))
        {
            var key = match.Groups[1].Value.Trim();
            var value = (match.Groups[2].Success ? match.Groups[2].Value
                : match.Groups[3].Success ? match.Groups[3].Value
                : match.Groups[4].Value).Trim();
            if (!string.IsNullOrEmpty(value))
            {
                attrs[key] = value;
            }
        }
        return attrs;
    }

    private static string ExtractDisplayName(string extInfLine)
    {
        var inQuotes = false;
        var quoteChar = '\0';
        var lastComma = -1;

        for (var i = 0; i < extInfLine.Length; i++)
        {
            var ch = extInfLine[i];
            if ((ch == '"' || ch == '\'') && (i == 0 || extInfLine[i - 1] != '\\'))
            {
                if (!inQuotes)
                {
                    inQuotes = true;
                    quoteChar = ch;
                }
                else if (quoteChar == ch)
                {
                    inQuotes = false;
                    quoteChar = '\0';
                }
            }
            else if (ch == ',' && !inQuotes)
            {
                lastComma = i;
            }
        }

        return lastComma == -1 ? string.Empty : extInfLine[(lastComma + 1)..].Trim();
    }

    private static StreamKind InferKind(string url, string group, Dictionary<string, string> attrs)
    {
        if (attrs.TryGetValue("type", out var explicitType))
        {
            if (explicitType.Equals("vod", StringComparison.OrdinalIgnoreCase) ||
                explicitType.Equals("movie", StringComparison.OrdinalIgnoreCase))
            {
                return StreamKind.Vod;
            }
            if (explicitType.Equals("series", StringComparison.OrdinalIgnoreCase))
            {
                return StreamKind.Series;
            }
        }

        var cleanUrl = url.Split('?')[0].ToLowerInvariant();
        if (cleanUrl.Contains("/movie/", StringComparison.Ordinal)) return StreamKind.Vod;
        if (cleanUrl.Contains("/series/", StringComparison.Ordinal)) return StreamKind.Series;
        if (VodExtensions.Any(ext => cleanUrl.EndsWith(ext, StringComparison.Ordinal))) return StreamKind.Vod;

        var lowerGroup = group.ToLowerInvariant();
        if (lowerGroup.Contains("serie", StringComparison.Ordinal) || lowerGroup.Contains("série", StringComparison.Ordinal))
            return StreamKind.Series;
        if (lowerGroup.Contains("filme", StringComparison.Ordinal) ||
            lowerGroup.Contains("movie", StringComparison.Ordinal) ||
            lowerGroup.Contains("vod", StringComparison.Ordinal))
            return StreamKind.Vod;

        return StreamKind.Live;
    }

    private static string ComputeHash(string input)
    {
        uint hash = 2166136261;
        foreach (var ch in input)
        {
            hash ^= ch;
            hash *= 16777619;
        }
        return Convert.ToString(hash, 16);
    }
}
