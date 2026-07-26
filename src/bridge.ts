/**
 * Robinhood Chain protocol and canonical token-bridge deployments.
 *
 * Source: https://docs.robinhood.com/chain/protocol-contracts
 * Last reviewed against the official table: 2026-07-26.
 */

export const ARBITRUM_PRECOMPILES = {
  arbAddressTable: "0x0000000000000000000000000000000000000066",
  arbAggregator: "0x000000000000000000000000000000000000006D",
  arbFunctionTable: "0x0000000000000000000000000000000000000068",
  arbGasInfo: "0x000000000000000000000000000000000000006C",
  arbInfo: "0x0000000000000000000000000000000000000065",
  arbOwner: "0x0000000000000000000000000000000000000070",
  arbOwnerPublic: "0x000000000000000000000000000000000000006b",
  arbRetryableTx: "0x000000000000000000000000000000000000006E",
  arbStatistics: "0x000000000000000000000000000000000000006F",
  arbSys: "0x0000000000000000000000000000000000000064",
  arbWasm: "0x0000000000000000000000000000000000000071",
  arbWasmCache: "0x0000000000000000000000000000000000000072",
  nodeInterface: "0x00000000000000000000000000000000000000C8",
} as const;

export const PROTOCOL_CONTRACTS = {
  mainnet: {
    l1: {
      rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
      sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
      coreProxyAdmin: "0x1232813BDd40aa9d53066A880dE78a4Be70B90FD",
      delayedInbox: "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D",
      bridge: "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3",
      outbox: "0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9",
      gatewayRouter: "0x6a2E3a1e16FC29f27Ce61429746D558d656975bB",
      erc20Gateway: "0x85001CC4867C5e1C22dA4B79BB8852B9e2a06da0",
      customGateway: "0x9368EAEbFe6E063C69dcF8126711A6997E0eCeE1",
      wethGateway: "0xF7e12b9614b509C747ab4423bC4ACF923759Cf1B",
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      proxyAdmin: "0x1232813BDd40aa9d53066A880dE78a4Be70B90FD",
      multicall: "0x7cdCB0Cc61f47B8Dd8f47C5A29edaDd84a1BDf5e",
    },
    l2: {
      gatewayRouter: "0x1E324B9316138CA9a73F960213621AD1aaf01B89",
      erc20Gateway: "0xfd9b17206278C16DdaacF6AC8f05dBf97EdCb31e",
      customGateway: "0x912285144fC0f6e89d3Ed16F5Ab72f87A1878959",
      wethGateway: "0x1D187C3E2dA52D72BC9C41e3AbA0fdFa6a7bF055",
      weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      proxyAdmin: "0xa3Acd31AFb851B4eB9DAD00F5204c01D924267dF",
      multicall: "0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    precompiles: ARBITRUM_PRECOMPILES,
  },
  testnet: {
    l1: {
      rollup: "0xdc5F8E399DBd8a9F5F87AeC4C23Beb12431b386D",
      sequencerInbox: "0xA0D9dB3DC9791D54b5183C1C1866eFe1eCA7D414",
      coreProxyAdmin: "0x20d5d542c1bF0a3c295524Eaef336fC07e890622",
      delayedInbox: "0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4",
      bridge: "0x96295BDad104eaD97cC08797b3dC68efF59CcF30",
      outbox: "0x8D180Caf588f3Da027BEf1F42a106Da93F90b166",
      gatewayRouter: "0xF6F11aAEE80875776C264d93B37B34cE437382D1",
      erc20Gateway: "0x52C2976cbDEf48BcC51d07d3c523769F76ECBd09",
      customGateway: "0xFB4aa8024F70B00121723A9C923BaD0Dd2dFaf8F",
      wethGateway: "0x8f8A6799F2b1978c6586318543c73D8Fb12f218f",
      weth: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
      proxyAdmin: "0x20d5d542c1bF0a3c295524Eaef336fC07e890622",
    },
    l2: {
      gatewayRouter: "0x77bF00A6A90c600f214b34BAFBB7918c0cF113A8",
      erc20Gateway: "0x8689aFB9086734e12beA6b5DF541a1da252Ea32a",
      customGateway: "0xE4EE9C15e2cA44136796342e31b67d953E67a70b",
      wethGateway: "0x5A8F55202A625D12FFCb76F857FE4563bC8Ce413",
      weth: "0x7943e237c7F95DA44E0301572D358911207852Fa",
      proxyAdmin: "0xE743e696B00789Ef489cF617477771764E9283a0",
      multicall: "0xa432504b6F04Cafe775b09D8AA92e8dbe41Ec7a8",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    precompiles: ARBITRUM_PRECOMPILES,
  },
} as const;

/** Backward-compatible mainnet aliases. */
export const L1_BRIDGE = PROTOCOL_CONTRACTS.mainnet.l1.bridge;
export const L1_DELAYED_INBOX = PROTOCOL_CONTRACTS.mainnet.l1.delayedInbox;
export const L1_SEQUENCER_INBOX = PROTOCOL_CONTRACTS.mainnet.l1.sequencerInbox;
export const L1_OUTBOX = PROTOCOL_CONTRACTS.mainnet.l1.outbox;
export const L1_ROLLUP = PROTOCOL_CONTRACTS.mainnet.l1.rollup;
export const L1_GATEWAY_ROUTER = PROTOCOL_CONTRACTS.mainnet.l1.gatewayRouter;
export const L1_ERC20_GATEWAY = PROTOCOL_CONTRACTS.mainnet.l1.erc20Gateway;
export const L1_CUSTOM_GATEWAY = PROTOCOL_CONTRACTS.mainnet.l1.customGateway;
export const L1_WETH_GATEWAY = PROTOCOL_CONTRACTS.mainnet.l1.wethGateway;
export const L1_GATEWAYS = [L1_ERC20_GATEWAY, L1_CUSTOM_GATEWAY, L1_WETH_GATEWAY] as const;

/** Emitted by the L1 gateways when ERC-20 deposits are initiated. */
export const DEPOSIT_INITIATED_EVENT =
  "event DepositInitiated(address l1Token, address indexed _from, address indexed _to, uint256 indexed _sequenceNumber, uint256 _amount)";
/**
 * Emitted by the L1 gateway after the Outbox executes a finalized withdrawal.
 * Filter the gateway addresses, not the Outbox address, for this event.
 */
export const WITHDRAWAL_FINALIZED_EVENT =
  "event WithdrawalFinalized(address l1Token, address indexed _from, address indexed _to, uint256 indexed _exitNum, uint256 _amount)";
