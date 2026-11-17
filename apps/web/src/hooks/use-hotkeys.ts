"use client";

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Global shortcuts: single keys ("c"), chords with a modifier ("mod+k", where
 * mod = ⌘ on macOS, Ctrl elsewhere) and two-key sequences ("g i"). Plain keys
 * are ignored while the user is typing in a field.
 */
export function useHotkeys(bindings: Record<string, Handler>): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && ref.current[`mod+${key}`]) {
        e.preventDefault();
        ref.current[`mod+${key}`]?.(e);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (pending) {
        const combo = `${pending} ${key}`;
        pending = null;
        clearTimeout(timer);
        if (ref.current[combo]) {
          e.preventDefault();
          ref.current[combo]?.(e);
        }
        return;
      }
      if (Object.keys(ref.current).some((k) => k.startsWith(`${key} `))) {
        pending = key;
        timer = setTimeout(() => (pending = null), 900);
        return;
      }
      if (ref.current[key]) {
        e.preventDefault();
        ref.current[key]?.(e);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, []);
}
