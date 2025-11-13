import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { client } from './clickhouse';

/**
 * Options for SQL setup
 */
export interface SetupOptions {
    cluster?: string;
}

/**
 * Transform SQL statements to support ClickHouse clusters
 * - Adds ON CLUSTER clause to CREATE/ALTER statements
 * - Converts MergeTree engines to ReplicatedMergeTree
 */
export function transformSqlForCluster(sql: string, clusterName: string): string {
    let transformed = sql;

    // Add ON CLUSTER to CREATE TABLE statements (before ENGINE)
    transformed = transformed.replace(
        /CREATE TABLE (IF NOT EXISTS )?(\S+)/gi,
        (match, ifNotExists, tableName) => {
            const clause = ifNotExists || '';
            return `CREATE TABLE ${clause}${tableName} ON CLUSTER '${clusterName}'`;
        }
    );

    // Add ON CLUSTER to ALTER TABLE statements
    transformed = transformed.replace(
        /ALTER TABLE (\S+)/gi,
        (match, tableName) => {
            return `ALTER TABLE ${tableName} ON CLUSTER '${clusterName}'`;
        }
    );

    // Add ON CLUSTER to CREATE OR REPLACE FUNCTION statements
    transformed = transformed.replace(
        /CREATE OR REPLACE FUNCTION/gi,
        `CREATE OR REPLACE FUNCTION ON CLUSTER '${clusterName}'`
    );

    // Convert MergeTree engines to ReplicatedMergeTree
    // ReplacingMergeTree -> ReplicatedReplacingMergeTree
    transformed = transformed.replace(
        /ENGINE\s*=\s*ReplacingMergeTree\(([^)]+)\)/gi,
        (match, args) => {
            return `ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}', ${args})`;
        }
    );

    // Handle basic MergeTree (without Replacing)
    transformed = transformed.replace(
        /ENGINE\s*=\s*MergeTree\(\s*\)/gi,
        `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')`
    );

    // Handle MergeTree with parameters
    transformed = transformed.replace(
        /ENGINE\s*=\s*MergeTree\(([^)]+)\)/gi,
        (match, args) => {
            return `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}', ${args})`;
        }
    );

    return transformed;
}

/**
 * Split SQL content into individual statements
 * Handles comments and multi-line statements
 */
export function splitSqlStatements(sql: string): string[] {
    const statements: string[] = [];
    let currentStatement = '';
    const lines = sql.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip empty lines and standalone comments
        if (!trimmedLine || trimmedLine.startsWith('--')) {
            // But keep inline comments as part of the statement
            if (currentStatement && !trimmedLine.startsWith('--')) {
                currentStatement += '\n' + line;
            }
            continue;
        }

        currentStatement += (currentStatement ? '\n' : '') + line;

        // Check if statement ends with semicolon
        if (trimmedLine.endsWith(';')) {
            statements.push(currentStatement.trim());
            currentStatement = '';
        }
    }

    // Add any remaining statement
    if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
    }

    return statements.filter(s => s.length > 0);
}

/**
 * Execute SQL setup from file(s)
 */
export async function executeSqlSetup(
    filePaths: string[],
    options: SetupOptions = {}
): Promise<void> {
    console.log('🔧 Starting SQL setup...\n');

    for (const filePath of filePaths) {
        console.log(`📄 Processing: ${filePath}`);

        try {
            // Check if file exists and provide helpful error message
            if (!existsSync(filePath)) {
                const fileName = basename(filePath);
                const hasValidExtension = /\.(sql|SQL)$/i.test(fileName);
                
                // If the file doesn't have a SQL extension, it might be a misplaced cluster name
                if (!hasValidExtension) {
                    throw new Error(
                        `File not found: ${filePath}\n\n` +
                        `💡 Tip: If '${fileName}' is a cluster name, use: --cluster ${fileName}\n` +
                        `   Example: bun run cli.ts setup file1.sql file2.sql --cluster ${fileName}`
                    );
                } else {
                    throw new Error(`File not found: ${filePath}`);
                }
            }

            // Read SQL file
            const sqlContent = readFileSync(filePath, 'utf8');
            
            // Transform SQL if cluster is specified
            const transformedSql = options.cluster
                ? transformSqlForCluster(sqlContent, options.cluster)
                : sqlContent;

            // Split into individual statements
            const statements = splitSqlStatements(transformedSql);

            console.log(`   Found ${statements.length} SQL statement(s)`);

            // Execute each statement
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                const statementPreview = statement.substring(0, 60).replace(/\n/g, ' ');
                
                try {
                    await client.exec({ query: statement });
                    console.log(`   ✓ Statement ${i + 1}/${statements.length}: ${statementPreview}...`);
                } catch (error) {
                    const err = error as Error;
                    console.error(`   ✗ Statement ${i + 1}/${statements.length} failed: ${err.message}`);
                    console.error(`   Statement: ${statementPreview}...`);
                    throw error;
                }
            }

            console.log(`   ✅ Completed: ${filePath}\n`);
        } catch (error) {
            const err = error as Error;
            console.error(`   ❌ Failed to process ${filePath}: ${err.message}\n`);
            throw error;
        }
    }

    console.log('✅ SQL setup completed successfully!');
    
    if (options.cluster) {
        console.log(`\n📊 Cluster: ${options.cluster}`);
        console.log('   - ON CLUSTER clause added to all statements');
        console.log('   - Converted to Replicated* table engines');
    }
}
