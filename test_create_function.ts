import { transformSqlForCluster } from './lib/setup';

const testSql = `
CREATE OR REPLACE FUNCTION hex_to_string AS (hex_str) ->
(
    if(
        hex_str = '' OR hex_str IS NULL,
        CAST(NULL AS Nullable(String)),
        unhex(replaceRegexpAll(hex_str, '^0x', ''))
    )
);

CREATE OR REPLACE FUNCTION hex_to_uint8 AS (hex_str) ->
(
    ifNull(
        hex_to_uint8_or_null(hex_str),
        toUInt8(0)
    )
);
`;

console.log('Original SQL:');
console.log(testSql);
console.log('\n' + '='.repeat(80) + '\n');

const transformed = transformSqlForCluster(testSql, 'my_cluster');
console.log('Transformed SQL:');
console.log(transformed);

// Check if ON CLUSTER is added
if (transformed.includes("ON CLUSTER 'my_cluster'")) {
    console.log('\n✅ SUCCESS: ON CLUSTER clause added to CREATE FUNCTION statements');
} else {
    console.log('\n❌ FAIL: ON CLUSTER clause NOT added to CREATE FUNCTION statements');
}
