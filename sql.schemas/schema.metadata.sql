-- Raw Token Metadata from RPC
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

-- base,avalanche,unichain,tron,bsc,polygon,mainnet,arbitrum-one,optimism --
INSERT INTO metadata (network, contract, decimals, name, symbol) VALUES
    ('tron', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', 6, 'Tron', 'TRX'),
    ('tron', '0x0000000000000000000000000000000000000000', 6, 'Tron', 'TRX'),
    ('mainnet', '0x0000000000000000000000000000000000000000', 18, 'Ethereum', 'ETH'),
    ('bsc', '0x0000000000000000000000000000000000000000', 18, 'BNB', 'BNB'),
    ('polygon', '0x0000000000000000000000000000000000000000', 18, 'MATIC', 'MATIC'),
    ('avalanche', '0x0000000000000000000000000000000000000000', 18, 'AVAX', 'AVAX'),
    ('optimism', '0x0000000000000000000000000000000000000000', 18, 'ETH', 'ETH'),
    ('arbitrum-one', '0x0000000000000000000000000000000000000000', 18, 'ETH', 'ETH'),
    ('unichain', '0x0000000000000000000000000000000000000000', 18, 'ETH', 'ETH'),
    ('base', '0x0000000000000000000000000000000000000000', 18, 'ETH', 'ETH');
