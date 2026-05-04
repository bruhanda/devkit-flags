import type {
  EvaluationContext,
  FlagSchema,
  FlagKeysOf,
  FlagValueOf,
  FlagsHandle,
  Subject,
} from '../../types/index.js';

interface HonoContextLike {
  readonly req: { readonly raw: Request };
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T;
}

type Next = () => Promise<void>;

interface HonoOptions<S extends FlagSchema> {
  /** Override how the context maps to a `Subject`. */
  readonly extractSubject?: (c: HonoContextLike) => Subject | undefined;
  /** Subject-cookie name. Default: `'devkit-flags-subject'`. */
  readonly cookieName?: string;
  /** Phantom — keeps `S` in the public signature. */
  readonly _typeOnly?: S;
}

/**
 * Hono middleware factory. Registers the handle under `c.var.flags`
 * and a typed `c.var.flag(key)` helper that resolves with the
 * per-request subject pulled from cookies (overrideable via
 * `opts.extractSubject`).
 *
 * @param flags  The configured `FlagsHandle`.
 * @param opts   Subject-extraction overrides.
 * @returns      A Hono `MiddlewareHandler`-shaped function.
 *
 * @example
 *   import { Hono } from 'hono';
 *   import { honoFlags } from '@devkit/flags/adapters/hono';
 *   const app = new Hono();
 *   app.use('*', honoFlags(flags));
 *   app.get('/', (c) => c.json({ enabled: c.var.flag('newCheckout') }));
 */
export function honoFlags<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: HonoOptions<S>,
): (c: HonoContextLike, next: Next) => Promise<void> {
  const cookieName = opts?.cookieName ?? 'devkit-flags-subject';
  return async (c, next) => {
    const subject =
      opts?.extractSubject !== undefined
        ? opts.extractSubject(c)
        : extractSubjectFromCookie(c, cookieName);
    const evalContext: EvaluationContext = subject !== undefined ? { subject } : {};
    c.set('flags', flags);
    c.set('flag', <K extends FlagKeysOf<S>>(key: K): FlagValueOf<S, K> => {
      return flags.get(key as never, evalContext as never) as FlagValueOf<S, K>;
    });
    await next();
  };
}

function extractSubjectFromCookie(
  c: HonoContextLike,
  cookieName: string,
): Subject | undefined {
  const cookieHeader = c.req.raw.headers.get('cookie');
  if (cookieHeader === null) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName && rest.length > 0) {
      const value = rest.join('=');
      if (value !== '') return { id: decodeURIComponent(value) };
    }
  }
  return undefined;
}
