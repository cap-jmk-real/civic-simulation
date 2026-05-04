/**
 * Mulberry32 — deterministic PRNG. Returns a function `rnd` with `rnd()` ∈ [0, 1).
 * @param seed — 32-bit seed; same seed yields the same stream.
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-place Fisher–Yates shuffle using `rnd`.
 * @param arr — Array to mutate.
 * @param rnd — Random source, typically from {@link mulberry32}.
 */
export function shuffleInPlace<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
