/**
 * The stock-token address book: Robinhood's RHJ assets registry, parsed
 * strictly.
 *
 * The failure mode this module closes: every consumer that wanted "the AAPL
 * token's address" either hardcoded it (stale the day a deployment migrates)
 * or wrote an ad-hoc parser over `api.robinhood.com/rhj/assets` that accepted
 * whatever arrived. This loader mirrors `loadChainlinkFeedDirectory` exactly:
 * atomic parsing where one malformed row rejects the whole document, optional
 * byte-level SHA-256 pinning, injectable fetch — because an address book you
 * route money by deserves the same trust boundary as a feed directory.
 *
 * Field semantics were taken from the live payload (194 assets read and
 * checked on 2026-08-24), not from documentation that does not exist. Unknown
 * fields are ignored; the fields parsed here are the ones every row carried.
 *
 * The multiplier in this registry is a SNAPSHOT the API published, not the
 * contract's state right now. Use it for display and cross-checking; for a
 * figure that goes into a calculation, read the contract
 * (`readScaledUiMultiplierState`).
 */
import { CHAIN_ID, RHJ_ASSETS_URL } from "./chain.js";
import { fetchWithRetry } from "./retryfetch.js";
import { sha256Hex } from "./feeds.js";
import { SCALED_UI_DECIMALS } from "./stocktokens.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const DECIMAL = /^([0-9]+)(?:\.([0-9]+))?$/;

/**
 * USDG — Global Dollar, the cash asset stock tokens settle against on
 * Robinhood Chain.
 *
 * Verified on chain 4663 on 2026-08-24, not copied from an Ethereum listing:
 * `eth_call` against this address on the mainnet RPC returned `name()` =
 * "Global Dollar", `symbol()` = "USDG", `decimals()` = 6; the chain's
 * Blockscout lists the contract as verified (admin-panel confirmed) with a
 * live ~$1.00 exchange rate and a nine-digit circulating market cap, while
 * the several same-name copycat deployments on the chain are unverified with
 * round 1e27 supplies. The 6-decimal scale is what `cashDecimals` wants in
 * settlement pricing.
 */
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** `decimals()` of {@link USDG_ADDRESS}, from the same on-chain verification. */
export const USDG_DECIMALS = 6;

/** One deployment row, as the registry publishes it. */
export interface StockTokenDeployment {
  contractAddress: `0x${string}`;
  chainId: number;
  networkName: string;
}

/** Stable, normalized subset of one RHJ assets row. */
export interface StockTokenEntry {
  /** registry asset id (32-byte hex) */
  id: string;
  /** exchange ticker, e.g. "AAPL" */
  symbol: string;
  /** display name, e.g. "Apple • Robinhood Token" */
  name: string;
  /** the chain-4663 token contract, lowercased */
  tokenAddress: `0x${string}`;
  /** every deployment row, verbatim (addresses validated, not re-cased) */
  deployments: StockTokenDeployment[];
  tokenDecimals: number;
  isin?: string;
  status: string;
  /**
   * Multiplier snapshot at 1e18 scale — the API's claim, NOT the contract's
   * current state. Read the contract before using it in a calculation.
   */
  currentMultiplierSnapshot: bigint;
  /** pending multiplier snapshot, absent when the registry publishes none */
  pendingMultiplierSnapshot?: bigint;
  logoUrl?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rowString = (row: Record<string, unknown>, field: string, index: number): string => {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Stock directory row ${index} has invalid ${field}`);
  }
  return value;
};

const optionalRowString = (
  row: Record<string, unknown>,
  field: string,
  index: number,
): string | undefined => {
  const value = row[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Stock directory row ${index} has invalid ${field}`);
  }
  return value.trim() === "" ? undefined : value;
};

/**
 * Parse the registry's decimal-string multiplier ("1.000566080061092436") to
 * the same 1e18 bigint scale the contract uses. Exact: more than 18 fraction
 * digits rejects rather than rounds, because a registry that starts publishing
 * sub-1e-18 precision is a schema change worth failing loudly on.
 */
