import { describe, expect, it } from "vitest";
import {
  calculatePriceDeviationBps,
  decodeTransactionAction,
  inspectTransaction,
  normalizeTransactionRequest,
  type CustomTransactionAction,
  type TokenBalanceRequirement,
  type TransactionPreflightAdapter,
} from "./preflight.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const SPENDER = "0x4444444444444444444444444444444444444444";
const ROUTER = "0x5555555555555555555555555555555555555555";
const MAX_UINT256 = (1n << 256n) - 1n;
const NOW_SECONDS = 1_000;
const MARKET_PAIR = {
  baseAsset: TOKEN,
  quoteAsset: "native:4663",
};

const addressWord = (address: string) => address.slice(2).padStart(64, "0");
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const call = (selector: string, ...words: string[]) => `${selector}${words.join("")}`;

const baseRequest = {
  chainId: 4663,
  from: FROM,
  to: TOKEN,
  data: call("0xa9059cbb", addressWord(RECIPIENT), uintWord(100n)),
  value: 0n,
};

const safeAdapter = (
  overrides: Partial<TransactionPreflightAdapter> = {},
): TransactionPreflightAdapter => ({
  getChainId: async () => 4663,
  simulate: async () => ({ success: true, gasUsed: 50_000n }),
  getCode: async () => "0x60006000",
  resolveContract: async (address) => ({
    address,
    name: "Known contract",
    kind: address.toLowerCase() === ROUTER.toLowerCase() ? "router" : "erc20",
    verified: true,
    source: "test registry",
  }),
  resolveAsset: async (address) => ({
    address,
    symbol: "TEST",
    decimals: 18,
    kind: "erc20",
    verified: true,
    source: "test registry",
  }),
  getNativeBalance: async () => 10n ** 18n,
  getTokenBalance: async () => 1_000n,
  getAllowance: async () => 1_000n,
  estimateGas: async () => 50_000n,
  getFeePerGas: async () => 2n,
  ...overrides,
});

const healthyOracle = {
  usable: true,
  reason: "healthy",
  issues: [],
  ageSeconds: 1,
  formattedAnswer: "100.00000000",
} as const;

const marketObservation = (source: string) => ({
  ...MARKET_PAIR,
  source,
  chainId: 4663,
  blockNumber: 100n,
  observedAtSeconds: NOW_SECONDS,
});

const safeMarket = () => ({
  oracle: {
    ...marketObservation("Oracle Guard"),
    assessment: healthyOracle,
  },
  oraclePrice: {
    ...marketObservation("Chainlink"),
    value: 100_000_000n,
    decimals: 8,
  },
  dexPrice: {
    ...marketObservation("router quote"),
    value: 100n,
    decimals: 2,
  },
  slippage: {
    ...marketObservation("router quote"),
    bps: 50,
  },
  priceImpact: {
    ...marketObservation("router quote"),
    bps: 75,
  },
});

const customSwap = (): CustomTransactionAction => ({
  kind: "custom",
  name: "Swap",
  category: "swap",
  source: "router adapter",
  selector: "0x12345678",
  target: ROUTER,
  tokenBalanceRequirements: [
    { token: TOKEN, owner: FROM, minimum: 1n },
  ],
  allowanceRequirements: [],
  marketSensitive: true,
  marketPair: MARKET_PAIR,
});

