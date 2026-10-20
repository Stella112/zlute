/**
 * Cross-chain route classification (mandate §19.9). Classes combine. Execution is allowed only
 * for a route whose classification is exactly STRICT_PRIVATE_VERIFIED. Unknown facts classify as
 * UNKNOWN (fail closed). A route with a public source chain is never strict-private, even if it
 * ends in shielded ZEC.
 */

export type RouteClass =
  | 'STRICT_PRIVATE_VERIFIED'
  | 'INTERMEDIATE_CONFIDENTIAL_ONLY'
  | 'PUBLIC_SOURCE_EXPOSURE'
  | 'PUBLIC_DESTINATION_EXPOSURE'
  | 'TRANSPARENT_ZCASH_HOP'
  | 'PROVIDER_VISIBLE'
  | 'UNKNOWN'
  | 'UNSUPPORTED';

/** Observed (not assumed) facts about a route; `undefined` means not established. */
export interface RouteFacts {
  supported: boolean | undefined;
  source_chain_public: boolean | undefined;
  destination: 'zcash_shielded' | 'zcash_transparent' | 'public_chain' | undefined;
  transparent_zcash_hop: boolean | undefined;
  intermediate_confidential: boolean | undefined;
  provider_visible: boolean | undefined;
  /** Live route behavior was exercised with passing tests (not documentation alone). */
  verified_by_tests: boolean | undefined;
}

export function classifyRoute(f: RouteFacts): RouteClass[] {
  if (f.supported === false) return ['UNSUPPORTED'];
  const classes = new Set<RouteClass>();
  const unknown =
    f.supported === undefined ||
    f.source_chain_public === undefined ||
    f.destination === undefined ||
    f.transparent_zcash_hop === undefined ||
    f.provider_visible === undefined ||
    f.verified_by_tests === undefined;
  if (unknown) classes.add('UNKNOWN');
  if (f.source_chain_public === true) classes.add('PUBLIC_SOURCE_EXPOSURE');
  if (f.destination === 'public_chain' || f.destination === 'zcash_transparent') {
    classes.add('PUBLIC_DESTINATION_EXPOSURE');
  }
  if (f.transparent_zcash_hop === true || f.destination === 'zcash_transparent') {
    classes.add('TRANSPARENT_ZCASH_HOP');
  }
  if (f.provider_visible === true) classes.add('PROVIDER_VISIBLE');
  if (f.intermediate_confidential === true && classes.size > 0) {
    classes.add('INTERMEDIATE_CONFIDENTIAL_ONLY');
  }
  if (
    !unknown &&
    classes.size === 0 &&
    f.source_chain_public === false &&
    f.destination === 'zcash_shielded' &&
    f.transparent_zcash_hop === false &&
    f.provider_visible === false &&
    f.verified_by_tests === true
  ) {
    classes.add('STRICT_PRIVATE_VERIFIED');
  }
  if (classes.size === 0) classes.add('UNKNOWN');
  return [...classes].sort();
}

export function routeExecutionAllowed(classes: RouteClass[]): boolean {
  return classes.length === 1 && classes[0] === 'STRICT_PRIVATE_VERIFIED';
}
