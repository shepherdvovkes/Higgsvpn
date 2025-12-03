#!/bin/bash
set -e

echo "=== Testing BosonServer Components ==="

BASE_URL="http://localhost:3000"
MAX_RETRIES=30
RETRY_DELAY=2

# Wait for server to be ready
echo "Waiting for server to be ready..."
for i in $(seq 1 $MAX_RETRIES); do
  if curl -s -f "$BASE_URL/health" > /dev/null 2>&1; then
    echo "Server is ready!"
    break
  fi
  if [ $i -eq $MAX_RETRIES ]; then
    echo "ERROR: Server did not become ready after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Attempt $i/$MAX_RETRIES: Server not ready, waiting ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

# Test results
PASSED=0
FAILED=0

# Test function
test_endpoint() {
  local name=$1
  local method=$2
  local endpoint=$3
  local expected_status=${4:-200}
  local data=${5:-""}
  
  echo ""
  echo "Testing: $name"
  echo "  Endpoint: $method $endpoint"
  
  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
  elif [ "$method" = "POST" ]; then
    response=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "$data" "$BASE_URL$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
  fi
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo "  ✓ PASSED (Status: $http_code)"
    if [ -n "$body" ] && [ "$body" != "null" ]; then
      echo "  Response: $(echo "$body" | head -c 200)"
    fi
    ((PASSED++))
    return 0
  else
    echo "  ✗ FAILED (Expected: $expected_status, Got: $http_code)"
    if [ -n "$body" ]; then
      echo "  Response: $body"
    fi
    ((FAILED++))
    return 1
  fi
}

# Health check
test_endpoint "Health Check" "GET" "/health" 200

# Metrics endpoint
test_endpoint "Metrics Endpoint" "GET" "/metrics" 200

# Nodes endpoints
test_endpoint "Get Nodes" "GET" "/api/v1/nodes" 200

# Test node registration (will fail without auth, but should return proper error)
test_endpoint "Node Registration (without auth)" "POST" "/api/v1/nodes/register" 401

# Routing endpoints
test_endpoint "Get Routes" "GET" "/api/v1/routing/routes" 200

# TURN endpoints
test_endpoint "Get TURN Credentials" "GET" "/api/v1/turn/credentials" 200

# WebSocket endpoint (check if it's accessible)
echo ""
echo "Testing: WebSocket Endpoint"
if curl -s -f --http1.1 --no-buffer -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" "$BASE_URL/relay/test" > /dev/null 2>&1; then
  echo "  ✓ WebSocket endpoint accessible"
  ((PASSED++))
else
  echo "  ✗ WebSocket endpoint not accessible (this may be expected)"
  ((FAILED++))
fi

# Database connectivity (check logs or metrics)
echo ""
echo "Testing: Database Connectivity"
db_check=$(curl -s "$BASE_URL/metrics" | grep -i "postgres\|database" || echo "")
if [ -n "$db_check" ]; then
  echo "  ✓ Database metrics found"
  ((PASSED++))
else
  echo "  ⚠ Database metrics not found in /metrics (may be normal)"
fi

# Redis connectivity
echo ""
echo "Testing: Redis Connectivity"
redis_check=$(curl -s "$BASE_URL/metrics" | grep -i "redis" || echo "")
if [ -n "$redis_check" ]; then
  echo "  ✓ Redis metrics found"
  ((PASSED++))
else
  echo "  ⚠ Redis metrics not found in /metrics (may be normal)"
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi

