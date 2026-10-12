import { generateBrief, type GenerateOptions, type PipelineDeps, type Trigger } from "./generate.ts";

export interface BriefQueue {
  /** Returns false if a run for this topic is already queued or running. */
  enqueue(topicId: number, trigger: Trigger, opts?: GenerateOptions): boolean;
  isBusy(topicId: number): boolean;
  /** Resolves when nothing is queued or running. */
  idle(): Promise<void>;
}

/** `onIdle` runs each time the queue drains after running at least one brief (e.g. to write the day's themes). */
export function createBriefQueue(deps: PipelineDeps, concurrency: number, onIdle?: () => void): BriefQueue {
  const pending: { topicId: number; trigger: Trigger; opts?: GenerateOptions }[] = [];
  const running = new Set<number>();
  let waiters: (() => void)[] = [];
  let ran = false;

  const pump = () => {
    while (running.size < concurrency && pending.length) {
      const job = pending.shift();
      if (!job) break;
      running.add(job.topicId);
      ran = true;
      generateBrief(deps, job.topicId, job.trigger, job.opts)
        .catch((e) => deps.log.error({ err: String(e), topicId: job.topicId }, "brief job crashed"))
        .finally(() => {
          running.delete(job.topicId);
          pump();
        });
    }
    if (!running.size && !pending.length) {
      for (const w of waiters) w();
      waiters = [];
      if (ran) onIdle?.();
      ran = false;
    }
  };

  return {
    enqueue(topicId, trigger, opts) {
      if (running.has(topicId) || pending.some((j) => j.topicId === topicId)) return false;
      pending.push({ topicId, trigger, opts });
      queueMicrotask(pump);
      return true;
    },
    isBusy: (topicId) => running.has(topicId) || pending.some((j) => j.topicId === topicId),
    idle() {
      if (!running.size && !pending.length) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push(resolve);
      return promise;
    },
  };
}
