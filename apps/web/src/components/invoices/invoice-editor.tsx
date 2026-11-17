"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { Route } from "next";
import {
  CURRENCY_CODES,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABEL,
  formatMoney,
  type CurrencyCode,
  type TaxCategory,
} from "@pti/core";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { errorToast } from "@/lib/action-state";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/cn";
import {
  applyTaxTreatment,
  blankLine,
  computeTotals,
  moveLine,
  taxSuggestion,
  toPayload,
  withClient,
  type EditorLine,
  type EditorState,
  type SellerContext,
} from "@/lib/invoice-editor";
import { deleteDraftAction, issueInvoiceAction, saveInvoice } from "@/app/app/invoices/actions";
import { ClientPicker } from "./client-picker";

export interface TaxRateOption {
  id: string;
  name: string;
  category: TaxCategory;
  rate: string;
}

export interface InvoiceEditorProps {
  id: string | null;
  version: number;
  docType: "invoice" | "credit_note" | "quote";
  initial: EditorState;
  seller: SellerContext & { name: string; defaultTermsDays: number };
  taxRates: TaxRateOption[];
  countries: { code: string; name: string }[];
  /** Field paths filled by the AI ("client", "lines.0.description", …) — shown with a highlighter mark until edited. */
  aiFields?: string[];
  canIssue: boolean;
  /** Currencies the plan allows; others are shown disabled with an upgrade hint. */
  allowedCurrencies: readonly string[] | null;
  /** Assumptions the AI made, shown as a margin note. */
  aiNotes?: string[];
}

