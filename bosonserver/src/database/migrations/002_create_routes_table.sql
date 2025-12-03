-- Create routes table
CREATE TABLE IF NOT EXISTS routes (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  path TEXT[] NOT NULL,
  estimated_latency INTEGER NOT NULL,
  estimated_bandwidth INTEGER NOT NULL,
  cost DECIMAL(10, 2) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- Create index on type and priority for route selection
CREATE INDEX IF NOT EXISTS idx_routes_type ON routes(type);
CREATE INDEX IF NOT EXISTS idx_routes_priority ON routes(priority DESC);
CREATE INDEX IF NOT EXISTS idx_routes_expires_at ON routes(expires_at);

-- Create index on path for searching
CREATE INDEX IF NOT EXISTS idx_routes_path ON routes USING GIN(path);

