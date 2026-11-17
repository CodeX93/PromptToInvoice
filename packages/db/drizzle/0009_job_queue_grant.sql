-- pg-boss issues CREATE SCHEMA IF NOT EXISTS on start, which requires CREATE on the database
-- even when the schema exists. Grant it to the system role only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pti_system') THEN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO pti_system', current_database());
  END IF;
END $$;
