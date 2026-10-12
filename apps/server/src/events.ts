import type { AppEvent } from "@dailybrief/shared";
import { EventEmitter } from "node:events";

export type { AppEvent };

export interface EventBus {
  emit(event: AppEvent): void;
  subscribe(listener: (event: AppEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  return {
    emit: (event) => void emitter.emit("event", event),
    subscribe(listener) {
      emitter.on("event", listener);
      return () => void emitter.off("event", listener);
    },
  };
}
