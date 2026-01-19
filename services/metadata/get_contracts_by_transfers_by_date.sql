WITH filtered_transfers AS (
    SELECT
        log_address AS contract,
        block_num,
        timestamp
    FROM transfers
    WHERE floor(minute / 1440) = toInt16(toDate('2023-07-13'))
)
SELECT
    contract ,
    max(FT.block_num) as block_num,
    max(FT.timestamp) as minute
FROM filtered_transfers FT
ANTI LEFT JOIN metadata_errors USING (contract)
ANTI LEFT JOIN metadata USING (contract)
GROUP BY contract
ORDER BY minute DESC;