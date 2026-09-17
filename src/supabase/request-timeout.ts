import { ServiceUnavailableException } from '@nestjs/common';

export const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

// The signal remains active while the SDK consumes the response body, not just headers.
export const supabaseFetch: typeof fetch = (input, init) => {
  const existing =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: existing ? AbortSignal.any([existing, deadline]) : deadline,
  });
};

// Also bound the caller if an SDK operation fails to settle after cancellation.
export async function withRequestDeadline<T>(
  request: PromiseLike<T>,
  ms = SUPABASE_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ServiceUnavailableException(
                'Supabase request timed out; please retry',
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
