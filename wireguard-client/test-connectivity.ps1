# PowerShell script to test connectivity from wireguard-client container to bosonserver
# Usage: .\test-connectivity.ps1 [BOSONSERVER_HOST] [HTTP_PORT] [TURN_TCP_PORT] [TURN_UDP_PORTS]

param(
    [string]$BosonServerHost = "mail.s0me.uk",
    [int]$HttpPort = 3003,
    [int]$TurnTcpPort = 3478,
    [string]$TurnUdpPorts = "3478,3479,3480"
)

$ContainerName = "wireguard-client"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Testing connectivity to bosonserver" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Target host: $BosonServerHost"
Write-Host "HTTP port: $HttpPort"
Write-Host "TURN TCP port: $TurnTcpPort"
Write-Host "TURN UDP ports: $TurnUdpPorts"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if container is running
$containerRunning = docker ps --format '{{.Names}}' | Select-String -Pattern "^${ContainerName}$"
if (-not $containerRunning) {
    Write-Host "Error: Container '$ContainerName' is not running." -ForegroundColor Red
    Write-Host "Please start it first with: docker-compose up -d" -ForegroundColor Yellow
    exit 1
}

# Copy test script to container if needed
Write-Host "Ensuring test script is in container..." -ForegroundColor Yellow
$scriptExists = docker exec $ContainerName test -f /test-connectivity.sh 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Copying test script to container..." -ForegroundColor Yellow
    docker cp test-connectivity.sh "${ContainerName}:/test-connectivity.sh"
    docker exec $ContainerName chmod +x /test-connectivity.sh
}

# Run the test
Write-Host "Executing connectivity tests..." -ForegroundColor Yellow
Write-Host ""
docker exec $ContainerName /test-connectivity.sh $BosonServerHost $HttpPort $TurnTcpPort $TurnUdpPorts

$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "All connectivity tests passed!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Some connectivity tests failed!" -ForegroundColor Red
}

exit $exitCode

