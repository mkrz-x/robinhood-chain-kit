# Changelog

## 0.7.0 — 2026-08-01

- **ERC-8056 stock tokens**: added the transfer event Robinhood stock tokens
  actually emit, its verified `topic0`, exact bigint multiplier recovery,
  raw/display conversion, and corporate-action change detection.
  **The name is the point:** EIP-8056 calls the event `TransferWithUIAmount`
  and the deployed contracts emit `TransferWithScaledUI`. A filter built from
  the spec's text computes a different topic and matches zero logs forever,
  which does not look like a bug — it looks like a chain with no
  tokenized-equity activity. Both topics are exported, and the tests hash the
  signatures rather than trusting the constants.
- **Peer-to-peer settlement**: `pairDeliveryVersusPayment` reconstructs trades
  that never touched a pool, from a stock leg and a cash leg opposed inside one
  transaction. Fails closed — a settlement is only reported when exactly one of
  each is present between the same two addresses, so batches and routed fills
  are left unclassified rather than guessed at.
- **Inferred settlement price**: `inferSettlementPrice` divides the two legs
  exactly across differing decimals, and carries `inferred: true` in the result
  because no venue quoted it. A count of settlements is a hard fact; the level
  any one printed at is a reconstruction.
- Multipliers are bigint throughout. A `number` cannot hold a uint256 ratio
  exactly, and a figure that is quietly slightly wrong is the whole hazard.

## 0.6.0 — 2026-07-26 (published 2026-08-01)

- **Transaction Firewall**: added strict transaction normalization, conservative
  native/ERC-20/operator action decoding, injected simulation and RPC evidence,
  provider-chain checks, asset/contract/approval-target identity, exact gas and
  balance accounting, and fail-closed `safe` / `blocked` / `unknown` verdicts.
- **Market-aware planning**: integrates Oracle Guard, exact cross-decimal
  oracle/DEX deviation, slippage, price-impact, and bounded custom DEX/bridge
  decoders. Market observations are bound to an explicit pair, chain, block,
  timestamp, and source; stale, skewed, or mismatched evidence fails closed.
- **Independent execution caps**: caller gas limits and fee caps are compared
  with independent estimates, empty-calldata targets are classified by
  bytecode, and EOA or unknown/unverified approval targets are blocked unless
  an explicit policy opts out.
- **Immutable evidence**: adapter and caller inputs are cloned into deeply
  frozen reports so later mutation cannot change a completed assessment.
- **Guided examples**: added deterministic ERC-20 transfer, blocked approval,
  and provenance-bound custom swap walkthroughs alongside the live RPC example.
- **No execution authority**: the public surface prepares explainable plans but
  contains no wallet, private-key, signer, broadcaster, or send API.

## 0.5.0 — 2026-07-26 (developed, never published to npm)

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

## 0.4.0 — 2026-07-26 (developed, never published to npm)

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
