# Examples

Recommended learning order. The deterministic preflight examples use injected
in-memory evidence, so they are safe to run, make no network requests, and
never sign or broadcast; the live examples read the real chain and public
directories, and still never sign anything.

| Example | Expected result | What it teaches |
|---|---|---|
| `preflight-erc20-transfer.mts` | `safe` | built-in calldata decoding, token balance and identity checks |
| `preflight-approval-risk.mts` | `blocked` | unlimited approvals, unverified spenders, and withheld plans |
| `preflight-custom-swap.mts` | `safe` | custom decoding, allowance checks, Oracle Guard, and market provenance |
| `equity-quote.mts` | a live quote, `usable: false (sequencer-state-unknown)` | the viem `.extend()` on-ramp: directory → feed → round → pause → session in one call |
| `oracle-health-live.mts` | one honest remaining issue | `checkOracleHealth` against mainnet, and why the kit ships no sequencer feed address |
| `viem-preflight.mts` | depends on live evidence | `createViemPreflightAdapter`: the whole adapter in one call |
| `preflight-transaction.mts` | depends on live evidence | the same adapter written by hand, method by method |

Run them from this directory:

```sh
npm install
npm run preflight:erc20
npm run preflight:approval-risk
npm run preflight:swap
npm run equity:quote            # or: SYMBOL=GOOGL npm run equity:quote
npm run oracle:health-live
npm run preflight:viem
npm run preflight:live-native
```

The adapter owns read-only evidence collection. `inspectTransaction()` owns
validation, policy evaluation, and the withheld-or-ready plan. Your application
still owns any later signing or broadcasting step.
