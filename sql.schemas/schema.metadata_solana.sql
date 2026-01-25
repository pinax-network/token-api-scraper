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
    -- Metaplex TokenStandard enum (NULL for tokens without metadata)
    token_standard              Nullable(Enum8('NonFungible' = 0, 'FungibleAsset' = 1, 'Fungible' = 2, 'NonFungibleEdition' = 3, 'ProgrammableNonFungible' = 4, 'ProgrammableNonFungibleEdition' = 5)),

    -- parsed token metadata --
    image                       String DEFAULT '',
    description                 String DEFAULT '',

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
INSERT INTO metadata (network, contract, decimals, name, symbol, uri, source, token_standard, image, description) VALUES
    ('solana', 'So11111111111111111111111111111111111111112', 9, 'Wrapped SOL', 'SOL', '', 'none', NULL, '', '');
