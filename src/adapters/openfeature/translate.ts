import type { EvaluationReason } from '../../types/result.js';

/**
 * Map our internal `EvaluationReason` to OpenFeature's
 * `ResolutionReason` string. OpenFeature ships these as a string-union;
 * we use the canonical names so we never have to peer-dep their types
 * for the mapping itself.
 *
 * @param reason  The internal evaluation reason.
 * @returns       OpenFeature-compatible reason string.
 */
export function translateReason(reason: EvaluationReason): string {
  switch (reason) {
    case 'STATIC':
      return 'STATIC';
    case 'ENVIRONMENT':
      return 'TARGETING_MATCH';
    case 'TARGETING_MATCH':
      return 'TARGETING_MATCH';
    case 'TARGETING_FALLBACK':
      return 'DEFAULT';
    case 'ROLLOUT_INCLUDED':
      return 'SPLIT';
    case 'ROLLOUT_EXCLUDED':
      return 'SPLIT';
    case 'OVERRIDE':
      return 'OVERRIDE';
    case 'STALE':
      return 'STALE';
    case 'ERROR':
      return 'ERROR';
  }
}
