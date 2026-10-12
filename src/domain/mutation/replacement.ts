export type ReplacementPlan =
  | {
      ok: true;
      index: number;
      next: string;
    }
  | {
      ok: false;
      reason: "stale" | "ambiguous";
    };

function findOccurrences(content: string, needle: string): number[] {
  if (!needle) return [];

  const matches: number[] = [];
  let cursor = 0;

  while (cursor <= content.length - needle.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) break;

    matches.push(index);
    cursor = index + needle.length;
  }

  return matches;
}

export function planReplacement(
  content: string,
  original: string,
  replacement: string,
): ReplacementPlan {
  const matches = findOccurrences(content, original);

  if (matches.length === 0) {
    return { ok: false, reason: "stale" };
  }

  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }

  const index = matches[0];
  return {
    ok: true,
    index,
    next:
      content.slice(0, index) +
      replacement +
      content.slice(index + original.length),
  };
}
