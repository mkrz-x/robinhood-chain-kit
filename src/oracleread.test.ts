import { describe, expect, it } from "vitest";
import {
  checkOracleHealth,
  readOracleRound,
  readOracleRounds,
  readSequencerUptime,
} from "./oracleread.js";
import type { MinimalContractCall, MinimalPublicClient } from "./client.js";

const FEED = "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0";
const OTHER_FEED = "0x2222222222222222222222222222222222222222";
const TOKEN = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";

type Tuple = readonly [bigint, bigint, bigint, bigint, bigint];

const roundTuple = (answer: bigint, updatedAt: bigint): Tuple => [
  10n,
  answer,
  updatedAt,
  updatedAt,
  10n,
];

const feedClient = (rounds: Record<string, Tuple | Error>): MinimalPublicClient => ({
  readContract: async ({ address, functionName }: MinimalContractCall) => {
    expect(functionName).toBe("latestRoundData");
    const entry = rounds[address.toLowerCase()];
    if (!entry) throw new Error(`execution reverted at ${address}`);
    if (entry instanceof Error) throw entry;
    return entry;
  },
});

describe("readOracleRound", () => {
  it("executes latestRoundData and normalizes the tuple", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(12_345_678_900n, 1_000n) });
    const round = await readOracleRound(client, FEED);
    expect(round).toEqual({
      roundId: 10n,
      answer: 12_345_678_900n,
      startedAtSeconds: 1_000n,
      updatedAtSeconds: 1_000n,
      answeredInRound: 10n,
    });
  });

  it("accepts a directory entry as the feed reference", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(1n, 1n) });
    const round = await readOracleRound(client, { proxyAddress: FEED });
    expect(round.answer).toBe(1n);
  });

  it("throws on a revert — a bad address should be checked, not retried", async () => {
    const client = feedClient({});
    await expect(readOracleRound(client, FEED)).rejects.toThrow(/execution reverted/);
  });

  it("throws on a malformed tuple rather than normalizing garbage", async () => {
    const client: MinimalPublicClient = { readContract: async () => [1n, 2n] };
    await expect(readOracleRound(client, FEED)).rejects.toThrow(TypeError);
  });

  it("rejects an invalid feed address before touching the client", async () => {
    const client = feedClient({});
    await expect(readOracleRound(client, "0xbad")).rejects.toThrow(TypeError);
  });
});

describe("readOracleRounds isolates per-feed failures", () => {
  it("one dead proxy does not sink the batch, and order is preserved", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(5n, 7n) });
    const results = await readOracleRounds(client, [FEED, OTHER_FEED]);
    expect(results[0]).toMatchObject({ status: "success", feed: FEED });
    if (results[0]!.status === "success") expect(results[0]!.round.answer).toBe(5n);
    expect(results[1]).toMatchObject({ status: "error", feed: OTHER_FEED });
  });
});

describe("readSequencerUptime fails closed", () => {
  it("answer 0 is up, carrying startedAt and the grace period", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(0n, 500n) });
    expect(await readSequencerUptime(client, FEED, { gracePeriodSeconds: 120 })).toEqual({
      status: "up",
      sinceSeconds: 500n,
      gracePeriodSeconds: 120,
    });
  });

  it("defaults the grace period to Chainlink's documented 3600 seconds", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(0n, 500n) });
    const state = await readSequencerUptime(client, FEED);
    expect(state).toMatchObject({ status: "up", gracePeriodSeconds: 3600 });
  });

  it("answer 1 is down", async () => {
    const client = feedClient({ [FEED.toLowerCase()]: roundTuple(1n, 500n) });
    expect(await readSequencerUptime(client, FEED)).toEqual({ status: "down" });
  });

  it("any other answer, and any revert, is unknown — never up", async () => {
    const weird = feedClient({ [FEED.toLowerCase()]: roundTuple(2n, 500n) });
    expect(await readSequencerUptime(weird, FEED)).toEqual({ status: "unknown" });
    const dead = feedClient({});
    expect(await readSequencerUptime(dead, FEED)).toEqual({ status: "unknown" });
  });

  it("rejects an invalid aggregator address as a caller bug", async () => {
    await expect(readSequencerUptime(feedClient({}), "nope")).rejects.toThrow(TypeError);
  });
});

