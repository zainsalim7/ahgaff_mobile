/**
 * TTL-based in-memory API response cache
 *
 * Wraps any async API call and returns a cached result if the entry is
 * still fresh.  Falls back to the live call when the cache is stale or
 * missing.  The cache is intentionally in-memory (not persisted) so it
 * is cleared on every app restart – use the existing AsyncStorage-backed
 * offline cache in api.ts for persistence.
 *
 * Usage:
 *   // Cache GET /courses for 5 minutes
 *   const courses = await withCache('courses', () => coursesAPI.getAll(), 5 * 60_000);
 *
 *   // Invalidate a key (e.g. after a mutation)
 *   invalidateCache('courses');
 *
 *   // Invalidate all keys that start with a prefix
 *   invalidateCachePrefix('courses');
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // epoch ms
}

// ─── Store ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry<unknown>>();

// ─── Default TTLs (ms) ────────────────────────────────────────────────────────

export const TTL = {
  /** Very short – for data that changes frequently (e.g. today's lectures). */
  SHORT: 60_000,          // 1 minute
  /** Standard – for data that changes occasionally (e.g. course list). */
  MEDIUM: 5 * 60_000,     // 5 minutes
  /** Long – for mostly-static data (e.g. departments, settings). */
  LONG: 15 * 60_000,      // 15 minutes
  /** Very long – for near-static data (e.g. institution info). */
  VERY_LONG: 60 * 60_000, // 1 hour
} as const;

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Return a cached value if it exists and is still fresh, otherwise call
 * `fetcher`, store the result, and return it.
 *
 * @param key     Unique cache key (e.g. 'courses', 'departments')
 * @param fetcher Async function that fetches fresh data
 * @param ttl     Time-to-live in milliseconds (default: TTL.MEDIUM = 5 min)
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = TTL.MEDIUM,
): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (entry && Date.now() < entry.expiresAt) {
    console.log(`[Cache] ✅ HIT  – ${key}`);
    return entry.data;
  }

  console.log(`[Cache] 🔄 MISS – ${key}`);
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  return data;
}

/**
 * Remove a single cache entry by exact key.
 */
export function invalidateCache(key: string): void {
  if (cache.delete(key)) {
    console.log(`[Cache] 🗑️  Invalidated – ${key}`);
  }
}

/**
 * Remove all cache entries whose key starts with `prefix`.
 * Useful for invalidating a whole resource family (e.g. 'courses').
 */
export function invalidateCachePrefix(prefix: string): void {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[Cache] 🗑️  Invalidated ${count} entries with prefix "${prefix}"`);
  }
}

/**
 * Clear the entire cache (e.g. on logout).
 */
export function clearCache(): void {
  cache.clear();
  console.log('[Cache] 🗑️  Cache cleared');
}

/**
 * Return the number of entries currently in the cache.
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * Return debug info about all cache entries.
 */
export function getCacheDebugInfo(): Array<{
  key: string;
  expiresIn: number;
  expired: boolean;
}> {
  const now = Date.now();
  return Array.from(cache.entries()).map(([key, entry]) => ({
    key,
    expiresIn: Math.max(0, entry.expiresAt - now),
    expired: now >= entry.expiresAt,
  }));
}
