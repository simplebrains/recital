/**
 * Literal prompt / continuation markers.
 *
 * Matched longest-first as exact prefixes (parse) or suffixes (REPL sync), so
 * overlapping markers like `"> "` and `">"` stay unambiguous.
 */

/** Default continuation markers — preserves the historical `^>\s?(.*)$` forms. */
export const DEFAULT_CONTINUE: readonly string[] = ["> ", ">"];

/**
 * Normalize a directive field that accepts a string or a list of strings into a
 * non-empty `string[]`. Empty strings (and empty lists) are rejected.
 */
export function parseStringOrList(
  value: unknown,
  field: string,
  line: number,
): string[] {
  if (typeof value === "string") {
    if (!value) {
      throw new Error(`recital ${field} on line ${line} must be a non-empty string.`);
    }
    return [value];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(
        `recital ${field} on line ${line} must be a non-empty string or list of strings.`,
      );
    }
    const out: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== "string" || !item) {
        throw new Error(
          `recital ${field} on line ${line} item ${i + 1} must be a non-empty string.`,
        );
      }
      out.push(item);
    }
    return out;
  }
  throw new Error(
    `recital ${field} on line ${line} must be a string or a list of strings.`,
  );
}

/** Longest marker that is a prefix of `text`, or null. */
export function longestPrefix(
  text: string,
  markers: readonly string[],
): { marker: string; rest: string } | null {
  let best: { marker: string; rest: string } | null = null;
  for (const marker of markers) {
    if (text.startsWith(marker) && (!best || marker.length > best.marker.length)) {
      best = { marker, rest: text.slice(marker.length) };
    }
  }
  return best;
}

/** Longest marker that is a suffix of `text`, or null. */
export function longestSuffix(
  text: string,
  markers: readonly string[],
): { marker: string; rest: string } | null {
  let best: { marker: string; rest: string } | null = null;
  for (const marker of markers) {
    if (text.endsWith(marker) && (!best || marker.length > best.marker.length)) {
      best = { marker, rest: text.slice(0, text.length - marker.length) };
    }
  }
  return best;
}
