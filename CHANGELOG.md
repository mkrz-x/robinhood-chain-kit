# Changelog

## 0.9.0 — 2026-08-24

The kit meets viem where developers are, and every fail-closed door gets an
on-ramp. 0.8.x shipped three flagship fail-closed designs — Oracle Guard,
ERC-8056 reads, transaction preflight — and, an audit found, no way to feed
any of them: call descriptors were exported but nothing executed them,
`assessOracleHealth` demanded sequencer and pause state the kit gave you no
way to obtain, and the preflight adapter's ten methods had no shipped binding.
This release closes those gaps without breaking anything: a pure minor, and
the core still has zero runtime dependencies.

### Added

- **`robinhood-chain-kit/viem`** — the one entry that speaks viem, with viem
  imported as **types only** (the emitted JS contains no viem import, so the
  new optional peer stays truly optional). `robinhoodChainActions()` for
  `.extend()`: `getScaledUiMultiplierState`, `getStockDirectory`,
  `getOracleHealth`, and `getEquityQuote`, which composes registry → feed →
  round → multiplier → pause → session into one quote.
  `createViemPreflightAdapter(client)` is the shipped
  `TransactionPreflightAdapter` binding; it deliberately omits
  `resolveContract`/`resolveAsset` rather than fabricate `verified: true`
  evidence an RPC cannot know.
- **Subpath exports** `./viem`, `./erc8056`, `./oracle`, `./preflight`, each
  with types-first ESM and CJS conditions, so guarding a price no longer
  drags the preflight engine into a bundle. The root keeps re-exporting
  everything else, unchanged.
- **`MinimalPublicClient`** (`src/client.ts`) — the structural client the
  executed readers take. Any viem `PublicClient` satisfies it without the kit
  importing viem; `executeContractCalls` batches through `multicall` when
  present (chunked at 300 calls) and falls back to sequential reads when the
  method is absent, rejects wholesale, or returns a misaligned result —
  misalignment being the silent-wrong-answer case, since slot N would read as
  call N+1's value.
- **Executed readers**: `readScaledUiMultiplierState(s)` run the three
  authoritative ERC-8056 reads and return typed bigints plus the resolved
  schedule; `readOraclePauseState` reads `oraclePaused()` on the token —
  documented on the official oracles page, verified by `eth_call` on chain
  4663, and mapped fail-closed to `"unknown"` on any revert (a plain ERC-20
  reverts on the selector, and USDG did); `readOracleRound(s)` execute and
  normalize `latestRoundData()`; `readSequencerUptime` reads an AggregatorV3
  uptime feed (0 = up, 1 = down, anything else or a revert = `"unknown"`);
  and `checkOracleHealth` gathers round + pause + sequencer in one call and
  hands them to the unchanged fail-closed assessment. **No sequencer uptime
  feed address ships**: none for chain 4663 could be verified in the live
  Chainlink directory, and an unverified address baked into a package is the
  exact class of silent wrong answer this kit exists to prevent.
- **The stock-token registry** (`src/registry.ts`): `loadStockTokenDirectory`
  parses Robinhood's own `api.robinhood.com/rhj/assets` with the same trust
  boundary as the Chainlink loader — atomic parsing where one malformed row
  rejects the document, optional byte-level `expectedSha256` pinning,
  injectable fetch — with the schema taken from the live payload (194 assets
  read and checked), not from documentation that does not exist.
  `findStockToken` looks up by ticker or address; `RHJ_ASSETS_URL` is
  exported from `chain`. **`USDG_ADDRESS` / `USDG_DECIMALS`** ship verified:
  `eth_call` on chain 4663 answered name "Global Dollar", symbol "USDG",
  decimals 6 at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, and the chain's
  Blockscout lists that deployment as verified with live market data while
  the several same-name copycats are unverified with round 1e27 supplies.
- **DvP leg builders**: `settlementLegFromScaledUiLog` and
  `settlementLegFromTransferLog` convert decoded logs into `SettlementLeg`s —
  the boilerplate every `pairDeliveryVersusPayment` caller hand-wrote, with
  its two recurring mistakes designed out (uiValue where the raw value
  belongs; uiValue dropped and lost to UI pricing). Strict validation throws
  on malformed input, because a leg that silently fails to pair is worse than
  one that errors.
