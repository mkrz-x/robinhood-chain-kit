/** Is the US equity regular session open right now?
 *
 * Why you care on this chain: tokenized stocks trade 24/7 on the DEX while
 * Chainlink equity feeds freeze outside market hours — a growing gap after
 * the close is EXPECTED, not an arb.
 *
 *   npx tsx market-session.mts
 */
import { isUsEquityMarketOpen } from "robinhood-chain-kit";

const now = Math.floor(Date.now() / 1000);
const open = isUsEquityMarketOpen(now);
console.log(`US equity regular session: ${open ? "OPEN" : "CLOSED"}`);
console.log(
  open
    ? "equity oracle prices are live — DEX vs quote divergence is meaningful"
    : "equity oracles are frozen at the last print — DEX drift is normal",
);
