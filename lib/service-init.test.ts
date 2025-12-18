import { beforeEach, describe, expect, test } from 'bun:test';
import { initService } from './service-init';

describe('initService', () => {
    let consoleOutput: string[] = [];

    beforeEach(() => {
        // Reset output before each test
        consoleOutput = [];
        // Replace console.log to capture output
        console.log = (...args: any[]) => {
            consoleOutput.push(args.join(' '));
        };
    });

    test('should log configuration values once when verbose is enabled', () => {
        // First initialization
        initService({ serviceName: 'Test Service 1' });

        // Check that configuration was logged
        const configLines = consoleOutput.join('\n');
        expect(configLines).toContain('🔧 Configuration:');
        expect(configLines).toContain('CLICKHOUSE_URL:');
        expect(configLines).toContain('CLICKHOUSE_DATABASE:');
        expect(configLines).toContain('NODE_URL:');

        // Reset output
        consoleOutput = [];

        // Second initialization
        initService({ serviceName: 'Test Service 2' });

        // Configuration should NOT be logged again
        const secondConfigLines = consoleOutput.join('\n');
        expect(secondConfigLines).not.toContain('🔧 Configuration:');
        expect(secondConfigLines).not.toContain('CLICKHOUSE_URL:');

        // But service-specific logs should still appear
        expect(secondConfigLines).toContain('Test Service 2');
    });

    test('should log service initialization details when verbose is enabled', () => {
        initService({ serviceName: 'Metadata Service' });

        const output = consoleOutput.join('\n');
        expect(output).toContain('Batch insert enabled');
        expect(output).toContain('Starting Metadata Service');
        expect(output).toContain('Prometheus metrics enabled');
    });
});
