import { createLogger } from './logger';

const log = createLogger('db-health');

interface HealthCheckResult {
    success: boolean;
    message: string;
    details?: {
        url?: string;
        host?: string;
        ipAddresses?: string[];
        pingResponse?: string;
        error?: string;
        errorCode?: string;
        attemptedAddress?: string;
        timeout?: string;
    };
}

interface DNSResponse {
    Answer?: Array<{
        type: number;
        data: string;
    }>;
}

/**
 * Extract hostname from a URL
 */
function getHostnameFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

/**
 * Resolve DNS for the ClickHouse hostname using a simple DNS-over-HTTPS query
 */
export async function checkDNS(url: string): Promise<HealthCheckResult> {
    const hostname = getHostnameFromUrl(url);
    // return true if localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return {
            success: true,
            message: `DNS resolution successful for ${hostname}`,
            details: {
                host: hostname,
                ipAddresses: ['127.0.0.1'],
            },
        };
    }

    try {
        // Use DNS-over-HTTPS to resolve the hostname
        const dnsUrl = `https://dns.google/resolve?name=${hostname}&type=A`;
        const response = await fetch(dnsUrl);
        const data = (await response.json()) as DNSResponse;

        if (data.Answer && data.Answer.length > 0) {
            const ipAddresses = data.Answer.filter(
                (answer) => answer.type === 1,
            ) // A records
                .map((answer) => answer.data);

            return {
                success: true,
                message: `DNS resolution successful for ${hostname}`,
                details: {
                    host: hostname,
                    ipAddresses,
                },
            };
        } else {
            return {
                success: false,
                message: `No DNS records found for ${hostname}`,
                details: {
                    host: hostname,
                    error: 'No A records found',
                },
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `DNS resolution failed for ${hostname}`,
            details: {
                host: hostname,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

/**
 * Ping the ClickHouse server using the /ping endpoint
 */
export async function pingClickHouse(url: string): Promise<HealthCheckResult> {
    const hostname = getHostnameFromUrl(url);
    try {
        // Use the ping endpoint
        const pingUrl = new URL(url);
        pingUrl.pathname = '/ping';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(pingUrl.toString(), {
                method: 'GET',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const responseText = await response.text();

            if (response.ok) {
                return {
                    success: true,
                    message: `ClickHouse server is reachable at ${url}`,
                    details: {
                        url,
                        host: hostname,
                        pingResponse: responseText,
                    },
                };
            } else {
                return {
                    success: false,
                    message: `ClickHouse ping failed with status ${response.status}`,
                    details: {
                        url,
                        host: hostname,
                        error: `HTTP ${response.status}: ${responseText}`,
                    },
                };
            }
        } catch (fetchError: unknown) {
            clearTimeout(timeoutId);

            const err = fetchError as Error & {
                name?: string;
                cause?: {
                    code?: string;
                    message?: string;
                };
            };

            // Extract detailed error information
            const errorDetails: HealthCheckResult['details'] = {
                url,
                host: hostname,
                error: err.message || String(fetchError),
            };

            // Check for timeout or connection errors
            if (err.name === 'AbortError') {
                errorDetails.timeout = '10000ms';
                errorDetails.error = 'Request aborted due to timeout';
            }

            if (err.cause) {
                errorDetails.errorCode = err.cause.code;
                errorDetails.attemptedAddress = `${hostname}:443`;
                if (err.cause.message) {
                    errorDetails.error = err.cause.message;
                }
            }

            return {
                success: false,
                message: `Failed to connect to ClickHouse at ${url}`,
                details: errorDetails,
            };
        }
    } catch (error: unknown) {
        const err = error as Error & { code?: string };
        return {
            success: false,
            message: `Error setting up ClickHouse ping`,
            details: {
                url,
                host: hostname,
                error: err.message || String(error),
                errorCode: err.code,
            },
        };
    }
}

/**
 * Run comprehensive health checks for ClickHouse database
 */
export async function runHealthChecks(): Promise<{
    overall: boolean;
    checks: {
        dns: HealthCheckResult;
        ping: HealthCheckResult;
    };
}> {
    const url = process.env.CLICKHOUSE_URL || 'http://localhost:8123';

    log.info('ClickHouse Database Health Check', { url });

    // Check DNS resolution
    log.info('Checking DNS resolution');
    const dnsCheck = await checkDNS(url);
    if (dnsCheck.success) {
        log.info('DNS resolution successful', {
            message: dnsCheck.message,
            ipAddresses: dnsCheck.details?.ipAddresses,
        });
    } else {
        log.error('DNS resolution failed', {
            message: dnsCheck.message,
            error: dnsCheck.details?.error,
        });
    }

    // Check ClickHouse ping
    log.info('Pinging ClickHouse server');
    const pingCheck = await pingClickHouse(url);
    if (pingCheck.success) {
        log.info('ClickHouse server is reachable', {
            message: pingCheck.message,
            response: pingCheck.details?.pingResponse,
        });
    } else {
        log.error('ClickHouse ping failed', {
            message: pingCheck.message,
            error: pingCheck.details?.error,
            errorCode: pingCheck.details?.errorCode,
            attemptedAddress: pingCheck.details?.attemptedAddress,
            timeout: pingCheck.details?.timeout,
        });
    }

    const overall = dnsCheck.success && pingCheck.success;

    if (overall) {
        log.info('All health checks passed');
    } else {
        log.error('Health checks failed');
    }

    return {
        overall,
        checks: {
            dns: dnsCheck,
            ping: pingCheck,
        },
    };
}
