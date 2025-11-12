-- ============================================================================
-- Helper Functions for TRC20/TVM Token Processing
-- ============================================================================

-- Function to decode hex string to UTF-8 string
-- Used for decoding token name and symbol from smart contract responses
CREATE OR REPLACE FUNCTION hex_to_string AS (hex_str) -> if(
    hex_str = '' OR hex_str IS NULL,
    '',
    unhex(replaceRegexpAll(hex_str, '^0x', ''))
);

-- Function to safely convert hex to decimal (UInt256)
-- Used for decoding balance and decimals values
CREATE OR REPLACE FUNCTION hex_to_uint256 AS (hex_str) -> if(
    hex_str = '' OR hex_str IS NULL,
    0,
    reinterpretAsUInt256(reverse(unhex(replaceRegexpAll(hex_str, '^0x', ''))))
);

-- Function to format balance with decimals
-- Converts raw balance to human-readable format
CREATE OR REPLACE FUNCTION format_balance AS (balance, decimals) -> if(
    decimals = 0,
    toString(balance),
    concat(
        toString(toDecimal128(balance / pow(10, decimals), decimals)),
        ' (', toString(balance), ' raw)'
    )
);