describe("transaction normalization and decoding", () => {
  it("normalizes safe defaults without coercing bigint fields", () => {
    expect(
      normalizeTransactionRequest({
        chainId: 4663,
        from: FROM,
        to: RECIPIENT,
      }),
    ).toEqual({
      chainId: 4663,
      from: FROM,
      to: RECIPIENT,
      data: "0x",
      value: 0n,
    });
  });

  it.each([
    ["native transfer", { chainId: 4663, from: FROM, to: RECIPIENT }, "native-transfer"],
    [
      "ERC-20 transfer",
      {
        ...baseRequest,
        data: call("0xa9059cbb", addressWord(RECIPIENT), uintWord(100n)),
      },
      "erc20-transfer",
    ],
    [
      "ERC-20 approval",
      {
        ...baseRequest,
        data: call("0x095ea7b3", addressWord(SPENDER), uintWord(100n)),
      },
      "erc20-approve",
    ],
    [
      "ERC-20 transferFrom",
      {
        ...baseRequest,
        data: call(
          "0x23b872dd",
          addressWord(FROM),
          addressWord(RECIPIENT),
          uintWord(100n),
        ),
      },
      "erc20-transfer-from",
    ],
    [
      "operator approval",
      {
        ...baseRequest,
        data: call("0xa22cb465", addressWord(SPENDER), uintWord(1n)),
      },
      "operator-approval",
    ],
    [
      "unknown call",
      { ...baseRequest, data: "0x12345678" },
      "unknown-contract-call",
    ],
    [
      "contract deployment",
      { chainId: 4663, from: FROM, data: "0x60006000" },
      "contract-deployment",
    ],
  ])("decodes a %s conservatively", (_label, request, expected) => {
    expect(decodeTransactionAction(normalizeTransactionRequest(request))).toMatchObject({
      kind: expected,
    });
  });

  it("rejects malformed input before making adapter calls", async () => {
    let calls = 0;
    const adapter = safeAdapter({
      simulate: async () => {
        calls += 1;
        return { success: true };
      },
    });
    await expect(
      inspectTransaction(
        { ...baseRequest, from: "0x1234" },
        { adapter },
      ),
    ).rejects.toThrow(/request\.from/);
    expect(calls).toBe(0);
  });

  it("rejects conflicting fee fields and empty deployments", () => {
    expect(() =>
      normalizeTransactionRequest({
        ...baseRequest,
        gasPrice: 1n,
        maxFeePerGas: 2n,
      }),
    ).toThrow(/not both/);
    expect(() =>
      normalizeTransactionRequest({ chainId: 4663, from: FROM }),
    ).toThrow(/deployment data/);
  });
});

describe("exact market arithmetic", () => {
  it("calculates cross-decimal deviation without floating point", () => {
    expect(
      calculatePriceDeviationBps(
        { value: 100_000_000n, decimals: 8, source: "oracle" },
        { value: 101n, decimals: 2, source: "dex" },
      ),
    ).toBe(100n);
  });

  it("rounds any fractional basis point upward", () => {
    expect(
      calculatePriceDeviationBps(
        { value: 1_000_000n, decimals: 6, source: "oracle" },
        { value: 1_000_001n, decimals: 6, source: "dex" },
      ),
    ).toBe(1n);
  });
});

