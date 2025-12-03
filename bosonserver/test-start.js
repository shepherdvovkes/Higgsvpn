// Test script to diagnose startup issues
const { db } = require('./dist/database/postgres');
const { redis } = require('./dist/database/redis');
const { runMigrations } = require('./dist/database/migrations/run-migrations');
const { config } = require('./dist/config/config');

async function test() {
  try {
    console.log('Testing database connections...');
    console.log('Config:', JSON.stringify(config, null, 2));
    
    console.log('Connecting to PostgreSQL...');
    await db.connect();
    console.log('PostgreSQL connected');
    
    console.log('Connecting to Redis...');
    await redis.connect();
    console.log('Redis connected');
    
    console.log('Running migrations...');
    await runMigrations();
    console.log('Migrations completed');
    
    console.log('All tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();

