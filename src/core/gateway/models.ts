import type { Model } from '../entities/model';

/** Levenshtein distance, iterative single-row implementation. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** SPEC §19: unknown model → 404 listing up to 5 ids with distance ≤ 3. */
export function nearestModels(id: string, models: Model[], limit = 5): string[] {
  return models
    .map((model) => ({ id: model.id, d: distance(id.toLowerCase(), model.id.toLowerCase()) }))
    .filter((entry) => entry.d <= 3)
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}