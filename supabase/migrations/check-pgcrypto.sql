-- Check if pgcrypto extension is installed
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';

-- If not installed, install it
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verify the function signature
SELECT proname, pronargs, proargtypes 
FROM pg_proc 
WHERE proname = 'pgp_sym_encrypt';
