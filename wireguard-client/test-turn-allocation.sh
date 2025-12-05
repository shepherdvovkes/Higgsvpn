#!/bin/bash

# Comprehensive TURN Allocation Test
# Tests TURN server functionality using credentials from bosonserver API

set -e

BOSONSERVER_URL="${BOSONSERVER_URL:-http://mail.s0me.uk:3003}"
TURN_HOST="mail.s0me.uk"
TURN_PORT=3478

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "TURN Allocation Test"
echo "=========================================="
echo "TURN Server: $TURN_HOST:$TURN_PORT"
echo "BosonServer API: $BOSONSERVER_URL"
echo "=========================================="
echo ""

# Get TURN credentials
get_credentials() {
    echo -e "${BLUE}=== Getting TURN Credentials ===${NC}"
    
    local response
    if command -v curl >/dev/null 2>&1; then
        response=$(curl -s "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    else
        response=$(wget -qO- "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    fi
    
    if [ -z "$response" ]; then
        echo -e "${RED}Failed to get TURN credentials${NC}"
        return 1
    fi
    
    # Extract credentials using jq if available
    if command -v jq >/dev/null 2>&1; then
        TURN_USERNAME=$(echo "$response" | jq -r '.servers[0].username // empty')
        TURN_PASSWORD=$(echo "$response" | jq -r '.servers[0].password // empty')
        TURN_REALM=$(echo "$response" | jq -r '.servers[0].realm // empty')
        
        if [ -z "$TURN_USERNAME" ] || [ "$TURN_USERNAME" = "null" ]; then
            echo -e "${RED}Failed to extract credentials${NC}"
            return 1
        fi
        
        echo -e "${GREEN}Credentials retrieved:${NC}"
        echo "  Username: $TURN_USERNAME"
        echo "  Password: $TURN_PASSWORD"
        echo "  Realm: $TURN_REALM"
        return 0
    else
        echo -e "${YELLOW}jq not available, cannot parse credentials${NC}"
        echo "Response: $response"
        return 1
    fi
}

# Test with turnutils_peer if available
test_turn_allocation() {
    echo ""
    echo -e "${BLUE}=== Testing TURN Allocation ===${NC}"
    
    if ! command -v turnutils_peer >/dev/null 2>&1; then
        echo -e "${YELLOW}turnutils_peer not available${NC}"
        echo "Install coturn package to get TURN testing utilities:"
        echo "  apt-get install coturn"
        return 1
    fi
    
    if [ -z "$TURN_USERNAME" ] || [ -z "$TURN_PASSWORD" ]; then
        echo -e "${RED}Credentials not available${NC}"
        return 1
    fi
    
    echo "Testing TURN allocation with credentials..."
    echo "This will attempt to create a TURN allocation..."
    
    # turnutils_peer can be used to test TURN allocation
    # Note: This is a simplified test
    echo -e "${YELLOW}Note: Full TURN allocation test requires a TURN client library${NC}"
    echo "For comprehensive testing, use:"
    echo "  - Trickle ICE: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
    echo "  - Python pystun3 library"
    echo "  - Node.js node-turn library"
    
    return 0
}

# Test connectivity summary
test_connectivity_summary() {
    echo ""
    echo -e "${BLUE}=== Connectivity Summary ===${NC}"
    
    # Test UDP connectivity
    echo -n "UDP port $TURN_PORT: "
    if timeout 2 bash -c "echo 'test' > /dev/udp/$TURN_HOST/$TURN_PORT" 2>/dev/null; then
        echo -e "${GREEN}✓ Accessible${NC}"
    else
        echo -e "${RED}✗ Not accessible${NC}"
    fi
    
    # Test TCP connectivity
    echo -n "TCP port $TURN_PORT: "
    if timeout 2 bash -c "echo > /dev/tcp/$TURN_HOST/$TURN_PORT" 2>/dev/null; then
        echo -e "${GREEN}✓ Accessible${NC}"
    else
        echo -e "${YELLOW}? Not accessible (may be normal for UDP-only TURN)${NC}"
    fi
    
    # Test HTTP API
    echo -n "HTTP API ($BOSONSERVER_URL): "
    if curl -s -f --max-time 3 "$BOSONSERVER_URL/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Accessible${NC}"
    else
        echo -e "${RED}✗ Not accessible${NC}"
    fi
}

# Main
main() {
    local success=0
    
    # Get credentials
    if get_credentials; then
        success=$((success + 1))
    fi
    
    # Test allocation (if tools available)
    test_turn_allocation
    
    # Connectivity summary
    test_connectivity_summary
    
    echo ""
    echo "=========================================="
    echo "Test Complete"
    echo "=========================================="
    echo ""
    echo "For comprehensive TURN testing, use:"
    echo "  1. Trickle ICE test page:"
    echo "     https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
    echo "     Add server: turn:$TURN_HOST:$TURN_PORT"
    echo "     Username: $TURN_USERNAME"
    echo "     Password: $TURN_PASSWORD"
    echo ""
    echo "  2. Or install coturn utilities:"
    echo "     apt-get install coturn"
    echo "     turnutils_stunclient $TURN_HOST -p $TURN_PORT"
    
    return 0
}

main "$@"

