export interface QueueTask<T> {
  runnable: () => Promise<T>;
  typeId?: string;
}

export class TaskQueue {
  private queue: QueueTask<any>[] = [];
  private running = false;

  constructor(private runUniqueTasksConcurrently = false) {}

  queueTask(task: QueueTask<any>, replaceSameType = false) {
    if (task.typeId && replaceSameType) {
      this.queue = this.queue.filter((t) => t.typeId !== task.typeId);
    }
    this.queue.push(task);
    this.run();
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
        this.queue = this.queue.filter((q) => !tasksToRun.includes(q));
      } else {
        tasksToRun = this.queue.splice(0, 1);
      }
      // Run tasks
      await Promise.allSettled(tasksToRun.map((t) => t.runnable()));
    }
    this.running = false;
  }
}