describe("checkOracleHealth gathers what assessOracleHealth demands", () => {
  const feed = { proxyAddress: FEED as `0x${string}`, decimals: 8, heartbeatSeconds: 86_400 };

  const liveClient = (pause: boolean | Error = false): MinimalPublicClient => ({
    readContract: async ({ address, functionName }: MinimalContractCall) => {
      if (functionName === "latestRoundData" && address.toLowerCase() === FEED.toLowerCase()) {
        return roundTuple(12_345_678_900n, 1_000n);
      }
      if (functionName === "latestRoundData" && address.toLowerCase() === OTHER_FEED.toLowerCase()) {
        return roundTuple(0n, 500n); // sequencer uptime: up since 500
      }
      if (functionName === "oraclePaused" && address.toLowerCase() === TOKEN.toLowerCase()) {
        if (pause instanceof Error) throw pause;
        return pause;
      }
      throw new Error(`unexpected call ${functionName} at ${address}`);
    },
  });

  it("reaches usable: true on live-shaped data with every input supplied", async () => {
    const { health, round, pauseState, sequencer } = await checkOracleHealth(liveClient(), {
      feed,
      token: TOKEN,
      sequencerFeed: OTHER_FEED,
      sequencerGracePeriodSeconds: 60,
      nowSeconds: 1_200,
    });
    expect(round.answer).toBe(12_345_678_900n);
    expect(pauseState).toBe("active");
    expect(sequencer).toEqual({ status: "up", sinceSeconds: 500n, gracePeriodSeconds: 60 });
    expect(health.usable).toBe(true);
    expect(health.formattedAnswer).toBe("123.45678900");
  });

  it("with no sequencer source the one issue is sequencer-state-unknown — honest, not a bug", async () => {
    const { health } = await checkOracleHealth(liveClient(), {
      feed,
      token: TOKEN,
      nowSeconds: 1_200,
    });
    expect(health.usable).toBe(false);
    expect(health.issues).toEqual(["sequencer-state-unknown"]);
  });

  it("a paused token blocks the verdict", async () => {
    const { health, pauseState } = await checkOracleHealth(liveClient(true), {
      feed,
      token: TOKEN,
      sequencer: { status: "up", sinceSeconds: 500, gracePeriodSeconds: 60 },
      nowSeconds: 1_200,
    });
    expect(pauseState).toBe("paused");
    expect(health.issues).toContain("corporate-action-paused");
  });

  it("a token whose pause flag reverts degrades to unknown, which fails closed", async () => {
    const { health, pauseState } = await checkOracleHealth(
      liveClient(new Error("execution reverted")),
      {
        feed,
        token: TOKEN,
        sequencer: { status: "up", sinceSeconds: 500, gracePeriodSeconds: 60 },
        nowSeconds: 1_200,
      },
    );
    expect(pauseState).toBe("unknown");
    expect(health.issues).toContain("pause-state-unknown");
  });

  it("caller-known pauseState substitutes for a token read", async () => {
    const { health } = await checkOracleHealth(liveClient(), {
      feed,
      pauseState: "not-applicable",
      sequencer: { status: "up", sinceSeconds: 500, gracePeriodSeconds: 60 },
      nowSeconds: 1_200,
    });
    expect(health.usable).toBe(true);
  });

  it("refuses two sources of the same truth", async () => {
    await expect(
      checkOracleHealth(liveClient(), { feed, token: TOKEN, pauseState: "active" }),
    ).rejects.toThrow(/token or pauseState/);
    await expect(
      checkOracleHealth(liveClient(), {
        feed,
        sequencerFeed: OTHER_FEED,
        sequencer: { status: "unknown" },
      }),
    ).rejects.toThrow(/sequencerFeed or sequencer/);
  });

  it("a stale round stays blocked no matter what the other inputs say", async () => {
    const { health } = await checkOracleHealth(liveClient(), {
      feed: { ...feed, heartbeatSeconds: 10 },
      token: TOKEN,
      sequencer: { status: "up", sinceSeconds: 500, gracePeriodSeconds: 60 },
      nowSeconds: 1_000_000,
    });
    expect(health.usable).toBe(false);
    expect(health.issues).toContain("stale");
  });
});
