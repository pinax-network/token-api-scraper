import { readFileSync } from 'fs';
import { transformSqlForCluster, splitSqlStatements } from './lib/setup';

// Test with the actual schema.functions.sql file
const functionsSql = readFileSync('./sql.schemas/schema.functions.sql', 'utf8');

console.log('Testing schema.functions.sql with cluster transformation\n');
console.log('='.repeat(80));

const transformed = transformSqlForCluster(functionsSql, 'test_cluster');
const statements = splitSqlStatements(transformed);

console.log(`\nFound ${statements.length} statements\n`);

statements.forEach((stmt, i) => {
    const preview = stmt.substring(0, 100).replace(/\n/g, ' ');
    console.log(`Statement ${i + 1}: ${preview}...`);
    
    if (stmt.includes('CREATE OR REPLACE FUNCTION') && !stmt.includes('ON CLUSTER')) {
        console.log('❌ MISSING ON CLUSTER clause!');
    } else if (stmt.includes('CREATE OR REPLACE FUNCTION') && stmt.includes('ON CLUSTER')) {
        console.log('✅ Has ON CLUSTER clause');
    }
    console.log('');
});

console.log('='.repeat(80));
console.log('\nFull transformed SQL:\n');
console.log(transformed);
