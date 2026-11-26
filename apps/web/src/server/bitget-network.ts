import { isIPv4 } from "node:net";
import { Agent } from "undici";

export const BITGET_HOST = "api.bitget.com";

const CONNECTION_ERRORS = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function isBitgetConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof AggregateError)
    return error.errors.length > 0 && error.errors.every(isBitgetConnectionFailure);
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (typeof code === "string" && CONNECTION_ERRORS.has(code)) ||
    isBitgetConnectionFailure(error.cause)
  );
}

async function resolveBitgetAddresses() {
  // The resolver receives just the Bitget hostname. The TLS connection below
  // still uses that hostname for certificate checks and SNI.
  const response = await fetch(`https://dns.google/resolve?name=${BITGET_HOST}&type=A`, {
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error("Bitget DNS lookup failed.");
  const body = (await response.json()) as {
    Status?: number;
    Answer?: { type?: number; data?: string }[];
  } | null;
  const addresses =
    body?.Status === 0 && Array.isArray(body.Answer)
      ? body.Answer.flatMap((record) =>
          record?.type === 1 && typeof record.data === "string" && isIPv4(record.data)
            ? [{ address: record.data, family: 4 }]
            : [],
        )
      : [];
  if (!addresses.length) throw new Error("Bitget DNS lookup returned no IPv4 addresses.");
  return addresses;
}

export const bitgetDnsFallback = new Agent({
  maxOrigins: 1,
  connect: {
    rejectUnauthorized: true,
    lookup(hostname, options, callback) {
      if (hostname !== BITGET_HOST) {
        callback(new Error("Unexpected hostname for the Bitget DNS lookup."), "", 4);
        return;
      }
      void resolveBitgetAddresses().then(
        (addresses) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, 4);
        },
        (error) => callback(error as Error, "", 4),
      );
    },
  },
});
