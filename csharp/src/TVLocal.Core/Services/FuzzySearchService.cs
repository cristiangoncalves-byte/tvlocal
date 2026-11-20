using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using TVLocal.Core.Models;

namespace TVLocal.Core.Services;

public sealed record FuzzySearchResult(IReadOnlyList<Channel> Items, string? CorrectedQuery);

public sealed partial class FuzzySearchService
{
    private sealed class VocabEntry
    {
        public required string Norm { get; init; }
        public required string Display { get; init; }
        public int Count { get; set; }
    }

    private sealed class IndexedChannel
    {
        public required Channel Channel { get; init; }
        public required int Index { get; init; }
        public required string NameNorm { get; init; }
        public required string GroupNorm { get; init; }
        public required string[] Words { get; init; }
    }

    [GeneratedRegex(@"[^a-z0-9\s]", RegexOptions.Compiled)]
    private static partial Regex NonAlnumRegex();

    [GeneratedRegex(@"\s+", RegexOptions.Compiled)]
    private static partial Regex MultiSpaceRegex();

    [GeneratedRegex(@"[^\p{L}\p{N}]+", RegexOptions.Compiled)]
    private static partial Regex DisplayWordSplitRegex();

    public static string NormalizeText(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;

        var formD = input.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(formD.Length);
        foreach (var ch in formD)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
            {
                sb.Append(char.ToLowerInvariant(ch));
            }
        }

