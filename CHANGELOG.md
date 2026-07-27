# Changelog

## 0.5.0 — 2026-07-26

- **Oracle Guard**: added a strict Chainlink feed-directory loader and parser,
  metadata queries, Aggregator V3 ABI/read helpers, exact bigint price
  formatting, and a fail-closed health assessment that reports heartbeat,
  round, sequencer, recovery-grace, and corporate-action issues together.
- **Replay-safe fetches**: retryable one-shot request bodies now require a
  per-attempt `bodyFactory`, preventing consumed streams from failing on later
  attempts.
- **Release evidence**: live canaries now use bounded retries/timeouts and
  validate explorer JSON shapes, while package checks execute both ESM import
  and CommonJS require from a clean tarball installation.

## 0.4.0 — 2026-07-26

- **Correct paged-log semantics**: `chunkSize` is now an exact inclusive block
  count; callback failures are never mistaken for RPC failures; only recognized
  range-limit errors shrink the window; 429 retries are bounded; invalid
  options fail fast; and callers can cancel between requests and retry delays.
- **Safe retrying fetch**: caller abort signals are preserved, retry options are
  validated, unsafe methods are not retried without explicit authorization,
  `Retry-After` and bounded jittered backoff are supported, and discarded
  response bodies are cancelled. Timing hooks make the test suite immediate.
- **Market and oracle correctness**: added `getUsEquityMarketSession` with
  scheduled US exchange holidays and early closes, made invalid timestamps
  safely closed, and added `isFeedFresh` so the regular session is no longer
  presented as a proxy for Robinhood Stock Token feeds' 24/5 freshness.
- **Chain configuration**: split the Etherscan-compatible Blockscout `/api`
  from REST `/api/v2`, added Robinhood Chain testnet, and added the documented
  mainnet/testnet L1, L2, and Arbitrum precompile registries.
- **DEX and bridge accuracy**: replaced ambiguous "swapper" labels with caller
  and recipient roles; added address-scoped DEX discovery targets; documented
  that L1 gateways emit `WithdrawalFinalized`; added V4 to the pool example;
  and removed the bridge example's hard-coded RPC and 18-decimal assumption.
- **Packaging and CI**: dual ESM/CJS output, Node 20.3+ engine declaration,
  reproducible `prepack`, source maps, publint/Are the Types Wrong checks,
  example type-checking, restricted workflow permissions, pinned actions, and
  the complete canonical MIT license.

## 0.3.2 - 2026-07-26

- Docs only: the footer linking the author and the agent lived in a raw
  `<p align="center">` block, which npm sanitizes away - so both links
  rendered on GitHub and were invisible on npmjs.com. Replaced with a plain
  markdown Links table (terminal, author, agent, source, package) that renders
  identically on both, plus X badges in the badge row. npm serves the README
  frozen at publish time, so this needed a release to reach the registry.

## 0.3.1 — 2026-07-26

- Packaging only: add the `default` condition to the exports map. Resolvers
  that do not ask with the `import` condition (bundlephobia's build pipeline
  among them) found no matching entry and failed with a BuildError; `default`
  is the spec's catch-all and must come last. Verified against how ky /
  nanoid / p-limit (ESM-only packages that build fine there) shape theirs.

## 0.3.0 — 2026-07-26

- **New: Uniswap V4 events** — `V4_INITIALIZE_EVENT` and `V4_SWAP_EVENT` for
  the singleton PoolManager (pools keyed by `bytes32 id`, no per-pool
  contracts), plus `V4_NATIVE_CURRENCY` (address(0) = the chain's native
  asset). Attribution note: V4's `sender` is always a periphery contract —
  attribute swaps to the transaction sender. Both added to `DEX_EVENTS`.
- **Chain object**: `robinhoodChain` now carries
  `blockExplorers.default.apiUrl` (Blockscout `/api/v2`, also exported as
  `EXPLORER_API_URL`) and `contracts.multicall3`, matching what a viem
  client needs for multicall and explorer-API lookups.
- **New: `feeds` module** — `CHAINLINK_FEED_DIRECTORY_URL`, the Chainlink
  per-chain feed directory for 4663 (every live oracle, including the
  tokenized-stock feeds). Constant only; the kit stays zero-dependency.
- **Docs**: the architecture diagram is now a pre-rendered SVG
  (`assets/architecture.svg`, source kept at `assets/architecture.mmd`) so it
  renders on npmjs.com too — npm does not render mermaid code fences.

## 0.2.1 — 2026-07-25

- Packaging only, no code changes: add a modern `exports` map and
  `sideEffects: false`. Fixes ESM resolution in bundlers whose resolvers
  require the exports field (bundlephobia's BuildError) and enables
  tree-shaking.

## 0.2.0 — 2026-07-24

- **New: `getLogsPaged`** — adaptive `getLogs` paging for backfills over capped
  RPCs. Halves the span on dense windows ("range too large" / result-cap
  errors), cools off on 429 without shrinking (a rate limit is a time problem,
  not a size problem), and re-grows only after 3 consecutive clean passes so it
  never ping-pongs against the cap. Client-agnostic and zero-dep: you supply
  the `getLogs` function. Streaming mode via `{ collect: false, onPage }`.
- **New: `dex` module** — the V2/V3 `PairCreated` / `PoolCreated` / `Swap`
  event signatures observed live on Robinhood Chain, `parseAbiItem`-ready,
  with swapper-attribution notes (V2 `to`, V3 `recipient`, either may be a
  router — check bytecode before calling it a wallet).
- **Tests**: 18 unit tests across every module (DST boundaries, retry
  semantics, paging behavior, constants shape). `npm test`.
- **CI**: GitHub Actions on Node 20 and 22, build + tests on every push and PR.
- **Examples**: runnable scripts in `examples/` — L1 bridge deposit watcher,
  genesis pool scan, market-session gate.

## 0.1.0 — 2026-07-23

- Initial release: chain constants + viem-compatible chain object, canonical
  L1 bridge contracts + event signatures, `isUsEquityMarketOpen`,
  `fetchWithRetry`.
