/**
 * Compact non-cryptographic string hash via djb2.
 * Used for memory content-hash dedup; NOT for security or cryptographic
 * integrity. The 8-char hex output is short enough for log lines and
 * deterministic-id derivation.
 */
export function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0; // hash * 33 + char
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
