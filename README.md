<p align="center">
  <img src="https://rhxbt.com/avatar.svg" width="72" height="72" alt="rhxbt" />
</p>

<h1 align="center">robinhood-chain-kit</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/robinhood-chain-kit"><img src="https://img.shields.io/npm/v/robinhood-chain-kit?color=cb3837&label=npm" alt="npm" /></a>
  <a href="https://github.com/mkrz-x/robinhood-chain-kit/actions/workflows/ci.yml"><img src="https://github.com/mkrz-x/robinhood-chain-kit/actions/workflows/ci.yml/badge.svg" alt="ci" /></a>
  <a href="https://github.com/mkrz-x/robinhood-chain-kit/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/chain%20id-4663-8b5cf6" alt="chain id 4663" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/dependencies-zero-0ea5e9" alt="zero dependencies" />
  <a href="https://bundlephobia.com/package/robinhood-chain-kit"><img src="https://img.shields.io/bundlephobia/minzip/robinhood-chain-kit?label=gzipped&color=f59e0b" alt="bundle size" /></a>
  <a href="https://x.com/mkrz_"><img src="https://img.shields.io/badge/author-%40mkrz__-000000?logo=x&logoColor=white" alt="@mkrz_ on X" /></a>
  <a href="https://x.com/0xrhXBT"><img src="https://img.shields.io/badge/agent-%400xrhXBT-000000?logo=x&logoColor=white" alt="@0xrhXBT on X" /></a>
</p>

<p align="center">
  Typed building blocks for <b>Robinhood Chain</b> (Arbitrum Orbit L2, chain id <b>4663</b>),<br/>
  extracted from the production pipeline behind <a href="https://rhxbt.com">rhxbt.com</a>.
</p>

---

## Why

Every project on this chain re-derives the same primitives: network and bridge
configuration, trusted DEX event scopes, US regular-session context, independent
oracle-heartbeat checks, and resilient RPC/HTTP access. This package keeps those
primitives typed, tested, and free of runtime dependencies.

It also carries the one thing that makes this chain different from every other
L2, and the one that costs the most to learn the hard way: tokenized equities
adjust through an **ERC-8056 scaled-UI multiplier** rather than by minting, and
the deployed contracts do not use the event name the EIP specifies.

## What's inside

| Module | What it gives you |
|---|---|
| `chain` | mainnet + testnet RPC, sequencer feed, explorer, separate Blockscout `/api` + REST `/api/v2`, and viem-compatible chain objects |
| `bridge` | documented mainnet/testnet L1 + L2 protocol contracts, Arbitrum precompiles, and gateway-emitted deposit/withdrawal events |
| `dex` | **V2/V3/V4** event signatures, explicit caller/recipient roles, and address-scoped factory/PoolManager discovery targets |
| `stocktokens` / ERC-8056 | the transfer event stock tokens **actually** emit and its verified `topic0`, exact bigint multiplier recovery, raw↔display conversion, corporate-action change detection, and peer-to-peer settlement reconstruction |
| `feeds` / Oracle Guard | strict Chainlink directory loading, typed feed lookup and read calls, exact bigint price formatting, and fail-closed round/sequencer/pause assessment |
| `preflight` / Transaction Firewall | strict action decoding, injected simulation and identity evidence, exact balance/fee/market checks, and withheld-or-ready transaction plans |
| `getLogsPaged(getLogs, from, to, opts)` | exact-block-count log backfill: shrinks only on recognized size errors, bounds 429 retries, supports cancellation, and never retries consumer callbacks |
| `getUsEquityMarketSession(ts)` | DST-, holiday-, and early-close-aware US regular-session context |
| `isFeedFresh(updatedAt, heartbeat, now)` | heartbeat freshness independent from the regular session; Stock Token feeds currently publish 24/5 |
| `fetchWithRetry(url, init, opts)` | caller-aware timeout, Retry-After + jittered backoff, body cleanup, and safe-method retry defaults |

## How it fits together

