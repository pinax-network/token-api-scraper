import { select } from '@inquirer/prompts';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { client } from './clickhouse';
import { createLogger } from './logger';

const log = createLogger('setup');

/**
 * Options for SQL setup
 */
export interface SetupOptions {
    cluster?: string;
    queryParams?: Record<string, string | number>;
}

/**
 * Cluster information from SHOW CLUSTERS query
 */
interface ClusterInfo {
    cluster: string;
}

/**
 * Query available clusters from ClickHouse
 */
export async function showClusters(): Promise<string[]> {
    try {
        const resultSet = await client.query({
            query: 'SHOW CLUSTERS',
            format: 'JSONEachRow',
        });
        const clusters: ClusterInfo[] = await resultSet.json();
        return clusters.map((c) => c.cluster);
    } catch (error) {
        const err = error as Error;
        throw new Error(`Failed to query clusters: ${err.message}`);
    }
}

/**
 * Prompt user to select a cluster from available clusters
 */
export async function promptClusterSelection(): Promise<string> {
    log.info('Fetching available clusters');

    const clusters = await showClusters();

    if (clusters.length === 0) {
        throw new Error(
            'No clusters found. Please specify a cluster name manually using --cluster <name>',
        );
    }

    log.info(`Found ${clusters.length} cluster(s)`, { clusters });

    const selectedCluster = await select({
        message: 'Select a cluster:',
        choices: clusters.map((cluster) => ({
            name: cluster,
            value: cluster,
        })),
    });

    return selectedCluster;
}

/**
 * Transform SQL statements to support ClickHouse clusters
 * - Adds ON CLUSTER clause to CREATE/ALTER statements
 * - Converts MergeTree engines to ReplicatedMergeTree
 */
export function transformSqlForCluster(
    sql: string,
    clusterName: string,
): string {
    let transformed = sql;

    // Add ON CLUSTER to CREATE TABLE statements (before ENGINE)
    transformed = transformed.replace(
        /CREATE TABLE (IF NOT EXISTS )?(\S+)/gi,
        (_match, ifNotExists, tableName) => {
            const clause = ifNotExists || '';
            return `CREATE TABLE ${clause}${tableName} ON CLUSTER '${clusterName}'`;
        },
    );

    // Add ON CLUSTER to ALTER TABLE statements
    transformed = transformed.replace(
        /ALTER TABLE (\S+)/gi,
        (_match, tableName) => {
            return `ALTER TABLE ${tableName} ON CLUSTER '${clusterName}'`;
        },
    );

    // Add ON CLUSTER to CREATE FUNCTION statements (all variants)
    // Handles: CREATE OR REPLACE FUNCTION, CREATE FUNCTION, CREATE FUNCTION IF NOT EXISTS
    // Pattern: CREATE [OR REPLACE] FUNCTION [IF NOT EXISTS] function_name ...
    // Result: CREATE [OR REPLACE] FUNCTION [IF NOT EXISTS] function_name ON CLUSTER 'name' ...
    transformed = transformed.replace(
        /CREATE(\s+OR\s+REPLACE)?\s+FUNCTION(\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/gi,
        (_match, orReplace, ifNotExists, functionName) => {
            const orReplacePart = orReplace || '';
            const ifNotExistsPart = ifNotExists || '';
            return `CREATE${orReplacePart} FUNCTION${ifNotExistsPart} ${functionName} ON CLUSTER '${clusterName}'`;
        },
    );

    // Add ON CLUSTER to CREATE MATERIALIZED VIEW statements
    // Pattern: CREATE MATERIALIZED VIEW [IF NOT EXISTS] view_name ...
    // Result: CREATE MATERIALIZED VIEW [IF NOT EXISTS] view_name ON CLUSTER 'name' ...
    transformed = transformed.replace(
        /CREATE\s+MATERIALIZED\s+VIEW(\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/gi,
        (_match, ifNotExists, viewName) => {
            const ifNotExistsPart = ifNotExists || '';
            return `CREATE MATERIALIZED VIEW${ifNotExistsPart} ${viewName} ON CLUSTER '${clusterName}'`;
        },
    );

    // Convert MergeTree engines to ReplicatedMergeTree
    // ReplacingMergeTree -> ReplicatedReplacingMergeTree
    transformed = transformed.replace(
        /ENGINE\s*=\s*ReplacingMergeTree\(([^)]+)\)/gi,
        (_match, args) => {
            return `ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}', ${args})`;
        },
    );

    // Handle basic MergeTree without parentheses (most common case)
    // Match: ENGINE = MergeTree (followed by newline, whitespace, or semicolon)
    transformed = transformed.replace(
        /ENGINE\s*=\s*MergeTree(?=\s|$|;)/gi,
        `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')`,
    );

    // Handle MergeTree with empty parentheses
    transformed = transformed.replace(
        /ENGINE\s*=\s*MergeTree\(\s*\)/gi,
        `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')`,
    );

    // Handle MergeTree with parameters
    transformed = transformed.replace(
        /ENGINE\s*=\s*MergeTree\(([^)]+)\)/gi,
        (_match, args) => {
            return `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}', ${args})`;
        },
    );

    return transformed;
}

