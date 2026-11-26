import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { fetchBitgetHistory } from "../src/server/bitget";
import { bitgetDnsFallback } from "../src/server/bitget-network";

const credentials = { apiKey: "test-key", apiSecret: "test-secret", passphrase: "test-passphrase" };
const fill = {
  symbol: "BTCUSDT",
  side: "buy",
  priceAvg: "100",
  size: "2",
  cTime: String(Date.now() - 1000),
  feeDetail: { feeCoin: "BTC", totalFee: "-0.01" },
};

it("signs spot requests, paginates by trade ID, and keeps distinct fills", async () => {
  const fills = Array.from({ length: 100 }, (_, index) => ({
    ...fill,
    tradeId: String(101 - index),
  }));
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(Response.json({ code: "00000", data: fills }));
  request.mockResolvedValueOnce(
    Response.json({
      code: "00000",
      data: [fills[99], { ...fill, tradeId: "1" }, { ...fill, tradeId: "3a", symbol: "ETHBTC" }],
    }),
  );
  const result = await fetchBitgetHistory(credentials, undefined, request);
  const [target, init] = request.mock.calls[0]!;
  const url = new URL(String(target));
  const headers = new Headers(init?.headers);
  expect(url.pathname).toBe("/api/v2/spot/trade/fills");
  expect(headers.get("ACCESS-SIGN")).toBe(
    createHmac("sha256", credentials.apiSecret)
      .update(`${headers.get("ACCESS-TIMESTAMP")}GET${url.pathname}${url.search}`)
      .digest("base64"),
  );
  expect(new URL(String(request.mock.calls[1]?.[0])).searchParams.get("idLessThan")).toBe("2");
  expect(result).toMatchObject({ skipped: 1 });
  expect(result.trades).toHaveLength(101);
  expect(result.trades[0]).toMatchObject({ quantity: 2, fee: 1, assetClass: "crypto" });
});

it("keeps hedged futures closes on the correct position side", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      code: "00000",
      data: {
        fillList: [
          {
            ...fill,
            tradeId: "1",
            side: "buy",
            price: "100",
            baseVolume: "2",
            tradeSide: "close",
            posMode: "hedge_mode",
          },
        ],
      },
    }),
  );
  const result = await fetchBitgetHistory(
    { ...credentials, market: "USDT-FUTURES" },
    new Date(Date.now() - 86400000).toISOString(),
    request,
  );
  expect(new URL(String(request.mock.calls[0]?.[0])).searchParams.get("productType")).toBe(
    "USDT-FUTURES",
  );
  expect(result.trades[0]).toMatchObject({
    side: "buy",
    positionSide: "short",
    positionEffect: "close",
    assetClass: "futures",
  });
});

it("retries a refused connection with resolved DNS and uses it for the rest of the sync", async () => {
  const fills = Array.from({ length: 100 }, (_, index) => ({
    ...fill,
    tradeId: String(index + 1),
  }));
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(
      new TypeError("fetch failed", {
        cause: new AggregateError([Object.assign(new Error("connect"), { code: "ECONNREFUSED" })]),
      }),
    )
    .mockResolvedValueOnce(Response.json({ code: "00000", data: fills }))
    .mockResolvedValueOnce(Response.json({ code: "00000", data: [] }));

  const result = await fetchBitgetHistory(credentials, undefined, request);

  const [initialUrl, initial] = request.mock.calls[0]!;
  const [retryUrl, retry] = request.mock.calls[1]!;
  const [nextUrl, next] = request.mock.calls[2]!;
  expect(initial).not.toHaveProperty("dispatcher");
  expect(retry).toHaveProperty("dispatcher", bitgetDnsFallback);
  expect(next).toHaveProperty("dispatcher", bitgetDnsFallback);
  expect(retryUrl).toBe(initialUrl);
  expect(new URL(String(retryUrl)).hostname).toBe("api.bitget.com");
  expect(new URL(String(nextUrl)).searchParams.get("idLessThan")).toBe("100");
  const firstTimestamp = Number(new Headers(initial?.headers).get("ACCESS-TIMESTAMP"));
  const retryTimestamp = Number(new Headers(retry?.headers).get("ACCESS-TIMESTAMP"));
  expect(retryTimestamp).toBeGreaterThan(firstTimestamp);
  expect(result.trades).toHaveLength(100);
});

it.each([401, 451])("keeps HTTP %s responses on the normal route", async (status) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
  await expect(fetchBitgetHistory(credentials, undefined, request)).rejects.toThrow(
    `HTTP ${status}`,
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("keeps certificate failures on the normal route", async () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("certificate"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
  });
  const request = vi.fn<typeof fetch>().mockRejectedValue(error);
  await expect(fetchBitgetHistory(credentials, undefined, request)).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});
