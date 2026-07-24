# Changelog

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
