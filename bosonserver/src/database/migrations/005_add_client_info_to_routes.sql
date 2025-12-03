-- Add client information columns to routes table
ALTER TABLE routes 
ADD COLUMN IF NOT EXISTS client_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS client_network_info JSONB,
ADD COLUMN IF NOT EXISTS requirements JSONB;

-- Create index on client_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_routes_client_id ON routes(client_id);

