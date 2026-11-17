-- ───────────────────────────── Roles ─────────────────────────────
-- pti_app:    used by the web app; subject to row-level security.
-- pti_system: used by workers, webhooks and the hosted invoice page; bypasses RLS.
-- Passwords are set out-of-band by the operator (see docs/runbooks/database.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pti_app') THEN
    CREATE ROLE pti_app LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pti_system') THEN
    CREATE ROLE pti_system LOGIN BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pti_app, pti_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pti_app, pti_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pti_app, pti_system;
--> statement-breakpoint
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_log FROM pti_app;
--> statement-breakpoint

-- ──────────────────────── Tenant isolation ────────────────────────
-- Every tenant-owned table carries org_id. The app sets `app.org_id` with
-- SET LOCAL inside each transaction; rows of other organisations are
-- invisible and cannot be written, even if a query forgets a WHERE clause.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_profiles','number_series','number_counters','clients','tax_rates','catalog_items',
    'invoices','invoice_lines','payments','invoice_events','recurring_schedules',
    'files','email_messages','ai_drafts','usage_counters','idempotency_keys','audit_log','subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ─────────────────────── Issued-invoice immutability ───────────────────────
-- Once issued, an invoice's legal content is frozen (GoBD / EU VAT Directive).
-- Corrections happen through credit notes. Only lifecycle facts may change.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    RAISE EXCEPTION 'issued invoice % cannot return to draft', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'void invoice % cannot be reopened', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.org_id, NEW.business_profile_id, NEW.client_id, NEW.doc_type, NEW.number, NEW.series_id,
      NEW.issue_date, NEW.supply_date, NEW.due_date, NEW.currency, NEW.language, NEW.reference,
      NEW.discount_type, NEW.discount_value, NEW.line_net_total, NEW.discount_total, NEW.tax_exclusive,
      NEW.tax_total, NEW.total, NEW.tax_breakdown, NEW.fx_rate, NEW.fx_currency, NEW.notes, NEW.terms,
      NEW.tax_note, NEW.corrects_invoice_id, NEW.issued_snapshot, NEW.issued_at)
     IS DISTINCT FROM
     (OLD.org_id, OLD.business_profile_id, OLD.client_id, OLD.doc_type, OLD.number, OLD.series_id,
      OLD.issue_date, OLD.supply_date, OLD.due_date, OLD.currency, OLD.language, OLD.reference,
      OLD.discount_type, OLD.discount_value, OLD.line_net_total, OLD.discount_total, OLD.tax_exclusive,
      OLD.tax_total, OLD.total, OLD.tax_breakdown, OLD.fx_rate, OLD.fx_currency, OLD.notes, OLD.terms,
      OLD.tax_note, OLD.corrects_invoice_id, OLD.issued_snapshot, OLD.issued_at)
  THEN
    RAISE EXCEPTION 'issued invoice % is immutable; issue a credit note instead', OLD.id USING ERRCODE = 'P0001';
  END IF;

  -- The rendered PDF is part of the record: it may be set once, never replaced.
  IF OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
    RAISE EXCEPTION 'archived PDF of invoice % cannot be replaced', OLD.id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard_trg
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- Cascading delete of a draft invoice: parent row already gone.
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'lines of issued invoice % are immutable', COALESCE(NEW.invoice_id, OLD.invoice_id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
--> statement-breakpoint
-- Payments are financial records: never deleted, only refunded.
CREATE OR REPLACE FUNCTION payments_no_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payments cannot be deleted; record a refund instead' USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete_trg
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_no_delete();
