using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using TVLocal.Core.Models;

namespace TVLocal.Core.Parsers;

public static partial class XmltvParser
{
    [GeneratedRegex(@"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?", RegexOptions.Compiled)]
    private static partial Regex XmltvDateRegex();

    public static DateTimeOffset? ParseXmltvDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var match = XmltvDateRegex().Match(raw.Trim());
        if (!match.Success) return null;

        var year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
        var hour = int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture);
        var minute = int.Parse(match.Groups[5].Value, CultureInfo.InvariantCulture);
        var second = int.Parse(match.Groups[6].Value, CultureInfo.InvariantCulture);

        var offset = TimeSpan.Zero;
        if (match.Groups[7].Success && match.Groups[8].Success && match.Groups[9].Success)
        {
            var sign = match.Groups[7].Value == "+" ? 1 : -1;
            var offsetHours = int.Parse(match.Groups[8].Value, CultureInfo.InvariantCulture);
            var offsetMinutes = int.Parse(match.Groups[9].Value, CultureInfo.InvariantCulture);
            offset = TimeSpan.FromMinutes(sign * (offsetHours * 60 + offsetMinutes));
        }

        return new DateTimeOffset(year, month, day, hour, minute, second, offset);
    }

    public static Dictionary<string, List<EpgProgram>> Parse(string xmlContent)
    {
        var result = new Dictionary<string, List<EpgProgram>>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(xmlContent)) return result;

        var doc = XDocument.Parse(xmlContent);
        foreach (var el in doc.Descendants("programme"))
        {
            var channelId = el.Attribute("channel")?.Value?.Trim();
            var start = ParseXmltvDate(el.Attribute("start")?.Value);
            var stop = ParseXmltvDate(el.Attribute("stop")?.Value);
            var title = el.Element("title")?.Value?.Trim();

            if (string.IsNullOrEmpty(channelId) || start is null || stop is null || string.IsNullOrEmpty(title))
                continue;

            var program = new EpgProgram(
                ChannelId: channelId,
                Title: title,
                Start: start.Value,
                Stop: stop.Value,
                Description: el.Element("desc")?.Value?.Trim(),
                Category: el.Element("category")?.Value?.Trim());

            if (!result.TryGetValue(channelId, out var list))
            {
                list = [];
                result[channelId] = list;
            }
            list.Add(program);
        }

        foreach (var list in result.Values)
        {
            list.Sort((a, b) => a.Start.CompareTo(b.Start));
        }

        return result;
    }

    public static IReadOnlyList<EpgProgram> GetProgramsForChannel(
        IReadOnlyDictionary<string, List<EpgProgram>> epg,
        Channel channel)
    {
        string?[] candidates = [channel.TvgId, channel.TvgName, channel.Name];
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            if (epg.TryGetValue(candidate.Trim(), out var programs) && programs.Count > 0)
            {
                return programs;
            }
        }
        return [];
    }

    public static NowAndNextPrograms GetNowAndNext(
        IReadOnlyDictionary<string, List<EpgProgram>> epg,
        Channel channel,
        DateTimeOffset? now = null)
    {
        var programs = GetProgramsForChannel(epg, channel);
        if (programs.Count == 0)
        {
            return new NowAndNextPrograms(null, null, []);
        }

        var currentTime = now ?? DateTimeOffset.UtcNow;

        for (var i = 0; i < programs.Count; i++)
        {
            var p = programs[i];
            if (p.Start <= currentTime && p.Stop > currentTime)
            {
                var next = i + 1 < programs.Count ? programs[i + 1] : null;
                var upcoming = programs.Skip(i).Take(8).ToList();
                return new NowAndNextPrograms(p, next, upcoming);
            }
        }

        for (var i = 0; i < programs.Count; i++)
        {
            if (programs[i].Start > currentTime)
            {
                var upcoming = programs.Skip(i).Take(8).ToList();
                return new NowAndNextPrograms(null, programs[i], upcoming);
            }
        }

        return new NowAndNextPrograms(null, null, []);
    }
}
