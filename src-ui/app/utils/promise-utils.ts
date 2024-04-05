export function pTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError = new Error('Promise timed out')
): Promise<T> {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]) as Promise<T>;
}
