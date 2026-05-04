import type {
  EvaluationContext,
  FlagSchema,
  FlagsHandle,
  Subject,
} from '../../types/index.js';

interface RequestEventLike {
  readonly cookies: {
    get(name: string): string | undefined;
  };
  readonly request: { readonly headers: Headers };
  readonly url: URL;
  locals: Record<string, unknown>;
}

interface SvelteKitHandleArg {
  readonly event: RequestEventLike;
  readonly resolve: (event: RequestEventLike) => Promise<Response>;
}

type SvelteKitHandle = (input: SvelteKitHandleArg) => Promise<Response>;

interface FlagsHandleOptions<S extends FlagSchema> {
  /** Override how the event maps to a `Subject`. */
  readonly extractSubject?: (event: RequestEventLike) => Subject | undefined;
  /** Subject-cookie name. Default: `'devkit-flags-subject'`. */
  readonly cookieName?: string;
  /**
   * Locals key the handle is exposed under. Default: `'flags'`.
   * `event.locals[key]` resolves to `{ get, getDetail, getAsync, ... }`.
   */
  readonly localsKey?: string;
  /** Phantom — keeps `S` in the public signature for narrowing. */
  readonly _typeOnly?: S;
}

/**
 * SvelteKit `Handle` factory. Populates `event.locals.flags` with a
 * lightweight wrapper around the supplied handle so route handlers
 * can read flags without importing the singleton everywhere.
 *
 * @param flags  The configured `FlagsHandle`.
 * @param opts   Cookie / locals / subject extraction overrides.
 * @returns      A SvelteKit `Handle` hook.
 *
 * @example
 *   // src/hooks.server.ts
 *   import { flags } from '$lib/flags';
 *   import { flagsHandle } from '@devkit/flags/adapters/sveltekit';
 *   export const handle = flagsHandle(flags);
 */
export function flagsHandle<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: FlagsHandleOptions<S>,
): SvelteKitHandle {
  const cookieName = opts?.cookieName ?? 'devkit-flags-subject';
  const localsKey = opts?.localsKey ?? 'flags';
  return async ({ event, resolve }) => {
    const subject =
      opts?.extractSubject !== undefined
        ? opts.extractSubject(event)
        : extractDefaultSubject(event, cookieName);
    const evalContext: EvaluationContext =
      subject !== undefined ? { subject } : {};
    event.locals[localsKey] = {
      handle: flags,
      get: <K extends Parameters<FlagsHandle<S>['get']>[0]>(
        key: K,
      ) => flags.get(key as never, evalContext as never),
      getDetail: <K extends Parameters<FlagsHandle<S>['get']>[0]>(
        key: K,
      ) => flags.getDetail(key as never, evalContext as never),
    };
    return resolve(event);
  };
}

function extractDefaultSubject(
  event: RequestEventLike,
  cookieName: string,
): Subject | undefined {
  const id = event.cookies.get(cookieName);
  if (id === undefined || id === '') return undefined;
  return { id };
}
