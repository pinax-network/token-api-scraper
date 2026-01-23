-- Raw Token Metadata from Solana RPC
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32,
    timestamp                   DateTime('UTC'),

    -- token identity --
    network                     String,
    contract                    String,

    -- token metadata --
    decimals                    UInt8,
    name                        String,
    symbol                      String,
    uri                         String,
    source                      LowCardinality(String),
    -- Metaplex TokenStandard enum (0=Unknown for tokens without metadata)
    token_standard              Enum8('Unknown' = 0, 'NonFungible' = 1, 'FungibleAsset' = 2, 'Fungible' = 3, 'NonFungibleEdition' = 4, 'ProgrammableNonFungible' = 5, 'ProgrammableNonFungibleEdition' = 6),

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree(block_num)
ORDER BY (
    network, contract
);

-- RPC error handling for metadata --
CREATE TABLE IF NOT EXISTS metadata_errors (
    network                     String,
    contract                    String,
    error                       LowCardinality(String) DEFAULT '',
    created_at                  DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
TTL created_at + INTERVAL 1 WEEK
ORDER BY ( network, contract );

-- Solana network specific metadata --
INSERT INTO metadata (network, contract, decimals, name, symbol, uri, source, token_standard) VALUES
    ('solana', 'So11111111111111111111111111111111111111112', 9, 'Wrapped SOL', 'SOL', '', 'none', 'Unknown');
