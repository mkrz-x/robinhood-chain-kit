/**
 * The five-line viem integration: extend a public client with the kit's
 * actions and ask for a composed quote. `getEquityQuote` resolves the symbol
 * through Robinhood's own registry, matches the Chainlink feed, reads the
 * round, the authoritative multiplier, and the pause flag, and attaches the
 * US session context and the fail-closed health verdict.
 *
 * A quote is a REPORT, not a green light: with no sequencer source supplied,
 * `health.usable` stays false with `sequencer-state-unknown` — the honest
 * remaining unknown, printed rather than papered over.
 */
import { robinhoodChain } from "robinhood-chain-kit";
import { robinhoodChainActions } from "robinhood-chain-kit/viem";
import { createPublicClient, http } from "viem";

const client = createPublicClient({ chain: robinhoodChain, transport: http() }).extend(
  robinhoodChainActions(),
);

const quote = await client.getEquityQuote(process.env.SYMBOL ?? "AAPL");

console.log(`${quote.symbol} (${quote.tokenAddress})`);
console.log(`  token price  ${quote.tokenPrice.formatted}  (what the feed answers: multiplier included)`);
console.log(`  share price  ${quote.sharePrice.formatted}  (feed / multiplier — the docs' direction)`);
console.log(`  multiplier   ${quote.multiplier} (1e18-scaled, read from the contract)`);
console.log(`  schedule     ${quote.schedule.status}`);
console.log(`  session      ${quote.session.phase} (${quote.session.reason}) — feeds publish 24/5 regardless`);
console.log(`  pause        ${quote.pauseState}`);
console.log(`  usable       ${quote.health.usable}${quote.health.issues.length ? `  issues: ${quote.health.issues.join(", ")}` : ""}`);
