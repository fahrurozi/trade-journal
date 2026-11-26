import { listBrokers } from "@/server/sync";
import { handler, ok } from "@/server/api";

/** Broker roster used to render the connection form. */
export const GET = handler(() => ok({ brokers: listBrokers() }));
