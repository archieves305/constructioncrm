import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Pool sizing is deliberate, not decoration.
 *
 * This app shares one Postgres cluster with the rest of the CareyOS fleet, and
 * that cluster runs close to its connection ceiling. Passing only a connection
 * string inherits the node-postgres defaults — `min: 0` and a 10s idle timeout
 * — which means every connection is handed back ten seconds after the last
 * query. Sibling apps hold theirs open for days, so the slots we release are
 * gone by the time the next request needs one, and this app was reliably the
 * one failing with P2037 TooManyConnections while the others stayed up.
 *
 * `min` keeps a small floor of connections that the idle reaper will not take
 * (pg-pool only closes idle clients above `min`), so a request no longer races
 * the whole fleet for a slot. `max` stays modest: the fix is to stop dropping
 * connections, not to hoard a bigger share of a scarce resource.
 */
const POOL = {
  max: 8,
  min: 2,
  idleTimeoutMillis: 60_000,
  // Fail fast when the cluster really is full. Without this a saturated pool
  // waits indefinitely and the request hangs instead of erroring.
  connectionTimeoutMillis: 5_000,
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    ...POOL,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
