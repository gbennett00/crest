/**
 * Wraps actions so they run one at a time, in the order they were called,
 * whatever order their predecessors settle in (a failure doesn't stop the
 * queue). Used for assignment writes: typing 50 then 60 into the same row
 * must end at 60, which two concurrent requests wouldn't guarantee.
 */
export function createActionQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function inOrder<R>(action: () => Promise<R>): () => Promise<R> {
    return () => {
      const run = tail.then(action, action);
      tail = run.catch(() => {});
      return run;
    };
  };
}
