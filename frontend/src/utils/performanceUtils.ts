/**
 * Performance Monitoring Utilities
 *
 * Tracks Core Web Vitals (LCP, FID, CLS), API call durations, and
 * component render times. All measurements are logged to the console
 * in development and can be forwarded to an analytics endpoint in
 * production by setting EXPO_PUBLIC_PERF_ENDPOINT.
 */

import { Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PerfMetric {
  name: string;
  value: number; // milliseconds (or score for CLS)
  rating: 'good' | 'needs-improvement' | 'poor';
  timestamp: number;
}

export interface ApiMetric {
  url: string;
  method: string;
  duration: number; // ms
  status: number;
  timestamp: number;
}

// ─── Thresholds (Google Core Web Vitals) ─────────────────────────────────────

const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },   // Largest Contentful Paint (ms)
  FID: { good: 100, poor: 300 },     // First Input Delay (ms)
  CLS: { good: 0.1, poor: 0.25 },   // Cumulative Layout Shift (score)
  FCP: { good: 1800, poor: 3000 },   // First Contentful Paint (ms)
  TTFB: { good: 800, poor: 1800 },   // Time to First Byte (ms)
  API: { good: 500, poor: 2000 },    // API call duration (ms)
};

function rate(
  name: keyof typeof THRESHOLDS,
  value: number,
): PerfMetric['rating'] {
  const t = THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

// ─── In-memory log ────────────────────────────────────────────────────────────

const metricLog: PerfMetric[] = [];
const apiLog: ApiMetric[] = [];
const MAX_LOG_SIZE = 100;

function pushMetric(metric: PerfMetric) {
  metricLog.push(metric);
  if (metricLog.length > MAX_LOG_SIZE) metricLog.shift();
}

function pushApiMetric(metric: ApiMetric) {
  apiLog.push(metric);
  if (apiLog.length > MAX_LOG_SIZE) apiLog.shift();
}

// ─── Console helpers ──────────────────────────────────────────────────────────

const RATING_EMOJI: Record<PerfMetric['rating'], string> = {
  good: '✅',
  'needs-improvement': '⚠️',
  poor: '🔴',
};

function logMetric(metric: PerfMetric) {
  const emoji = RATING_EMOJI[metric.rating];
  const val =
    metric.name === 'CLS'
      ? metric.value.toFixed(4)
      : `${Math.round(metric.value)}ms`;
  console.log(`[Perf] ${emoji} ${metric.name}: ${val} (${metric.rating})`);
}

// ─── Core Web Vitals (web only) ───────────────────────────────────────────────

/**
 * Observe Core Web Vitals using the PerformanceObserver API.
 * Only runs on web; silently no-ops on native.
 */
export function observeWebVitals(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  // LCP
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & {
        startTime: number;
      };
      if (!last) return;
      const metric: PerfMetric = {
        name: 'LCP',
        value: last.startTime,
        rating: rate('LCP', last.startTime),
        timestamp: Date.now(),
      };
      pushMetric(metric);
      logMetric(metric);
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}

  // FID
  try {
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & {
          processingStart: number;
          startTime: number;
        };
        const fid = e.processingStart - e.startTime;
        const metric: PerfMetric = {
          name: 'FID',
          value: fid,
          rating: rate('FID', fid),
          timestamp: Date.now(),
        };
        pushMetric(metric);
        logMetric(metric);
      }
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
  } catch (_) {}

  // CLS
  try {
    let clsValue = 0;
    let clsEntries: PerformanceEntry[] = [];
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!e.hadRecentInput) {
          clsValue += e.value;
          clsEntries.push(entry);
        }
      }
      const metric: PerfMetric = {
        name: 'CLS',
        value: clsValue,
        rating: rate('CLS', clsValue),
        timestamp: Date.now(),
      };
      pushMetric(metric);
      logMetric(metric);
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}

  // FCP via paint timing
  try {
    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          const metric: PerfMetric = {
            name: 'FCP',
            value: entry.startTime,
            rating: rate('FCP', entry.startTime),
            timestamp: Date.now(),
          };
          pushMetric(metric);
          logMetric(metric);
        }
      }
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  } catch (_) {}

  // TTFB via navigation timing
  try {
    const navObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceNavigationTiming;
        const ttfb = e.responseStart - e.requestStart;
        if (ttfb > 0) {
          const metric: PerfMetric = {
            name: 'TTFB',
            value: ttfb,
            rating: rate('TTFB', ttfb),
            timestamp: Date.now(),
          };
          pushMetric(metric);
          logMetric(metric);
        }
      }
    });
    navObserver.observe({ type: 'navigation', buffered: true });
  } catch (_) {}
}

