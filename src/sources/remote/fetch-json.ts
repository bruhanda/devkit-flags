import { FlagsError } from '../../errors/base.js';

interface FetchJsonOptions {
  readonly init?: RequestInit;
  readonly fetchImpl?: typeof fetch;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

/**
 * Outcome of a single `fetchJson` call. `notModified === true` is
 * the 304-equivalent fast path used by the polling driver.
 */
export type FetchJsonResult<T> =
  | { readonly notModified: true }
  | { readonly notModified: false; readonly body: T; readonly response: Response };

/**
 * Fetch a JSON document with abort-aware timeout, max-byte cap, and
 * 304-aware short-circuit. Wraps every error path through
 * `FlagsError` so the caller can branch on the error code.
 *
 * @param url   Target URL.
 * @param opts  Fetch policy (init, max bytes, timeout).
 * @returns     Parsed JSON, OR `{ notModified: true }` for 304s.
 * @throws      `FlagsError('SOURCE_LOAD_FAILED' | 'PAYLOAD_TOO_LARGE')`.
 */
export async function fetchJson<T>(
  url: string | URL,
  opts: FetchJsonOptions,
): Promise<FetchJsonResult<T>> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new FlagsError('SOURCE_LOAD_FAILED', 'global fetch is unavailable');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...opts.init,
      signal: controller.signal,
    });
    if (response.status === 304) {
      return { notModified: true };
    }
    if (!response.ok) {
      throw new FlagsError(
        'SOURCE_LOAD_FAILED',
        `remote source ${url.toString()} responded ${response.status}`,
      );
    }
    const contentLengthHeader = response.headers.get('Content-Length');
    if (contentLengthHeader !== null) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        throw new FlagsError(
          'PAYLOAD_TOO_LARGE',
          `remote payload declared ${declared} bytes (max ${opts.maxBytes})`,
        );
      }
    }
    const text = await readWithCap(response, opts.maxBytes);
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (cause) {
      throw new FlagsError('SOURCE_LOAD_FAILED', 'remote payload is not JSON', { cause });
    }
    return { notModified: false, body: parsed, response };
  } catch (err) {
    if (FlagsError.is(err)) throw err;
    throw new FlagsError('SOURCE_LOAD_FAILED', 'remote fetch failed', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

async function readWithCap(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new FlagsError(
        'PAYLOAD_TOO_LARGE',
        `remote payload exceeds ${maxBytes} bytes`,
      );
    }
    return text;
  }
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new FlagsError(
        'PAYLOAD_TOO_LARGE',
        `remote payload exceeds ${maxBytes} bytes`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}
