# robinhood-chain-kit

Typed building blocks for **Robinhood Chain** (Arbitrum Orbit L2, chain id **4663**), extracted from the production pipeline behind [rhxbt.com](https://rhxbt.com) — an onchain intelligence terminal for the chain.

Zero dependencies. MIT.

## What's inside

- **`chain`** — chain id, RPC, sequencer feed WS, explorer, a viem-compatible chain object
- **`bridge`** — every canonical L1 contract (bridge, inbox, outbox, rollup, gateways) + the `DepositInitiated` / `WithdrawalFinalized` event signatures for tracking capital flow
- **`isUsEquityMarketOpen(ts)`** — DST-correct US regular-session check. On a tokenized-stock chain, oracle feeds freeze after the close while DEXs keep trading; treating that gap as a dislocation is the classic mistake this helper prevents
- **`fetchWithRetry(url, init, opts)`** — fetch with per-attempt timeout + exponential backoff on 408/429/5xx/timeouts, never on definitive 4xx

## Usage

```ts
import { robinhoodChain, L1_GATEWAYS, DEPOSIT_INITIATED_EVENT, isUsEquityMarketOpen } from "robinhood-chain-kit";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

const l2 = createPublicClient({ chain: robinhoodChain, transport: http() });
const l1 = createPublicClient({ chain: mainnet, transport: http() });
const deposits = await l1.getLogs({
  address: [...L1_GATEWAYS],
  event: parseAbiItem(DEPOSIT_INITIATED_EVENT),
  fromBlock: 23_000_000n,
});
```

Built and maintained by [@mkrz_](https://x.com/mkrz_) · live terminal: [rhxbt.com](https://rhxbt.com) · agent: [@0xrhXBT](https://x.com/0xrhXBT)