![How it fits together](https://raw.githubusercontent.com/mkrz-x/robinhood-chain-kit/main/assets/architecture.svg)

<sub>source: [`assets/architecture.mmd`](assets/architecture.mmd) — rendered to SVG so it displays on npm too (npm does not render mermaid)</sub>

## Install

```
npm i robinhood-chain-kit
```

Node 20.3+ is supported. Both ESM imports and CommonJS `require()` are published.

## Usage

```ts
import {
  robinhoodChain,
  L1_GATEWAYS,
  DEPOSIT_INITIATED_EVENT,
  getUsEquityMarketSession,
  isFeedFresh,
} from "robinhood-chain-kit";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

const l2 = createPublicClient({ chain: robinhoodChain, transport: http() });

// track recent ERC-20 deposits from an L1 RPC
const l1 = createPublicClient({ chain: mainnet, transport: http() });
const l1Head = await l1.getBlockNumber();
const deposits = await l1.getLogs({
  address: [...L1_GATEWAYS],
  event: parseAbiItem(DEPOSIT_INITIATED_EVENT),
  fromBlock: l1Head - 1_000n,
  toBlock: l1Head,
});

// regular-session context and feed freshness are separate signals
function shouldCompareDuringRegularSession(updatedAt: number, heartbeat: number) {
  const now = Date.now() / 1000;
  const session = getUsEquityMarketSession(now);
  const freshness = isFeedFresh(updatedAt, heartbeat, now);
  return session.phase === "regular" && freshness.fresh;
}
```

`getUsEquityMarketSession` models scheduled US exchange holidays and standard
13:00 ET early closes. It cannot predict emergency closures. The current
Robinhood Stock Token feeds are documented as 24/5, so do not use the regular
session as a feed-freshness proxy: check `updatedAt`, the feed heartbeat,
sequencer uptime, and the token's corporate-action pause state.

### Backfill event history without babysitting the RPC

The public RPC caps `eth_getLogs` at ~10k blocks *and* ~10k results, and rate
limits on top. `getLogsPaged` encodes the response that actually works (learned
running rhxbt.com's full-chain swap index): a "range too large" error is a
**size** problem — halve the window; a 429 is a **time** problem — cool off and
retry the *same* window, because halving multiplies the request count and makes
it worse. After a reduction it re-grows only after 3 clean passes, so it never
ping-pongs against the cap. Authentication, malformed-query, and other fatal
errors are rethrown immediately instead of being disguised as size failures.

```ts
import { getLogsPaged, robinhoodChain, V2_PAIR_CREATED_EVENT } from "robinhood-chain-kit";
import { createPublicClient, http, parseAbiItem } from "viem";

const client = createPublicClient({ chain: robinhoodChain, transport: http() });
const head = await client.getBlockNumber();
const abortController = new AbortController();

// every V2 pair ever created, from genesis, over the plain public RPC
const pairs = await getLogsPaged(
  (fromBlock, toBlock) =>
    client.getLogs({ event: parseAbiItem(V2_PAIR_CREATED_EVENT), fromBlock, toBlock }),
  0n,
  head,
  { chunkSize: 9_500n, maxRetries: 5, signal: abortController.signal },
);
```

Works with any client — you supply the `getLogs` function, the kit supplies the
judgment. For huge ranges, stream with `{ collect: false, onPage }` instead of
accumulating. `chunkSize` is an exact block count: `10_000n` requests at most
10,000 inclusive blocks.

### Discover DEX pools without trusting event signatures

An event topic is not a deployment identity: any contract can emit a matching
topic. Supply independently verified factory/PoolManager addresses and use the
returned address-scoped targets:

```ts
import { getDexDiscoveryTargets } from "robinhood-chain-kit";

const targets = getDexDiscoveryTargets({
  v2Factories: ["0x..."],
  v3Factories: ["0x..."],
  v4PoolManagers: ["0x..."],
});
```

V2 `to` and V3 `recipient` are output recipients, not guaranteed economic
actors. V4 `sender` is normally periphery. Treat transaction origin, routers,
smart accounts, and beneficiaries as separate roles.

### Read a tokenized equity without getting the split wrong

Corporate actions on this chain do not mint or burn. The contract carries a
multiplier, raw balances stay exactly where they were, and the amount a holder
is shown changes underneath them. Every transfer emits both numbers.

**The event is not the one EIP-8056 names.** The spec says
`TransferWithUIAmount`; the deployed contracts emit `TransferWithScaledUI`. A
filter built from the spec computes a different `topic0` and matches zero logs,
forever. That failure is silent and it does not look like a bug — it looks like
a chain with no tokenized-equity activity on it.

```ts
import { parseAbiItem } from "viem";
import {
  TRANSFER_WITH_SCALED_UI_EVENT,
  compareScaledUiMultiplier,
  formatScaledUiMultiplier,
  readScaledUiMultiplier,
  toUiAmount,
} from "robinhood-chain-kit";

const logs = await client.getLogs({
  address: stockToken,
  event: parseAbiItem(TRANSFER_WITH_SCALED_UI_EVENT),
  fromBlock,
  toBlock,
});

const { value, uiValue } = logs.at(-1)!.args;
const read = readScaledUiMultiplier({ value, uiValue });
if (!read.known) throw new Error(`multiplier unreadable: ${read.reason}`);

console.log(formatScaledUiMultiplier(read.multiplier)); // 4.000000000000000000
console.log(toUiAmount(rawBalance, read.multiplier));   // what the holder sees

const change = compareScaledUiMultiplier(previousMultiplier, read.multiplier);
if (change.moved) {
  // a corporate action landed. every historical figure derived from raw
  // amounts across this boundary has changed meaning.
  console.warn(`multiplier moved ${change.direction}`);
}
```

`readScaledUiMultiplier` fails closed: a zero raw value makes the ratio
undefined rather than enormous, and "we cannot tell" is a different answer from
"the multiplier is 1". Multipliers are `bigint` throughout, because a `number`
cannot hold a uint256 ratio exactly and a figure that is quietly slightly wrong
is the entire hazard.

`compareScaledUiMultiplier` reports **direction only**. A split and a dividend
adjustment both move it up; the event carries nothing that separates them, so
naming a cause here would be a guess wearing an API's clothes.

### See the trades no DEX index can

A stock-token transfer and a stablecoin transfer inside the same transaction,
opposed between the same two addresses, is a trade by construction: one side
gave up the asset, the other gave up the cash, and both legs committed together
or neither did. No pool was involved, which is exactly why a swap-based index
cannot see any of it.

```ts
import { inferSettlementPrice, pairDeliveryVersusPayment } from "robinhood-chain-kit";

const settlements = pairDeliveryVersusPayment({ stockLegs, cashLegs });

for (const settlement of settlements) {
  const price = inferSettlementPrice({
    settlement,
    stockDecimals: 18,
    cashDecimals: 6,
    priceDecimals: 2,
  });
  if (price.inferred) console.log(settlement.buyer, price.price); // "400.00"
}
```

Fails closed, hard. A settlement is reported only when a transaction carries
exactly one stock leg and one cash leg, opposed between the same pair of
addresses. Batches, routed fills, and anything with a third party in the middle
are left unclassified rather than guessed at — the value of the output is that
a reported settlement really is one.

`inferred: true` is not decoration. **No venue quoted this price.** It is the
ratio of two amounts in one transaction, and the two parties may have agreed it
hours earlier, off-chain, at a level unrelated to any market. A count of
settlements is a hard fact; the level any one of them printed at is a
reconstruction, and anything displaying it should say so.

### Guard a Chainlink price round

Oracle Guard loads a stable, validated subset of the live Chainlink directory
and keeps answers as `bigint` until exact decimal formatting. A round is usable
only when its answer and timestamp are valid, its heartbeat is fresh, the
sequencer is up beyond the caller's recovery grace period, and corporate-action
state is explicitly active or not applicable.

```ts
import {
  assessOracleHealth,
  findChainlinkFeeds,
  loadChainlinkFeedDirectory,
} from "robinhood-chain-kit";

const feeds = await loadChainlinkFeedDirectory();
const [feed] = findChainlinkFeeds(feeds, { baseAsset: "GOOGL", quoteAsset: "USD" });
if (!feed) throw new Error("GOOGL/USD feed is missing");

const health = assessOracleHealth({
  feed,
  round: {
    roundId: 10n,
    answer: 12_345_678_900n,
    updatedAtSeconds: 1_000n,
    answeredInRound: 10n,
  },
  nowSeconds: 1_200,
  sequencer: { status: "up", sinceSeconds: 100, gracePeriodSeconds: 60 },
  pauseState: "active",
});

if (!health.usable) console.error(health.issues);
else console.log(health.formattedAnswer); // 123.45678900
```

`pauseState: "unknown"` and `sequencer: { status: "unknown" }` fail closed.
Use `"not-applicable"` only for assets that do not have corporate-action
pauses. Oracle Guard reports safety inputs; it never emits buy/sell decisions
or invents fallback prices.

### Preflight a transaction before signing

Transaction Firewall separates a transaction's claimed calldata shape from
independent evidence about the RPC chain, simulation, target bytecode,
contract and asset identity, approval spender, balances, allowances, gas,
fees, Oracle Guard state, and market execution risk. Caller-supplied gas and
fee caps are never accepted as estimates: they are compared with independent
adapter evidence before a plan can become ready.

```ts
import { inspectTransaction } from "robinhood-chain-kit";

const report = await inspectTransaction(
  {
    chainId: 4663,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: 1_000_000_000_000_000n,
  },
  {
    adapter: {
      getChainId: () => publicClient.getChainId(),
      simulate: async (request) => {
        try {
          await publicClient.call({
            account: request.from,
            to: request.to,
            data: request.data,
            value: request.value,
          });
          return { success: true };
        } catch (error) {
          return { success: false, revertReason: String(error) };
        }
      },
      getCode: async (address) =>
        (await publicClient.getBytecode({ address })) ?? "0x",
      getNativeBalance: (owner) => publicClient.getBalance({ address: owner }),
      estimateGas: (request) =>
        publicClient.estimateGas({
          account: request.from,
          to: request.to,
          data: request.data,
          value: request.value,
        }),
      getFeePerGas: () => publicClient.getGasPrice(),
    },
  },
);

if (report.verdict !== "safe") console.error(report.issues);
else console.log(report.plan.steps); // prepared only; never signed or sent
```

The default policy allows only Robinhood mainnet/testnet, requires RPC chain
identity, simulation, gas, fee and balance evidence, blocks unlimited token and
operator approvals, blocks EOA or unknown/unverified approval targets, and
treats unknown actions as unknown. The approval-target checks can be relaxed
only with the explicit `allowEoaApprovalTargets` or
`allowUnverifiedApprovalTargets` policy flags.

Custom decoders can describe verified DEX or bridge calls and their
balance/allowance requirements. Their selector must match the calldata, their
requirements are bounded and deduplicated, and swaps must declare both an input
asset and a canonical `marketPair` whose base matches that input (native assets
use `native:<chainId>`). Every Oracle, DEX, slippage, and
price-impact observation for a market-sensitive action carries `source`,
`chainId`, `blockNumber`, `observedAtSeconds`, `baseAsset`, and `quoteAsset`.
Pair/chain mismatch, stale or future observations, and excessive timestamp or
block skew fail closed. Selector decoding never proves contract identity.

Reports are immutable evidence snapshots. A `safe` report contains one
prepared transaction step; `blocked` and `unknown` reports always withhold all
steps. The module has no signer, wallet, private-key, broadcast, or send API.

## Examples

Runnable scripts in [`examples/`](examples/):

- [`watch-bridge.mts`](examples/watch-bridge.mts) — recent canonical ERC-20 deposits, with each token's actual decimals
- [`scan-pools.mts`](examples/scan-pools.mts) — V2/V3/V4 discovery from verified deployment addresses, with streaming and resume bounds
- [`market-session.mts`](examples/market-session.mts) — report regular-session context without claiming oracle freshness
- [`stock-token-transfers.mts`](examples/stock-token-transfers.mts) — read a stock token's ERC-8056 multiplier from live logs and spot where a corporate action landed
- [`oracle-guard.mts`](examples/oracle-guard.mts) — read a live feed and fail closed on unknown sequencer or pause state
- [`preflight-transaction.mts`](examples/preflight-transaction.mts) — simulate and risk-check a native transfer without a signer or send call
- [`preflight-erc20-transfer.mts`](examples/preflight-erc20-transfer.mts) — decode and approve a safe ERC-20 transfer plan using deterministic evidence
- [`preflight-approval-risk.mts`](examples/preflight-approval-risk.mts) — see an unlimited approval to an unverified spender fail closed
- [`preflight-custom-swap.mts`](examples/preflight-custom-swap.mts) — bind a custom swap to balances, allowance, Oracle Guard, and market provenance

The [transaction preflight examples guide](examples/README.md) provides the
recommended learning order and expected verdict for each example.

```
cd examples && npm i
V2_FACTORIES=0x... V3_FACTORIES=0x... V4_POOL_MANAGERS=0x... npx tsx scan-pools.mts
ETHEREUM_RPC_URL=https://your-rpc.example npx tsx watch-bridge.mts
npx tsx oracle-guard.mts # defaults to unknown pause/sequencer state and fails closed
STOCK_TOKEN=0x... npx tsx stock-token-transfers.mts
FROM_ADDRESS=0x... TO_ADDRESS=0x... npx tsx preflight-transaction.mts
npm run preflight:erc20
npm run preflight:approval-risk
npm run preflight:swap
```

## Notes

- Unit-tested (`npm test`), package-linted, example-type-checked, and CI-tested at the Node 20.3 floor and on Node 22.
- `npm run verify` runs the build, unit, package-resolution, and example checks.
- Contract addresses come from the [official chain docs](https://docs.robinhood.com/chain/) — verify independently before moving value.
- This is an independent, unofficial community project. Not affiliated with or endorsed by Robinhood.

---

## Links

Plain markdown on purpose: npm sanitizes raw HTML, so the centered footer this
replaced rendered on GitHub and quietly vanished on npmjs.com.

| | |
|---|---|
| Live terminal | [rhxbt.com](https://rhxbt.com) |
| Author | [@mkrz\_ on X](https://x.com/mkrz_) |
| The agent this was extracted from | [@0xrhXBT on X](https://x.com/0xrhXBT) |
| Source | [github.com/mkrz-x/robinhood-chain-kit](https://github.com/mkrz-x/robinhood-chain-kit) |
| Package | [npmjs.com/package/robinhood-chain-kit](https://www.npmjs.com/package/robinhood-chain-kit) |

## Credits

Built by [@mkrz-x](https://github.com/mkrz-x) ([rhxbt.com](https://rhxbt.com)) with review help from [@aididhaiqal](https://github.com/aididhaiqal).
