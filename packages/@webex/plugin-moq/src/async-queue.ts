type Task<T> = () => Promise<T>;

export class AsyncQueue {
  private pending: Promise<unknown> = Promise.resolve();

  push<T>(task: Task<T>): Promise<T> {
    const next = this.pending.then(
      () => task(),
      () => task()
    );
    this.pending = next.catch(() => {});

    return next;
  }
}
