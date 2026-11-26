"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Use in a component keyed by its filter snapshot so old results cannot cross scopes. */
export function useAiRequest() {
  const active = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  async function run<T>(request: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void) {
    if (pending.current || !active.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await request(controller.signal);
      if (pending.current === controller) accept(result);
    } catch (cause) {
      if (pending.current === controller)
        setError(cause instanceof Error ? cause.message : "AI request failed");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  const reset = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError(null);
  };
  return { run, busy, error, reset, dismiss: () => setError(null) };
}

export interface AiScope {
  label: string;
  timeZone: string;
}
