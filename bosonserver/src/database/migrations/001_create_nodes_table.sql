-- Create nodes table
CREATE TABLE IF NOT EXISTS nodes (
  node_id VARCHAR(255) PRIMARY KEY,
  public_key TEXT NOT NULL,
  network_info JSONB NOT NULL,
  capabilities JSONB NOT NULL,
  location JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'online',
  last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
  registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  session_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index on status for quick filtering
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_heartbeat ON nodes(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_nodes_location ON nodes USING GIN(location);
CREATE INDEX IF NOT EXISTS idx_nodes_expires_at ON nodes(expires_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

