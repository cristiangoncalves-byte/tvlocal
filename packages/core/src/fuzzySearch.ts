import type { Channel } from './types.ts';

export interface FuzzySearchResult {
  items: Channel[];
  correctedQuery: string | null;
}

export interface FuzzyCategoryResult {
  items: string[];
  correctedQuery: string | null;
}

interface VocabEntry {
  norm: string;
  display: string;
  count: number;
}

interface IndexedItem<T> {
  item: T;
  index: number;
  primaryNorm: string;
  secondaryNorm: string;
  words: string[];
}

export function normalizeSearchText(input: string): string {
  if (!input) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function maxAllowedDistance(tokenLen: number): number {
  if (tokenLen <= 2) return 0;
  if (tokenLen <= 4) return 1;
  if (tokenLen <= 8) return 2;
  return 3;
}

/**
 * Computes Optimal String Alignment (restricted Damerau-Levenshtein) distance.
 * Returns `maxDist + 1` early when length difference already exceeds `maxDist`.
 */
export function editDistance(a: string, b: string, maxDist = 4): number {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  let prev2 = new Array<number>(lenB + 1).fill(0);
  let prev1 = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);

  for (let j = 0; j <= lenB; j++) prev1[j] = j;

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);

    for (let j = 1; j <= lenB; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;
      let val = Math.min(
        prev1[j] + 1,
        curr[j - 1] + 1,
        prev1[j - 1] + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        ai === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === bj
      ) {
        val = Math.min(val, prev2[j - 2] + 1);
      }

      curr[j] = val;
    }

    const tmp = prev2;
    prev2 = prev1;
    prev1 = curr;
    curr = tmp;
  }

  return prev1[lenB];
}

function extractDisplayWords(raw: string): Array<{ norm: string; display: string }> {
  if (!raw) return [];
  const rawTokens = raw.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: Array<{ norm: string; display: string }> = [];
  for (const rawTok of rawTokens) {
    const norm = normalizeSearchText(rawTok);
    if (!norm) continue;
    for (const part of norm.split(' ')) {
      if (part) {
        out.push({ norm: part, display: rawTok });
      }
    }
  }
  return out;
}

