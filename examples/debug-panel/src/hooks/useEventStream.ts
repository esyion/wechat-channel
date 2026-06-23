import { useEffect, useRef, useState } from "react";

import type { AppStatus, PublicMessage, SseEvent } from "../shared/types";

interface EventStreamState {
  status: AppStatus | null;
  messages: PublicMessage[];
  errors: Array<{ message: string; phase?: string; ts: number }>;
  logs: Array<{ level: "info" | "warn" | "error"; message: string; ts: number }>;
  connected: boolean;
}

const INITIAL: EventStreamState = {
  status: null,
  messages: [],
  errors: [],
  logs: [],
  connected: false,
};

/**
 * Subscribe to the backend SSE stream (`GET /api/events`) and merge events
 * into a single coherent state. Reconnects with exponential backoff if the
 * connection drops.
 */
export function useEventStream(): EventStreamState {
  const [state, setState] = useState<EventStreamState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const es = new EventSource("/api/events");
      esRef.current = es;

      es.onopen = () => {
        retryRef.current = 0;
        setState((s) => ({ ...s, connected: true }));
      };

      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es.close();
        if (cancelled) return;
        const delay = Math.min(15_000, 500 * 2 ** retryRef.current++);
        setTimeout(connect, delay);
      };

      es.onmessage = (e: MessageEvent<string>) => {
        let event: SseEvent;
        try {
          event = JSON.parse(e.data) as SseEvent;
        } catch {
          return;
        }
        setState((s) => applyEvent(s, event));
      };
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, []);

  return state;
}

function applyEvent(state: EventStreamState, event: SseEvent): EventStreamState {
  switch (event.type) {
    case "state":
      return { ...state, status: event.status };
    case "message":
      return { ...state, messages: [...state.messages, event.message] };
    case "error":
      return {
        ...state,
        errors: [...state.errors.slice(-20), { ...event, ts: Date.now() }],
      };
    case "log":
      return {
        ...state,
        logs: [...state.logs.slice(-30), { ...event, ts: Date.now() }],
      };
  }
}
