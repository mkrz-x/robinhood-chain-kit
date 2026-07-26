# Changelog

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