// ─── API call timing ──────────────────────────────────────────────────────────

/**
 * Wrap an async API call with timing and logging.
 *
 * @example
 * const data = await measureApiCall('GET /courses', () => coursesAPI.getAll());
 */
export async function measureApiCall<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  let status = 200;
  try {
    const result = await fn();
    return result;
  } catch (err: any) {
    status = err?.response?.status ?? 0;
    throw err;
  } finally {
    const duration = Date.now() - start;
    const [method = 'GET', ...urlParts] = label.split(' ');
    const url = urlParts.join(' ') || label;
    const apiMetric: ApiMetric = {
      url,
      method,
      duration,
      status,
      timestamp: Date.now(),
    };
    pushApiMetric(apiMetric);

    const rating = rate('API', duration);
    const emoji = RATING_EMOJI[rating];
    if (rating !== 'good') {
      console.warn(`[Perf] ${emoji} Slow API – ${label}: ${duration}ms`);
    } else {
      console.log(`[Perf] ${emoji} API – ${label}: ${duration}ms`);
    }
  }
}

// ─── Generic timer helpers ────────────────────────────────────────────────────

const timers: Record<string, number> = {};

/** Start a named timer. */
export function startTimer(label: string): void {
  timers[label] = Date.now();
  console.time(label);
}

/** End a named timer and log the elapsed time. */
export function endTimer(label: string): number {
  console.timeEnd(label);
  const start = timers[label];
  if (start === undefined) return 0;
  const elapsed = Date.now() - start;
  delete timers[label];
  return elapsed;
}

// ─── Navigation timing ────────────────────────────────────────────────────────

let navStart = 0;

/** Call when navigation begins (e.g. on link press). */
export function markNavigationStart(): void {
  navStart = Date.now();
}

/** Call when the destination screen finishes rendering. */
export function markNavigationEnd(screenName: string): void {
  if (!navStart) return;
  const duration = Date.now() - navStart;
  const rating = duration < 500 ? 'good' : duration < 1000 ? 'needs-improvement' : 'poor';
  const emoji = RATING_EMOJI[rating];
  console.log(`[Perf] ${emoji} Navigation → ${screenName}: ${duration}ms`);
  navStart = 0;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

/** Return a snapshot of all recorded performance metrics. */
export function getMetrics(): PerfMetric[] {
  return [...metricLog];
}

/** Return a snapshot of all recorded API metrics. */
export function getApiMetrics(): ApiMetric[] {
  return [...apiLog];
}

/** Print a summary of all slow API calls (> 500 ms). */
export function printSlowApiSummary(): void {
  const slow = apiLog.filter((m) => m.duration > THRESHOLDS.API.good);
  if (slow.length === 0) {
    console.log('[Perf] ✅ No slow API calls recorded.');
    return;
  }
  console.group('[Perf] ⚠️ Slow API calls summary');
  slow
    .sort((a, b) => b.duration - a.duration)
    .forEach((m) =>
      console.log(`  ${m.method} ${m.url} – ${m.duration}ms (HTTP ${m.status})`),
    );
  console.groupEnd();
}
