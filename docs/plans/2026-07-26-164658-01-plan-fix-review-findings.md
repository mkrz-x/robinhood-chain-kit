# Correct all review findings

**Goal:** Correct every confirmed P0, P1, and P2 finding from the 2026-07-26 repository review and ship the behavior as a coherent 0.4.0-quality source state.
**Why planning is required:** The work changes public APIs and retry/indexing behavior across multiple modules, examples, packaging, and CI.
**Acceptance:** Every confirmed defect has retained regression coverage where automatable; documentation and examples match the corrected contracts; build, unit tests, package linting, tarball smoke tests, and example checks pass from a clean install.

### Outcome 1: Reliable paged log ingestion
- Work: Define block-count semantics, validate options and ranges, distinguish rate-limit/range/transient/fatal failures, keep consumer callback failures outside RPC retry handling, support cancellation and bounded retries, and provide a streaming API without duplicate delivery.
- Verify: `npm test -- src/logs.test.ts`

### Outcome 2: Safe retrying fetch
- Work: Preserve caller cancellation, distinguish caller aborts from per-attempt timeouts, prevent implicit retries of unsafe methods, validate options, honor Retry-After, add jitter and injectable timing, and dispose discarded bodies.
- Verify: `npm test -- src/retryfetch.test.ts`

### Outcome 3: Accurate market and oracle semantics
- Work: Separate regular-session state from feed freshness, model US holidays and early closes, handle invalid timestamps, expose richer session information, and update documentation for Robinhood Stock Token feeds' current 24/5 behavior.
- Verify: `npm test -- src/markethours.test.ts`

### Outcome 4: Correct chain, DEX, bridge, and example contracts
- Work: Split Blockscout REST and Etherscan-compatible API URLs, add mainnet/testnet/full protocol registries, correct DEX role terminology and provide deployment-address filtering contracts, correct bridge flow documentation, remove token-decimal assumptions, and make examples configurable and testable.
- Risks/open questions: DEX deployment addresses are not present in official Robinhood protocol documentation; do not invent or hard-code unverified addresses.
- Verify: `npm test -- src/constants.test.ts && npm run check:examples`

### Outcome 5: Reproducible package and CI
- Work: Restore the complete MIT license, declare runtime/ESM support, make clean packaging build-safe, add lint/type/package/example checks, tighten workflow permissions, and add release/community guidance without publishing or changing remote state.
- Verify: `npm run verify`

### Outcome 6: Final integration review
- Work: Inspect the complete diff for all original findings, public compatibility, generated package contents, documentation consistency, and unsupported claims.
- Verify: `npm run verify && git diff --check`
