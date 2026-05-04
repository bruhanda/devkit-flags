import type {
  EvaluationContext,
  FlagKeysOf,
  FlagSchema,
  FlagValueOf,
  FlagsHandle,
  Subject,
} from '../../types/index.js';

interface ExpressRequestLike {
  readonly cookies?: Record<string, unknown>;
  readonly headers: Record<string, string | string[] | undefined>;
  flag?: <K extends string>(key: K) => unknown;
  flags?: unknown;
}

interface ExpressResponseLike {
  // present for type compatibility; not consulted directly
  readonly statusCode?: number;
}

type ExpressNext = (err?: unknown) => void;

interface ExpressOptions<S extends FlagSchema> {
  readonly extractSubject?: (req: ExpressRequestLike) => Subject | undefined;
  readonly cookieName?: string;
  readonly _typeOnly?: S;
}

/**
 * Express middleware factory. Adds `req.flags` (the handle) and
 * `req.flag(key)` (a typed accessor that resolves through the
 * per-request subject) so route handlers can read flags without
 * importing the singleton everywhere.
 *
 * @param flags  The configured `FlagsHandle`.
 * @param opts   Subject extraction overrides.
 * @returns      A standard `(req, res, next)` Express middleware.
 *
 * @example
 *   import express from 'express';
 *   import { expressFlags } from '@devkit/flags/adapters/express';
 *   const app = express();
 *   app.use(expressFlags(flags));
 *   app.get('/', (req, res) => res.json({ enabled: req.flag('newCheckout') }));
 */
export function expressFlags<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: ExpressOptions<S>,
): (req: ExpressRequestLike, res: ExpressResponseLike, next: ExpressNext) => void {
  const cookieName = opts?.cookieName ?? 'devkit-flags-subject';
  return (req, _res, next) => {
    const subject =
      opts?.extractSubject !== undefined
        ? opts.extractSubject(req)
        : extractSubjectFromRequest(req, cookieName);
    const evalContext: EvaluationContext = subject !== undefined ? { subject } : {};
    req.flags = flags;
    req.flag = <K extends FlagKeysOf<S>>(key: K) =>
      flags.get(key as never, evalContext as never) as FlagValueOf<S, K>;
    next();
  };
}

function extractSubjectFromRequest(
  req: ExpressRequestLike,
  cookieName: string,
): Subject | undefined {
  const fromParser = req.cookies?.[cookieName];
  if (typeof fromParser === 'string' && fromParser !== '') {
    return { id: fromParser };
  }
  const cookieHeader = req.headers['cookie'];
  if (typeof cookieHeader !== 'string') return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName && rest.length > 0) {
      const value = rest.join('=');
      if (value !== '') return { id: decodeURIComponent(value) };
    }
  }
  return undefined;
}
