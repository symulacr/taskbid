-- Create api schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS api;

-- Move all tables from public to api schema
ALTER TABLE IF EXISTS public.tasks SET SCHEMA api;
ALTER TABLE IF EXISTS public.bids SET SCHEMA api;
ALTER TABLE IF EXISTS public.molbot_profiles SET SCHEMA api;
ALTER TABLE IF EXISTS public.payment_records SET SCHEMA api;
ALTER TABLE IF EXISTS public.events SET SCHEMA api;
ALTER TABLE IF EXISTS public.settings SET SCHEMA api;

-- Move indexes (they follow the table automatically)
-- Grant usage on api schema to anon and authenticated roles
GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA api TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO anon, authenticated, service_role;
