-- Retention purge: issued documents may be deleted only by the maintenance job, which sets the
-- transaction-local flag app.retention_purge = 'on' for organisations deleted past their retention.
CREATE OR REPLACE FUNCTION retention_purge_active() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.retention_purge', true), '') = 'on' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND NOT retention_purge_active() THEN
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

  IF OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
    RAISE EXCEPTION 'archived PDF of invoice % cannot be replaced', OLD.id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF retention_purge_active() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO s FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'lines of issued invoice % are immutable', COALESCE(NEW.invoice_id, OLD.invoice_id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_no_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF retention_purge_active() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'payments cannot be deleted; record a refund instead' USING ERRCODE = 'P0001';
END $$;