describe("inspectTransaction", () => {
  it("returns a ready plan only when every required signal is safe", async () => {
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter(),
    });
    expect(report).toMatchObject({
      verdict: "safe",
      action: { kind: "erc20-transfer", amount: 100n },
      issues: [],
      estimatedFee: 100_000n,
      requiredNativeBalance: 100_000n,
      plan: {
        status: "ready",
        steps: [{ id: "transaction", kind: "transaction" }],
      },
    });
    expect(report.evidence.tokenBalances).toHaveLength(1);
    expect(report.evidence.assetIdentities).toHaveLength(1);
  });

  it("withholds the plan when required provider evidence is missing", async () => {
    const report = await inspectTransaction(baseRequest, {
      adapter: {
        simulate: async () => ({ success: true }),
      },
    });
    expect(report.verdict).toBe("unknown");
    expect(report.plan).toEqual({ status: "withheld", steps: [] });
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "chain-id-unavailable",
        "target-code-unavailable",
        "contract-identity-unavailable",
        "asset-identity-unavailable",
        "gas-estimate-unavailable",
        "fee-estimate-unavailable",
        "native-balance-unavailable",
        "token-balance-unavailable",
      ]),
    );
  });

  it("blocks when provider chain identity does not match the request", async () => {
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter({ getChainId: async () => 1 }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "chain-id-mismatch", severity: "block" }),
    );
  });

  it("isolates provider failures as unknown evidence", async () => {
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter({
        getCode: async () => {
          throw new Error("provider offline");
        },
      }),
    });
    expect(report.verdict).toBe("unknown");
    expect(report.evidence.targetCode).toEqual({
      status: "unavailable",
      error: "provider offline",
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "target-code-unavailable", severity: "unknown" }),
    );
  });

  it.each([
    [
      "simulation",
      { simulate: async () => null as never },
      "simulation-unavailable",
    ],
    [
      "gas estimate",
      {
        simulate: async () => ({ success: true }),
        estimateGas: async () => 50_000 as never,
      },
      "gas-estimate-unavailable",
    ],
    [
      "uint256-overflow gas estimate",
      {
        simulate: async () => ({ success: true }),
        estimateGas: async () => 1n << 256n,
      },
      "gas-estimate-unavailable",
    ],
    [
      "zero fee estimate",
      { getFeePerGas: async () => 0n },
      "fee-estimate-unavailable",
    ],
    [
      "contract identity",
      { resolveContract: async () => null as never },
      "contract-identity-unavailable",
    ],
    [
      "asset identity",
      { resolveAsset: async () => null as never },
      "asset-identity-unavailable",
    ],
  ])("fails closed without throwing for malformed %s evidence", async (_label, overrides, code) => {
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter(overrides),
    });
    expect(report.verdict).toBe("unknown");
    expect(report.issues).toContainEqual(expect.objectContaining({ code }));
    expect(report.plan.status).toBe("withheld");
  });

  it("rejects a successful simulation that also reports a revert reason", async () => {
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter({
        simulate: async () => ({
          success: true,
          gasUsed: 50_000n,
          revertReason: "execution reverted",
        }),
      }),
    });
    expect(report.verdict).toBe("unknown");
    expect(report.evidence.simulation).toMatchObject({
      status: "unavailable",
      error: "Simulation evidence is malformed",
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "simulation-unavailable" }),
    );
  });

  it("rethrows caller aborts instead of converting them to unknown", async () => {
    const controller = new AbortController();
    const adapter = safeAdapter({
      simulate: async () => {
        controller.abort(new Error("caller stopped"));
        throw new Error("provider error");
      },
    });
    await expect(
      inspectTransaction(baseRequest, {
        adapter,
        signal: controller.signal,
      }),
    ).rejects.toThrow("caller stopped");
  });

  it("reports simulation, balance, and approval blocks together", async () => {
    const request = {
      ...baseRequest,
      data: call("0x095ea7b3", addressWord(SPENDER), uintWord(MAX_UINT256)),
      value: 10n,
    };
    const report = await inspectTransaction(request, {
      adapter: safeAdapter({
        simulate: async () => ({ success: false, revertReason: "execution reverted" }),
        getNativeBalance: async () => 0n,
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "simulation-failed",
        "insufficient-native-balance",
        "unlimited-approval",
      ]),
    );
    expect(report.plan.status).toBe("withheld");
  });

  it("does not let a custom decoder override built-in approval safety", async () => {
    const report = await inspectTransaction(
      {
        ...baseRequest,
        data: call("0x095ea7b3", addressWord(SPENDER), uintWord(MAX_UINT256)),
      },
      {
        adapter: safeAdapter(),
        decodeAction: () => ({
          kind: "custom",
          name: "Harmless call",
          category: "other",
          source: "incorrect decoder",
          target: TOKEN,
          tokenBalanceRequirements: [],
          allowanceRequirements: [],
          marketSensitive: false,
        }),
      },
    );
    expect(report.action.kind).toBe("erc20-approve");
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "unlimited-approval", severity: "block" }),
    );
  });

  it("independently blocks an approval whose spender is not a contract", async () => {
    const request = {
      ...baseRequest,
      data: call("0x095ea7b3", addressWord(SPENDER), uintWord(100n)),
    };
    const report = await inspectTransaction(request, {
      adapter: safeAdapter({
        getCode: async (address) =>
          address.toLowerCase() === SPENDER.toLowerCase() ? "0x" : "0x60006000",
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "approval-target-not-contract", severity: "block" }),
    );
    expect(report.plan.status).toBe("withheld");
  });

  it("checks transferFrom balance and allowance independently", async () => {
    const request = {
      ...baseRequest,
      data: call(
        "0x23b872dd",
        addressWord(FROM),
        addressWord(RECIPIENT),
        uintWord(100n),
      ),
    };
    const report = await inspectTransaction(request, {
      adapter: safeAdapter({
        getTokenBalance: async () => 99n,
        getAllowance: async () => 98n,
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["insufficient-token-balance", "insufficient-allowance"]),
    );
  });

  it("blocks selector interpretations that disagree with the asset standard", async () => {
    const request = {
      ...baseRequest,
      data: call(
        "0x23b872dd",
        addressWord(FROM),
        addressWord(RECIPIENT),
        uintWord(100n),
      ),
    };
    const report = await inspectTransaction(request, {
      adapter: safeAdapter({
        resolveAsset: async (address) => ({
          address,
          kind: "erc721",
          verified: true,
          source: "test registry",
        }),
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "asset-standard-mismatch", severity: "block" }),
    );
  });

  it("blocks zero-address transfers and unexpected native value on token calls", async () => {
    const report = await inspectTransaction(
      {
        ...baseRequest,
        data: call(
          "0xa9059cbb",
          addressWord("0x0000000000000000000000000000000000000000"),
          uintWord(100n),
        ),
        value: 1n,
      },
      { adapter: safeAdapter() },
    );
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["zero-address-recipient", "unexpected-native-value"]),
    );
    expect(report.verdict).toBe("blocked");
  });

  it("blocks a missing contract and broad operator approval", async () => {
    const request = {
      ...baseRequest,
      data: call("0xa22cb465", addressWord(SPENDER), uintWord(1n)),
    };
    const report = await inspectTransaction(request, {
      adapter: safeAdapter({ getCode: async () => "0x" }),
    });
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["target-not-contract", "operator-approval"]),
    );
    expect(report.verdict).toBe("blocked");
  });

  it("treats an unverified identity as a warning or block according to policy", async () => {
    const adapter = safeAdapter({
      resolveContract: async (address) => ({
        address,
        kind: "erc20",
        verified: false,
        source: "caller registry",
      }),
      resolveAsset: async (address) => ({
        address,
        kind: "erc20",
        verified: false,
        source: "caller registry",
      }),
    });
    const warning = await inspectTransaction(baseRequest, { adapter });
    expect(warning.verdict).toBe("safe");
    expect(warning.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "contract-unverified", severity: "warning" }),
        expect.objectContaining({ code: "asset-unverified", severity: "warning" }),
      ]),
    );

    const blocked = await inspectTransaction(baseRequest, {
      adapter,
      policy: { requireVerifiedContract: true, requireVerifiedAssets: true },
    });
    expect(blocked.verdict).toBe("blocked");
  });

  it("fails closed for unknown calls unless policy explicitly permits them", async () => {
    const request = { ...baseRequest, data: "0x12345678" };
    const unknown = await inspectTransaction(request, { adapter: safeAdapter() });
    expect(unknown).toMatchObject({
      verdict: "unknown",
      action: { kind: "unknown-contract-call" },
      plan: { status: "withheld" },
    });

    const allowed = await inspectTransaction(request, {
      adapter: safeAdapter(),
      policy: { allowUnknownActions: true },
    });
    expect(allowed.verdict).toBe("safe");
  });

  it("supports bounded custom actions with balance and allowance requirements", async () => {
    const custom: CustomTransactionAction = {
      kind: "custom",
      name: "Swap exact tokens",
      category: "swap",
      source: "verified router adapter",
      target: ROUTER,
      selector: "0x12345678",
      tokenBalanceRequirements: [
        { token: TOKEN, owner: FROM, minimum: 100n, label: "swap input" },
      ],
      allowanceRequirements: [
        { token: TOKEN, owner: FROM, spender: ROUTER, minimum: 100n, label: "router allowance" },
      ],
      marketSensitive: true,
      marketPair: MARKET_PAIR,
    };
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: () => custom,
        market: safeMarket(),
        nowSeconds: NOW_SECONDS,
      },
    );
    expect(report).toMatchObject({
      verdict: "safe",
      action: { kind: "custom", category: "swap" },
      oracleDexDeviationBps: 0n,
      market: {
        oraclePrice: { source: "Chainlink" },
        dexPrice: { source: "router quote" },
      },
      plan: { status: "ready" },
    });
    expect(report.evidence.allowances).toHaveLength(1);
  });

  it("rejects an allowance-only custom swap before adapter I/O", async () => {
    let calls = 0;
    await expect(
      inspectTransaction(
        { ...baseRequest, to: ROUTER, data: "0x12345678" },
        {
          adapter: safeAdapter({
            simulate: async () => {
              calls += 1;
              return { success: true };
            },
          }),
          decodeAction: () => ({
            kind: "custom",
            name: "Swap",
            category: "swap",
            source: "router adapter",
            selector: "0x12345678",
            target: ROUTER,
            tokenBalanceRequirements: [],
            allowanceRequirements: [
              { token: TOKEN, owner: FROM, spender: ROUTER, minimum: 100n },
            ],
            marketSensitive: false,
            marketPair: MARKET_PAIR,
          }),
        },
      ),
    ).rejects.toThrow(/positive token spend or native value/);
    expect(calls).toBe(0);
  });

  it("binds a custom swap market pair to a positive declared input asset", async () => {
    let calls = 0;
    const adapter = safeAdapter({
      simulate: async () => {
        calls += 1;
        return { success: true };
      },
    });
    for (const tokenBalanceRequirements of [
      [{ token: TOKEN, owner: FROM, minimum: 0n }],
      [{ token: TOKEN, owner: FROM, minimum: 1n }],
    ]) {
      await expect(
        inspectTransaction(
          { ...baseRequest, to: ROUTER, data: "0x12345678" },
          {
            adapter,
            decodeAction: () => ({
              ...customSwap(),
              tokenBalanceRequirements,
              marketPair:
                tokenBalanceRequirements[0]?.minimum === 0n
                  ? MARKET_PAIR
                  : { baseAsset: RECIPIENT, quoteAsset: "native:4663" },
            }),
          },
        ),
      ).rejects.toThrow(/positive token spend|must match a declared input asset/);
    }
    expect(calls).toBe(0);
  });

  it("rejects unbounded custom requirements before making adapter calls", async () => {
    let calls = 0;
    const adapter = safeAdapter({
      simulate: async () => {
        calls += 1;
        return { success: true };
      },
    });
    await expect(
      inspectTransaction(
        { ...baseRequest, to: ROUTER, data: "0x12345678" },
        {
          adapter,
          decodeAction: () => ({
            kind: "custom",
            name: "Oversized action",
            category: "other",
            source: "test",
            selector: "0x12345678",
            target: ROUTER,
            tokenBalanceRequirements: Array.from({ length: 33 }, () => ({
              token: TOKEN,
              owner: FROM,
              minimum: 1n,
            })),
            allowanceRequirements: [],
            marketSensitive: false,
          }),
        },
      ),
    ).rejects.toThrow(/requirements/i);
    expect(calls).toBe(0);
  });

  it("blocks every independently unsafe market signal", async () => {
    const custom: CustomTransactionAction = {
      kind: "custom",
      name: "Swap",
      category: "swap",
      source: "router adapter",
      target: ROUTER,
      selector: "0x12345678",
      tokenBalanceRequirements: [
        { token: TOKEN, owner: FROM, minimum: 1n },
      ],
      allowanceRequirements: [],
      marketSensitive: true,
      marketPair: MARKET_PAIR,
    };
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: () => custom,
        market: {
          oracle: {
            ...marketObservation("Oracle Guard"),
            assessment: {
              usable: false,
              reason: "stale",
              issues: ["stale"],
              ageSeconds: 100,
            },
          },
          oraclePrice: {
            ...marketObservation("Chainlink"),
            value: 100n,
            decimals: 2,
          },
          dexPrice: {
            ...marketObservation("router quote"),
            value: 110n,
            decimals: 2,
          },
          slippage: { ...marketObservation("router quote"), bps: 101 },
          priceImpact: { ...marketObservation("router quote"), bps: 301 },
        },
        nowSeconds: NOW_SECONDS,
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "oracle-unusable",
        "excessive-oracle-dex-deviation",
        "excessive-slippage",
        "excessive-price-impact",
      ]),
    );
  });

  it("returns unknown when a market-sensitive action lacks required evidence", async () => {
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: () => ({
          kind: "custom",
          name: "Swap",
          category: "swap",
          source: "router adapter",
          selector: "0x12345678",
          target: ROUTER,
          tokenBalanceRequirements: [
            { token: TOKEN, owner: FROM, minimum: 1n },
          ],
          allowanceRequirements: [],
          marketSensitive: true,
          marketPair: MARKET_PAIR,
        }),
      },
    );
    expect(report.verdict).toBe("unknown");
    expect(
      report.issues.filter((entry) => entry.code === "market-evidence-unavailable"),
    ).toHaveLength(4);
  });

  it("blocks market evidence for a different pair or chain", async () => {
    const market = safeMarket();
    market.dexPrice.baseAsset = RECIPIENT;
    market.slippage.chainId = 1;
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: customSwap,
        market,
        nowSeconds: NOW_SECONDS,
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(
      report.issues.filter((entry) => entry.code === "market-evidence-mismatch"),
    ).toHaveLength(2);
    expect(report.oracleDexDeviationBps).toBeUndefined();
  });

  it("blocks stale and future-dated market evidence", async () => {
    const market = safeMarket();
    market.oracle.observedAtSeconds = NOW_SECONDS - 61;
    market.dexPrice.observedAtSeconds = NOW_SECONDS + 1;
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: customSwap,
        market,
        nowSeconds: NOW_SECONDS,
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(
      report.issues.filter((entry) => entry.code === "market-evidence-stale"),
    ).toHaveLength(2);
  });

  it("blocks market observations whose block snapshots are too far apart", async () => {
    const market = safeMarket();
    market.dexPrice.blockNumber = 103n;
    const report = await inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter(),
        decodeAction: customSwap,
        market,
        nowSeconds: NOW_SECONDS,
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "market-evidence-mismatch",
        message: expect.stringMatching(/block skew/i),
      }),
    );
  });

  it("snapshots market input before asynchronous evidence collection", async () => {
    let releaseSimulation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSimulation = resolve;
    });
    const market = safeMarket();
    const pending = inspectTransaction(
      { ...baseRequest, to: ROUTER, data: "0x12345678" },
      {
        adapter: safeAdapter({
          simulate: async () => {
            await gate;
            return { success: true, gasUsed: 50_000n };
          },
        }),
        decodeAction: customSwap,
        market,
        nowSeconds: NOW_SECONDS,
      },
    );
    market.dexPrice.value = 200n;
    market.dexPrice.baseAsset = RECIPIENT;
    releaseSimulation();

    const report = await pending;
    expect(report.verdict).toBe("safe");
    expect(report.market?.dexPrice?.value).toBe(100n);
    expect(report.market?.dexPrice?.baseAsset).toBe(TOKEN);
  });

  it("rejects contradictory Oracle Guard evidence before adapter I/O", async () => {
    let calls = 0;
    await expect(
      inspectTransaction(
        { ...baseRequest, to: ROUTER, data: "0x12345678" },
        {
          adapter: safeAdapter({
            simulate: async () => {
              calls += 1;
              return { success: true };
            },
          }),
          decodeAction: () => ({
            kind: "custom",
            name: "Swap",
            category: "swap",
            source: "router adapter",
            selector: "0x12345678",
            target: ROUTER,
            tokenBalanceRequirements: [
              { token: TOKEN, owner: FROM, minimum: 1n },
            ],
            allowanceRequirements: [],
            marketSensitive: true,
            marketPair: MARKET_PAIR,
          }),
          market: {
            oracle: {
              ...marketObservation("Oracle Guard"),
              assessment: {
                usable: true,
                reason: "healthy",
                issues: ["stale"],
              },
            },
            oraclePrice: {
              ...marketObservation("oracle"),
              value: 100n,
              decimals: 2,
            },
            dexPrice: {
              ...marketObservation("dex"),
              value: 100n,
              decimals: 2,
            },
            slippage: { ...marketObservation("router"), bps: 1 },
            priceImpact: { ...marketObservation("router"), bps: 1 },
          },
          nowSeconds: NOW_SECONDS,
        },
      ),
    ).rejects.toThrow(/market\.oracle\.assessment/i);
    expect(calls).toBe(0);
  });

  it.each([
    [
      "negative healthy age",
      {
        ...healthyOracle,
        ageSeconds: -1,
      },
    ],
    [
      "healthy assessment without price metadata",
      {
        usable: true,
        reason: "healthy",
        issues: [],
      },
    ],
    [
      "healthy sequencer grace remainder",
      {
        ...healthyOracle,
        sequencerGracePeriodRemainingSeconds: 10,
      },
    ],
    [
      "missing sequencer grace remainder",
      {
        usable: false,
        reason: "sequencer-grace-period",
        issues: ["sequencer-grace-period"],
      },
    ],
  ])("rejects impossible Oracle Guard metadata: %s", async (_label, assessment) => {
    let calls = 0;
    const market = safeMarket();
    market.oracle.assessment = assessment as never;
    await expect(
      inspectTransaction(
        { ...baseRequest, to: ROUTER, data: "0x12345678" },
        {
          adapter: safeAdapter({
            simulate: async () => {
              calls += 1;
              return { success: true };
            },
          }),
          decodeAction: customSwap,
          market,
          nowSeconds: NOW_SECONDS,
        },
      ),
    ).rejects.toThrow(/market\.oracle\.assessment/);
    expect(calls).toBe(0);
  });

  it("propagates abort promptly even when an adapter ignores its signal", async () => {
    const controller = new AbortController();
    const pending = inspectTransaction(baseRequest, {
      adapter: safeAdapter({
        simulate: () => new Promise(() => {}),
      }),
      signal: controller.signal,
    }).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    setTimeout(() => controller.abort(new Error("caller stopped")), 0);
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 80)),
    ]);
    expect(outcome).toBe("caller stopped");
  });

  it("cannot miss an abort fired synchronously while starting an adapter", async () => {
    const controller = new AbortController();
    const pending = inspectTransaction(baseRequest, {
      adapter: safeAdapter({
        simulate: () => {
          controller.abort(new Error("synchronous stop"));
          return new Promise(() => {});
        },
      }),
      signal: controller.signal,
    });
    await expect(pending).rejects.toThrow("synchronous stop");
  });

  it("does not share mutable requirement arrays between decoded actions", () => {
    const first = decodeTransactionAction(
      normalizeTransactionRequest({ chainId: 4663, from: FROM, to: RECIPIENT }),
    );
    expect(() =>
      (first.tokenBalanceRequirements as TokenBalanceRequirement[]).push({
        token: TOKEN,
        owner: FROM,
        minimum: 1n,
      }),
    ).toThrow();
    const second = decodeTransactionAction(
      normalizeTransactionRequest({ chainId: 4663, from: FROM, to: RECIPIENT }),
    );
    expect(second.tokenBalanceRequirements).toEqual([]);
  });

  it("blocks unidentified approval targets by default", async () => {
    const report = await inspectTransaction(
      {
        ...baseRequest,
        data: call("0x095ea7b3", addressWord(SPENDER), uintWord(100n)),
      },
      {
        adapter: safeAdapter({
          resolveContract: async (address) =>
            address.toLowerCase() === SPENDER.toLowerCase()
              ? {
                  address,
                  kind: "unknown",
                  verified: false,
                  source: "untrusted registry",
                }
              : {
                  address,
                  kind: "erc20",
                  verified: true,
                  source: "test registry",
                },
        }),
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(report.plan.status).toBe("withheld");
  });

  it("requires explicit policy to permit an EOA approval target", async () => {
    const request = {
      ...baseRequest,
      data: call("0x095ea7b3", addressWord(SPENDER), uintWord(100n)),
    };
    const adapter = safeAdapter({
      getCode: async (address) =>
        address.toLowerCase() === SPENDER.toLowerCase() ? "0x" : "0x60006000",
    });
    const blocked = await inspectTransaction(request, { adapter });
    expect(blocked.verdict).toBe("blocked");

    const explicitlyAllowed = await inspectTransaction(request, {
      adapter,
      policy: { allowEoaApprovalTargets: true },
    });
    expect(explicitlyAllowed.verdict).toBe("safe");
    expect(explicitlyAllowed.issues).toContainEqual(
      expect.objectContaining({
        code: "approval-target-not-contract",
        severity: "warning",
      }),
    );
  });

  it("inspects target code and identity for empty-calldata contract calls", async () => {
    let codeCalls = 0;
    let identityCalls = 0;
    const report = await inspectTransaction(
      { chainId: 4663, from: FROM, to: ROUTER, value: 0n },
      {
        adapter: safeAdapter({
          getCode: async () => {
            codeCalls += 1;
            return "0x60006000";
          },
          resolveContract: async (address) => {
            identityCalls += 1;
            return {
              address,
              kind: "contract",
              verified: true,
              source: "test registry",
            };
          },
        }),
      },
    );
    expect(codeCalls).toBeGreaterThan(0);
    expect(identityCalls).toBeGreaterThan(0);
    expect(report.evidence.targetCode.status).toBe("available");
    expect(report.evidence.contractIdentity.status).toBe("available");
  });

  it("allows an empty-calldata EOA transfer without contract identity", async () => {
    const report = await inspectTransaction(
      { chainId: 4663, from: FROM, to: RECIPIENT, value: 1n },
      {
        adapter: safeAdapter({
          getCode: async () => "0x",
          resolveContract: async () => {
            throw new Error("no contract identity");
          },
        }),
      },
    );
    expect(report.verdict).toBe("safe");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ code: "contract-identity-unavailable" }),
    );
  });

  it("withholds an empty-calldata contract transfer without identity", async () => {
    const report = await inspectTransaction(
      { chainId: 4663, from: FROM, to: ROUTER, value: 1n },
      {
        adapter: safeAdapter({
          getCode: async () => "0x60006000",
          resolveContract: async () => {
            throw new Error("identity registry offline");
          },
        }),
      },
    );
    expect(report.verdict).toBe("unknown");
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "contract-identity-unavailable" }),
    );
  });

  it("compares execution gas and fee caps to independent evidence", async () => {
    const report = await inspectTransaction(
      {
        ...baseRequest,
        gasLimit: 21_000n,
        maxFeePerGas: 1n,
      },
      {
        adapter: safeAdapter({
          simulate: async () => ({ success: true, gasUsed: 100_000n }),
          estimateGas: async () => 100_000n,
          getFeePerGas: async () => 2n,
        }),
      },
    );
    expect(report.verdict).toBe("blocked");
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["gas-limit-too-low", "fee-cap-too-low"]),
    );
  });

  it("snapshots adapter objects and returns a deeply immutable report", async () => {
    const assetIdentity = {
      address: TOKEN,
      symbol: "TEST",
      decimals: 18,
      kind: "erc20" as const,
      verified: true,
      source: "mutable registry",
    };
    const report = await inspectTransaction(baseRequest, {
      adapter: safeAdapter({
        resolveAsset: async () => assetIdentity,
      }),
      nowSeconds: NOW_SECONDS,
    });
    assetIdentity.verified = false;
    assetIdentity.symbol = "MUTATED";

    expect(report.evidence.assetIdentities[0]?.evidence).toMatchObject({
      status: "available",
      value: { verified: true, symbol: "TEST" },
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.evidence.assetIdentities)).toBe(true);
    expect(Object.isFrozen(report.plan.steps)).toBe(true);
    expect(() =>
      (report.issues as Array<(typeof report.issues)[number]>).push({
        code: "simulation-failed",
        severity: "block",
        message: "mutated",
      }),
    ).toThrow();
  });

  it("rejects unsafe integer and uint bounds before adapter I/O", async () => {
    let calls = 0;
    const adapter = safeAdapter({
      simulate: async () => {
        calls += 1;
        return { success: true };
      },
    });
    for (const request of [
      { ...baseRequest, chainId: Number.MAX_SAFE_INTEGER + 1 },
      { ...baseRequest, value: 1n << 256n },
      { ...baseRequest, gasLimit: 0n },
      { ...baseRequest, maxFeePerGas: 0n },
    ]) {
      await expect(inspectTransaction(request, { adapter })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it("validates policy, adapter, market, and custom decoder output before RPC evidence", async () => {
    let calls = 0;
    const adapter = safeAdapter({
      simulate: async () => {
        calls += 1;
        return { success: true };
      },
    });
    await expect(
      inspectTransaction(baseRequest, {
        adapter,
        policy: { maxSlippageBps: 10_001 },
      }),
    ).rejects.toThrow(/maxSlippageBps/);
    await expect(
      inspectTransaction(baseRequest, {
        adapter,
        policy: null as never,
      }),
    ).rejects.toThrow(/policy must be an object/);
    await expect(
      inspectTransaction(baseRequest, {
        adapter,
        market: { oracle: null } as never,
      }),
    ).rejects.toThrow(/market\.oracle/);
    await expect(
      inspectTransaction(baseRequest, {
        adapter,
        market: {
          oraclePrice: {
            ...marketObservation("bad"),
            value: 0n,
            decimals: 8,
          },
        },
      }),
    ).rejects.toThrow(/oraclePrice.value/);
    await expect(
      inspectTransaction({ ...baseRequest, data: "0x12345678" }, {
        adapter,
        decodeAction: () => ({ kind: "custom" }) as never,
      }),
    ).rejects.toThrow(/category/);
    expect(calls).toBe(0);
  });
});
