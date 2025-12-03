#!/bin/bash
# Script to generate secure passwords for BosonServer

echo "Generating secure passwords for BosonServer..."
echo ""

# Generate passwords using OpenSSL
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
TURN_STATIC_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

echo "# Add these to your .env file or docker-compose.yml"
echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
echo "REDIS_PASSWORD=${REDIS_PASSWORD}"
echo "JWT_SECRET=${JWT_SECRET}"
echo "TURN_STATIC_SECRET=${TURN_STATIC_SECRET}"
echo ""
echo "# Or export them before running docker-compose:"
echo "export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'"
echo "export REDIS_PASSWORD='${REDIS_PASSWORD}'"
echo "export JWT_SECRET='${JWT_SECRET}'"
echo "export TURN_STATIC_SECRET='${TURN_STATIC_SECRET}'"
echo ""
echo "⚠️  IMPORTANT: Save these passwords securely! They will not be shown again."