- **Premium math where people can find it** (`src/premium.ts`, also on
  `./oracle`): `underlyingSharePrice` encodes the official docs' direction —
  the feed prices the TOKEN, multiplier included, and the share price is
  `feedPrice * 1e18 / uiMultiplier()`, quoted from the docs in the source —
  plus `formatUnderlyingSharePrice`, signed `premiumBps`, and
  `computePriceDeviationBps`/`computeSignedPriceDeviationBps`. The deviation
  arithmetic moved to a shared pure module so `./oracle` offers it without
  the preflight engine; preflight's `calculatePriceDeviationBps` now
  delegates to it, byte-for-byte the same results.
- **`nextUsEquitySessionChange(ts)`** — the exact epoch of the next scheduled
  session boundary and which way it flips, holiday- and early-close-aware,
  using the same calendar as `getUsEquityMarketSession`.
- **`oraclePaused` joined `ERC8056_ABI`** with a `deployed-call` verification
  entry, evidence documented in the member's note.
- **Formerly private utilities, exported**: `sha256Hex` (compute your own
  directory pins), `DEFAULT_RANGE_TOO_LARGE_PATTERNS`, `defaultIsRateLimit`
  and `defaultIsRangeTooLarge` (extend the classifiers instead of replacing
  them), `KNOWN_ERC20_SELECTORS`, and `MAX_UINT256`.
- **`llms.txt`** in the package root: every export, one line each, grouped by
  module and marked `[pure]`/`[network]`, for token-budgeted contexts.
- Examples: `equity-quote.mts`, `oracle-health-live.mts`,
  `viem-preflight.mts`, and a rewritten learning-order table.

### Changed

- **viem becomes an optional peer** (`peerDependenciesMeta.optional`), used
  by the `/viem` entry and only for types. Consumers without viem see no
  install change and no runtime change.
- `getChainlinkRoundDataCalls` accepts `Pick<ChainlinkFeed, "proxyAddress">`,
  a safe widening so executed readers can pass a bare address.
- The build is multi-entry (tsup) and `attw` runs the node16 profile: the
  package requires Node ≥ 20.3, and the node10 resolution mode it drops was
  the only thing standing between the subpaths and a green check.
- `verify-live` now exercises the whole new surface against mainnet: parses
  the live registry, reads AAPL's multiplier and pause flag, confirms USDG's
  decimals on-chain, runs `checkOracleHealth`, and extends a real viem client
  through `getEquityQuote`.
- README: the five-line viem quickstart leads, followed by a
  which-functions-touch-the-network table and the on-ramp sections. The
  failure-mode prose is unchanged.

### Fixed

- Nothing existing broke, and nothing existing changed behaviour. Every 0.8.x
  export, including both deprecated functions, is intact — this is a pure
  minor.

## 0.8.1 — 2026-08-01

- **Release process: CI attests, it no longer publishes.** Two attempts to
  publish over OIDC were rejected with a 404 on the PUT while provenance signed
  fine, and the second was unambiguous — the version was not on the registry at
  all, so nothing but the token could have been refused. Rather than leave a
  failed run on every tag, `npm run release` publishes from a laptop and the
  tag workflow proves the result: it rebuilds the tag's tree and fails unless
  the tarball on npm is byte-identical to it. That is a stronger check than the
  old flow had, because it catches the failure a manual release actually
  introduces — publishing from a dirty tree, a stale `dist/`, or the wrong
  branch. `publishConfig.provenance` is removed: with no OIDC provider outside
  CI it made every hand publish fail with `EUSAGE`, and no released version has
  ever carried an attestation. The workflow header documents exactly how to
  restore CI publishing if the trusted publisher is ever configured.
- **`npm run release` refuses in under a second instead of after thirty.**
  `scripts/preflight-release.mjs` checks the three cheap things first: the
  version is not already on the registry, the working tree is clean, and the
  CHANGELOG has a section for this version. The working-tree check is the one
  that matters — publishing is irreversible and npm does not allow replacing a
  version, so the tag workflow's checksum comparison can only report a bad
  publish after it is already public. This prevents it.
