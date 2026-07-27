# Transaction preflight examples

Start with the deterministic examples. They use injected in-memory evidence, so
they are safe to run, make no network requests, and never sign or broadcast.

| Example | Expected result | What it teaches |
|---|---|---|
| `preflight-erc20-transfer.mts` | `safe` | built-in calldata decoding, token balance and identity checks |
| `preflight-approval-risk.mts` | `blocked` | unlimited approvals, unverified spenders, and withheld plans |
| `preflight-custom-swap.mts` | `safe` | custom decoding, allowance checks, Oracle Guard, and market provenance |
| `preflight-transaction.mts` | depends on live evidence | adapting a viem public client for a native transfer |

Run them from this directory:

```sh
npm install
npm run preflight:erc20
npm run preflight:approval-risk
npm run preflight:swap
npm run preflight:live-native
```

The adapter owns read-only evidence collection. `inspectTransaction()` owns
validation, policy evaluation, and the withheld-or-ready plan. Your application
still owns any later signing or broadcasting step.
