#!/bin/bash
set -e

echo "Initializing PostgreSQL database..."

# Wait for PostgreSQL to be ready
until pg_isready -U postgres; do
  echo "Waiting for PostgreSQL to start..."
  sleep 1
done

# Get password from environment or use default
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# Wait a bit for PostgreSQL to fully start
sleep 2

# Create database if it doesn't exist (using password)
export PGPASSWORD="${POSTGRES_PASSWORD}"
psql -U postgres -h localhost -tc "SELECT 1 FROM pg_database WHERE datname = 'bosonserver'" | grep -q 1 || \
  psql -U postgres -h localhost -c "CREATE DATABASE bosonserver"

echo "PostgreSQL database initialized successfully"

