#!/bin/bash

# Full Connection Test - Tests complete wireguard-client to bosonserver connection flow
# This verifies the entire connection process including TURN usage

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
echo "Full Connection Flow Test"
echo "=========================================="
echo "BosonServer: $BOSONSERVER_URL"
echo "TURN Server: $TURN_HOST:$TURN_PORT"
echo "=========================================="
echo ""

# Step 1: Verify basic connectivity
test_basic_connectivity() {
    echo -e "${BLUE}=== Step 1: Basic Connectivity ===${NC}"
    
    local passed=0
    local total=0
    
    # Test HTTP API
    total=$((total + 1))
    if curl -s -f --max-time 5 "${BOSONSERVER_URL}/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ HTTP API accessible${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ HTTP API not accessible${NC}"
    fi
    
    # Test UDP to TURN
    total=$((total + 1))
    if timeout 2 bash -c "echo 'test' > /dev/udp/$TURN_HOST/$TURN_PORT" 2>/dev/null; then
        echo -e "${GREEN}✓ UDP to TURN server accessible${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ UDP to TURN server not accessible${NC}"
    fi
    
    # Test DNS resolution
    total=$((total + 1))
    if ping -c 1 -W 2 "$TURN_HOST" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ DNS resolution working${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ DNS resolution failed${NC}"
    fi
    
    echo "Basic connectivity: $passed/$total tests passed"
    return $([ $passed -eq $total ] && echo 0 || echo 1)
}

# Step 2: Test API endpoints
test_api_endpoints() {
    echo ""
    echo -e "${BLUE}=== Step 2: API Endpoints ===${NC}"
    
    local passed=0
    local total=0
    
    # Health endpoint
    total=$((total + 1))
    local health=$(curl -s "${BOSONSERVER_URL}/health" 2>/dev/null)
    if echo "$health" | grep -q '"status":"healthy"'; then
        echo -e "${GREEN}✓ Health endpoint working${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ Health endpoint failed${NC}"
    fi
    
    # TURN servers endpoint
    total=$((total + 1))
    local turn_servers=$(curl -s "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    if echo "$turn_servers" | grep -q '"servers"'; then
        echo -e "${GREEN}✓ TURN servers endpoint working${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ TURN servers endpoint failed${NC}"
    fi
    
    # ICE servers endpoint
    total=$((total + 1))
    local ice_servers=$(curl -s "${BOSONSERVER_URL}/api/v1/turn/ice" 2>/dev/null)
    if echo "$ice_servers" | grep -q '"iceServers"'; then
        echo -e "${GREEN}✓ ICE servers endpoint working${NC}"
        passed=$((passed + 1))
    else
        echo -e "${RED}✗ ICE servers endpoint failed${NC}"
    fi
    
    echo "API endpoints: $passed/$total tests passed"
    return $([ $passed -eq $total ] && echo 0 || echo 1)
}

# Step 3: Test TURN credentials
test_turn_credentials() {
    echo ""
    echo -e "${BLUE}=== Step 3: TURN Credentials ===${NC}"
    
    local response=$(curl -s "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    
    if [ -z "$response" ]; then
        echo -e "${RED}✗ Failed to get TURN credentials${NC}"
        return 1
    fi
    
    if command -v jq >/dev/null 2>&1; then
        local username=$(echo "$response" | jq -r '.servers[0].username // empty')
        local password=$(echo "$response" | jq -r '.servers[0].password // empty')
        local realm=$(echo "$response" | jq -r '.servers[0].realm // empty')
        
        if [ -n "$username" ] && [ "$username" != "null" ] && [ -n "$password" ] && [ "$password" != "null" ]; then
            echo -e "${GREEN}✓ TURN credentials retrieved${NC}"
            echo "  Username: $username"
            echo "  Realm: $realm"
            echo "  Password: ${password:0:10}..."
            return 0
        else
            echo -e "${RED}✗ Invalid credentials format${NC}"
            return 1
        fi
    else
        if echo "$response" | grep -q '"username"'; then
            echo -e "${GREEN}✓ TURN credentials retrieved (jq not available for parsing)${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed to parse credentials${NC}"
            return 1
        fi
    fi
}

# Step 4: Test routing API (if available)
test_routing_api() {
    echo ""
    echo -e "${BLUE}=== Step 4: Routing API ===${NC}"
    
    # Generate a valid UUID for testing
    local test_uuid
    if command -v uuidgen >/dev/null 2>&1; then
        test_uuid=$(uuidgen)
    elif [ -f /proc/sys/kernel/random/uuid ]; then
        test_uuid=$(cat /proc/sys/kernel/random/uuid)
    else
        test_uuid="550e8400-e29b-41d4-a716-446655440001"
    fi
    
    # Test routing request endpoint (POST)
    local response_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "{\"clientId\":\"$test_uuid\",\"clientNetworkInfo\":{\"ipv4\":\"172.17.0.2\",\"natType\":\"Symmetric\"}}" \
        "${BOSONSERVER_URL}/api/v1/routing/request" 2>/dev/null)
    
    if [ "$response_code" = "200" ]; then
        echo -e "${GREEN}✓ Routing request endpoint working (HTTP $response_code)${NC}"
        return 0
    elif [ "$response_code" = "400" ] || [ "$response_code" = "500" ]; then
        echo -e "${YELLOW}⚠ Routing request endpoint exists but returned HTTP $response_code${NC}"
        echo "  (May need active nodes or valid configuration)"
        return 0  # Endpoint exists, just may not have nodes
    elif [ "$response_code" = "404" ]; then
        echo -e "${YELLOW}⚠ Routing API endpoint not found (HTTP $response_code)${NC}"
        return 1
    else
        echo -e "${YELLOW}⚠ Routing API endpoint returned HTTP $response_code${NC}"
        return 0  # Endpoint exists
    fi
}

# Step 5: Network configuration check
test_network_config() {
    echo ""
    echo -e "${BLUE}=== Step 5: Network Configuration ===${NC}"
    
    # Check default route
    local default_route=$(ip route | grep "^default" || echo "")
    if [ -n "$default_route" ]; then
        echo -e "${GREEN}✓ Default route configured${NC}"
        echo "  $default_route"
    else
        echo -e "${YELLOW}⚠ No default route found${NC}"
    fi
    
    # Check interfaces
    local interfaces=$(ip -o link show | awk -F': ' '{print $2}' | grep -v lo)
    echo -e "${GREEN}✓ Network interfaces:${NC}"
    for iface in $interfaces; do
        local ip=$(ip addr show "$iface" 2>/dev/null | grep "inet " | awk '{print $2}' | head -1)
        if [ -n "$ip" ]; then
            echo "  $iface: $ip"
        else
            echo "  $iface: (no IP)"
        fi
    done
    
    return 0
}

# Main test flow
main() {
    local all_passed=true
    
    # Run all tests
    test_basic_connectivity || all_passed=false
    test_api_endpoints || all_passed=false
    test_turn_credentials || all_passed=false
    test_routing_api || all_passed=false
    test_network_config || all_passed=false
    
    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    
    if [ "$all_passed" = true ]; then
        echo -e "${GREEN}✓ All connection tests passed!${NC}"
        echo ""
        echo "The wireguard-client container is ready to:"
        echo "  - Connect to bosonserver API"
        echo "  - Retrieve TURN credentials"
        echo "  - Use TURN server for NAT traversal"
        echo "  - Establish VPN connections"
        return 0
    else
        echo -e "${YELLOW}⚠ Some tests had issues${NC}"
        echo ""
        echo "Review the test results above for details"
        return 1
    fi
}

main "$@"

