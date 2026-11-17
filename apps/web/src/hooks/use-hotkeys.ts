"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

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
  // Keep the latest handlers without re-subscribing the listener.
  useLayoutEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

    function onKey(e: KeyboardEvent) {
      const map = ref.current;
      const key = e.key.toLowerCase();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const chord = mod ? map[`mod+${key}`] : undefined;
      if (chord) {
        e.preventDefault();
        chord(e);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (pending) {
        const seq = map[`${pending} ${key}`];
        pending = null;
        clearTimeout(timer);
        if (seq) {
          e.preventDefault();
          seq(e);
        }
        return;
      }
      if (Object.keys(map).some((k) => k.startsWith(`${key} `))) {
        pending = key;
        timer = setTimeout(() => (pending = null), 900);
        return;
      }
      const single = map[key];
      if (single) {
        e.preventDefault();
        single(e);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, []);
}
