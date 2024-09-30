export function pTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: any = new Error('Promise timed out')
): Promise<T> {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]) as Promise<T>;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pRetry<T>(
  promise: () => Promise<T>,
  retries: number,
  retryDelay: number
): Promise<T> {
  let attempts = 0;
  let error: any;

  while (attempts <= retries) {
    try {
      return await promise();
    } catch (err) {
      error = err;
      attempts++;

      if (attempts <= retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw error;
}
