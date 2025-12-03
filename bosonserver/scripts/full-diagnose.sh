#!/bin/bash
set -e

echo "=== Full BosonServer Diagnosis ==="
cd /app

echo ""
echo "1. Checking PostgreSQL..."
sleep 2
PGPASSWORD=postgres psql -U postgres -h localhost -d postgres -c "SELECT 1" 2>&1 && echo "   ✓ PostgreSQL OK" || echo "   ✗ PostgreSQL FAILED"

echo ""
echo "2. Checking Redis..."
redis-cli -h localhost ping 2>&1 && echo "   ✓ Redis OK" || echo "   ✗ Redis FAILED"

echo ""
echo "3. Checking migration files..."
ls -la /app/dist/database/migrations/*.sql 2>&1 | head -5

echo ""
echo "4. Testing database connection from Node.js..."
node -e "
const { db } = require('./dist/database/postgres');
db.connect().then(() => {
  console.log('   ✓ Database connection OK');
  process.exit(0);
}).catch(err => {
  console.log('   ✗ Database connection FAILED:', err.message);
  process.exit(1);
});
" 2>&1

echo ""
echo "5. Testing Redis connection from Node.js..."
node -e "
const { redis } = require('./dist/database/redis');
redis.connect().then(() => {
  console.log('   ✓ Redis connection OK');
  process.exit(0);
}).catch(err => {
  console.log('   ✗ Redis connection FAILED:', err.message);
  process.exit(1);
});
" 2>&1

echo ""
echo "6. Attempting full server start (10 seconds)..."
timeout 10 node dist/index.js 2>&1 || echo "   Server exited"

echo ""
echo "=== Diagnosis Complete ==="

