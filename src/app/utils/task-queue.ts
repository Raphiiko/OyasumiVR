import { noop } from 'lodash';
import { Completer, CompletionResult } from './completer';

export interface QueueTask<T> {
  runnable: () => Promise<T>;
  typeId?: string;
}

export interface TaskQueueRateLimiter {
  totalPerMinute?: number;
  typePerMinute?: { [typeId: string]: number };
}

export class TaskQueue {
  private readonly runUniqueTasksConcurrently: boolean;
  private readonly rateLimiter?: TaskQueueRateLimiter;
  private queue: QueueTask<any>[] = [];
  private running = false;
  private runHistory: Array<{ typeId?: string; timestamp: number }> = [];

  constructor(options?: {
    runUniqueTasksConcurrently?: boolean;
    rateLimiter?: TaskQueueRateLimiter;
  }) {
    const fullOptions = { runUniqueTasksConcurrently: false, ...options };
    this.runUniqueTasksConcurrently = fullOptions.runUniqueTasksConcurrently;
    this.rateLimiter = fullOptions.rateLimiter;
  }

  async queueTask<T = void>(
    task: QueueTask<T>,
    replaceSameType = false
  ): Promise<CompletionResult<T>> {
    if (task.typeId && replaceSameType) {
      this.queue = this.queue.filter((t) => t.typeId !== task.typeId);
    }
    const completer = new Completer<T>();
    const oldRunnable = task.runnable;
    task.runnable = async () => {
      let returnValue: T;
      try {
        returnValue = await oldRunnable();
        completer.complete(returnValue);
        return returnValue;
      } catch (e) {
        completer.completeWithError(e);
        throw e;
      }
    };
    this.queue.push(task);
    noop(this.run());
    return completer.completion;
  }

  private async run() {
    if (this.running) {
      return;
    }
    this.running = true;
    while (this.queue.length) {
      // Get tasks to run
      let tasksToRun: QueueTask<any>[] = [];
      if (this.runUniqueTasksConcurrently) {
        this.queue.forEach((task) => {
          if (!tasksToRun.find((t) => t.typeId === task.typeId)) {
            tasksToRun.push(task);
          }
        });
        tasksToRun = tasksToRun.filter((t) => this.rateLimitsOkForTask(t));
        this.queue = this.queue.filter((q) => !tasksToRun.includes(q));
      } else {
        if (this.rateLimitsOkForTask(this.queue[0])) {
          tasksToRun = this.queue.splice(0, 1);
        }
      }
      // Run tasks
      if (tasksToRun.length) {
        await Promise.allSettled(
          tasksToRun.map(async (t) => {
            this.logRun(t);
            await t.runnable();
          })
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    this.running = false;
  }

  logRun(task: QueueTask<any>) {
    this.runHistory.push({ typeId: task.typeId, timestamp: Math.floor(Date.now() / 1000) });
    this.runHistory = this.runHistory.filter(
      (r) => r.timestamp > Math.floor(Date.now() / 1000) - 60
    );
  }

  rateLimitsOkForTask(task: QueueTask<any>) {
    if (!this.rateLimiter) return true;
    const { totalPerMinute, typePerMinute } = this.rateLimiter;
    if (totalPerMinute) {
      const totalInLastMinute = this.runHistory.filter(
        (r) => r.timestamp > Math.floor(Date.now() / 1000) - 60
      ).length;
      if (totalInLastMinute >= totalPerMinute) return false;
    }
    if (typePerMinute && task.typeId && typePerMinute[task.typeId]) {
      const totalForTypeInLastMinute = this.runHistory.filter(
        (r) => r.typeId === task.typeId && r.timestamp > Math.floor(Date.now() / 1000) - 60
      ).length;
      if (totalForTypeInLastMinute >= typePerMinute[task.typeId]) return false;
    }
    return true;
  }
}
