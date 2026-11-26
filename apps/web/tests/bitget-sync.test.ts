import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { fetchBitgetHistory } from "../src/server/bitget";

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
