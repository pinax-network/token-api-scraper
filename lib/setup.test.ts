import { describe, test, expect } from 'bun:test';
import { transformSqlForCluster, splitSqlStatements, executeSqlSetup } from './setup';

describe('splitSqlStatements', () => {
    test('should split SQL statements correctly', () => {
        const testSql = `
-- This is a comment
CREATE TABLE test1 (id UInt32);

-- Another comment
CREATE TABLE test2 (
    id UInt32,
    name String
);

ALTER TABLE test1 ADD COLUMN extra String;
`;

        const statements = splitSqlStatements(testSql);
        expect(statements.length).toBe(3);
    });
});

describe('transformSqlForCluster', () => {
    test('should add ON CLUSTER clause', () => {
        const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;

ALTER TABLE test_table ADD COLUMN extra String;

CREATE OR REPLACE FUNCTION test_func AS (x) -> x * 2;
`;

        const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');
        
        expect(transformed).toContain("ON CLUSTER 'my_cluster'");
    });

    test('should add ON CLUSTER to CREATE OR REPLACE FUNCTION', () => {
        const sql = 'CREATE OR REPLACE FUNCTION test_func AS (x) -> x * 2;';
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain("CREATE OR REPLACE FUNCTION test_func ON CLUSTER 'my_cluster'");
    });

    test('should add ON CLUSTER to plain CREATE FUNCTION', () => {
        const sql = 'CREATE FUNCTION test_func AS (x) -> x * 2;';
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain("CREATE FUNCTION test_func ON CLUSTER 'my_cluster'");
    });

    test('should add ON CLUSTER to CREATE FUNCTION IF NOT EXISTS', () => {
        const sql = 'CREATE FUNCTION IF NOT EXISTS test_func AS (x) -> x * 2;';
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain("CREATE FUNCTION IF NOT EXISTS test_func ON CLUSTER 'my_cluster'");
    });

    test('should add ON CLUSTER to CREATE MATERIALIZED VIEW', () => {
        const sql = 'CREATE MATERIALIZED VIEW mv_test TO target_table AS SELECT * FROM source;';
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain("CREATE MATERIALIZED VIEW mv_test ON CLUSTER 'my_cluster'");
    });

    test('should add ON CLUSTER to CREATE MATERIALIZED VIEW IF NOT EXISTS', () => {
        const sql = 'CREATE MATERIALIZED VIEW IF NOT EXISTS mv_test TO target_table AS SELECT * FROM source;';
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain("CREATE MATERIALIZED VIEW IF NOT EXISTS mv_test ON CLUSTER 'my_cluster'");
    });

    test('should convert to ReplicatedReplacingMergeTree', () => {
        const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;
`;

        const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');
        
        expect(transformed).toContain('ReplicatedReplacingMergeTree');
    });

    test('should add ZooKeeper path', () => {
        const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;
`;

        const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');
        
        expect(transformed).toContain('/clickhouse/tables/{shard}/{database}/{table}');
    });

    test('should convert MergeTree without parentheses to ReplicatedMergeTree', () => {
        const sql = `
CREATE TABLE test_table (
    id UInt32
)
ENGINE = MergeTree
ORDER BY id;
`;
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain('ReplicatedMergeTree');
        expect(transformed).toContain('/clickhouse/tables/{shard}/{database}/{table}');
        expect(transformed).toContain("'{replica}'");
        // Should not have the original MergeTree anymore
        expect(transformed).not.toMatch(/ENGINE\s*=\s*MergeTree(?!\()/i);
    });

    test('should convert MergeTree with empty parentheses to ReplicatedMergeTree', () => {
        const sql = `
CREATE TABLE test_table (
    id UInt32
)
ENGINE = MergeTree()
ORDER BY id;
`;
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain('ReplicatedMergeTree');
        expect(transformed).toContain('/clickhouse/tables/{shard}/{database}/{table}');
    });

    test('should convert MergeTree with parameters to ReplicatedMergeTree', () => {
        const sql = `
CREATE TABLE test_table (
    id UInt32,
    date Date
)
ENGINE = MergeTree(date, id, 8192)
ORDER BY id;
`;
        const transformed = transformSqlForCluster(sql, 'my_cluster');
        
        expect(transformed).toContain('ReplicatedMergeTree');
        expect(transformed).toContain('/clickhouse/tables/{shard}/{database}/{table}');
        expect(transformed).toContain('date, id, 8192');
    });
});

describe('schema files', () => {
    test('should parse functions schema', async () => {
        const functionsSql = await Bun.file('./sql.schemas/schema.functions.sql').text();
        const functionsStatements = splitSqlStatements(functionsSql);
        
        expect(functionsStatements.length).toBeGreaterThan(0);
    });

    test('should parse metadata schema', async () => {
        const metadataSql = await Bun.file('./sql.schemas/schema.metadata.sql').text();
        const metadataStatements = splitSqlStatements(metadataSql);
        
        expect(metadataStatements.length).toBeGreaterThan(0);
    });

    test('should parse balances schema', async () => {
        const balancesSql = await Bun.file('./sql.schemas/schema.trc20_balances.sql').text();
        const balancesStatements = splitSqlStatements(balancesSql);
        
        expect(balancesStatements.length).toBeGreaterThan(0);
    });

    test('should transform functions schema for cluster', async () => {
        const functionsSql = await Bun.file('./sql.schemas/schema.functions.sql').text();
        const transformedFunctions = transformSqlForCluster(functionsSql, 'test_cluster');
        
        expect(transformedFunctions).toContain("ON CLUSTER 'test_cluster'");
        // Verify all CREATE FUNCTION statements have ON CLUSTER
        // Pattern: function_name ON CLUSTER
        const functionMatches = transformedFunctions.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi);
        const clusterMatches = transformedFunctions.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+\S+\s+ON\s+CLUSTER/gi);
        expect(functionMatches?.length).toBe(clusterMatches?.length);
    });

    test('should transform metadata schema for cluster', async () => {
        const metadataSql = await Bun.file('./sql.schemas/schema.metadata.sql').text();
        const transformedMetadata = transformSqlForCluster(metadataSql, 'test_cluster');
        
        expect(transformedMetadata).toContain("ON CLUSTER 'test_cluster'");
        expect(transformedMetadata).toContain('ReplicatedReplacingMergeTree');
    });

    test('should transform all actual metadata.sql correctly', async () => {
        const metadataSql = await Bun.file('./sql/schema.metadata.sql').text();
        const transformed = transformSqlForCluster(metadataSql, 'test_cluster');
        
        // Check all CREATE FUNCTION statements have ON CLUSTER
        // Pattern: function_name ON CLUSTER
        const functionMatches = transformed.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi);
        const functionClusterMatches = transformed.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+\S+\s+ON\s+CLUSTER/gi);
        expect(functionMatches?.length).toBe(functionClusterMatches?.length);
        
        // Check all CREATE TABLE statements have ON CLUSTER
        const tableMatches = transformed.match(/CREATE\s+TABLE/gi);
        const tableClusterMatches = transformed.match(/CREATE\s+TABLE.*ON\s+CLUSTER/gi);
        expect(tableMatches?.length).toBe(tableClusterMatches?.length);
        
        // Check CREATE MATERIALIZED VIEW has ON CLUSTER
        expect(transformed).toContain('CREATE MATERIALIZED VIEW');
        // Pattern: view_name ON CLUSTER
        expect(transformed).toMatch(/CREATE MATERIALIZED VIEW IF NOT EXISTS \S+ ON CLUSTER/);
        
        // Check MergeTree converted
        expect(transformed).toContain('ReplicatedMergeTree');
        expect(transformed).toContain('ReplicatedReplacingMergeTree');
        
        // Ensure no plain MergeTree left
        const plainMergeTree = transformed.match(/ENGINE\s*=\s*MergeTree(?=\s|$|;)/gi);
        expect(plainMergeTree).toBeNull();
    });

    test('should transform all actual trc20_balances.sql correctly', async () => {
        const balancesSql = await Bun.file('./sql/schema.trc20_balances.sql').text();
        const transformed = transformSqlForCluster(balancesSql, 'test_cluster');
        
        // Check CREATE FUNCTION has ON CLUSTER
        // Pattern: function_name ON CLUSTER
        expect(transformed).toMatch(/CREATE OR REPLACE FUNCTION \S+ ON CLUSTER/);
        
        // Check all CREATE TABLE statements have ON CLUSTER
        const tableMatches = transformed.match(/CREATE\s+TABLE/gi);
        const tableClusterMatches = transformed.match(/CREATE\s+TABLE.*ON\s+CLUSTER/gi);
        expect(tableMatches?.length).toBe(tableClusterMatches?.length);
        
        // Check CREATE MATERIALIZED VIEW has ON CLUSTER
        // Pattern: view_name ON CLUSTER
        expect(transformed).toMatch(/CREATE MATERIALIZED VIEW IF NOT EXISTS \S+ ON CLUSTER/);
        
        // Check all MergeTree engines converted
        const mergeTreeCount = (transformed.match(/ENGINE\s*=\s*ReplicatedMergeTree/gi) || []).length;
        const replacingMergeTreeCount = (transformed.match(/ENGINE\s*=\s*ReplicatedReplacingMergeTree/gi) || []).length;
        
        // Should have at least 2 ReplicatedMergeTree and 1 ReplicatedReplacingMergeTree
        expect(mergeTreeCount).toBeGreaterThanOrEqual(2);
        expect(replacingMergeTreeCount).toBeGreaterThanOrEqual(1);
        
        // Ensure no plain MergeTree left
        const plainMergeTree = transformed.match(/ENGINE\s*=\s*MergeTree(?=\s|$|;)/gi);
        expect(plainMergeTree).toBeNull();
    });
});

describe('error handling', () => {
    test('should provide helpful error for non-SQL file', async () => {
        try {
            await executeSqlSetup(['nonexistent-cluster-name'], {});
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            const err = error as Error;
            expect(err.message).toContain('File not found');
            expect(err.message).toContain('--cluster');
            expect(err.message).toContain('nonexistent-cluster-name');
        }
    });

    test('should provide simple error for SQL file not found', async () => {
        try {
            await executeSqlSetup(['nonexistent.sql'], {});
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            const err = error as Error;
            expect(err.message).toContain('File not found');
            expect(err.message).not.toContain('--cluster'); // Should not suggest cluster for .sql files
        }
    });
});

describe('showClusters', () => {
    test('should export showClusters function', async () => {
        const { showClusters } = await import('./setup');
        expect(typeof showClusters).toBe('function');
    });
});

describe('promptClusterSelection', () => {
    test('should export promptClusterSelection function', async () => {
        const { promptClusterSelection } = await import('./setup');
        expect(typeof promptClusterSelection).toBe('function');
    });
});
