/**
 * Dependency-free transaction preflight and action planning for Robinhood
 * Chain. This module inspects and prepares requests; it never signs or sends.
 */
import { CHAIN_ID, TESTNET_CHAIN_ID } from "./chain.js";
import type { OracleHealthAssessment } from "./feeds.js";

export type EvmAddress = `0x${string}`;
export type HexData = `0x${string}`;

export interface TransactionRequest {
  chainId: number;
  from: string;
  to?: string;
  data?: string;
  value?: bigint;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
}

export interface NormalizedTransactionRequest {
  chainId: number;
  from: EvmAddress;
  to?: EvmAddress;
  data: HexData;
  value: bigint;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
}

export interface TokenBalanceRequirement {
  token: EvmAddress;
  owner: EvmAddress;
  minimum: bigint;
  label?: string;
}

export interface AllowanceRequirement {
  token: EvmAddress;
  owner: EvmAddress;
  spender: EvmAddress;
  minimum: bigint;
  label?: string;
}

export interface MarketPair {
  /** Asset being priced or sold. Use an address or another stable canonical ID. */
  baseAsset: string;
  /** Asset in which the base asset price is denominated. */
  quoteAsset: string;
}

interface TransactionActionBase {
  selector?: HexData;
  target?: EvmAddress;
  tokenBalanceRequirements: readonly TokenBalanceRequirement[];
  allowanceRequirements: readonly AllowanceRequirement[];
  marketSensitive: boolean;
}

export interface NativeTransferAction extends TransactionActionBase {
  kind: "native-transfer";
  recipient: EvmAddress;
  amount: bigint;
}

export interface Erc20TransferAction extends TransactionActionBase {
  kind: "erc20-transfer";
  token: EvmAddress;
  recipient: EvmAddress;
  amount: bigint;
}

export interface Erc20ApproveAction extends TransactionActionBase {
  kind: "erc20-approve";
  token: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
  unlimited: boolean;
}

export interface Erc20TransferFromAction extends TransactionActionBase {
  kind: "erc20-transfer-from";
  token: EvmAddress;
  owner: EvmAddress;
  recipient: EvmAddress;
  amount: bigint;
}

export interface OperatorApprovalAction extends TransactionActionBase {
  kind: "operator-approval";
  collection: EvmAddress;
  operator: EvmAddress;
  approved: boolean;
}

export interface ContractDeploymentAction extends TransactionActionBase {
  kind: "contract-deployment";
}

export interface UnknownContractCallAction extends TransactionActionBase {
  kind: "unknown-contract-call";
}

export interface CustomTransactionAction extends TransactionActionBase {
  kind: "custom";
  selector: HexData;
  name: string;
  category: "swap" | "bridge" | "contract-call" | "other";
  source: string;
  marketPair?: MarketPair;
}

export type TransactionAction =
  | NativeTransferAction
  | Erc20TransferAction
  | Erc20ApproveAction
  | Erc20TransferFromAction
  | OperatorApprovalAction
  | ContractDeploymentAction
  | UnknownContractCallAction
  | CustomTransactionAction;

export type TransactionActionDecoder = (
  request: Readonly<NormalizedTransactionRequest>,
  builtIn: Readonly<TransactionAction>,
) => CustomTransactionAction | undefined;

export interface SimulationResult {
  success: boolean;
  gasUsed?: bigint;
  returnData?: HexData;
  revertReason?: string;
}

export interface ContractIdentity {
  address: EvmAddress;
  name?: string;
  kind: "erc20" | "erc721" | "erc1155" | "router" | "bridge" | "contract" | "unknown";
  verified: boolean;
  source: string;
}

export interface AssetIdentity {
  address: EvmAddress;
  symbol?: string;
  name?: string;
  decimals?: number;
  kind: "native" | "erc20" | "erc721" | "erc1155" | "unknown";
  verified: boolean;
  source: string;
}

export interface PreflightAdapterContext {
  signal?: AbortSignal;
}