function runFuzzyFilter<T>(
  items: readonly T[],
  rawQuery: string,
  getPrimary: (item: T) => string,
  getSecondary: (item: T) => string,
): { items: T[]; correctedQuery: string | null } {
  const qNorm = normalizeSearchText(rawQuery);
  if (!qNorm) {
    return { items: [...items], correctedQuery: null };
  }

  const queryTokens = qNorm.split(' ').filter(Boolean);
  if (queryTokens.length === 0) {
    return { items: [...items], correctedQuery: null };
  }

  const vocab = new Map<string, VocabEntry>();
  const indexed: IndexedItem<T>[] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const primaryRaw = getPrimary(item) || '';
    const secondaryRaw = getSecondary(item) || '';
    const primaryNorm = normalizeSearchText(primaryRaw);
    const secondaryNorm = normalizeSearchText(secondaryRaw);

    const wordsSet = new Set<string>();
    const addWords = (raw: string) => {
      for (const { norm, display } of extractDisplayWords(raw)) {
        wordsSet.add(norm);
        if (norm.length >= 3) {
          const existing = vocab.get(norm);
          if (existing) {
            existing.count += 1;
          } else {
            vocab.set(norm, { norm, display, count: 1 });
          }
        }
      }
    };
    addWords(primaryRaw);
    addWords(secondaryRaw);

    indexed[i] = {
      item,
      index: i,
      primaryNorm,
      secondaryNorm,
      words: Array.from(wordsSet),
    };
  }

  const vocabList = Array.from(vocab.values());

  let anyCorrected = false;
  const resolvedTokens: Array<{
    token: string;
    correctedToken: string;
    displayToken: string;
  }> = [];

  for (const token of queryTokens) {
    let hasDirectHit = false;
    for (let i = 0; i < indexed.length; i++) {
      const entry = indexed[i];
      if (entry.primaryNorm.includes(token) || entry.secondaryNorm.includes(token)) {
        hasDirectHit = true;
        break;
      }
    }

    if (hasDirectHit || token.length < 3) {
      resolvedTokens.push({ token, correctedToken: token, displayToken: token });
      continue;
    }

    const maxDist = maxAllowedDistance(token.length);
    let best: { entry: VocabEntry; dist: number; prefixBonus: number } | null = null;

    for (let i = 0; i < vocabList.length; i++) {
      const cand = vocabList[i];
      const dist = editDistance(token, cand.norm, maxDist);
      if (dist > maxDist) continue;

      const sameFirst = cand.norm.charCodeAt(0) === token.charCodeAt(0) ? 1 : 0;
      const prefixBonus = cand.norm.startsWith(token.slice(0, 2)) ? 2 : sameFirst;

      if (
        !best ||
        dist < best.dist ||
        (dist === best.dist &&
          (prefixBonus > best.prefixBonus ||
            (prefixBonus === best.prefixBonus &&
              (cand.count > best.entry.count ||
                (cand.count === best.entry.count &&
                  Math.abs(cand.norm.length - token.length) <
                    Math.abs(best.entry.norm.length - token.length))))))
      ) {
        best = { entry: cand, dist, prefixBonus };
      }
    }

    if (best) {
      anyCorrected = true;
      resolvedTokens.push({
        token,
        correctedToken: best.entry.norm,
        displayToken: best.entry.display,
      });
    } else {
      resolvedTokens.push({ token, correctedToken: token, displayToken: token });
    }
  }

  const correctedFullNorm = resolvedTokens.map((t) => t.correctedToken).join(' ');
  const correctedQuery = anyCorrected
    ? resolvedTokens.map((t) => t.displayToken).join(' ')
    : null;

  const minRequiredMatches =
    queryTokens.length <= 3 ? queryTokens.length : Math.ceil(queryTokens.length * 0.75);

  const scored: Array<{ item: T; score: number; index: number }> = [];

  for (let i = 0; i < indexed.length; i++) {
    const entry = indexed[i];
    let score = 0;
    let matchedTokens = 0;

    if (entry.primaryNorm.includes(qNorm)) {
      score += 120;
    } else if (entry.secondaryNorm && entry.secondaryNorm.includes(qNorm)) {
      score += 100;
    } else if (anyCorrected) {
      if (entry.primaryNorm.includes(correctedFullNorm)) {
        score += 95;
      } else if (entry.secondaryNorm && entry.secondaryNorm.includes(correctedFullNorm)) {
        score += 85;
      }
    }

    for (const rt of resolvedTokens) {
      let tokenScore = 0;
      const tok = rt.token;
      const corr = rt.correctedToken;

      if (entry.primaryNorm.includes(tok)) {
        tokenScore = Math.max(tokenScore, 40);
      } else if (entry.secondaryNorm && entry.secondaryNorm.includes(tok)) {
        tokenScore = Math.max(tokenScore, 30);
      }

      if (corr !== tok) {
        if (entry.primaryNorm.includes(corr)) {
          tokenScore = Math.max(tokenScore, 32);
        } else if (entry.secondaryNorm && entry.secondaryNorm.includes(corr)) {
          tokenScore = Math.max(tokenScore, 24);
        }
      }

      if (tokenScore === 0 && tok.length >= 3) {
        const maxDist = maxAllowedDistance(tok.length);
        for (const word of entry.words) {
          if (word.startsWith(tok) && tok.length >= 3) {
            tokenScore = Math.max(tokenScore, 22);
            break;
          }
          const dist = editDistance(tok, word, maxDist);
          if (dist <= maxDist) {
            tokenScore = Math.max(tokenScore, 25 - dist * 5);
          } else if (word.length > tok.length && tok.length >= 4) {
            // Check approximate prefix match against longer compound words
            const wordPrefix = word.slice(0, tok.length);
            const pDist = editDistance(tok, wordPrefix, 1);
            if (pDist <= 1) {
              tokenScore = Math.max(tokenScore, 14);
            }
          }
        }
      }

      if (tokenScore > 0) {
        matchedTokens += 1;
        score += tokenScore;
      }
    }

    if (matchedTokens >= minRequiredMatches && score > 0) {
      scored.push({ item: entry.item, score, index: entry.index });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return {
    items: scored.map((s) => s.item),
    correctedQuery: scored.length > 0 ? correctedQuery : null,
  };
}

export function fuzzyFilterChannels(channels: readonly Channel[], rawQuery: string): FuzzySearchResult {
  return runFuzzyFilter(
    channels,
    rawQuery,
    (ch) => ch.name || '',
    (ch) => ch.group || '',
  );
}

export function fuzzyFilterCategories(categories: readonly string[], rawQuery: string): FuzzyCategoryResult {
  return runFuzzyFilter(
    categories,
    rawQuery,
    (cat) => cat || '',
    () => '',
  );
}
