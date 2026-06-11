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

/** Build one unified timing line matching the xplatform `TIMING …` format. */
export function xtFormat(
    file: string,
    fn: string,
    tags: Record<string, string | number>,
    ms: number,
): string {
    let out = `TIMING ${file} # ${fn} src=mlb`;
    for (const k in tags) {
        out += ` ${k}=${tags[k]}`;
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
