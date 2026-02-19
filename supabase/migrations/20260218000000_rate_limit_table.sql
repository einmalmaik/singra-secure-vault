-- Create table for server-side rate limiting
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- userId or email
    action TEXT NOT NULL CHECK (action IN ('unlock', '2fa', 'passkey', 'emergency')),
    success BOOLEAN NOT NULL DEFAULT false,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX idx_rate_limit_identifier_action ON rate_limit_attempts(identifier, action);
CREATE INDEX idx_rate_limit_attempted_at ON rate_limit_attempts(attempted_at);
CREATE INDEX idx_rate_limit_locked_until ON rate_limit_attempts(locked_until) WHERE locked_until IS NOT NULL;

-- Enable RLS
ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table
CREATE POLICY "Service role only" ON rate_limit_attempts
FOR ALL USING (auth.role() = 'service_role');

-- Add cleanup function to remove old entries (optional, can be run via cron)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limit_attempts()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limit_attempts
    WHERE attempted_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limit_attempts() TO service_role;
