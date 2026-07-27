# Add Transaction Preflight and Action Planner

**Goal:** Add a dependency-free, fail-closed transaction firewall that explains, simulates, risk-checks, and prepares Robinhood Chain transactions without signing or broadcasting them.
**Why planning is required:** This introduces a financial public API that combines untrusted calldata, injected RPC evidence, balances, allowances, gas and fee estimates, contract identity, Oracle Guard output, and market-risk policy into an execution-readiness verdict.
**Acceptance:** A caller can inspect a normalized transaction and receive a decoded action, isolated evidence results, explicit blocking/unknown/warning issues, and a withheld-or-ready plan; malformed inputs throw before I/O; missing or failed required evidence never becomes safe; unlimited approvals, insufficient funds or allowance, failed simulation, unusable oracle state, and excessive slippage, price impact, or oracle/DEX deviation fail closed; aborts propagate; no API signs, sends, or mutates chain state; retained tests cover every verdict path and the full package, exact Node floor, example, tarball, live-canary, audit, and review gates pass.

### Outcome 1: Strict transaction and action analysis
- Work: Add a `preflight` module with strict address, hex, bigint, chain, fee, and calldata validation; normalize requests without number coercion; decode native transfers, ERC-20 transfers/approvals/transfer-from calls, operator approvals, contract creation, and unknown calls; expose a bounded custom decoder hook for protocol-specific DEX or bridge actions.
- Risks/open questions: Function selectors describe calldata shape rather than proving target identity, so decoded actions must remain separate from independently supplied contract evidence.
- Verify: `npm test -- src/preflight.test.ts`

### Outcome 2: Abort-aware evidence collection and planning
- Work: Add an injected client-neutral adapter for simulation, code, contract identity, balances, allowances, gas, and fee evidence; isolate provider failures into explicit unknown evidence while rethrowing caller aborts; collect only evidence relevant to the decoded action; withhold all transaction steps unless the final verdict is safe.
- Risks/open questions: The package must not add viem, ethers, private-key, wallet, signer, or broadcaster ownership.
- Verify: `npm test -- src/preflight.test.ts && npm run check:types`

### Outcome 3: Fail-closed policy and exact market risk
- Work: Add deterministic policy evaluation for supported chains, unknown actions, contract existence and identity, simulation, gas and fee coverage, balances, allowances, unlimited and operator approvals, Oracle Guard usability, slippage, price impact, and exact cross-decimal oracle/DEX deviation; return all independent issues in stable order with `safe`, `blocked`, or `unknown` verdicts.
- Risks/open questions: Market evidence is caller- or adapter-supplied and must retain provenance; the kit reports readiness, never predicts returns or emits buy/sell decisions.
- Verify: `npm test -- src/preflight.test.ts`

### Outcome 4: v0.6.0 integration and operator example
- Work: Export the module, add a runnable injected-adapter example, update README, architecture, changelog, keywords, and package version, and retain zero runtime dependencies and dual ESM/CommonJS delivery.
- Verify: `npm run check:examples && npm run check:package`

### Outcome 5: Completion evidence and review
- Work: Compare the complete stacked diff with this plan, run the full suite on the supported Node floor, exercise live canaries, audit dependencies, inspect the final package surface, and obtain an independent financial/public-contract review.
- Verify: `npm run verify && npm run check:live && npm audit --audit-level=low && git diff --check`
