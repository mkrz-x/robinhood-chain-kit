/** Canonical L1 (Ethereum mainnet) contracts for Robinhood Chain.
 * Source: docs.robinhood.com/chain — deposits enter through the gateways,
 * finalized withdrawals exit through the Outbox (7-day challenge window). */
export const L1_BRIDGE = "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3";
export const L1_DELAYED_INBOX = "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D";
export const L1_SEQUENCER_INBOX = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
export const L1_OUTBOX = "0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9";
export const L1_ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
export const L1_GATEWAY_ROUTER = "0x6a2E3a1e16FC29f27Ce61429746D558d656975bB";
export const L1_ERC20_GATEWAY = "0x85001CC4867C5e1C22dA4B79BB8852B9e2a06da0";
export const L1_CUSTOM_GATEWAY = "0x9368EAEbFe6E063C69dcF8126711A6997E0eCeE1";
export const L1_WETH_GATEWAY = "0xF7e12b9614b509C747ab4423bC4ACF923759Cf1B";
export const L1_GATEWAYS = [L1_ERC20_GATEWAY, L1_CUSTOM_GATEWAY, L1_WETH_GATEWAY] as const;

/** human-readable event signatures for token flow tracking (viem parseAbiItem-ready) */
export const DEPOSIT_INITIATED_EVENT =
  "event DepositInitiated(address l1Token, address indexed _from, address indexed _to, uint256 indexed _sequenceNumber, uint256 _amount)";
export const WITHDRAWAL_FINALIZED_EVENT =
  "event WithdrawalFinalized(address l1Token, address indexed _from, address indexed _to, uint256 indexed _exitNum, uint256 _amount)";