const LANGS = [
  ["en", "English"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["es", "Español"],
  ["nl", "Nederlands"],
  ["it", "Italiano"],
] as const;

type SaveState = "clean" | "dirty" | "saving" | "error";

export function InvoiceEditor(props: InvoiceEditorProps) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(props.initial);
  const [id, setId] = useState(props.id);
  const [version, setVersion] = useState(props.version);
  const [save, setSave] = useState<SaveState>(props.id ? "clean" : "dirty");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [ai, setAi] = useState(() => new Set(props.aiFields ?? []));
  const [issuing, startIssue] = useTransition();
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const totals = useMemo(() => computeTotals(state), [state]);
  const suggestion = useMemo(() => taxSuggestion(state, props.seller), [state, props.seller]);
  const fmt = (minor: number) => formatMoney(minor, state.currency);
  const isCredit = props.docType === "credit_note";
  const isQuote = props.docType === "quote";
  const docLabel = isCredit ? "Credit note" : isQuote ? "Quote" : "Invoice";

  const update = useCallback(
    (patch: Partial<EditorState> | ((s: EditorState) => EditorState), touched?: string) => {
      setState((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
      setSave("dirty");
      if (touched)
        setAi((a) => (a.has(touched) ? new Set([...a].filter((x) => x !== touched)) : a));
    },
    [],
  );

  const setLine = (i: number, patch: Partial<EditorLine>, field: string) =>
    update(
      (s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }),
      `lines.${i}.${field}`,
    );

  const defaultRate = props.taxRates[0];
  const addLine = () =>
    update((s) => ({
      ...s,
      lines: [
        ...s.lines,
        blankLine(
          s.lines.at(-1)?.taxCategory ?? defaultRate?.category ?? "O",
          s.lines.at(-1)?.taxRate ?? defaultRate?.rate ?? "0",
        ),
      ],
    }));

  const doSave = useCallback(async (): Promise<string | null> => {
    setSave("saving");
    const snapshot = stateRef.current;
    const res = await saveInvoice(id, toPayload(snapshot), id ? version : undefined, props.docType);
    if (!res.ok) {
      setSave("error");
      setErrors(res.fieldErrors ?? {});
      errorToast(res, toast);
      return null;
    }
    setErrors({});
    setVersion(res.data.version);
    setSavedAt(new Date());
    // Only mark clean if nothing changed while the request was in flight.
    setSave(stateRef.current === snapshot ? "clean" : "dirty");
    if (!id) {
      setId(res.data.id);
      window.history.replaceState(null, "", `/app/invoices/${res.data.id}`);
    }
    return res.data.id;
  }, [id, version, props.docType]);

  // Autosave existing drafts shortly after the user stops typing.
  useEffect(() => {
    if (!id || save !== "dirty") return;
    const t = setTimeout(() => void doSave(), 1500);
    return () => clearTimeout(t);
  }, [state, id, save, doSave]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (save !== "dirty" && save !== "saving") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [save]);

  function issue() {
    startIssue(async () => {
      const savedId = save === "clean" && id ? id : await doSave();
      if (!savedId) return;
      const r = await issueInvoiceAction(savedId);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        errorToast(r, toast);
        return;
      }
      toast.success(`${docLabel} ${r.data.number} issued.`);
      router.push(`/app/invoices/${savedId}` as Route);
      router.refresh();
    });
  }

  useHotkeys({
    "mod+s": () => void doSave(),
    "mod+enter": () => props.canIssue && issue(),
  });

  const err = (path: string) => errors[path]?.[0];
  const lineError = !totals.ok ? totals.lineIndex : null;

  return (
    <div className="pb-24">
      {/* ── Command strip ─────────────────────────────────────────── */}
      <div className="border-rule bg-paper/95 sticky top-24 z-20 flex flex-wrap items-center gap-3 border-b px-6 py-2.5 backdrop-blur-[2px] md:top-12 lg:px-10">
        <Link href="/app/invoices" className="text-ink-3 hover:text-ink text-[13px]">
          ← Invoices
        </Link>
        <span className="text-ink-4">/</span>
        <span className="text-[13px]">{docLabel} draft</span>
        <SaveIndicator state={save} at={savedAt} />
        <div className="ml-auto flex items-center gap-2">
          {id ? (
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-danger"
              onClick={() => {
                if (!confirm("Delete this draft? This can't be undone.")) return;
                void deleteDraftAction(id).then((r) => {
                  if (!r.ok) return toast.error(r.error);
                  toast.success("Draft deleted.");
                  setSave("clean");
                  router.push("/app/invoices");
                });
              }}
            >
              Delete
            </Button>
          ) : null}
          {id ? (
            <Button asChild variant="ghost" size="sm">
              <a href={`/app/invoices/${id}/pdf`} target="_blank" rel="noopener">
                Preview PDF
              </a>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void doSave()}
            pending={save === "saving" && !issuing}
            title="⌘S"
          >
            Save draft
          </Button>
          {props.canIssue ? (
            <Button size="sm" onClick={issue} pending={issuing} title="⌘↵">
              Issue {docLabel.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 pt-8 sm:px-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        {/* ── The paper ────────────────────────────────────────────── */}
        <article
          aria-label="Invoice"
          className="border-rule-strong bg-paper-raised shadow-pop rounded-xs border px-6 py-8 sm:px-12 sm:py-12"
        >
          <header className="flex flex-wrap items-start justify-between gap-6">
            <p className="font-serif text-xl">{props.seller.name}</p>
            <div className="text-right">
              <p className="label-caps">{docLabel}</p>
              <p className="text-ink-3 mt-1 font-serif text-2xl">Draft</p>
            </div>
          </header>
          <hr className="border-ink my-6" />

          <section className="grid gap-8 sm:grid-cols-[1fr_auto]">
            <div className="max-w-sm">
              <p className="label-caps mb-1.5">Bill to</p>
              <ClientPicker
                value={state.client}
                onChange={(c) =>
                  update((s) => withClient(s, c, props.seller.defaultTermsDays), "client")
                }
                countries={props.countries}
                invalid={Boolean(err("clientId"))}
                highlight={ai.has("client")}
              />
              {err("clientId") ? (
                <p className="text-danger mt-1 text-xs">{err("clientId")}</p>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_150px] items-center gap-x-6 gap-y-1.5 text-[13px]">
              <MetaInput
                label="Issue date"
                type="date"
                value={state.issueDate}
                onChange={(v) => update({ issueDate: v }, "issueDate")}
                error={err("issueDate")}
                ai={ai.has("issueDate")}
              />
              {!isCredit ? (
                <MetaInput
                  label={isQuote ? "Valid until" : "Due date"}
                  type="date"
                  value={state.dueDate}
                  onChange={(v) => update({ dueDate: v }, "dueDate")}
                  error={err("dueDate")}
                  ai={ai.has("dueDate")}
                />
              ) : null}
              <MetaInput
                label="Reference"
                value={state.reference}
                placeholder="PO / project"
                onChange={(v) => update({ reference: v }, "reference")}
                ai={ai.has("reference")}
              />
            </dl>
          </section>

          {suggestion ? (
            <div
              role="note"
              className="border-accent bg-accent-soft mt-8 flex flex-wrap items-center gap-3 border-l-2 px-4 py-3 text-[13px]"
            >
              <span className="flex-1">
                <strong className="font-medium">{TAX_CATEGORY_LABEL[suggestion.category]}</strong>{" "}
                likely applies to {state.client?.name}
                {suggestion.category === "S" ? ` (${suggestion.rate}%)` : ""}.{" "}
                <span className="text-ink-3">
                  Suggestion only; you're responsible for the tax you charge.
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => update((s) => applyTaxTreatment(s, suggestion))}
              >
                Apply to all lines
              </Button>
            </div>
          ) : null}

          {/* ── Lines ─────────────────────────────────────────────── */}
          <table className="mt-8 w-full text-[13px]">
            <thead>
              <tr className="border-ink border-b text-left">
                <th className="label-caps pb-2 font-medium">Description</th>
                <th className="label-caps w-20 pb-2 text-right font-medium">Qty</th>
                <th className="label-caps hidden w-16 pb-2 pl-2 font-medium sm:table-cell">Unit</th>
                <th className="label-caps w-28 pb-2 text-right font-medium">Price</th>
                <th className="label-caps hidden w-28 pb-2 pl-3 font-medium md:table-cell">Tax</th>
                <th className="label-caps w-28 pb-2 text-right font-medium">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {state.lines.map((l, i) => (
                <tr
                  key={l.key}
                  className={cn(
                    "border-rule group border-b align-top",
                    lineError === i && "bg-danger-soft/50",
                  )}
                >
                  <td className="py-1.5 pr-3">
                    <textarea
                      aria-label={`Line ${i + 1} description`}
                      rows={1}
                      value={l.description}
                      placeholder={i === 0 ? "What did you do?" : "Description"}
                      onChange={(e) => setLine(i, { description: e.target.value }, "description")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && i === state.lines.length - 1) {
                          e.preventDefault();
                          addLine();
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLTextAreaElement>(
                                `[aria-label="Line ${i + 2} description"]`,
                              )
                              ?.focus(),
                          );
                        }
                      }}
                      className={cn(
                        "placeholder:text-ink-4 block [field-sizing:content] w-full resize-none bg-transparent py-1 leading-snug outline-none",
                        ai.has(`lines.${i}.description`) && "ai-field",
                      )}
                    />
                  </td>
                  <td className="py-1.5">
                    <CellInput
                      label={`Line ${i + 1} quantity`}
                      value={l.quantity}
                      onChange={(v) => setLine(i, { quantity: v }, "quantity")}
                      ai={ai.has(`lines.${i}.quantity`)}
                    />
                  </td>
                  <td className="hidden py-1.5 pl-2 sm:table-cell">
                    <input
                      aria-label={`Line ${i + 1} unit`}
                      value={l.unit}
                      placeholder="—"
                      maxLength={20}
                      onChange={(e) => setLine(i, { unit: e.target.value }, "unit")}
                      className={cn(
                        "placeholder:text-ink-4 w-full bg-transparent py-1 outline-none",
                        ai.has(`lines.${i}.unit`) && "ai-field",
                      )}
                    />
                  </td>
                  <td className="py-1.5">
                    <CellInput
                      label={`Line ${i + 1} unit price`}
                      value={l.unitPrice}
                      placeholder="0.00"
                      onChange={(v) => setLine(i, { unitPrice: v }, "unitPrice")}
                      ai={ai.has(`lines.${i}.unitPrice`)}
                    />
                  </td>
                  <td className="hidden py-1.5 pl-3 md:table-cell">
                    <select
                      aria-label={`Line ${i + 1} tax`}
                      value={`${l.taxCategory}|${Number(l.taxRate)}`}
                      onChange={(e) => {
                        const [c, r] = e.target.value.split("|") as [TaxCategory, string];
                        setLine(i, { taxCategory: c, taxRate: r }, "tax");
                      }}
                      className="figures w-full cursor-pointer bg-transparent py-1 text-xs outline-none"
                    >
                      {taxOptions(props.taxRates, l).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="figures py-2 text-right">
                    {totals.ok && totals.result.lines.length
                      ? fmt(lineAmount(totals.result, state.lines, i))
                      : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="invisible inline-flex flex-col group-focus-within:visible group-hover:visible">
                      <button
                        type="button"
                        aria-label={`Move line ${i + 1} up`}
                        onClick={() =>
                          update((s) => ({ ...s, lines: moveLine(s.lines, i, i - 1) }))
                        }
                        className="text-ink-4 hover:text-ink text-[10px] leading-3"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() =>
                          update((s) => ({
                            ...s,
                            lines:
                              s.lines.length > 1
                                ? s.lines.filter((_, j) => j !== i)
                                : [blankLine(l.taxCategory, l.taxRate)],
                          }))
                        }
                        className="text-ink-4 hover:text-danger text-xs leading-4"
                      >
                        ×
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={addLine}
            className="text-ink-3 hover:text-ink mt-3 text-[13px]"
          >
            + Add line <span className="text-ink-4 text-2xs">(Enter on the last line)</span>
          </button>
          {!totals.ok ? <p className="text-danger mt-2 text-xs">{totals.message}</p> : null}

          {/* ── Totals ────────────────────────────────────────────── */}
          {totals.ok ? (
            <dl className="mt-8 ml-auto w-full max-w-xs text-[13px]">
              {totals.result.discountTotal !== 0 || state.discount ? (
                <Row label="Subtotal" value={fmt(totals.result.lineNetTotal)} />
              ) : null}
              {state.discount ? (
                <Row label="Discount" value={fmt(-totals.result.discountTotal)} />
              ) : null}
              {totals.result.taxTotal !== 0 ? (
                <Row label="Total excl. tax" value={fmt(totals.result.taxExclusive)} />
              ) : null}
              {totals.result.breakdown
                .filter((b) => b.tax !== 0)
                .map((b) => (
                  <Row key={`${b.category}${b.rate}`} label={`VAT ${b.rate}%`} value={fmt(b.tax)} />
                ))}
              <div className="rule-double mt-2 flex items-baseline justify-between pt-2 pb-1.5">
                <dt className="font-medium">Total {state.currency}</dt>
                <dd className="figures text-base font-medium">{fmt(totals.result.taxInclusive)}</dd>
              </div>
            </dl>
          ) : null}

          {state.taxNote ? (
            <p className="text-ink-2 mt-6 max-w-lg text-xs">{state.taxNote}</p>
          ) : null}

          <section className="mt-10 grid gap-6 sm:grid-cols-2">
            <NoteArea
              label="Notes"
              value={state.notes}
              onChange={(v) => update({ notes: v }, "notes")}
              ai={ai.has("notes")}
              placeholder="Thank you for your business."
            />
            <NoteArea
              label="Terms"
              value={state.terms}
              onChange={(v) => update({ terms: v }, "terms")}
              placeholder="Payment terms, late fees…"
            />
          </section>
        </article>

        {/* ── Margin rail ──────────────────────────────────────────── */}
        <aside className="flex flex-col gap-6 text-[13px] xl:sticky xl:top-28 xl:self-start">
          {props.aiNotes?.length ? (
            <div className="border-highlight border-l-2 pl-3">
              <p className="label-caps mb-1">Drafted from your prompt</p>
              <ul className="text-ink-2 list-disc space-y-1 pl-4 text-xs">
                {props.aiNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="text-ink-3 text-2xs mt-2">
                <span className="ai-field px-0.5">Highlighted</span> values were filled in for you.
                Check them before issuing.
              </p>
            </div>
          ) : null}
          <RailField label="Currency">
            <Select
              value={state.currency}
              onChange={(e) => update({ currency: e.target.value as CurrencyCode }, "currency")}
              aria-label="Currency"
              className={cn(ai.has("currency") && "ai-field")}
            >
              {CURRENCY_CODES.map((c) => (
                <option
                  key={c}
                  value={c}
                  disabled={
                    props.allowedCurrencies !== null && !props.allowedCurrencies.includes(c)
                  }
                >
                  {c}
                  {props.allowedCurrencies !== null && !props.allowedCurrencies.includes(c)
                    ? " · Pro"
                    : ""}
                </option>
              ))}
            </Select>
          </RailField>
          <RailField label="Document language">
            <Select
              value={state.language}
              onChange={(e) => update({ language: e.target.value })}
              aria-label="Document language"
            >
              {LANGS.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </Select>
          </RailField>
          <RailField label="Date of supply" hint="If different from the issue date.">
            <input
              type="date"
              value={state.supplyDate}
              onChange={(e) => update({ supplyDate: e.target.value })}
              aria-label="Date of supply"
              className="figures border-rule-strong focus:border-ink w-full border-b bg-transparent py-1.5 outline-none"
            />
          </RailField>
          <RailField label="Discount">
            <div className="flex gap-2">
              <Select
                aria-label="Discount type"
                value={state.discount?.type ?? "none"}
                onChange={(e) =>
                  update({
                    discount:
                      e.target.value === "none"
                        ? null
                        : {
                            type: e.target.value as "percent" | "amount",
                            value: state.discount?.value ?? "",
                          },
                  })
                }
                className="w-24"
              >
                <option value="none">None</option>
                <option value="percent">%</option>
                <option value="amount">Amount</option>
              </Select>
              {state.discount ? (
                <input
                  aria-label="Discount value"
                  value={state.discount.value}
                  inputMode="decimal"
                  onChange={(e) =>
                    update({
                      discount: { type: state.discount?.type ?? "percent", value: e.target.value },
                    })
                  }
                  className="figures border-rule-strong focus:border-ink w-full border-b bg-transparent py-1.5 text-right outline-none"
                />
              ) : null}
            </div>
          </RailField>
          <div className="text-ink-4 border-rule text-2xs border-t pt-4 leading-relaxed">
            <kbd className="figures">⌘S</kbd> save · <kbd className="figures">⌘↵</kbd> issue ·{" "}
            <kbd className="figures">Enter</kbd> new line
          </div>
        </aside>
      </div>
    </div>
  );
}

function lineAmount(r: { lines: { net: number }[] }, lines: EditorLine[], i: number): number {
  // Totals skip blank lines; map editor index → result index.
  let k = -1;
  for (let j = 0; j <= i; j++) if (lines[j]?.description.trim() || lines[j]?.unitPrice.trim()) k++;
  const blank = !lines[i]?.description.trim() && !lines[i]?.unitPrice.trim();
  return blank ? 0 : (r.lines[k]?.net ?? 0);
}

function taxOptions(rates: TaxRateOption[], l: EditorLine) {
  const opts = rates.map((r) => ({
    value: `${r.category}|${Number(r.rate)}`,
    label: r.category === "S" ? `${Number(r.rate)}%` : `${r.category} 0%`,
  }));
  const cur = `${l.taxCategory}|${Number(l.taxRate)}`;
  if (!opts.some((o) => o.value === cur))
    opts.unshift({
      value: cur,
      label: l.taxCategory === "S" ? `${Number(l.taxRate)}%` : `${l.taxCategory} 0%`,
    });
  for (const c of TAX_CATEGORIES) {
    const v = `${c}|0`;
    if (c !== "S" && !opts.some((o) => o.value === v))
      opts.push({ value: v, label: `${c} 0% · ${TAX_CATEGORY_LABEL[c]}` });
  }
  return opts;
}

function SaveIndicator({ state, at }: { state: SaveState; at: Date | null }) {
  const text =
    state === "saving"
      ? "Saving…"
      : state === "error"
        ? "Not saved"
        : state === "dirty"
          ? "Unsaved changes"
          : at
            ? `Saved ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Saved";
  return (
    <span
      aria-live="polite"
      className={cn("text-2xs ml-2", state === "error" ? "text-danger" : "text-ink-4")}
    >
      {text}
    </span>
  );
}

function CellInput({
  label,
  value,
  onChange,
  placeholder,
  ai,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ai?: boolean;
}) {
  return (
    <input
      aria-label={label}
      value={value}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "figures placeholder:text-ink-4 w-full bg-transparent py-1 text-right outline-none",
        ai && "ai-field",
      )}
    />
  );
}

function MetaInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
  ai,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  ai?: boolean;
}) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd>
        <input
          aria-label={label}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          title={error}
          className={cn(
            "figures placeholder:text-ink-4 hover:border-rule focus:border-ink w-full border-b border-transparent bg-transparent py-0.5 text-right outline-none",
            error && "border-danger",
            ai && "ai-field",
          )}
        />
      </dd>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-ink-2 flex justify-between py-0.5">
      <dt>{label}</dt>
      <dd className="figures">{value}</dd>
    </div>
  );
}

function NoteArea({
  label,
  value,
  onChange,
  placeholder,
  ai,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ai?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={cn(
          "placeholder:text-ink-4 text-ink-2 [field-sizing:content] resize-none bg-transparent text-[13px] leading-relaxed outline-none",
          ai && "ai-field",
        )}
      />
    </label>
  );
}

function RailField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      {children}
      {hint ? <span className="text-ink-4 text-2xs">{hint}</span> : null}
    </div>
  );
}