export interface TransactionPreflightAdapter {
  getChainId?(context: PreflightAdapterContext): Promise<number>;
  simulate(
    request: Readonly<NormalizedTransactionRequest>,
    context: PreflightAdapterContext,
  ): Promise<SimulationResult>;
  getCode?(
    address: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<HexData>;
  resolveContract?(
    address: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<ContractIdentity>;
  resolveAsset?(
    address: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<AssetIdentity>;
  getNativeBalance?(
    owner: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<bigint>;
  getTokenBalance?(
    token: EvmAddress,
    owner: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<bigint>;
  getAllowance?(
    token: EvmAddress,
    owner: EvmAddress,
    spender: EvmAddress,
    context: PreflightAdapterContext,
  ): Promise<bigint>;
  estimateGas?(
    request: Readonly<NormalizedTransactionRequest>,
    context: PreflightAdapterContext,
  ): Promise<bigint>;
  getFeePerGas?(
    request: Readonly<NormalizedTransactionRequest>,
    context: PreflightAdapterContext,
  ): Promise<bigint>;
}

export type Evidence<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; error: string }
  | { status: "not-required" };

export interface TokenBalanceEvidence {
  requirement: TokenBalanceRequirement;
  evidence: Evidence<bigint>;
}

export interface AllowanceEvidence {
  requirement: AllowanceRequirement;
  evidence: Evidence<bigint>;
}

export interface AssetIdentityEvidence {
  address: EvmAddress;
  evidence: Evidence<AssetIdentity>;
}

export interface ApprovalTargetEvidence {
  address: EvmAddress;
  code: Evidence<HexData>;
  identity: Evidence<ContractIdentity>;
}

export interface TransactionPreflightEvidence {
  chainId: Evidence<number>;
  simulation: Evidence<SimulationResult>;
  targetCode: Evidence<HexData>;
  contractIdentity: Evidence<ContractIdentity>;
  approvalTargets: readonly ApprovalTargetEvidence[];
  assetIdentities: readonly AssetIdentityEvidence[];
  nativeBalance: Evidence<bigint>;
  tokenBalances: readonly TokenBalanceEvidence[];
  allowances: readonly AllowanceEvidence[];
  gasEstimate: Evidence<bigint>;
  feePerGas: Evidence<bigint>;
}

export interface MarketObservation extends MarketPair {
  source: string;
  chainId: number;
  blockNumber: bigint;
  observedAtSeconds: number;
}

export interface PriceValue {
  value: bigint;
  decimals: number;
}

export interface ExactPrice extends MarketObservation, PriceValue {}

export interface BasisPointObservation extends MarketObservation {
  bps: number;
}

export interface OracleAssessmentObservation extends MarketObservation {
  assessment: OracleHealthAssessment;
}

export interface TransactionMarketContext {
  oracle?: OracleAssessmentObservation;
  oraclePrice?: ExactPrice;
  dexPrice?: ExactPrice;
  slippage?: BasisPointObservation;
  priceImpact?: BasisPointObservation;
}

export interface TransactionPreflightPolicy {
  allowedChainIds?: readonly number[];
  allowUnknownActions?: boolean;
  allowContractDeployment?: boolean;
  allowUnlimitedApproval?: boolean;
  allowOperatorApproval?: boolean;
  allowUnverifiedApprovalTargets?: boolean;
  allowEoaApprovalTargets?: boolean;
  requireContractIdentity?: boolean;
  requireVerifiedContract?: boolean;
  requireAssetIdentity?: boolean;
  requireVerifiedAssets?: boolean;
  requireGasEstimate?: boolean;
  requireFeeEstimate?: boolean;
  requireChainIdentity?: boolean;
  requireMarketEvidence?: boolean;
  maxSlippageBps?: number;
  maxPriceImpactBps?: number;
  maxOracleDexDeviationBps?: number;
  maxMarketAgeSeconds?: number;
  maxMarketObservationSkewSeconds?: number;
  maxMarketBlockSkew?: bigint;
}

export interface ResolvedTransactionPreflightPolicy {
  allowedChainIds: readonly number[];
  allowUnknownActions: boolean;
  allowContractDeployment: boolean;
  allowUnlimitedApproval: boolean;
  allowOperatorApproval: boolean;
  allowUnverifiedApprovalTargets: boolean;
  allowEoaApprovalTargets: boolean;
  requireContractIdentity: boolean;
  requireVerifiedContract: boolean;
  requireAssetIdentity: boolean;
  requireVerifiedAssets: boolean;
  requireGasEstimate: boolean;
  requireFeeEstimate: boolean;
  requireChainIdentity: boolean;
  requireMarketEvidence: boolean;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  maxOracleDexDeviationBps: number;
  maxMarketAgeSeconds: number;
  maxMarketObservationSkewSeconds: number;
  maxMarketBlockSkew: bigint;
}

export type PreflightIssueSeverity = "block" | "unknown" | "warning";

export type PreflightIssueCode =
  | "unsupported-chain"
  | "chain-id-unavailable"
  | "chain-id-mismatch"
  | "unknown-action"
  | "contract-deployment-disabled"
  | "simulation-failed"
  | "simulation-unavailable"
  | "target-not-contract"
  | "target-code-unavailable"
  | "contract-identity-unavailable"
  | "contract-unverified"
  | "approval-target-code-unavailable"
  | "approval-target-not-contract"
  | "approval-target-identity-unavailable"
  | "approval-target-unverified"
  | "asset-identity-unavailable"
  | "asset-unverified"
  | "asset-standard-mismatch"
  | "gas-estimate-unavailable"
  | "gas-limit-too-low"
  | "fee-estimate-unavailable"
  | "fee-cap-too-low"
  | "native-balance-unavailable"
  | "insufficient-native-balance"
  | "token-balance-unavailable"
  | "insufficient-token-balance"
  | "allowance-unavailable"
  | "insufficient-allowance"
  | "unlimited-approval"
  | "operator-approval"
  | "zero-address-recipient"
  | "unexpected-native-value"
  | "oracle-unusable"
  | "market-evidence-unavailable"
  | "market-evidence-mismatch"
  | "market-evidence-stale"
  | "excessive-slippage"
  | "excessive-price-impact"
  | "excessive-oracle-dex-deviation";

export interface PreflightIssue {
  code: PreflightIssueCode;
  severity: PreflightIssueSeverity;
  message: string;
}

export type PreflightVerdict = "safe" | "blocked" | "unknown";

export interface TransactionPlanStep {
  id: "transaction";
  kind: "transaction";
  description: string;
  request: NormalizedTransactionRequest;
}

export interface TransactionPlan {
  status: "ready" | "withheld";
  steps: readonly TransactionPlanStep[];
}

export interface TransactionPreflightReport {
  inspectedAtSeconds: number;
  verdict: PreflightVerdict;
  request: NormalizedTransactionRequest;
  action: TransactionAction;
  policy: ResolvedTransactionPreflightPolicy;
  evidence: TransactionPreflightEvidence;
  issues: readonly PreflightIssue[];
  market?: TransactionMarketContext;
  oracleDexDeviationBps?: bigint;
  estimatedFee?: bigint;
  requiredNativeBalance?: bigint;
  plan: TransactionPlan;
}

export interface InspectTransactionOptions {
  adapter: TransactionPreflightAdapter;
  policy?: TransactionPreflightPolicy;
  market?: TransactionMarketContext;
  decodeAction?: TransactionActionDecoder;
  signal?: AbortSignal;
  nowSeconds?: number;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_CUSTOM_REQUIREMENTS = 32;
const SELECTORS = {
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  setApprovalForAll: "0xa22cb465",
} as const;

const emptyRequirements = () => ({
  tokenBalanceRequirements: [] as TokenBalanceRequirement[],
  allowanceRequirements: [] as AllowanceRequirement[],
  marketSensitive: false,
});

const freezeAction = <T extends TransactionAction>(action: T): T =>
  Object.freeze({
    ...action,
    tokenBalanceRequirements: Object.freeze(
      action.tokenBalanceRequirements.map((requirement) =>
        Object.freeze({ ...requirement }),
      ),
    ),
    allowanceRequirements: Object.freeze(
      action.allowanceRequirements.map((requirement) =>
        Object.freeze({ ...requirement }),
      ),
    ),
  }) as unknown as T;

const normalizeAddress = (value: unknown, field: string): EvmAddress => {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new TypeError(`${field} must be a 20-byte hex address`);
  }
  return value as EvmAddress;
};

const normalizeHexData = (value: unknown, field: string): HexData => {
  if (typeof value !== "string" || !HEX_DATA.test(value)) {
    throw new TypeError(`${field} must be even-length hex data`);
  }
  return value as HexData;
};

const optionalNonNegativeBigint = (value: unknown, field: string): bigint | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    throw new TypeError(`${field} must be a uint256 bigint`);
  }
  return value;
};

const nonNegativeBigint = (value: unknown, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    throw new TypeError(`${field} must be a uint256 bigint`);
  }
  return value;
};

const positiveBigint = (value: unknown, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_UINT256) {
    throw new TypeError(`${field} must be a positive uint256 bigint`);
  }
  return value;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value as number;
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
};

const bps = (value: unknown, field: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new RangeError(`${field} must be an integer between 0 and 10000`);
  }
  return value as number;
};

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
};

export function normalizeTransactionRequest(
  request: TransactionRequest,
): NormalizedTransactionRequest {
  if (typeof request !== "object" || request === null) {
    throw new TypeError("request must be an object");
  }
  const chainId = positiveInteger(request.chainId, "request.chainId");
  const from = normalizeAddress(request.from, "request.from");
  const to = request.to === undefined ? undefined : normalizeAddress(request.to, "request.to");
  const data = normalizeHexData(request.data ?? "0x", "request.data");
  const value = optionalNonNegativeBigint(request.value, "request.value") ?? 0n;
  const gasLimit = optionalNonNegativeBigint(request.gasLimit, "request.gasLimit");
  const gasPrice = optionalNonNegativeBigint(request.gasPrice, "request.gasPrice");
  const maxFeePerGas = optionalNonNegativeBigint(
    request.maxFeePerGas,
    "request.maxFeePerGas",
  );
  if (gasPrice !== undefined && maxFeePerGas !== undefined) {
    throw new TypeError("Set request.gasPrice or request.maxFeePerGas, not both");
  }
  if (gasLimit === 0n) throw new RangeError("request.gasLimit must be positive");
  if (gasPrice === 0n) throw new RangeError("request.gasPrice must be positive");
  if (maxFeePerGas === 0n) throw new RangeError("request.maxFeePerGas must be positive");
  if (to === undefined && data === "0x") {
    throw new TypeError("Contract deployment data cannot be empty");
  }
  return {
    chainId,
    from,
    ...(to ? { to } : {}),
    data,
    value,
    ...(gasLimit !== undefined ? { gasLimit } : {}),
    ...(gasPrice !== undefined ? { gasPrice } : {}),
    ...(maxFeePerGas !== undefined ? { maxFeePerGas } : {}),
  };
}

const selectorOf = (data: HexData): HexData | undefined =>
  data.length >= 10 ? (data.slice(0, 10).toLowerCase() as HexData) : undefined;

const calldataWord = (data: HexData, index: number): string | undefined => {
  const start = 10 + index * 64;
  const end = start + 64;
  return data.length >= end ? data.slice(start, end) : undefined;
};

const addressWord = (data: HexData, index: number): EvmAddress | undefined => {
  const word = calldataWord(data, index);
  if (!word || !/^0{24}[0-9a-fA-F]{40}$/.test(word)) return undefined;
  return `0x${word.slice(24)}` as EvmAddress;
};

const uintWord = (data: HexData, index: number): bigint | undefined => {
  const word = calldataWord(data, index);
  return word ? BigInt(`0x${word}`) : undefined;
};

const boolWord = (data: HexData, index: number): boolean | undefined => {
  const value = uintWord(data, index);
  if (value === 0n) return false;
  if (value === 1n) return true;
  return undefined;
};

/**
 * Decode conservative, selector-level action shapes. A decoded selector does
 * not prove the target implements that interface; contract evidence remains
 * an independent preflight requirement.
 */
