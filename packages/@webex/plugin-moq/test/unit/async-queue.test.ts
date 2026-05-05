import {AsyncQueue} from '../../src/async-queue';

describe('AsyncQueue', () => {
  it('executes tasks sequentially', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    const task1 = queue.push(async () => {
      await delay(20);
      order.push(1);
      return 'a';
    });

    const task2 = queue.push(async () => {
      order.push(2);
      return 'b';
    });

    const [r1, r2] = await Promise.all([task1, task2]);

    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(order).toEqual([1, 2]);
  });

  it('continues after a failed task', async () => {
    const queue = new AsyncQueue();

    const failing = queue.push(async () => {
      throw new Error('fail');
    });

    const succeeding = queue.push(async () => 'ok');

    await expect(failing).rejects.toThrow('fail');
    expect(await succeeding).toBe('ok');
  });

  it('returns the task result', async () => {
    const queue = new AsyncQueue();
    const result = await queue.push(async () => 42);
    expect(result).toBe(42);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