const multiplierFromDecimal = (value: string, index: number): bigint => {
  const match = DECIMAL.exec(value);
  if (!match) throw new TypeError(`Stock directory row ${index} has invalid multiplier`);
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > SCALED_UI_DECIMALS) {
    throw new TypeError(`Stock directory row ${index} multiplier exceeds 18 decimals`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(SCALED_UI_DECIMALS) +
    BigInt(fraction.padEnd(SCALED_UI_DECIMALS, "0") || "0")
  );
};

export interface ParseStockTokenDirectoryOptions {
  /** the chain whose deployment becomes `tokenAddress` (default 4663) */
  chainId?: number;
}

/**
 * Validate and normalize the whole RHJ assets payload. Parsing is atomic: one
 * malformed or duplicate row rejects the document, because a registry that is
 * half right is more dangerous than one that is visibly broken.
 */
export function parseStockTokenDirectory(
  value: unknown,
  options: ParseStockTokenDirectoryOptions = {},
): StockTokenEntry[] {
  const chainId = options.chainId ?? CHAIN_ID;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new RangeError("chainId must be a positive integer");
  }
  if (!isRecord(value) || !Array.isArray(value.assets) || value.assets.length === 0) {
    throw new TypeError("Stock directory must be an object with a non-empty assets array");
  }

  const seenAddresses = new Set<string>();
  const seenSymbols = new Set<string>();
  return value.assets.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`Stock directory row ${index} must be an object`);
    }
    const id = rowString(entry, "id", index);
    const symbol = rowString(entry, "tokenSymbol", index);
    const name = rowString(entry, "tokenName", index);
    const status = rowString(entry, "status", index);
    const isin = optionalRowString(entry, "isin", index);
    const logoUrl = optionalRowString(entry, "logoUrl", index);

    const tokenDecimals = entry.tokenDecimals;
    if (
      !Number.isInteger(tokenDecimals) ||
      (tokenDecimals as number) < 0 ||
      (tokenDecimals as number) > 255
    ) {
      throw new TypeError(`Stock directory row ${index} has invalid tokenDecimals`);
    }

    if (!Array.isArray(entry.deployments) || entry.deployments.length === 0) {
      throw new TypeError(`Stock directory row ${index} has no deployments`);
    }
    const deployments = entry.deployments.map((deployment, deploymentIndex) => {
      if (!isRecord(deployment)) {
        throw new TypeError(
          `Stock directory row ${index} deployment ${deploymentIndex} must be an object`,
        );
      }
      const contractAddress = deployment.contractAddress;
      if (typeof contractAddress !== "string" || !ADDRESS.test(contractAddress)) {
        throw new TypeError(
          `Stock directory row ${index} deployment ${deploymentIndex} has an invalid contractAddress`,
        );
      }
      const deploymentChainId = deployment.chainId;
      if (!Number.isSafeInteger(deploymentChainId) || (deploymentChainId as number) <= 0) {
        throw new TypeError(
          `Stock directory row ${index} deployment ${deploymentIndex} has an invalid chainId`,
        );
      }
      const networkName = deployment.networkName;
      if (typeof networkName !== "string" || networkName.trim() === "") {
        throw new TypeError(
          `Stock directory row ${index} deployment ${deploymentIndex} has an invalid networkName`,
        );
      }
      return {
        contractAddress: contractAddress as `0x${string}`,
        chainId: deploymentChainId as number,
        networkName,
      };
    });

    const target = deployments.find((deployment) => deployment.chainId === chainId);
    if (!target) {
      throw new TypeError(`Stock directory row ${index} has no chain ${chainId} deployment`);
    }
    const tokenAddress = target.contractAddress.toLowerCase() as `0x${string}`;
    if (seenAddresses.has(tokenAddress)) {
      throw new TypeError(`Stock directory contains duplicate address ${tokenAddress}`);
    }
    seenAddresses.add(tokenAddress);
    const symbolKey = symbol.toLowerCase();
    if (seenSymbols.has(symbolKey)) {
      throw new TypeError(`Stock directory contains duplicate symbol ${symbol}`);
    }
    seenSymbols.add(symbolKey);

    const currentMultiplierSnapshot = multiplierFromDecimal(
      rowString(entry, "currentMultiplier", index),
      index,
    );
    const pendingRaw = optionalRowString(entry, "pendingMultiplier", index);
    const pendingMultiplierSnapshot =
      pendingRaw === undefined ? undefined : multiplierFromDecimal(pendingRaw, index);

    return {
      id,
      symbol,
      name,
      tokenAddress,
      deployments,
      tokenDecimals: tokenDecimals as number,
      ...(isin ? { isin } : {}),
      status,
      currentMultiplierSnapshot,
      ...(pendingMultiplierSnapshot === undefined ? {} : { pendingMultiplierSnapshot }),
      ...(logoUrl ? { logoUrl } : {}),
    };
  });
}