export function decodeTransactionAction(
  request: Readonly<NormalizedTransactionRequest>,
): TransactionAction {
  if (!request.to) {
    return freezeAction({
      kind: "contract-deployment",
      ...emptyRequirements(),
    });
  }
  if (request.data === "0x") {
    return freezeAction({
      kind: "native-transfer",
      target: request.to,
      recipient: request.to,
      amount: request.value,
      ...emptyRequirements(),
    });
  }

  const selector = selectorOf(request.data);
  if (selector === SELECTORS.transfer) {
    const recipient = addressWord(request.data, 0);
    const amount = uintWord(request.data, 1);
    if (recipient && amount !== undefined) {
      return freezeAction({
        kind: "erc20-transfer",
        selector,
        target: request.to,
        token: request.to,
        recipient,
        amount,
        tokenBalanceRequirements: [
          { token: request.to, owner: request.from, minimum: amount, label: "transfer amount" },
        ],
        allowanceRequirements: [],
        marketSensitive: false,
      });
    }
  }
  if (selector === SELECTORS.approve) {
    const spender = addressWord(request.data, 0);
    const amount = uintWord(request.data, 1);
    if (spender && amount !== undefined) {
      return freezeAction({
        kind: "erc20-approve",
        selector,
        target: request.to,
        token: request.to,
        spender,
        amount,
        unlimited: amount === MAX_UINT256,
        ...emptyRequirements(),
      });
    }
  }
  if (selector === SELECTORS.transferFrom) {
    const owner = addressWord(request.data, 0);
    const recipient = addressWord(request.data, 1);
    const amount = uintWord(request.data, 2);
    if (owner && recipient && amount !== undefined) {
      return freezeAction({
        kind: "erc20-transfer-from",
        selector,
        target: request.to,
        token: request.to,
        owner,
        recipient,
        amount,
        tokenBalanceRequirements: [
          { token: request.to, owner, minimum: amount, label: "transferFrom amount" },
        ],
        allowanceRequirements: [
          {
            token: request.to,
            owner,
            spender: request.from,
            minimum: amount,
            label: "transferFrom allowance",
          },
        ],
        marketSensitive: false,
      });
    }
  }
  if (selector === SELECTORS.setApprovalForAll) {
    const operator = addressWord(request.data, 0);
    const approved = boolWord(request.data, 1);
    if (operator && approved !== undefined) {
      return freezeAction({
        kind: "operator-approval",
        selector,
        target: request.to,
        collection: request.to,
        operator,
        approved,
        ...emptyRequirements(),
      });
    }
  }
  return freezeAction({
    kind: "unknown-contract-call",
    selector,
    target: request.to,
    ...emptyRequirements(),
  });
}

const normalizeTokenRequirement = (
  value: TokenBalanceRequirement,
  field: string,
): TokenBalanceRequirement => ({
  token: normalizeAddress(value.token, `${field}.token`),
  owner: normalizeAddress(value.owner, `${field}.owner`),
  minimum: nonNegativeBigint(value.minimum, `${field}.minimum`),
  ...(value.label === undefined ? {} : { label: requiredText(value.label, `${field}.label`) }),
});

const normalizeAllowanceRequirement = (
  value: AllowanceRequirement,
  field: string,
): AllowanceRequirement => ({
  token: normalizeAddress(value.token, `${field}.token`),
  owner: normalizeAddress(value.owner, `${field}.owner`),
  spender: normalizeAddress(value.spender, `${field}.spender`),
  minimum: nonNegativeBigint(value.minimum, `${field}.minimum`),
  ...(value.label === undefined ? {} : { label: requiredText(value.label, `${field}.label`) }),
});

const dedupeTokenRequirements = (
  requirements: readonly TokenBalanceRequirement[],
): TokenBalanceRequirement[] => {
  const deduped = new Map<string, TokenBalanceRequirement>();
  for (const requirement of requirements) {
    const key = `${requirement.token.toLowerCase()}:${requirement.owner.toLowerCase()}`;
    const current = deduped.get(key);
    if (!current || requirement.minimum > current.minimum) deduped.set(key, requirement);
  }
  return [...deduped.values()];
};

const dedupeAllowanceRequirements = (
  requirements: readonly AllowanceRequirement[],
): AllowanceRequirement[] => {
  const deduped = new Map<string, AllowanceRequirement>();
  for (const requirement of requirements) {
    const key = [
      requirement.token.toLowerCase(),
      requirement.owner.toLowerCase(),
      requirement.spender.toLowerCase(),
    ].join(":");
    const current = deduped.get(key);
    if (!current || requirement.minimum > current.minimum) deduped.set(key, requirement);
  }
  return [...deduped.values()];
};

