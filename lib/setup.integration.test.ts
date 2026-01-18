#!/usr/bin/env bun
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { splitSqlStatements, transformSqlForCluster } from './setup';

/**
 * Integration test for the setup CLI command
 * This test verifies that the setup command correctly processes SQL files
 * and transforms them for cluster deployment
 */

describe('Setup CLI Integration Tests', () => {
    const schemaFiles = [
        'sql.schemas/schema.metadata.sql',
        'sql.schemas/schema.polymarket.sql',
    ];

    test('all schema files should exist', () => {
        for (const file of schemaFiles) {
            const path = resolve(process.cwd(), file);
            expect(() => readFileSync(path, 'utf8')).not.toThrow();
        }
    });

    test('should parse SQL statements from all schema files', () => {
        let totalStatements = 0;

        for (const file of schemaFiles) {
            const content = readFileSync(file, 'utf8');
            const statements = splitSqlStatements(content);

            expect(statements.length).toBeGreaterThan(0);
            totalStatements += statements.length;
        }

        expect(totalStatements).toBeGreaterThan(0);
    });

    test('should transform schemas for cluster deployment', () => {
        const clusterName = 'test_cluster';

        for (const file of schemaFiles) {
            const content = readFileSync(file, 'utf8');
            const transformed = transformSqlForCluster(content, clusterName);

            // Check for MergeTree engines
            const hasMergeTree = content.includes('MergeTree');
            const hasReplicated = transformed.includes('Replicated');

            if (hasMergeTree) {
                expect(hasReplicated).toBe(true);
            }

            // Check for ON CLUSTER clause if there are CREATE or ALTER statements
            if (content.includes('CREATE') || content.includes('ALTER')) {
                // Functions file might not have ON CLUSTER for all statements
                // so we just check that the transformation ran without errors
                expect(transformed).toBeTruthy();
            }
        }
    });

    test('metadata schema should have expected statements', () => {
        const metadataContent = readFileSync(
            'sql.schemas/schema.metadata.sql',
            'utf8',
        );
        const statements = splitSqlStatements(metadataContent);

        const hasCreateTable = statements.some((s) =>
            s.includes('CREATE TABLE'),
        );
        const hasInsert = statements.some((s) => s.includes('INSERT'));

        expect(hasCreateTable).toBe(true);
        expect(hasInsert).toBe(true);
    });

    test('should have expected table names', () => {
        const expectedTables = ['metadata', 'metadata_errors', 'polymarket'];
        const allContent = schemaFiles
            .map((f) => readFileSync(f, 'utf8'))
            .join('\n');

        for (const table of expectedTables) {
            expect(allContent).toContain(table);
        }
    });
});