- No consumer-facing code changed in this release; it is release tooling and
  the README section describing it.

## 0.8.0 — 2026-08-01

Correctness release. Two figures in 0.7.0 were presented as exact and were
not; both are financial numbers, and both were wrong in a way that looks
right. Minor rather than patch because two public behaviours change.

- **A multiplier recovered from one transfer cannot be exact, and 0.7.0 said
  it was.** The contract computes `uiValue = floor(rawValue * multiplier /
  1e18)`, so the low-order information is destroyed before the event is
  emitted. With a true multiplier of 1.5 and a raw value of 3, the emitted
  `uiValue` is `floor(4.5) = 4`, and dividing back gives 1.333… — not the
  multiplier, and never was. Added `estimateScaledUiMultiplier`, which returns
  the mathematically exact feasible interval (`lowerBound`,
  `upperBoundExclusive`) alongside a midpoint labelled `estimated: true`.
  Verified against a contract simulation over 79,527 observations: the true
  multiplier lies inside the returned bounds every time.
- **`readScaledUiMultiplier` is deprecated** and now delegates to the estimate.
  Its `multiplier` is the interval midpoint rather than a floor division,
  because the old value could fall *outside* the range of multipliers
  consistent with the observation.
- **`compareScaledUiMultiplier` is for authoritative contract readings only**,
  and its `toleranceBps` now defaults to 0. The old default of 1 existed to
  absorb estimate noise, which meant a dead band that would swallow a genuine
  small corporate action. Added `compareScaledUiEstimates` for estimates: it
  reports a change only when the two feasible ranges are **disjoint**, so two
  differently sized transfers under one unchanged multiplier no longer
  manufacture a corporate action that never happened.
- **Settlement pricing now states its unit.** `settlement.stock.value` is a raw
  ERC-20 amount, which is not the displayed share count once a multiplier is in
  play: one raw unit under a 4x multiplier is four displayed shares, so a raw
  price of 400 is a displayed price of 100. Added `inferRawSettlementPrice` and
  `inferUiSettlementPrice`; every result now carries `stockAmountMode: "raw" |
  "ui"`. The UI form requires either the contract's own `uiValue` or an
  authoritative multiplier, and throws when given both or neither — a pricing
  basis that can be silently defaulted is one that will be silently wrong.
- **`inferSettlementPrice` is deprecated**, unchanged in behaviour, and now
  documents that it prices per raw ERC-20 unit.
- **ERC-8056 contract surface, verified against chain 4663**: added
  `ERC8056_ABI`, `UIMULTIPLIER_UPDATED_EVENT`, `UIMULTIPLIER_UPDATED_TOPIC0` and
  `getErc8056ReadCalls`, client-neutral and with no new runtime dependency.
  Nothing here is taken from the draft text: `uiMultiplier()`,
  `newUIMultiplier()` and `effectiveAt()` all answered `eth_call` on live stock
  tokens, and both event topics were found in the beacon implementation's
  bytecode and then in emitted logs. `ERC8056_VERIFICATION` records which kind
  of evidence each member has. The spec's `TransferWithUIAmount` topic is
  **absent** from that bytecode, so the name trap is now confirmed at the
  bytecode level and not only from log filters.
- **`UIMultiplierUpdated` announces a SCHEDULED change, not a completed one.**
  One token emitted the identical `(old, new, effectiveAt)` triple at two
  different blocks while `old` was still the live multiplier. Added
  `resolveScaledUiMultiplier`, which never returns the pending value as
  current and flags the one unsafe state — `status: "due"`, where the
  effective time has passed and the contract still reports the old value.
  All ten emissions on chain carry exactly one topic and 96 bytes of data,
  confirming all three parameters are non-indexed as declared.
- **Feed-directory integrity**: `loadChainlinkFeedDirectory` accepts an optional
  `expectedSha256`, hashed over the raw response bytes before parsing. Schema
  validation proves shape, not authorship — a hijacked mirror can serve a
  perfectly-shaped directory pointing every feed at addresses it chose. No
  digest is hardcoded: a pinned constant nobody maintains breaks for every
  consumer at once, so pinning is the caller's decision.

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