export interface LoadStockTokenDirectoryOptions extends ParseStockTokenDirectoryOptions {
  /** Override for mirrors or fixtures. */
  url?: string | URL;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Lowercase hex SHA-256 of the response body, pinned by the caller. Same
   * contract as `loadChainlinkFeedDirectory`: structural validation proves the
   * document is well-SHAPED, and only a byte pin proves it is the document you
   * reviewed. This registry names the contracts your settlement logic will
   * treat as real equities, so the argument for pinning is at least as strong
   * here. No digest is hardcoded; a pin nobody maintains breaks every consumer
   * at once, so it is the caller's decision and the caller's upkeep.
   */
  expectedSha256?: string;
}

/**
 * Load and atomically validate the RHJ stock-token registry. Makes no request
 * until called; rejects rather than returns a partial directory.
 */
export async function loadStockTokenDirectory(
  options: LoadStockTokenDirectoryOptions = {},
): Promise<StockTokenEntry[]> {
  const { expectedSha256 } = options;
  if (expectedSha256 !== undefined && !HEX_SHA256.test(expectedSha256)) {
    throw new TypeError("expectedSha256 must be a 64-character hex SHA-256 digest");
  }
  const response = await fetchWithRetry(
    options.url ?? RHJ_ASSETS_URL,
    { method: "GET", signal: options.signal },
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      attempts: options.attempts ?? 3,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Stock directory returned HTTP ${response.status}`);
  }
  const parseOptions =
    options.chainId === undefined ? {} : { chainId: options.chainId };
  if (expectedSha256 === undefined) {
    return parseStockTokenDirectory(await response.json(), parseOptions);
  }
  const bytes = await response.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Stock directory integrity check failed: expected sha256 ${expectedSha256.toLowerCase()}, received ${actual}`,
    );
  }
  return parseStockTokenDirectory(
    JSON.parse(new TextDecoder().decode(bytes)),
    parseOptions,
  );
}

/**
 * Find one entry by ticker symbol or token address, case-insensitively.
 *
 * A 40-hex-digit `0x` string is treated as an address and matched against
 * `tokenAddress` and every deployment; anything else is treated as a symbol.
 * Returns `undefined` when absent — an unlisted token is an answer, not an
 * error.
 */
export function findStockToken(
  directory: readonly StockTokenEntry[],
  symbolOrAddress: string,
): StockTokenEntry | undefined {
  if (typeof symbolOrAddress !== "string" || symbolOrAddress.trim() === "") {
    throw new TypeError("symbolOrAddress must be a non-empty string");
  }
  const key = symbolOrAddress.toLowerCase();
  if (ADDRESS.test(symbolOrAddress)) {
    return directory.find(
      (entry) =>
        entry.tokenAddress === key ||
        entry.deployments.some(
          (deployment) => deployment.contractAddress.toLowerCase() === key,
        ),
    );
  }
  return directory.find((entry) => entry.symbol.toLowerCase() === key);
}
