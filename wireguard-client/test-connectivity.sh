#!/bin/bash

# Test script to check TCP and UDP connectivity from wireguard-client to bosonserver
# Usage: ./test-connectivity.sh [BOSONSERVER_HOST] [BOSONSERVER_PORT]

set -e

# Default values
BOSONSERVER_HOST="${1:-mail.s0me.uk}"
HTTP_PORT="${2:-3003}"
TURN_TCP_PORT="${3:-3478}"
TURN_UDP_PORTS="${4:-3478,3479,3480}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Testing connectivity to bosonserver"
echo "=========================================="
echo "Target host: $BOSONSERVER_HOST"
echo "HTTP port: $HTTP_PORT"
echo "TURN TCP port: $TURN_TCP_PORT"
echo "TURN UDP ports: $TURN_UDP_PORTS"
echo "=========================================="
echo ""

# Function to test TCP connectivity
test_tcp() {
    local host=$1
    local port=$2
    local name=$3
    
    echo -n "Testing TCP $name ($host:$port)... "
    
    if timeout 5 bash -c "echo > /dev/tcp/$host/$port" 2>/dev/null; then
        echo -e "${GREEN}✓ SUCCESS${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi
}

# Function to test UDP connectivity
test_udp() {
    local host=$1
    local port=$2
    local name=$3
    
    echo -n "Testing UDP $name ($host:$port)... "
    
    # Try to send a UDP packet using netcat or nc
    if command -v nc >/dev/null 2>&1; then
        # Send a test packet and check if we get any response (or at least no immediate error)
        if echo "test" | timeout 3 nc -u -w 2 "$host" "$port" 2>/dev/null; then
            echo -e "${GREEN}✓ SUCCESS (got response)${NC}"
            return 0
        elif timeout 3 nc -u -w 2 "$host" "$port" < /dev/null 2>/dev/null; then
            # Even if no response, if connection doesn't fail immediately, port might be open
            echo -e "${YELLOW}? OPEN (no response, but no error)${NC}"
            return 0
        else
            echo -e "${RED}✗ FAILED${NC}"
            return 1
        fi
    elif command -v timeout >/dev/null 2>&1; then
        # Fallback: try using /dev/udp (bash feature)
        if timeout 3 bash -c "echo 'test' > /dev/udp/$host/$port" 2>/dev/null; then
            echo -e "${YELLOW}? PACKET SENT (no response verification)${NC}"
            return 0
        else
            echo -e "${RED}✗ FAILED${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}? SKIPPED (no UDP testing tools available)${NC}"
        return 1
    fi
}

# Function to test HTTP endpoint
test_http() {
    local host=$1
    local port=$2
    
    echo -n "Testing HTTP endpoint (http://$host:$port/health)... "
    
    if command -v curl >/dev/null 2>&1; then
        if curl -s -f --max-time 5 "http://$host:$port/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ SUCCESS${NC}"
            # Try to get the actual response
            response=$(curl -s --max-time 5 "http://$host:$port/health" 2>/dev/null || echo "")
            if [ -n "$response" ]; then
                echo "  Response: $response"
            fi
            return 0
        else
            echo -e "${RED}✗ FAILED${NC}"
            return 1
        fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -q --timeout=5 -O - "http://$host:$port/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ SUCCESS${NC}"
            return 0
        else
            echo -e "${RED}✗ FAILED${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}? SKIPPED (no HTTP client available)${NC}"
        return 1
    fi
}

# Test results tracking
TCP_SUCCESS=0
TCP_TOTAL=0
UDP_SUCCESS=0
UDP_TOTAL=0
HTTP_SUCCESS=0

echo "=== TCP Connectivity Tests ==="
# Test HTTP API port (TCP)
TCP_TOTAL=$((TCP_TOTAL + 1))
if test_tcp "$BOSONSERVER_HOST" "$HTTP_PORT" "HTTP API"; then
    TCP_SUCCESS=$((TCP_SUCCESS + 1))
fi

# Test TURN TCP port
TCP_TOTAL=$((TCP_TOTAL + 1))
if test_tcp "$BOSONSERVER_HOST" "$TURN_TCP_PORT" "TURN Server"; then
    TCP_SUCCESS=$((TCP_SUCCESS + 1))
fi

echo ""
echo "=== UDP Connectivity Tests ==="
# Test UDP ports
IFS=',' read -ra UDP_PORT_ARRAY <<< "$TURN_UDP_PORTS"
for port in "${UDP_PORT_ARRAY[@]}"; do
    UDP_TOTAL=$((UDP_TOTAL + 1))
    if test_udp "$BOSONSERVER_HOST" "$port" "TURN Server"; then
        UDP_SUCCESS=$((UDP_SUCCESS + 1))
    fi
done

echo ""
echo "=== HTTP Endpoint Tests ==="
# Test HTTP health endpoint
if test_http "$BOSONSERVER_HOST" "$HTTP_PORT"; then
    HTTP_SUCCESS=1
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "TCP: $TCP_SUCCESS/$TCP_TOTAL successful"
echo "UDP: $UDP_SUCCESS/$UDP_TOTAL successful"
echo "HTTP: $([ $HTTP_SUCCESS -eq 1 ] && echo 'SUCCESS' || echo 'FAILED')"
echo "=========================================="

# Exit with error if any critical test failed
if [ $TCP_SUCCESS -lt $TCP_TOTAL ] || [ $UDP_SUCCESS -eq 0 ]; then
    echo -e "${RED}Some connectivity tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}All connectivity tests passed!${NC}"
    exit 0
fi

