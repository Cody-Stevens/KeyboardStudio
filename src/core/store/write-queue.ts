/**
 * FIFO queue of keyboard writes. A job with a `coalesceKey` replaces a queued
 * job with the same key, so dragging a slider sends the latest value instead
 * of every intermediate one. The job that is already running is never
 * replaced.
 */
export interface QueueJob {
  readonly coalesceKey?: string;
  /** Performs the write. Must handle its own errors; a rejection is logged and swallowed. */
  run(): Promise<void>;
  /** Called when a newer job with the same coalesceKey replaces this one before it ran. */
  onSuperseded?(): void;
}

export class WriteQueue {
  private readonly jobs: QueueJob[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];

  get size(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  enqueue(job: QueueJob): void {
    if (job.coalesceKey !== undefined) {
      const index = this.jobs.findIndex((queued) => queued.coalesceKey === job.coalesceKey);
      const existing = this.jobs[index];
      if (existing) {
        this.jobs[index] = job;
        existing.onSuperseded?.();
        return;
      }
    }
    this.jobs.push(job);
    void this.pump();
  }

  /** Drops every queued job that has not started. */
  clear(): QueueJob[] {
    return this.jobs.splice(0);
  }

  whenIdle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        try {
          await job.run();
        } catch (error) {
          console.error('KeyboardStudio write job failed unexpectedly', error);
        }
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}
