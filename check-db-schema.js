// This script should be run from the Higgsvpn root directory
// It will use the bosonserver's database connection
// The bosonserver's postgres module already loads config, so we just need to require it
const { db } = require('./bosonserver/dist/database/postgres');

async function checkSchema() {
  try {
    console.log('=== Checking Database Schema ===\n');
    
    // Check if schema_migrations table exists
    const migrationsTable = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      );
    `);
    console.log('Schema migrations table exists:', migrationsTable[0].exists);
    
    // Get applied migrations
    if (migrationsTable[0].exists) {
      const appliedMigrations = await db.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
      console.log('\nApplied migrations:');
      appliedMigrations.forEach(m => {
        console.log(`  - ${m.version} (applied at: ${m.applied_at})`);
      });
    }
    
    // Check all tables
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    console.log('\n=== Existing Tables ===');
    tables.forEach(t => console.log(`  - ${t.table_name}`));
    
    // Check structure of key tables
    const keyTables = ['nodes', 'routes', 'sessions', 'metrics'];
    for (const tableName of keyTables) {
      const tableExists = tables.some(t => t.table_name === tableName);
      if (tableExists) {
        console.log(`\n=== ${tableName.toUpperCase()} Table Structure ===`);
        const columns = await db.query(`
          SELECT 
            column_name, 
            data_type, 
            is_nullable,
            column_default
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = $1
          ORDER BY ordinal_position;
        `, [tableName]);
        
        columns.forEach(col => {
          console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
        });
        
        // Check row count
        const count = await db.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        console.log(`  Row count: ${count[0].count}`);
      } else {
        console.log(`\n=== ${tableName.toUpperCase()} Table ===`);
        console.log('  Table does not exist');
      }
    }
    
    // Check for indexes
    console.log('\n=== Indexes ===');
    const indexes = await db.query(`
      SELECT 
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);
    indexes.forEach(idx => {
      console.log(`  ${idx.tablename}.${idx.indexname}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkSchema();

