/** Escapes LIKE wildcards so user search text matches literally (default escape char: backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
