-- ============================================
-- Hex decoding helpers (String, UInt8, UInt256)
-- No generic try(), compatible with your server
-- ============================================

-- --------------------------------------------
-- String decoders
-- --------------------------------------------

-- Nullable, safe on empty / NULL.
-- NOTE: this will still throw if hex_str is not valid hex.
CREATE OR REPLACE FUNCTION hex_to_string_or_null AS (hex_str) ->
(
    if(
        hex_str = '' OR hex_str IS NULL,
        CAST(NULL AS Nullable(String)),
        unhex(
            replaceRegexpAll(hex_str, '^0x', '')
        )
    )
);

-- Non-null wrapper: falls back to '' on NULL/empty.
CREATE OR REPLACE FUNCTION hex_to_string AS (hex_str) ->
(
    ifNull(
        hex_to_string_or_null(hex_str),
        ''
    )
);

-- --------------------------------------------
-- UInt8 decoders
-- --------------------------------------------

-- Nullable, safe on empty / NULL.
-- NOTE: still assumes hex_str is valid hex when non-empty.
CREATE OR REPLACE FUNCTION hex_to_uint8_or_null AS (hex_str) ->
(
    if(
        hex_str = '' OR hex_str IS NULL,
        CAST(NULL AS Nullable(UInt8)),
        reinterpretAsUInt8(
            reverse(
                unhex(
                    replaceRegexpAll(hex_str, '^0x', '')
                )
            )
        )
    )
);

-- Non-null wrapper: falls back to 0 on NULL/empty.
CREATE OR REPLACE FUNCTION hex_to_uint8 AS (hex_str) ->
(
    ifNull(
        hex_to_uint8_or_null(hex_str),
        toUInt8(0)
    )
);

-- --------------------------------------------
-- UInt256 decoders
-- --------------------------------------------

-- Nullable, safe on empty / NULL.
-- NOTE: still assumes hex_str is valid hex when non-empty.
CREATE OR REPLACE FUNCTION hex_to_uint256_or_null AS (hex_str) ->
(
    if(
        hex_str = '' OR hex_str IS NULL,
        CAST(NULL AS Nullable(UInt256)),
        reinterpretAsUInt256(
            reverse(
                unhex(
                    replaceRegexpAll(hex_str, '^0x', '')
                )
            )
        )
    )
);

-- Non-null wrapper: falls back to 0 on NULL/empty.
CREATE OR REPLACE FUNCTION hex_to_uint256 AS (hex_str) ->
(
    ifNull(
        hex_to_uint256_or_null(hex_str),
        toUInt256(0)
    )
);
