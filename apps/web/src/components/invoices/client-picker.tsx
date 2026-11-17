"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { countryName } from "@pti/core";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ClientForm, emptyClient } from "@/components/clients/client-form";
import { cn } from "@/lib/cn";
import { searchClientsAction, type ClientOption } from "@/app/app/clients/actions";

/**
 * Accessible combobox (ARIA 1.2 pattern): type to search, ↑/↓ to move,
 * Enter to pick, Esc to close. The last option creates a new client
 * pre-filled with what was typed.
 */
export function ClientPicker({
  value,
  onChange,
  countries,
  invalid,
  highlight,
}: {
  value: ClientOption | null;
  onChange: (c: ClientOption | null) => void;
  countries: { code: string; name: string }[];
  invalid?: boolean;
  /** Mark as AI-filled. */
  highlight?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const search = useCallback((text: string) => {
    const n = ++seq.current;
    start(async () => {
      const r = await searchClientsAction(text);
      if (n === seq.current) {
        setOptions(r);
        setActive(0);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(q), q ? 140 : 0);
    return () => clearTimeout(t);
  }, [q, open, search]);

  const total = options.length + (q.trim() ? 1 : 0);
  function pick(i: number) {
    const o = options[i];
    if (o) {
      onChange(o);
      setOpen(false);
      setQ("");
    } else if (q.trim()) {
      setCreating(q.trim());
      setOpen(false);
    }
  }

  if (value && !open) {
    return (
      <div className="group">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
          className="w-full text-left"
          aria-label={`Client: ${value.name}. Change client`}
        >
          <span className={cn("font-medium", highlight && "ai-mark")}>{value.name}</span>
          <span className="text-ink-3 block text-xs">
            {[value.email, value.country ? countryName(value.country) : null, value.vatId].filter(Boolean).join(" · ")}
          </span>
          <span className="text-ink-4 group-hover:text-ink-2 text-2xs">Change</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && total ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-label="Client"
        value={q}
        placeholder="Search or add a client"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, total - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape") {
            setOpen(false);
            if (value) setQ("");
          }
        }}
        className={cn(
          "border-rule-strong focus:border-ink w-full border-b bg-transparent py-1.5 text-sm outline-none",
          invalid && "border-danger",
        )}
      />
      {open && total > 0 ? (
        <ul id={listId} role="listbox" className="border-rule-strong bg-paper-raised shadow-pop absolute z-20 mt-1 w-full min-w-64 rounded-sm border py-1">
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-default px-3 py-1.5", i === active && "bg-paper-sunk")}
            >
              <span className="text-sm">{o.name}</span>
              <span className="text-ink-3 block text-xs">{[o.email, o.country].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
          {q.trim() ? (
            <li
              id={`${listId}-${options.length}`}
              role="option"
              aria-selected={active === options.length}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(options.length);
              }}
              onMouseEnter={() => setActive(options.length)}
              className={cn("border-rule text-ink-2 cursor-default border-t px-3 py-1.5 text-sm", active === options.length && "bg-paper-sunk")}
            >
              + Add “{q.trim()}” as a new client
            </li>
          ) : null}
        </ul>
      ) : null}

      <Dialog open={creating !== null} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent title="New client" wide>
          {creating !== null ? (
            <ClientForm
              compact
              countries={countries}
              values={{ ...emptyClient, name: creating }}
              onSaved={async (id) => {
                const found = (await searchClientsAction(creating)).find((c) => c.id === id);
                if (found) onChange(found);
                setCreating(null);
                setQ("");
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
