-- pg-boss keeps its tables in a dedicated schema owned by the system role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pti_system') THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION pti_system';
  ELSE
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS pgboss';
  END IF;
END $$;