const normalizeMarketPair = (value: MarketPair, field: string): MarketPair => {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${field} must be an object`);
  }
  const baseAsset = requiredText(value.baseAsset, `${field}.baseAsset`);
  const quoteAsset = requiredText(value.quoteAsset, `${field}.quoteAsset`);
  if (baseAsset.toLowerCase() === quoteAsset.toLowerCase()) {
    throw new TypeError(`${field} must use different base and quote assets`);
  }
  return { baseAsset, quoteAsset };
};

const normalizeCustomAction = (
  value: CustomTransactionAction,
  request: NormalizedTransactionRequest,
): CustomTransactionAction => {
  if (typeof value !== "object" || value === null || value.kind !== "custom") {
    throw new TypeError("decodeAction must return a custom action or undefined");
  }
  const categories = ["swap", "bridge", "contract-call", "other"] as const;
  if (!categories.includes(value.category)) {
    throw new TypeError("custom action category is invalid");
  }
  const target =
    value.target === undefined
      ? request.to
      : normalizeAddress(value.target, "custom action target");
  if (target?.toLowerCase() !== request.to?.toLowerCase()) {
    throw new TypeError("custom action target must match request.to");
  }
  if (!Array.isArray(value.tokenBalanceRequirements)) {
    throw new TypeError("custom action tokenBalanceRequirements must be an array");
  }
  if (!Array.isArray(value.allowanceRequirements)) {
    throw new TypeError("custom action allowanceRequirements must be an array");
  }
  if (typeof value.marketSensitive !== "boolean") {
    throw new TypeError("custom action marketSensitive must be boolean");
  }
  if (
    value.tokenBalanceRequirements.length + value.allowanceRequirements.length >
    MAX_CUSTOM_REQUIREMENTS
  ) {
    throw new RangeError(
      `custom action requirements cannot exceed ${MAX_CUSTOM_REQUIREMENTS}`,
    );
  }
  const selector = normalizeHexData(value.selector, "custom action selector");
  if (selector !== selectorOf(request.data)) {
    throw new TypeError("custom action selector must match request.data");
  }
  const tokenBalanceRequirements = dedupeTokenRequirements(
    value.tokenBalanceRequirements.map((requirement, index) =>
      normalizeTokenRequirement(requirement, `custom action tokenBalanceRequirements[${index}]`),
    ),
  );
  const allowanceRequirements = dedupeAllowanceRequirements(
    value.allowanceRequirements.map((requirement, index) =>
      normalizeAllowanceRequirement(requirement, `custom action allowanceRequirements[${index}]`),
    ),
  );
  const marketSensitive = value.category === "swap" || value.marketSensitive;
  const marketPair =
    value.marketPair === undefined
      ? undefined
      : normalizeMarketPair(value.marketPair, "custom action marketPair");
  if (marketSensitive && !marketPair) {
    throw new TypeError("market-sensitive custom action requires marketPair");
  }
  if (value.category === "swap") {
    const inputAssets = tokenBalanceRequirements
      .filter((requirement) => requirement.minimum > 0n)
      .map((requirement) => requirement.token.toLowerCase());
    if (request.value > 0n) inputAssets.push(`native:${request.chainId}`);
    if (inputAssets.length === 0) {
      throw new TypeError("custom swap must declare positive token spend or native value");
    }
    if (!inputAssets.includes(marketPair!.baseAsset.toLowerCase())) {
      throw new TypeError("custom swap marketPair.baseAsset must match a declared input asset");
    }
  }
  return freezeAction({
    kind: "custom",
    name: requiredText(value.name, "custom action name"),
    category: value.category,
    source: requiredText(value.source, "custom action source"),
    selector,
    ...(target ? { target } : {}),
    tokenBalanceRequirements,
    allowanceRequirements,
    marketSensitive,
    ...(marketPair ? { marketPair: Object.freeze(marketPair) } : {}),
  });
};

const resolvePolicy = (
  policy: TransactionPreflightPolicy | undefined,
): ResolvedTransactionPreflightPolicy => {
  if (
    policy !== undefined &&
    (typeof policy !== "object" || policy === null || Array.isArray(policy))
  ) {
    throw new TypeError("policy must be an object");
  }
  const allowedChainIds = policy?.allowedChainIds ?? [CHAIN_ID, TESTNET_CHAIN_ID];
  if (
    !Array.isArray(allowedChainIds) ||
    allowedChainIds.length === 0 ||
    allowedChainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)
  ) {
    throw new RangeError("policy.allowedChainIds must contain positive integers");
  }
  const boolean = (field: keyof TransactionPreflightPolicy, fallback: boolean) => {
    const value = policy?.[field];
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw new TypeError(`policy.${field} must be boolean`);
    return value;
  };
  return {
    allowedChainIds: [...new Set(allowedChainIds)],
    allowUnknownActions: boolean("allowUnknownActions", false),
    allowContractDeployment: boolean("allowContractDeployment", false),
    allowUnlimitedApproval: boolean("allowUnlimitedApproval", false),
    allowOperatorApproval: boolean("allowOperatorApproval", false),
    allowUnverifiedApprovalTargets: boolean(
      "allowUnverifiedApprovalTargets",
      false,
    ),
    allowEoaApprovalTargets: boolean("allowEoaApprovalTargets", false),
    requireContractIdentity: boolean("requireContractIdentity", true),
    requireVerifiedContract: boolean("requireVerifiedContract", false),
    requireAssetIdentity: boolean("requireAssetIdentity", true),
    requireVerifiedAssets: boolean("requireVerifiedAssets", false),
    requireGasEstimate: boolean("requireGasEstimate", true),
    requireFeeEstimate: boolean("requireFeeEstimate", true),
    requireChainIdentity: boolean("requireChainIdentity", true),
    requireMarketEvidence: boolean("requireMarketEvidence", true),
    maxSlippageBps: bps(policy?.maxSlippageBps ?? 100, "policy.maxSlippageBps"),
    maxPriceImpactBps: bps(
      policy?.maxPriceImpactBps ?? 300,
      "policy.maxPriceImpactBps",
    ),
    maxOracleDexDeviationBps: bps(
      policy?.maxOracleDexDeviationBps ?? 200,
      "policy.maxOracleDexDeviationBps",
    ),
    maxMarketAgeSeconds: positiveInteger(
      policy?.maxMarketAgeSeconds ?? 60,
      "policy.maxMarketAgeSeconds",
    ),
    maxMarketObservationSkewSeconds: nonNegativeInteger(
      policy?.maxMarketObservationSkewSeconds ?? 30,
      "policy.maxMarketObservationSkewSeconds",
    ),
    maxMarketBlockSkew: nonNegativeBigint(
      policy?.maxMarketBlockSkew ?? 2n,
      "policy.maxMarketBlockSkew",
    ),
  };
};

const normalizePriceValue = (price: PriceValue, field: string): PriceValue => {
  if (typeof price !== "object" || price === null) {
    throw new TypeError(`${field} must be an object`);
  }
  const value = positiveBigint(price.value, `${field}.value`);
  if (!Number.isInteger(price.decimals) || price.decimals < 0 || price.decimals > 255) {
    throw new RangeError(`${field}.decimals must be an integer between 0 and 255`);
  }
  return {
    value,
    decimals: price.decimals,
  };
};

const normalizeMarketObservation = (
  observation: MarketObservation,
  field: string,
): MarketObservation => {
  if (typeof observation !== "object" || observation === null) {
    throw new TypeError(`${field} must be an object`);
  }
  return Object.freeze({
    ...normalizeMarketPair(observation, field),
    source: requiredText(observation.source, `${field}.source`),
    chainId: positiveInteger(observation.chainId, `${field}.chainId`),
    blockNumber: nonNegativeBigint(observation.blockNumber, `${field}.blockNumber`),
    observedAtSeconds: nonNegativeInteger(
      observation.observedAtSeconds,
      `${field}.observedAtSeconds`,
    ),
  });
};

const normalizeExactPrice = (price: ExactPrice, field: string): ExactPrice =>
  Object.freeze({
    ...normalizeMarketObservation(price, field),
    ...normalizePriceValue(price, field),
  });

const normalizeBpsObservation = (
  observation: BasisPointObservation,
  field: string,
): BasisPointObservation =>
  Object.freeze({
    ...normalizeMarketObservation(observation, field),
    bps: bps(observation.bps, `${field}.bps`),
  });

const ORACLE_HEALTH_ISSUES = new Set([
  "pause-state-unknown",
  "corporate-action-paused",
  "sequencer-state-unknown",
  "sequencer-down",
  "sequencer-grace-period",
  "invalid-answer",
  "invalid-round",
  "incomplete-round",
  "invalid-timestamp",
  "future-timestamp",
  "stale",
]);

const normalizeOracleAssessment = (
  value: OracleHealthAssessment,
  field: string,
): OracleHealthAssessment => {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.usable !== "boolean" ||
    typeof value.reason !== "string" ||
    !Array.isArray(value.issues) ||
    value.issues.some(
      (entry) => typeof entry !== "string" || !ORACLE_HEALTH_ISSUES.has(entry),
    )
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  if (
    (value.usable &&
      (value.reason !== "healthy" || value.issues.length !== 0)) ||
    (!value.usable &&
      (value.issues.length === 0 ||
        value.reason !== value.issues[0] ||
        !ORACLE_HEALTH_ISSUES.has(value.reason)))
  ) {
    throw new TypeError(`${field} has contradictory usability, reason, or issues`);
  }
  if (
    value.ageSeconds !== undefined &&
    (typeof value.ageSeconds !== "number" || !Number.isFinite(value.ageSeconds))
  ) {
    throw new TypeError(`${field}.ageSeconds is invalid`);
  }
  if (
    value.formattedAnswer !== undefined &&
    (typeof value.formattedAnswer !== "string" ||
      value.formattedAnswer.trim() === "")
  ) {
    throw new TypeError(`${field}.formattedAnswer is invalid`);
  }
  if (
    value.usable &&
    (value.ageSeconds === undefined || value.formattedAnswer === undefined)
  ) {
    throw new TypeError(`${field} is missing healthy price metadata`);
  }
  if (
    value.sequencerGracePeriodRemainingSeconds !== undefined &&
    (typeof value.sequencerGracePeriodRemainingSeconds !== "number" ||
      !Number.isFinite(value.sequencerGracePeriodRemainingSeconds) ||
      value.sequencerGracePeriodRemainingSeconds <= 0)
  ) {
    throw new TypeError(`${field}.sequencerGracePeriodRemainingSeconds is invalid`);
  }
  const hasFutureTimestamp = value.issues.includes("future-timestamp");
  if (
    hasFutureTimestamp !==
    (value.ageSeconds !== undefined && value.ageSeconds < 0)
  ) {
    throw new TypeError(`${field}.ageSeconds contradicts future-timestamp`);
  }
  if (
    value.issues.includes("stale") &&
    (value.ageSeconds === undefined || value.ageSeconds < 0)
  ) {
    throw new TypeError(`${field}.ageSeconds contradicts stale`);
  }
  const hasSequencerGraceIssue = value.issues.includes(
    "sequencer-grace-period",
  );
  if (
    hasSequencerGraceIssue !==
    (value.sequencerGracePeriodRemainingSeconds !== undefined &&
      value.sequencerGracePeriodRemainingSeconds > 0)
  ) {
    throw new TypeError(
      `${field}.sequencerGracePeriodRemainingSeconds contradicts issues`,
    );
  }
  return Object.freeze({
    usable: value.usable,
    reason: value.reason,
    issues: Object.freeze([...value.issues]) as OracleHealthAssessment["issues"],
    ...(value.ageSeconds === undefined ? {} : { ageSeconds: value.ageSeconds }),
    ...(value.formattedAnswer === undefined
      ? {}
      : { formattedAnswer: value.formattedAnswer }),
    ...(value.sequencerGracePeriodRemainingSeconds === undefined
      ? {}
      : {
          sequencerGracePeriodRemainingSeconds:
            value.sequencerGracePeriodRemainingSeconds,
        }),
  });
};

const normalizeOracleObservation = (
  observation: OracleAssessmentObservation,
  field: string,
): OracleAssessmentObservation => {
  if (typeof observation !== "object" || observation === null) {
    throw new TypeError(`${field} must be an object`);
  }
  return Object.freeze({
    ...normalizeMarketObservation(observation, field),
    assessment: normalizeOracleAssessment(
      observation.assessment,
      `${field}.assessment`,
    ),
  });
};

const validateMarketContext = (
  market: TransactionMarketContext | undefined,
): TransactionMarketContext | undefined => {
  if (market === undefined) return undefined;
  if (typeof market !== "object" || market === null) {
    throw new TypeError("market must be an object");
  }
  return Object.freeze({
    ...(market.oracle === undefined
      ? {}
      : { oracle: normalizeOracleObservation(market.oracle, "market.oracle") }),
    ...(market.oraclePrice === undefined
      ? {}
      : {
          oraclePrice: normalizeExactPrice(
            market.oraclePrice,
            "market.oraclePrice",
          ),
        }),
    ...(market.dexPrice === undefined
      ? {}
      : { dexPrice: normalizeExactPrice(market.dexPrice, "market.dexPrice") }),
    ...(market.slippage === undefined
      ? {}
      : { slippage: normalizeBpsObservation(market.slippage, "market.slippage") }),
    ...(market.priceImpact === undefined
      ? {}
      : {
          priceImpact: normalizeBpsObservation(
            market.priceImpact,
            "market.priceImpact",
          ),
        }),
  });
};

/**
 * Exact, ceiling-rounded absolute deviation in basis points. Different decimal
 * scales are cross-multiplied; no floating-point conversion is used.
 */
export function calculatePriceDeviationBps(
  reference: PriceValue,
  observed: PriceValue,
): bigint {
  const left = normalizePriceValue(reference, "reference");
  const right = normalizePriceValue(observed, "observed");
  const referenceScaled = left.value * 10n ** BigInt(right.decimals);
  const observedScaled = right.value * 10n ** BigInt(left.decimals);
  const difference =
    referenceScaled >= observedScaled
      ? referenceScaled - observedScaled
      : observedScaled - referenceScaled;
  return (difference * 10_000n + referenceScaled - 1n) / referenceScaled;
}

const adapterMethods = [
  "getChainId",
  "simulate",
  "getCode",
  "resolveContract",
  "resolveAsset",
  "getNativeBalance",
  "getTokenBalance",
  "getAllowance",
  "estimateGas",
  "getFeePerGas",
] as const;

const validateAdapter = (adapter: TransactionPreflightAdapter) => {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("adapter must be an object");
  }
  for (const method of adapterMethods) {
    const value = adapter[method];
    if ((method === "simulate" || value !== undefined) && typeof value !== "function") {
      throw new TypeError(`adapter.${method} must be a function`);
    }
  }
};

const safeError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || "Provider evidence unavailable";
};

interface AbortRace {
  signal: AbortSignal;
  promise: Promise<never>;
  dispose: () => void;
}

const createAbortRace = (signal: AbortSignal | undefined): AbortRace | undefined => {
  if (!signal) return undefined;
  signal.throwIfAborted();
  let onAbort = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      try {
        signal.throwIfAborted();
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    signal,
    promise,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
};

const awaitWithAbort = <T>(
  operation: () => Promise<T>,
  abort: AbortRace | undefined,
) => {
  if (!abort) return operation();
  abort.signal.throwIfAborted();
  return Promise.race([operation(), abort.promise]);
};

const captureEvidence = async <T>(
  operation: (() => Promise<T>) | undefined,
  abort: AbortRace | undefined,
): Promise<Evidence<T>> => {
  if (!operation) return { status: "unavailable", error: "Adapter method is unavailable" };
  try {
    abort?.signal.throwIfAborted();
    const value = await awaitWithAbort(operation, abort);
    abort?.signal.throwIfAborted();
    return { status: "available", value };
  } catch (error) {
    abort?.signal.throwIfAborted();
    return { status: "unavailable", error: safeError(error) };
  }
};

const notRequired = <T>(): Evidence<T> => ({ status: "not-required" });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateEvidence = <T>(
  evidence: Evidence<T>,
  predicate: (value: unknown) => value is T,
  error: string,
): Evidence<T> =>
  evidence.status === "available" && !predicate(evidence.value)
    ? { status: "unavailable", error }
    : evidence;

const mapAvailableEvidence = <T, U>(
  evidence: Evidence<T>,
  map: (value: T) => U,
): Evidence<U> =>
  evidence.status === "available"
    ? { status: "available", value: map(evidence.value) }
    : { ...evidence };

const isHexData = (value: unknown): value is HexData =>
  typeof value === "string" && HEX_DATA.test(value);

const isNonNegativeBigint = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n && value <= MAX_UINT256;

const isPositiveBigint = (value: unknown): value is bigint =>
  typeof value === "bigint" && value > 0n && value <= MAX_UINT256;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isSimulationResult = (value: unknown): value is SimulationResult =>
  isRecord(value) &&
  typeof value.success === "boolean" &&
  (value.gasUsed === undefined || isNonNegativeBigint(value.gasUsed)) &&
  (value.returnData === undefined || isHexData(value.returnData)) &&
  (value.revertReason === undefined || typeof value.revertReason === "string") &&
  (!value.success || value.revertReason === undefined);

const cloneSimulationResult = (value: SimulationResult): SimulationResult => ({
  success: value.success,
  ...(value.gasUsed === undefined ? {} : { gasUsed: value.gasUsed }),
  ...(value.returnData === undefined ? {} : { returnData: value.returnData }),
  ...(value.revertReason === undefined ? {} : { revertReason: value.revertReason }),
});

const CONTRACT_KINDS = new Set([
  "erc20",
  "erc721",
  "erc1155",
  "router",
  "bridge",
  "contract",
  "unknown",
]);
const isContractIdentity = (value: unknown): value is ContractIdentity =>
  isRecord(value) &&
  typeof value.address === "string" &&
  ADDRESS.test(value.address) &&
  typeof value.kind === "string" &&
  CONTRACT_KINDS.has(value.kind) &&
  typeof value.verified === "boolean" &&
  typeof value.source === "string" &&
  value.source.trim() !== "" &&
  (value.name === undefined || typeof value.name === "string");

const cloneContractIdentity = (value: ContractIdentity): ContractIdentity => ({
  address: value.address,
  ...(value.name === undefined ? {} : { name: value.name }),
  kind: value.kind,
  verified: value.verified,
  source: value.source,
});

const ASSET_KINDS = new Set(["native", "erc20", "erc721", "erc1155", "unknown"]);
const isAssetIdentity = (value: unknown): value is AssetIdentity =>
  isRecord(value) &&
  typeof value.address === "string" &&
  ADDRESS.test(value.address) &&
  typeof value.kind === "string" &&
  ASSET_KINDS.has(value.kind) &&
  typeof value.verified === "boolean" &&
  typeof value.source === "string" &&
  value.source.trim() !== "" &&
  (value.name === undefined || typeof value.name === "string") &&
  (value.symbol === undefined || typeof value.symbol === "string") &&
  (value.decimals === undefined ||
    (typeof value.decimals === "number" &&
      Number.isInteger(value.decimals) &&
      value.decimals >= 0 &&
      value.decimals <= 255));

const cloneAssetIdentity = (value: AssetIdentity): AssetIdentity => ({
  address: value.address,
  ...(value.symbol === undefined ? {} : { symbol: value.symbol }),
  ...(value.name === undefined ? {} : { name: value.name }),
  ...(value.decimals === undefined ? {} : { decimals: value.decimals }),
  kind: value.kind,
  verified: value.verified,
  source: value.source,
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
};

const uniqueAssetAddresses = (action: TransactionAction) => {
  const values = new Map<string, EvmAddress>();
  for (const requirement of action.tokenBalanceRequirements) {
    values.set(requirement.token.toLowerCase(), requirement.token);
  }
  for (const requirement of action.allowanceRequirements) {
    values.set(requirement.token.toLowerCase(), requirement.token);
  }
  return [...values.values()];
};

const approvalTargetAddresses = (action: TransactionAction): EvmAddress[] => {
  if (action.kind === "erc20-approve" && action.amount > 0n) return [action.spender];
  if (action.kind === "operator-approval" && action.approved) return [action.operator];
  return [];
};

const planDescription = (action: TransactionAction) => {
  switch (action.kind) {
    case "native-transfer":
      return "Transfer native currency";
    case "erc20-transfer":
      return "Transfer ERC-20 tokens";
    case "erc20-approve":
      return "Set ERC-20 allowance";
    case "erc20-transfer-from":
      return "Transfer ERC-20 tokens using allowance";
    case "operator-approval":
      return action.approved ? "Grant operator approval" : "Revoke operator approval";
    case "contract-deployment":
      return "Deploy a contract";
    case "custom":
      return action.name;
    default:
      return "Call a contract";
  }
};

const issue = (
  code: PreflightIssueCode,
  severity: PreflightIssueSeverity,
  message: string,
): PreflightIssue => ({ code, severity, message });

const availableValue = <T>(evidence: Evidence<T>): T | undefined =>
  evidence.status === "available" ? evidence.value : undefined;

/**
 * Inspect a transaction using injected read-only evidence. Provider failures
 * become explicit unknowns; a caller abort is always rethrown. A plan is
 * returned only for a `safe` verdict and never signs or broadcasts.
 */
export async function inspectTransaction(
  input: TransactionRequest,
  options: InspectTransactionOptions,
): Promise<TransactionPreflightReport> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("options must be an object");
  }
  const request = Object.freeze(normalizeTransactionRequest(input));
  const policy = resolvePolicy(options.policy);
  const market = validateMarketContext(options.market);
  const inspectedAtSeconds =
    options.nowSeconds === undefined
      ? Math.floor(Date.now() / 1_000)
      : nonNegativeInteger(options.nowSeconds, "options.nowSeconds");
  validateAdapter(options.adapter);
  if (options.decodeAction !== undefined && typeof options.decodeAction !== "function") {
    throw new TypeError("decodeAction must be a function");
  }
  options.signal?.throwIfAborted();

  const builtInAction = decodeTransactionAction(request);
  const decoded =
    builtInAction.kind === "unknown-contract-call"
      ? options.decodeAction?.(request, builtInAction)
      : undefined;
  const action = decoded ? normalizeCustomAction(decoded, request) : builtInAction;
  options.signal?.throwIfAborted();

  const context = { ...(options.signal ? { signal: options.signal } : {}) };
  const abortRace = createAbortRace(options.signal);
  const tokenAddresses = uniqueAssetAddresses(action);
  const approvalTargets = approvalTargetAddresses(action);
  if (
    (action.kind === "erc20-transfer" ||
      action.kind === "erc20-approve" ||
      action.kind === "erc20-transfer-from" ||
      action.kind === "operator-approval") &&
    action.target &&
    !tokenAddresses.some((address) => address.toLowerCase() === action.target?.toLowerCase())
  ) {
    tokenAddresses.push(action.target);
  }

  const chainIdPromise = captureEvidence(
    options.adapter.getChainId
      ? () => options.adapter.getChainId!(context)
      : undefined,
    abortRace,
  );
  const simulationPromise = captureEvidence(
    () => options.adapter.simulate(request, context),
    abortRace,
  );
  const targetCodePromise =
    request.to
      ? captureEvidence(
          options.adapter.getCode
            ? () => options.adapter.getCode!(request.to!, context)
            : undefined,
          abortRace,
        )
      : Promise.resolve(notRequired<HexData>());
  const contractIdentityPromise =
    request.to
      ? captureEvidence(
          options.adapter.resolveContract
            ? () => options.adapter.resolveContract!(request.to!, context)
            : undefined,
          abortRace,
        )
      : Promise.resolve(notRequired<ContractIdentity>());
  const nativeBalancePromise = captureEvidence(
    options.adapter.getNativeBalance
      ? () => options.adapter.getNativeBalance!(request.from, context)
      : undefined,
    abortRace,
  );
  const gasEstimatePromise = captureEvidence(
    options.adapter.estimateGas
      ? () => options.adapter.estimateGas!(request, context)
      : undefined,
    abortRace,
  );
  const feePerGasPromise = captureEvidence(
    options.adapter.getFeePerGas
      ? () => options.adapter.getFeePerGas!(request, context)
      : undefined,
    abortRace,
  );

  const assetIdentityPromises = tokenAddresses.map(async (address) => ({
    address,
    evidence: await captureEvidence(
      options.adapter.resolveAsset
        ? () => options.adapter.resolveAsset!(address, context)
        : undefined,
      abortRace,
    ),
  }));
  const approvalTargetPromises = approvalTargets.map(async (address) => ({
    address,
    code: await captureEvidence(
      options.adapter.getCode
        ? () => options.adapter.getCode!(address, context)
        : undefined,
      abortRace,
    ),
    identity: await captureEvidence(
      options.adapter.resolveContract
        ? () => options.adapter.resolveContract!(address, context)
        : undefined,
      abortRace,
    ),
  }));
  const tokenBalancePromises = action.tokenBalanceRequirements.map(async (requirement) => ({
    requirement,
    evidence: await captureEvidence(
      options.adapter.getTokenBalance
        ? () =>
            options.adapter.getTokenBalance!(
              requirement.token,
              requirement.owner,
              context,
            )
        : undefined,
      abortRace,
    ),
  }));
  const allowancePromises = action.allowanceRequirements.map(async (requirement) => ({
    requirement,
    evidence: await captureEvidence(
      options.adapter.getAllowance
        ? () =>
            options.adapter.getAllowance!(
              requirement.token,
              requirement.owner,
              requirement.spender,
              context,
            )
        : undefined,
      abortRace,
    ),
  }));

  const evidenceResults = await Promise.all([
    chainIdPromise,
    simulationPromise,
    targetCodePromise,
    contractIdentityPromise,
    nativeBalancePromise,
    gasEstimatePromise,
    feePerGasPromise,
    Promise.all(approvalTargetPromises),
    Promise.all(assetIdentityPromises),
    Promise.all(tokenBalancePromises),
    Promise.all(allowancePromises),
  ]).finally(() => abortRace?.dispose());

  const [
    rawChainId,
    rawSimulation,
    rawTargetCode,
    rawContractIdentity,
    rawNativeBalance,
    rawGasEstimate,
    rawFeePerGas,
    rawApprovalTargetEvidence,
    rawAssetIdentities,
    rawTokenBalances,
    rawAllowances,
  ] = evidenceResults;

  const chainId = validateEvidence(
    rawChainId,
    isPositiveInteger,
    "Provider chain identity evidence is malformed",
  );
  const simulation = mapAvailableEvidence(
    validateEvidence(
      rawSimulation,
      isSimulationResult,
      "Simulation evidence is malformed",
    ),
    cloneSimulationResult,
  );
  const targetCode = validateEvidence(
    rawTargetCode,
    isHexData,
    "Target bytecode evidence is malformed",
  );
  const contractIdentity = mapAvailableEvidence(
    validateEvidence(
      rawContractIdentity,
      isContractIdentity,
      "Target contract identity evidence is malformed",
    ),
    cloneContractIdentity,
  );
  const nativeBalance = validateEvidence(
    rawNativeBalance,
    isNonNegativeBigint,
    "Native balance evidence is malformed",
  );
  const capturedGasEstimate = validateEvidence(
    rawGasEstimate,
    isPositiveBigint,
    "Gas estimate evidence is malformed",
  );
  const gasEstimate: Evidence<bigint> =
    capturedGasEstimate.status !== "available" &&
    simulation.status === "available" &&
    simulation.value.gasUsed !== undefined &&
    simulation.value.gasUsed > 0n
      ? { status: "available", value: simulation.value.gasUsed }
      : capturedGasEstimate;
  const feePerGas = validateEvidence(
    rawFeePerGas,
    isPositiveBigint,
    "Fee-per-gas evidence is malformed",
  );
  const approvalTargetEvidence = rawApprovalTargetEvidence.map((entry) => ({
    address: entry.address,
    code: validateEvidence(
      entry.code,
      isHexData,
      "Approval target bytecode evidence is malformed",
    ),
    identity: mapAvailableEvidence(
      validateEvidence(
        entry.identity,
        isContractIdentity,
        "Approval target identity evidence is malformed",
      ),
      cloneContractIdentity,
    ),
  }));
  const assetIdentities = rawAssetIdentities.map((entry) => ({
    address: entry.address,
    evidence: mapAvailableEvidence(
      validateEvidence(
        entry.evidence,
        isAssetIdentity,
        "Asset identity evidence is malformed",
      ),
      cloneAssetIdentity,
    ),
  }));
  const tokenBalances = rawTokenBalances.map((entry) => ({
    requirement: entry.requirement,
    evidence: validateEvidence(
      entry.evidence,
      isNonNegativeBigint,
      "Token balance evidence is malformed",
    ),
  }));
  const allowances = rawAllowances.map((entry) => ({
    requirement: entry.requirement,
    evidence: validateEvidence(
      entry.evidence,
      isNonNegativeBigint,
      "Allowance evidence is malformed",
    ),
  }));

  const evidence: TransactionPreflightEvidence = {
    chainId,
    simulation,
    targetCode,
    contractIdentity,
    approvalTargets: approvalTargetEvidence,
    assetIdentities,
    nativeBalance,
    tokenBalances,
    allowances,
    gasEstimate,
    feePerGas,
  };

  const issues: PreflightIssue[] = [];
  if (!policy.allowedChainIds.includes(request.chainId)) {
    issues.push(
      issue("unsupported-chain", "block", `Chain ${request.chainId} is not allowed by policy`),
    );
  }
  if (policy.requireChainIdentity) {
    if (chainId.status !== "available") {
      issues.push(
        issue("chain-id-unavailable", "unknown", "Provider chain identity is unavailable"),
      );
    } else if (chainId.value !== request.chainId) {
      issues.push(
        issue(
          "chain-id-mismatch",
          "block",
          `Provider chain ${chainId.value} does not match request chain ${request.chainId}`,
        ),
      );
    }
  }
  if (action.kind === "unknown-contract-call" && !policy.allowUnknownActions) {
    issues.push(issue("unknown-action", "unknown", "Transaction action could not be decoded"));
  }
  if (action.kind === "contract-deployment" && !policy.allowContractDeployment) {
    issues.push(
      issue("contract-deployment-disabled", "block", "Contract deployment is disabled by policy"),
    );
  }

  if (simulation.status !== "available") {
    issues.push(
      issue("simulation-unavailable", "unknown", "Transaction simulation is unavailable"),
    );
  } else {
    if (!simulation.value.success) {
      issues.push(
        issue(
          "simulation-failed",
          "block",
          simulation.value.revertReason
            ? `Transaction simulation failed: ${simulation.value.revertReason}`
            : "Transaction simulation failed",
        ),
      );
    }
  }

  const actionRequiresContract =
    action.kind !== "native-transfer" && action.kind !== "contract-deployment";
  const targetHasCode =
    targetCode.status === "available" && targetCode.value !== "0x";
  const targetRequiresIdentity = actionRequiresContract || targetHasCode;
  if (request.to) {
    if (targetCode.status !== "available") {
      issues.push(
        issue("target-code-unavailable", "unknown", "Target bytecode is unavailable"),
      );
    } else if (targetCode.value === "0x" && actionRequiresContract) {
      issues.push(issue("target-not-contract", "block", "Target has no deployed bytecode"));
    }
    if (targetRequiresIdentity && policy.requireContractIdentity) {
      if (contractIdentity.status !== "available") {
        issues.push(
          issue(
            "contract-identity-unavailable",
            "unknown",
            "Target contract identity is unavailable",
          ),
        );
      } else {
        const identity = contractIdentity.value;
        if (identity.address.toLowerCase() !== request.to?.toLowerCase()) {
          issues.push(
            issue(
              "contract-identity-unavailable",
              "unknown",
              "Target contract identity evidence is malformed",
            ),
          );
        } else if (!identity.verified) {
          issues.push(
            issue(
              "contract-unverified",
              policy.requireVerifiedContract ? "block" : "warning",
              "Target contract identity is not independently verified",
            ),
          );
        }
      }
    }
  }

  for (const approvalTarget of approvalTargetEvidence) {
    if (approvalTarget.code.status !== "available") {
      issues.push(
        issue(
          "approval-target-code-unavailable",
          policy.allowUnverifiedApprovalTargets &&
            policy.allowEoaApprovalTargets
            ? "warning"
            : "block",
          `Approval target bytecode is unavailable for ${approvalTarget.address}`,
        ),
      );
    } else if (approvalTarget.code.value === "0x") {
      issues.push(
        issue(
          "approval-target-not-contract",
          policy.allowEoaApprovalTargets ? "warning" : "block",
          `Approval target ${approvalTarget.address} has no deployed bytecode`,
        ),
      );
    }
    if (
      approvalTarget.code.status === "available" &&
      approvalTarget.code.value !== "0x"
    ) {
      if (approvalTarget.identity.status !== "available") {
        issues.push(
          issue(
            "approval-target-identity-unavailable",
            policy.allowUnverifiedApprovalTargets ? "warning" : "block",
            `Approval target identity is unavailable for ${approvalTarget.address}`,
          ),
        );
      } else if (
        approvalTarget.identity.value.address.toLowerCase() !==
        approvalTarget.address.toLowerCase()
      ) {
        issues.push(
          issue(
            "approval-target-identity-unavailable",
            policy.allowUnverifiedApprovalTargets ? "warning" : "block",
            `Approval target identity does not match ${approvalTarget.address}`,
          ),
        );
      } else if (
        !approvalTarget.identity.value.verified ||
        approvalTarget.identity.value.kind === "unknown"
      ) {
        issues.push(
          issue(
            "approval-target-unverified",
            policy.allowUnverifiedApprovalTargets ? "warning" : "block",
            `Approval target ${approvalTarget.address} is unknown or not independently verified`,
          ),
        );
      }
    }
  }

  if (policy.requireAssetIdentity) {
    for (const entry of assetIdentities) {
      if (entry.evidence.status !== "available") {
        issues.push(
          issue(
            "asset-identity-unavailable",
            "unknown",
            `Asset identity is unavailable for ${entry.address}`,
          ),
        );
        continue;
      }
      const identity = entry.evidence.value;
      if (identity.address.toLowerCase() !== entry.address.toLowerCase()) {
        issues.push(
          issue(
            "asset-identity-unavailable",
            "unknown",
            `Asset identity evidence is malformed for ${entry.address}`,
          ),
        );
      } else if (!identity.verified) {
        issues.push(
          issue(
            "asset-unverified",
            policy.requireVerifiedAssets ? "block" : "warning",
            `Asset ${entry.address} is not independently verified`,
          ),
        );
      }
      const expectedKinds =
        action.kind === "operator-approval"
          ? new Set(["erc721", "erc1155"])
          : action.kind === "erc20-transfer" ||
              action.kind === "erc20-approve" ||
              action.kind === "erc20-transfer-from"
            ? new Set(["erc20"])
            : undefined;
      if (expectedKinds && !expectedKinds.has(identity.kind)) {
        issues.push(
          issue(
            "asset-standard-mismatch",
            "block",
            `Asset ${entry.address} does not match the decoded ${action.kind} standard`,
          ),
        );
      }
    }
  }

  const gasEstimateValue = availableValue(gasEstimate);
  if (policy.requireGasEstimate && gasEstimateValue === undefined) {
    issues.push(
      issue("gas-estimate-unavailable", "unknown", "Gas estimate is unavailable"),
    );
  }
  if (
    request.gasLimit !== undefined &&
    gasEstimateValue !== undefined &&
    request.gasLimit < gasEstimateValue
  ) {
    issues.push(
      issue(
        "gas-limit-too-low",
        "block",
        `Transaction gas limit ${request.gasLimit} is below independent estimate ${gasEstimateValue}`,
      ),
    );
  }
  const feePerGasValue = availableValue(feePerGas);
  if (policy.requireFeeEstimate && feePerGasValue === undefined) {
    issues.push(
      issue("fee-estimate-unavailable", "unknown", "Fee-per-gas estimate is unavailable"),
    );
  }
  const requestFeePerGas = request.maxFeePerGas ?? request.gasPrice;
  if (
    requestFeePerGas !== undefined &&
    feePerGasValue !== undefined &&
    requestFeePerGas < feePerGasValue
  ) {
    issues.push(
      issue(
        "fee-cap-too-low",
        "block",
        `Transaction fee cap ${requestFeePerGas} is below independent estimate ${feePerGasValue}`,
      ),
    );
  }
  const executionGasLimit = request.gasLimit ?? gasEstimateValue;
  const executionFeePerGas = requestFeePerGas ?? feePerGasValue;
  const estimatedFee =
    executionGasLimit !== undefined &&
    executionFeePerGas !== undefined
      ? executionGasLimit * executionFeePerGas
      : undefined;
  const requiredNativeBalance =
    estimatedFee === undefined ? undefined : request.value + estimatedFee;
  if (nativeBalance.status !== "available") {
    issues.push(
      issue("native-balance-unavailable", "unknown", "Native balance is unavailable"),
    );
  } else {
    const minimum = requiredNativeBalance ?? request.value;
    if (nativeBalance.value < minimum) {
      issues.push(
        issue(
          "insufficient-native-balance",
          "block",
          "Native balance cannot cover transaction value and known fees",
        ),
      );
    }
  }

  for (const entry of tokenBalances) {
    if (entry.evidence.status !== "available") {
      issues.push(
        issue(
          "token-balance-unavailable",
          "unknown",
          `Token balance is unavailable for ${entry.requirement.token}`,
        ),
      );
    } else if (entry.evidence.value < entry.requirement.minimum) {
      issues.push(
        issue(
          "insufficient-token-balance",
          "block",
          `Token balance does not satisfy ${entry.requirement.label ?? "the action requirement"}`,
        ),
      );
    }
  }
  for (const entry of allowances) {
    if (entry.evidence.status !== "available") {
      issues.push(
        issue(
          "allowance-unavailable",
          "unknown",
          `Allowance is unavailable for ${entry.requirement.token}`,
        ),
      );
    } else if (entry.evidence.value < entry.requirement.minimum) {
      issues.push(
        issue(
          "insufficient-allowance",
          "block",
          `Allowance does not satisfy ${entry.requirement.label ?? "the action requirement"}`,
        ),
      );
    }
  }

  if (
    action.kind === "erc20-approve" &&
    action.unlimited &&
    !policy.allowUnlimitedApproval
  ) {
    issues.push(
      issue("unlimited-approval", "block", "Unlimited token approval is disabled by policy"),
    );
  }
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const recipient =
    action.kind === "native-transfer" ||
    action.kind === "erc20-transfer" ||
    action.kind === "erc20-transfer-from"
      ? action.recipient
      : undefined;
  if (recipient?.toLowerCase() === zeroAddress) {
    issues.push(
      issue("zero-address-recipient", "block", "Transfer recipient is the zero address"),
    );
  }
  if (
    request.value > 0n &&
    (action.kind === "erc20-transfer" ||
      action.kind === "erc20-approve" ||
      action.kind === "erc20-transfer-from" ||
      action.kind === "operator-approval")
  ) {
    issues.push(
      issue(
        "unexpected-native-value",
        "block",
        "Token action unexpectedly attaches native currency",
      ),
    );
  }
  if (
    action.kind === "operator-approval" &&
    action.approved &&
    !policy.allowOperatorApproval
  ) {
    issues.push(
      issue("operator-approval", "block", "Broad operator approval is disabled by policy"),
    );
  }

  let oracleDexDeviationBps: bigint | undefined;
  const requiresMarket = action.marketSensitive && policy.requireMarketEvidence;
  const expectedMarketPair =
    action.kind === "custom" ? action.marketPair : undefined;
  const observations = [
    ["Oracle assessment", market?.oracle],
    ["Oracle price", market?.oraclePrice],
    ["DEX price", market?.dexPrice],
    ["Slippage", market?.slippage],
    ["Price impact", market?.priceImpact],
  ] as const;
  let marketEvidenceComparable = true;

  if (requiresMarket && expectedMarketPair) {
    for (const [label, observation] of observations) {
      if (!observation) continue;
      const pairMatches =
        observation.baseAsset.toLowerCase() ===
          expectedMarketPair.baseAsset.toLowerCase() &&
        observation.quoteAsset.toLowerCase() ===
          expectedMarketPair.quoteAsset.toLowerCase();
      if (!pairMatches || observation.chainId !== request.chainId) {
        marketEvidenceComparable = false;
        issues.push(
          issue(
            "market-evidence-mismatch",
            "block",
            `${label} provenance does not match the requested chain and market pair`,
          ),
        );
      }
      const ageSeconds = inspectedAtSeconds - observation.observedAtSeconds;
      if (ageSeconds < 0 || ageSeconds > policy.maxMarketAgeSeconds) {
        marketEvidenceComparable = false;
        issues.push(
          issue(
            "market-evidence-stale",
            "block",
            `${label} timestamp is outside the allowed market evidence window`,
          ),
        );
      }
    }

    const presentObservations = observations.flatMap(([, observation]) =>
      observation ? [observation] : [],
    );
    if (presentObservations.length > 1) {
      const timestamps = presentObservations.map(
        (observation) => observation.observedAtSeconds,
      );
      const timestampSkew = Math.max(...timestamps) - Math.min(...timestamps);
      if (timestampSkew > policy.maxMarketObservationSkewSeconds) {
        marketEvidenceComparable = false;
        issues.push(
          issue(
            "market-evidence-mismatch",
            "block",
            `Market observation timestamp skew ${timestampSkew}s exceeds policy`,
          ),
        );
      }
      const blockNumbers = presentObservations.map(
        (observation) => observation.blockNumber,
      );
      const minBlock = blockNumbers.reduce((left, right) =>
        left <= right ? left : right,
      );
      const maxBlock = blockNumbers.reduce((left, right) =>
        left >= right ? left : right,
      );
      if (maxBlock - minBlock > policy.maxMarketBlockSkew) {
        marketEvidenceComparable = false;
        issues.push(
          issue(
            "market-evidence-mismatch",
            "block",
            `Market observation block skew ${maxBlock - minBlock} exceeds policy`,
          ),
        );
      }
    }
  }

  if (market?.oracle) {
    if (!market.oracle.assessment.usable) {
      issues.push(
        issue(
          "oracle-unusable",
          "block",
          `Oracle Guard rejected the market state: ${market.oracle.assessment.issues.join(", ")}`,
        ),
      );
    }
  } else if (requiresMarket) {
    issues.push(
      issue("market-evidence-unavailable", "unknown", "Oracle assessment is unavailable"),
    );
  }
  if (
    market?.oraclePrice &&
    market.dexPrice &&
    (!requiresMarket || marketEvidenceComparable)
  ) {
    oracleDexDeviationBps = calculatePriceDeviationBps(
      market.oraclePrice,
      market.dexPrice,
    );
    if (oracleDexDeviationBps > BigInt(policy.maxOracleDexDeviationBps)) {
      issues.push(
        issue(
          "excessive-oracle-dex-deviation",
          "block",
          `Oracle/DEX deviation ${oracleDexDeviationBps} bps exceeds policy`,
        ),
      );
    }
  } else if (requiresMarket) {
    issues.push(
      issue(
        "market-evidence-unavailable",
        "unknown",
        "Comparable oracle and DEX prices are unavailable",
      ),
    );
  }
  if (market?.slippage !== undefined) {
    if (market.slippage.bps > policy.maxSlippageBps) {
      issues.push(
        issue(
          "excessive-slippage",
          "block",
          `Slippage ${market.slippage.bps} bps exceeds policy`,
        ),
      );
    }
  } else if (requiresMarket) {
    issues.push(
      issue("market-evidence-unavailable", "unknown", "Slippage evidence is unavailable"),
    );
  }
  if (market?.priceImpact !== undefined) {
    if (market.priceImpact.bps > policy.maxPriceImpactBps) {
      issues.push(
        issue(
          "excessive-price-impact",
          "block",
          `Price impact ${market.priceImpact.bps} bps exceeds policy`,
        ),
      );
    }
  } else if (requiresMarket) {
    issues.push(
      issue("market-evidence-unavailable", "unknown", "Price-impact evidence is unavailable"),
    );
  }

  const verdict: PreflightVerdict = issues.some((entry) => entry.severity === "block")
    ? "blocked"
    : issues.some((entry) => entry.severity === "unknown")
      ? "unknown"
      : "safe";
  const plan: TransactionPlan =
    verdict === "safe"
      ? {
          status: "ready",
          steps: [
            {
              id: "transaction",
              kind: "transaction",
              description: planDescription(action),
              request,
            },
          ],
        }
      : { status: "withheld", steps: [] };

  return deepFreeze({
    inspectedAtSeconds,
    verdict,
    request,
    action,
    policy,
    evidence,
    issues,
    ...(market === undefined ? {} : { market }),
    ...(oracleDexDeviationBps === undefined ? {} : { oracleDexDeviationBps }),
    ...(estimatedFee === undefined ? {} : { estimatedFee }),
    ...(requiredNativeBalance === undefined ? {} : { requiredNativeBalance }),
    plan,
  });
}
