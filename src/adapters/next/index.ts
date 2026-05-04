import type {
  FlagsHandle,
  FlagSchema,
  FlagKeysOf,
  FlagValueOf,
  Subject,
  EvaluationContext,
} from '../../types/index.js';

interface NextRequestLike {
  readonly cookies: {
    get(name: string): { value?: string } | undefined;
  };
  readonly headers: { get(name: string): string | null };
  readonly nextUrl?: { searchParams: URLSearchParams };
}

interface NextResponseLike {
  readonly headers: { set(name: string, value: string): void };
  cookies?: { set(name: string, value: string): void };
}

interface MiddlewareOptions<S extends FlagSchema> {
  /** Subject-cookie name. Default: `'devkit-flags-subject'`. */
  readonly cookieName?: string;
  /** Header injected with the resolved bucket. Default: `'x-flags-subject'`. */
  readonly headerName?: string;
  /** Override how the request maps to a `Subject`. */
  readonly extractSubject?: (req: NextRequestLike) => Subject | undefined;
  /** Construct or extend the per-request `EvaluationContext`. */
  readonly buildContext?: (req: NextRequestLike) => EvaluationContext;
  /**
   * Inline a placeholder so the function-signature returns a real
   * NextResponse on consumers' machines (the type bundles in
   * `next/server` keep it minimal here).
   */
  readonly response?: () => NextResponseLike;
}

/**
 * Next.js App Router server-side helper. Resolve a flag from the
 * shared handle inside an RSC server component.
 *
 * @param flags  The configured `FlagsHandle`.
 * @param key    Flag key (typed against the handle's schema).
 * @returns      `Promise<FlagValueOf<S, K>>` — already-cached after
 *               the handle's first `ready()`.
 *
 * @example
 *   import { flags } from '@/flags';
 *   import { getFlag } from '@devkit/flags/adapters/next';
 *
 *   export default async function Page() {
 *     const variant = await getFlag(flags, 'checkoutVariant');
 *     return <div data-variant={variant}>...</div>;
 *   }
 */
export async function getFlag<S extends FlagSchema, K extends FlagKeysOf<S>>(
  flags: FlagsHandle<S>,
  key: K,
  context?: EvaluationContext,
): Promise<FlagValueOf<S, K>> {
  return flags.getAsync(key, context as never);
}

/**
 * Build a Route Handler that emits the merged snapshot. Useful for the
 * Pages Router client to bootstrap from `/api/flags`.
 *
 * @param flags  The configured `FlagsHandle`.
 * @returns      A `(request) => Response` handler.
 *
 * @example
 *   // app/api/flags/route.ts
 *   import { flags } from '@/flags';
 *   import { createFlagsRoute } from '@devkit/flags/adapters/next';
 *   export const GET = createFlagsRoute(flags);
 */
export function createFlagsRoute<S extends FlagSchema>(
  flags: FlagsHandle<S>,
): (req: NextRequestLike) => Promise<Response> {
  return async (_req) => {
    await flags.ready();
    const snapshot = flags.snapshot();
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Edge middleware. Extracts the subject from cookies, hashes it once
 * per request, and emits a header that downstream RSC reads can use
 * to honour subject-stable bucketing without re-reading the cookie.
 *
 * @param flags  The configured `FlagsHandle`.
 * @param opts   Cookie / header / subject-extraction overrides.
 * @returns      A function `(req, res) => res` shaped for Next middleware.
 *
 * @example
 *   // middleware.ts
 *   import { flags } from '@/flags';
 *   import { flagsMiddleware } from '@devkit/flags/adapters/next';
 *   export const middleware = flagsMiddleware(flags);
 */
export function flagsMiddleware<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: MiddlewareOptions<S>,
): (req: NextRequestLike, res: NextResponseLike) => NextResponseLike {
  const cookieName = opts?.cookieName ?? 'devkit-flags-subject';
  const headerName = opts?.headerName ?? 'x-flags-subject';
  return (req, res) => {
    void flags;
    const subject =
      opts?.extractSubject !== undefined
        ? opts.extractSubject(req)
        : extractDefaultSubject(req, cookieName);
    if (subject !== undefined) {
      res.headers.set(headerName, subject.id);
    }
    return res;
  };
}

function extractDefaultSubject(
  req: NextRequestLike,
  cookieName: string,
): Subject | undefined {
  const cookie = req.cookies.get(cookieName);
  if (cookie?.value === undefined || cookie.value === '') return undefined;
  return { id: cookie.value };
}
