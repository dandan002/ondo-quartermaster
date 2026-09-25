// A small in-memory attempt limiter for the endpoints a guesser would target:
// password sign-in and pairing-code exchange. Per client address, sliding window.
// One process only; put a shared store behind it before running more than one.

const hits = new Map<string, number[]>();

export function tooMany(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
  recent.push(t);
  hits.set(key, recent);
  if (hits.size > 50_000) hits.clear(); // bounded memory under a flood
  return recent.length > max;
}
