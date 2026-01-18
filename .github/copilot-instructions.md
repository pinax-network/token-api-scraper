# Token API Scraper - Copilot Instructions

## Overview
A Bun/TypeScript CLI tool that scrapes ERC-20 token data from TRON blockchain via RPC calls and stores it in ClickHouse. Services run in continuous loops with auto-restart, processing incremental data changes.

## Architecture

### Core Data Flow
1. **SQL queries** ([src/queries.ts](src/queries.ts)) fetch unprocessed records from ClickHouse
2. **Services** ([services/](services/)) call RPC endpoints via `p-queue` for concurrency control
3. **Batch insert queue** ([lib/batch-insert.ts](lib/batch-insert.ts)) accumulates rows and flushes to ClickHouse periodically or at max size

### Key Components
- **CLI** ([cli.ts](cli.ts)): Commander-based CLI defining `run <service>` and `setup <action>` commands
- **Services**: Independent modules in `services/` that export a `run()` function
- **Shared libs**: `lib/` contains reusable utilities (RPC, ClickHouse client, logging, Prometheus metrics)

### Service Pattern
Every service follows this structure:
```typescript
export async function run() {
    initService({ serviceName: 'my-service' });  // Initialize batch queue + log config
    const queue = new PQueue({ concurrency: CONCURRENCY });
    const items = await get_items_from_clickhouse();  // SQL query
    for (const item of items) {
        queue.add(async () => {
            // RPC call → insert result
            await callContract(...);
            await insertRow('table_name', data, serviceName);
        });
    }
    await queue.onIdle();
    await shutdownBatchInsertQueue();
}
```

## Development Commands
```bash
bun run cli run <service>      # Run a service (metadata-transfers, balances-erc20, etc.)
bun run cli setup <action>     # Deploy SQL schemas to ClickHouse
bun run test                   # Run tests with coverage (bun:test)
bun run fix                    # Auto-fix lint issues (Biome)
bun run build                  # Compile to single binary
```

## Conventions

### Code Style (Biome)
- 4-space indentation, single quotes, semicolons always
- No `any` restrictions (`noExplicitAny: off`)
- Imports auto-organized on save

### Logging
Use `createLogger(name)` from [lib/logger.ts](lib/logger.ts):
```typescript
const log = createLogger('my-component');
log.info('Message', { contextKey: value });  // Always use structured logging
```

### Error Handling
- RPC errors: Log with `log.warn()`, call `incrementError()`, insert to error table
- Non-fatal errors don't throw - services continue processing remaining items
- Retryable errors (network, rate limits) use exponential backoff in [lib/rpc.ts](lib/rpc.ts)

### Database Patterns
- SQL schemas live in `sql.schemas/` with prefix `schema.` or `mv.` for materialized views
- Use `ReplacingMergeTree` with deduplication for upsert semantics
- Query functions in [src/queries.ts](src/queries.ts) load SQL from files via `bun.file().text()`

### Testing
- Co-located test files: `*.test.ts` next to source files
- Use `bun:test` with `mock.module()` for dependency mocking
- Integration tests suffixed with `.integration.test.ts`

## Environment Variables
Key variables (see [lib/config.ts](lib/config.ts) for defaults):
- `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE` - Database connection
- `NODE_URL` - RPC endpoint (required, no default)
- `CONCURRENCY` - Parallel RPC requests (default: 40)
- `LOG_LEVEL` - `debug|info|warn|error`

## Adding a New Service
1. Create `services/<category>/<name>.ts` exporting `run()`
2. Add entry to `SERVICES` object in [cli.ts](cli.ts)
3. Add SQL schema to `sql.schemas/` and setup action in `SETUP_ACTIONS`
4. Use `initService()`, `PQueue`, `insertRow()` pattern from existing services
