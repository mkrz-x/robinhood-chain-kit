/**
 * Report US regular-session context.
 *
 * Feed freshness is intentionally separate: Robinhood Stock Token feeds use
 * a documented 24/5 schedule, so inspect updatedAt/heartbeat and pause state.
 */
import { getUsEquityMarketSession } from "robinhood-chain-kit";

const now = Date.now() / 1000;
const session = getUsEquityMarketSession(now);
console.log(`US equity regular session: ${session.phase.toUpperCase()}`);
console.log(`reason: ${session.reason}${session.holiday ? ` (${session.holiday})` : ""}`);
console.log("Do not infer oracle freshness from this result; validate the feed heartbeat separately.");