/**
 * Substitute query parameters directly in SQL string
 * This is needed because ClickHouse's query_params doesn't work with DDL statements
 * like CREATE MATERIALIZED VIEW ... REFRESH EVERY
 *
 * Handles parameters in the format:
 * - {param_name:Type} - Replaces with the parameter value
 * - {param_name:Identifier} - Replaces with the identifier value (for database/table names)
 *
 * @param sql - The SQL string with parameter placeholders
 * @param params - The parameters to substitute
 * @returns The SQL string with parameters substituted
 */
export function substituteQueryParams(
    sql: string,
    params: Record<string, string | number>,
): string {
    let result = sql;

    for (const [key, value] of Object.entries(params)) {
        // Match patterns like {param_name:Type} where Type can be any ClickHouse type
        // e.g., {refresh_interval:UInt32}, {canonical_database:Identifier}
        const pattern = new RegExp(`\\{${key}:[^}]+\\}`, 'g');
        result = result.replace(pattern, String(value));
    }

    return result;
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

    return statements.filter((s) => s.length > 0);
}

/**
 * Execute SQL setup from file(s)
 */
export async function executeSqlSetup(
    filePaths: string[],
    options: SetupOptions = {},
): Promise<void> {
    log.info('Starting SQL setup', { files: filePaths.length });

    for (const filePath of filePaths) {
        log.info('Processing file', { file: filePath });

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
                            `   Example: bun run cli.ts setup file1.sql file2.sql --cluster ${fileName}`,
                    );
                } else {
                    throw new Error(`File not found: ${filePath}`);
                }
            }

            // Read SQL file
            const sqlContent = readFileSync(filePath, 'utf8');

            // Substitute query parameters directly in SQL string
            // This is needed because ClickHouse's query_params doesn't work with DDL statements
            const substitutedSql = options.queryParams
                ? substituteQueryParams(sqlContent, options.queryParams)
                : sqlContent;

            // Transform SQL if cluster is specified
            const transformedSql = options.cluster
                ? transformSqlForCluster(substitutedSql, options.cluster)
                : substitutedSql;

            // Split into individual statements
            const statements = splitSqlStatements(transformedSql);

            log.info('Found SQL statements', {
                file: filePath,
                count: statements.length,
            });

            // Execute each statement
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                const statementPreview = statement
                    .substring(0, 60)
                    .replace(/\n/g, ' ');

                try {
                    await client.command({
                        query: statement,
                    });
                    log.debug('Statement executed', {
                        index: `${i + 1}/${statements.length}`,
                        preview: statementPreview,
                    });
                } catch (error) {
                    const err = error as Error;
                    log.error('Statement execution failed', {
                        index: `${i + 1}/${statements.length}`,
                        preview: statementPreview,
                        error: err.message,
                    });
                    throw error;
                }
            }

            log.info('File completed', { file: filePath });
        } catch (error) {
            const err = error as Error;
            log.error('Failed to process file', {
                file: filePath,
                error: err.message,
            });
            throw error;
        }
    }

    log.info('SQL setup completed successfully');

    if (options.cluster) {
        log.info('Cluster configuration applied', {
            cluster: options.cluster,
            transformations: [
                'Added ON CLUSTER clauses',
                'Converted to Replicated engines',
            ],
        });
    }
}
