#!/bin/bash
set -e

echo "=== Diagnosing BosonServer Startup ==="

cd /app

echo "1. Testing PostgreSQL connection..."
export PGPASSWORD=postgres
psql -U postgres -h localhost -d postgres -c "SELECT 1" > /dev/null 2>&1 && echo "   ✓ PostgreSQL accessible" || echo "   ✗ PostgreSQL not accessible"

echo "2. Testing Redis connection..."
redis-cli -h localhost ping > /dev/null 2>&1 && echo "   ✓ Redis accessible" || echo "   ✗ Redis not accessible"

echo "3. Checking SQL migration files..."
if [ -f "/app/dist/database/migrations/001_create_nodes_table.sql" ]; then
    echo "   ✓ Migration files found"
else
    echo "   ✗ Migration files NOT found"
fi

echo "4. Running test script..."
node test-start.js 2>&1 | tail -20

echo "5. Attempting to start server..."
timeout 10 node dist/index.js 2>&1 || echo "   Server exited with code: $?"

