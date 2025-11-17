import { transformSqlForCluster } from './lib/setup';

// Test various CREATE FUNCTION syntaxes
const testCases = [
    {
        name: 'CREATE OR REPLACE FUNCTION',
        sql: 'CREATE OR REPLACE FUNCTION test_func AS (x) -> x * 2;'
    },
    {
        name: 'CREATE FUNCTION',
        sql: 'CREATE FUNCTION test_func AS (x) -> x * 2;'
    },
    {
        name: 'CREATE FUNCTION IF NOT EXISTS',
        sql: 'CREATE FUNCTION IF NOT EXISTS test_func AS (x) -> x * 2;'
    }
];

console.log('Testing different CREATE FUNCTION syntaxes:\n');
console.log('='.repeat(80) + '\n');

testCases.forEach(testCase => {
    console.log(`Test: ${testCase.name}`);
    console.log(`Original: ${testCase.sql}`);
    const transformed = transformSqlForCluster(testCase.sql, 'my_cluster');
    console.log(`Transformed: ${transformed}`);
    
    if (transformed.includes("ON CLUSTER 'my_cluster'")) {
        console.log('✅ Has ON CLUSTER\n');
    } else {
        console.log('❌ MISSING ON CLUSTER\n');
    }
});
