/**
 * xplatform timing seam — a vendored-fork addition, NOT upstream MapLibre.
 *
 * Why this lives inside the library: the heavy vector-tile work (decode,
 * feature-id / `promoteId` assignment, geometry + feature-index build) runs in
 * the Web Worker, whose internal classes are not exported, so there is no way to
 * hook it from the host app. We own this fork, so we instrument the call-parents
 * in `WorkerTile.parse` directly.
 *
 * Transport: the worker builds finished `TIMING …` log-line strings (it knows
 * the tile id) and attaches them to the tile result (`xtiming`). The main thread
 * forwards them through a single global sink — `globalThis.__xtimingEmit` —
 * which the host app installs. With no sink installed, or with timing disabled,
 * nothing is emitted, so this is safe to compile into production builds and flip
 * on by config. See `client/src/platform/timing.ts` for the host side.
 */

/**
 * Worker-side switch: build the span strings during parse. The cost is a handful
 * of `performance.now()` pairs + short string concatenations per tile —
 * negligible against parse itself — but flip to `false` to compile the
 * worker-side cost (and the per-tile `xtiming` payload) out entirely.
 */
export const XT_WORKER_BUILD = true;

/**
 * Instrumentation build stamp. The host app's boot canary reads this off the
 * public API (`maplibregl.XT_TIMING_BUILD`) and logs it, so a stale vendored
 * `dist/` (one built before timing existed, or before a signpost was added)
 * is *loud* in the timing log instead of silently dropping every `src=mlb`
 * span. Bump when spans are added/renamed.
 */
export const XT_TIMING_BUILD = 2;

// Whether to forward worker-built lines. The REAL gate is the presence of the
// global sink (`globalThis.__xtimingEmit`), which the host app installs only when
// timing is on — so this defaults true and emission follows the sink. Kept as an
// explicit override (`setTimingEnabled(false)`) for force-disabling.
let emitEnabled = true;

/** Enable/disable forwarding of timing lines to the global sink (main thread). */
export function setTimingEnabled(value: boolean): void {
    emitEnabled = value;
}

/** Whether timing lines are currently being forwarded (main thread). */
export function isTimingEnabled(): boolean {
    return emitEnabled;
}

let pidCounter = 0;
/** Per-parse id (worker), so the analyzer can group one parse's sub-spans. */
export function xtNextPid(): number {
    pidCounter = (pidCounter + 1) & 0xffffff;
    return pidCounter;
}

/** Real wall-clock for durations (not MapLibre's mockable `now`). */
export function xtNow(): number {
    return performance.now();
}

/**
 * Epoch-anchored wall-clock, comparable ACROSS contexts (main thread vs each
 * worker — every `performance.now()` has its own origin, so raw values from two
 * threads must never be subtracted). Used to measure the actor-queue wait: the
 * main thread stamps the send (`xtSentAt` on the worker params), the worker
 * subtracts on receipt. Same machine, so clock-domain skew is sub-ms — fine for
 * the tens-to-thousands-of-ms waits this exists to expose.
 */
export function xtEpochNow(): number {
    return performance.timeOrigin + performance.now();
}

/**
 * Tag values must never contain whitespace or `=` — the consumer splits on
 * whitespace and on the first `=`, and a `\n` would split the host's IPC
 * batch. Runs of offending characters collapse to one `_` (same rule in all
 * three producers; see docs/timing.md §3 in the app repo).
 */
export function xtSanitizeTagValue(v: string | number): string {
    return String(v).replace(/[\s=]+/g, '_');
}

/**
 * Build one unified timing line matching the xplatform `TIMING …` grammar
 * (normative: docs/timing.md §3 in the app repo; this builder is
 * conformance-tested against the app's docs/timing-corpus.jsonl). mlb lines
 * are completed spans only — no `BEGIN|END id=` marker, by design.
 */
export function xtFormat(
    file: string,
    fn: string,
    tags: Record<string, string | number>,
    ms: number,
): string {
    let out = `TIMING ${file} # ${fn} src=mlb`;
    for (const k in tags) {
        out += ` ${k}=${xtSanitizeTagValue(tags[k])}`;
    }
    return `${out} TIME: ${Math.round(ms)}ms`;
}

/**
 * Main thread: forward worker-built timing lines to the global sink installed by
 * the host app. No-op when disabled or when no sink is present.
 */
export function xtEmitLines(lines: string[] | undefined): void {
    if (!emitEnabled || !lines || lines.length === 0) {
        return;
    }
    const sink = (globalThis as {__xtimingEmit?: (line: string) => void}).__xtimingEmit;
    if (!sink) {
        return;
    }
    for (const line of lines) {
        sink(line);
    }
}

/**
 * Whether emission is live right now (enabled AND the host sink is installed).
 * Main-thread producers (`main.ingest`, `gpu.tileUpload`) use this as their
 * before-measuring gate so disabled timing costs zero `performance.now()` calls.
 */
export function xtActive(): boolean {
    return emitEnabled &&
        (globalThis as {__xtimingEmit?: unknown}).__xtimingEmit !== undefined;
}

/** Main thread: build one completed-span line and push it to the sink. */
export function xtEmit(
    file: string,
    fn: string,
    tags: Record<string, string | number>,
    ms: number,
): void {
    xtEmitLines([xtFormat(file, fn, tags, ms)]);
}
