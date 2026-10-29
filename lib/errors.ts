/**
 * An upstream dependency (an HTTP API or the DNS lookup in front of it) failed
 * in a way that is expected to clear on its own: a 5xx/429/timeout or a
 * transport error that outlasted the caller's own retries.
 *
 * The CLI runner treats a cycle that failed only with these as skipped: it
 * waits `AUTO_RESTART_DELAY` and runs the next cycle, instead of exiting the
 * process and letting Kubernetes restart the container for an outage the
 * restart cannot fix.
 */
export class TransientUpstreamError extends Error {
    override name = 'TransientUpstreamError';
}

/**
 * True when `error` is a `TransientUpstreamError`, or an `AggregateError` whose
 * members all are. A cycle that mixes an upstream outage with any other
 * failure is not transient.
 */
export function isTransientUpstreamError(error: unknown): boolean {
    if (error instanceof AggregateError) {
        return (
            error.errors.length > 0 &&
            error.errors.every(isTransientUpstreamError)
        );
    }
    return error instanceof TransientUpstreamError;
}
