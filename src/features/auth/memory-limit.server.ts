/**
 * The free rate-limit tier (D30): a fixed window per key, in this server
 * instance's memory. It stops bursts before they cost a Supabase call. Each
 * instance counts on its own, so the shared database tier backs it up for
 * anything security-critical.
 */
const MAX_KEYS = 10_000;
const SWEEP_EVERY = 1_000;

const windows = new Map<string, { count: number; resetAt: number }>();
let calls = 0;

function sweep(now: number) {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/** True when the call is allowed, false when `key` is over `max` in this window. */
export function memoryLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (++calls % SWEEP_EVERY === 0) sweep(now);

  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (!w && windows.size >= MAX_KEYS) {
      // Maps keep insertion order: drop the oldest key to stay bounded.
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count += 1;
  return w.count <= max;
}

export function memoryLimitSize(): number {
  return windows.size;
}

/** For tests. */
export function resetMemoryLimit(): void {
  windows.clear();
  calls = 0;
}