        var cleaned = NonAlnumRegex().Replace(sb.ToString(), " ");
        return MultiSpaceRegex().Replace(cleaned, " ").Trim();
    }

    public static int MaxAllowedDistance(int tokenLength) => tokenLength switch
    {
        <= 2 => 0,
        <= 4 => 1,
        <= 8 => 2,
        _ => 3,
    };

    /// <summary>
    /// Computes Optimal String Alignment (restricted Damerau-Levenshtein) distance.
    /// </summary>
    public static int DamerauLevenshtein(string a, string b, int maxDist = 4)
    {
        var lenA = a.Length;
        var lenB = b.Length;
        if (Math.Abs(lenA - lenB) > maxDist) return maxDist + 1;
        if (string.Equals(a, b, StringComparison.Ordinal)) return 0;
        if (lenA == 0) return lenB;
        if (lenB == 0) return lenA;

        var prev2 = new int[lenB + 1];
        var prev1 = new int[lenB + 1];
        var curr = new int[lenB + 1];

        for (var j = 0; j <= lenB; j++) prev1[j] = j;

        for (var i = 1; i <= lenA; i++)
        {
            curr[0] = i;
            var ai = a[i - 1];

            for (var j = 1; j <= lenB; j++)
            {
                var bj = b[j - 1];
                var cost = ai == bj ? 0 : 1;
                var val = Math.Min(
                    Math.Min(prev1[j] + 1, curr[j - 1] + 1),
                    prev1[j - 1] + cost);

                if (i > 1 && j > 1 && ai == b[j - 2] && a[i - 2] == bj)
                {
                    val = Math.Min(val, prev2[j - 2] + 1);
                }

                curr[j] = val;
            }

            (prev2, prev1, curr) = (prev1, curr, prev2);
        }

        return prev1[lenB];
    }

    public static FuzzySearchResult FilterChannels(IReadOnlyList<Channel> channels, string? rawQuery)
    {
        var qNorm = NormalizeText(rawQuery);
        if (string.IsNullOrEmpty(qNorm))
        {
            return new FuzzySearchResult(channels, null);
        }

        var queryTokens = qNorm.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (queryTokens.Length == 0)
        {
            return new FuzzySearchResult(channels, null);
        }

        var vocab = new Dictionary<string, VocabEntry>(StringComparer.Ordinal);
        var indexed = new IndexedChannel[channels.Count];

        for (var i = 0; i < channels.Count; i++)
        {
            var ch = channels[i];
            var nameRaw = ch.Name ?? string.Empty;
            var groupRaw = ch.Group ?? string.Empty;
            var wordsSet = new HashSet<string>(StringComparer.Ordinal);

            void AddWords(string raw)
            {
                if (string.IsNullOrWhiteSpace(raw)) return;
                foreach (var rawTok in DisplayWordSplitRegex().Split(raw))
                {
                    if (string.IsNullOrEmpty(rawTok)) continue;
                    var norm = NormalizeText(rawTok);
                    if (string.IsNullOrEmpty(norm)) continue;
                    foreach (var part in norm.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                    {
                        wordsSet.Add(part);
                        if (part.Length >= 3)
                        {
                            if (vocab.TryGetValue(part, out var existing))
                            {
                                existing.Count += 1;
                            }
                            else
                            {
                                vocab[part] = new VocabEntry
                                {
                                    Norm = part,
                                    Display = rawTok,
                                    Count = 1,
                                };
                            }
                        }
                    }
                }
            }

            AddWords(nameRaw);
            AddWords(groupRaw);

            indexed[i] = new IndexedChannel
            {
                Channel = ch,
                Index = i,
                NameNorm = NormalizeText(nameRaw),
                GroupNorm = NormalizeText(groupRaw),
                Words = [.. wordsSet],
            };
        }

        var vocabList = vocab.Values.ToList();
        var anyCorrected = false;
        var resolvedTokens = new List<(string Token, string CorrectedToken, string DisplayToken)>(queryTokens.Length);

        foreach (var token in queryTokens)
        {
            var hasDirectHit = false;
            for (var i = 0; i < indexed.Length; i++)
            {
                var entry = indexed[i];
                if (entry.NameNorm.Contains(token, StringComparison.Ordinal) ||
                    entry.GroupNorm.Contains(token, StringComparison.Ordinal))
                {
                    hasDirectHit = true;
                    break;
                }
            }

            if (hasDirectHit || token.Length < 3)
            {
                resolvedTokens.Add((token, token, token));
                continue;
            }

            var maxDist = MaxAllowedDistance(token.Length);
            VocabEntry? bestEntry = null;
            var bestDist = int.MaxValue;
            var bestPrefixBonus = -1;

            foreach (var cand in vocabList)
            {
                var dist = DamerauLevenshtein(token, cand.Norm, maxDist);
                if (dist > maxDist) continue;

                var sameFirst = cand.Norm[0] == token[0] ? 1 : 0;
                var prefixBonus = token.Length >= 2 && cand.Norm.StartsWith(token[..2], StringComparison.Ordinal)
                    ? 2
                    : sameFirst;

                var isBetter = bestEntry is null
                    || dist < bestDist
                    || (dist == bestDist && (prefixBonus > bestPrefixBonus
                        || (prefixBonus == bestPrefixBonus && (cand.Count > bestEntry.Count
                            || (cand.Count == bestEntry.Count &&
                                Math.Abs(cand.Norm.Length - token.Length) < Math.Abs(bestEntry.Norm.Length - token.Length))))));

                if (isBetter)
                {
                    bestEntry = cand;
                    bestDist = dist;
                    bestPrefixBonus = prefixBonus;
                }
            }

            if (bestEntry is not null)
            {
                anyCorrected = true;
                resolvedTokens.Add((token, bestEntry.Norm, bestEntry.Display));
            }
            else
            {
                resolvedTokens.Add((token, token, token));
            }
        }

        var correctedFullNorm = string.Join(' ', resolvedTokens.Select(t => t.CorrectedToken));
        var correctedQuery = anyCorrected
            ? string.Join(' ', resolvedTokens.Select(t => t.DisplayToken))
            : null;

        var minRequiredMatches = queryTokens.Length <= 3
            ? queryTokens.Length
            : (int)Math.Ceiling(queryTokens.Length * 0.75);

        var scored = new List<(Channel Channel, int Score, int Index)>();

        for (var i = 0; i < indexed.Length; i++)
        {
            var entry = indexed[i];
            var score = 0;
            var matchedTokens = 0;

            if (entry.NameNorm.Contains(qNorm, StringComparison.Ordinal))
            {
                score += 120;
            }
            else if (!string.IsNullOrEmpty(entry.GroupNorm) && entry.GroupNorm.Contains(qNorm, StringComparison.Ordinal))
            {
                score += 100;
            }
            else if (anyCorrected)
            {
                if (entry.NameNorm.Contains(correctedFullNorm, StringComparison.Ordinal))
                {
                    score += 95;
                }
                else if (!string.IsNullOrEmpty(entry.GroupNorm) && entry.GroupNorm.Contains(correctedFullNorm, StringComparison.Ordinal))
                {
                    score += 85;
                }
            }

            foreach (var (tok, corr, _) in resolvedTokens)
            {
                var tokenScore = 0;

                if (entry.NameNorm.Contains(tok, StringComparison.Ordinal))
                {
                    tokenScore = Math.Max(tokenScore, 40);
                }
                else if (!string.IsNullOrEmpty(entry.GroupNorm) && entry.GroupNorm.Contains(tok, StringComparison.Ordinal))
                {
                    tokenScore = Math.Max(tokenScore, 30);
                }

                if (!string.Equals(corr, tok, StringComparison.Ordinal))
                {
                    if (entry.NameNorm.Contains(corr, StringComparison.Ordinal))
                    {
                        tokenScore = Math.Max(tokenScore, 32);
                    }
                    else if (!string.IsNullOrEmpty(entry.GroupNorm) && entry.GroupNorm.Contains(corr, StringComparison.Ordinal))
                    {
                        tokenScore = Math.Max(tokenScore, 24);
                    }
                }

                if (tokenScore == 0 && tok.Length >= 3)
                {
                    var maxDist = MaxAllowedDistance(tok.Length);
                    foreach (var word in entry.Words)
                    {
                        if (word.StartsWith(tok, StringComparison.Ordinal))
                        {
                            tokenScore = Math.Max(tokenScore, 22);
                            break;
                        }

                        var dist = DamerauLevenshtein(tok, word, maxDist);
                        if (dist <= maxDist)
                        {
                            tokenScore = Math.Max(tokenScore, 25 - dist * 5);
                        }
                        else if (word.Length > tok.Length && tok.Length >= 4)
                        {
                            var prefix = word[..tok.Length];
                            if (DamerauLevenshtein(tok, prefix, 1) <= 1)
                            {
                                tokenScore = Math.Max(tokenScore, 14);
                            }
                        }
                    }
                }

                if (tokenScore > 0)
                {
                    matchedTokens += 1;
                    score += tokenScore;
                }
            }

            if (matchedTokens >= minRequiredMatches && score > 0)
            {
                scored.Add((entry.Channel, score, entry.Index));
            }
        }

        scored.Sort((a, b) =>
        {
            var cmp = b.Score.CompareTo(a.Score);
            return cmp != 0 ? cmp : a.Index.CompareTo(b.Index);
        });

        var resultItems = scored.Select(s => s.Channel).ToList();
        return new FuzzySearchResult(resultItems, resultItems.Count > 0 ? correctedQuery : null);
    }
}
