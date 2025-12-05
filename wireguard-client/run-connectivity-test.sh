#!/bin/bash

# Helper script to run connectivity tests from host machine
# This script will execute the test inside the wireguard-client container

set -e

CONTAINER_NAME="wireguard-client"
BOSONSERVER_HOST="${1:-mail.s0me.uk}"
HTTP_PORT="${2:-3003}"
TURN_TCP_PORT="${3:-3478}"
TURN_UDP_PORTS="${4:-3478,3479,3480}"

echo "Running connectivity test from wireguard-client container..."
echo "Target: $BOSONSERVER_HOST"
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container '$CONTAINER_NAME' is not running."
    echo "Please start it first with: docker-compose up -d"
    exit 1
fi

# Copy test script to container if it doesn't exist
if ! docker exec "$CONTAINER_NAME" test -f /test-connectivity.sh 2>/dev/null; then
    echo "Copying test script to container..."
    docker cp test-connectivity.sh "$CONTAINER_NAME:/test-connectivity.sh"
    docker exec "$CONTAINER_NAME" chmod +x /test-connectivity.sh
fi

# Run the test
echo "Executing connectivity tests..."
docker exec "$CONTAINER_NAME" /test-connectivity.sh "$BOSONSERVER_HOST" "$HTTP_PORT" "$TURN_TCP_PORT" "$TURN_UDP_PORTS"

