import { PrismaClient } from "@prisma/client";

// Nothing is read from the environment here: Next evaluates this module while building, on a
// machine that has no database. The first query is what reaches for DATABASE_URL, and the first
// request is what validates the environment, through `loadEnv`.
//
// In development Next re-evaluates server modules on every edit. Keeping the client on the global
// object is what stops each edit from opening one more pool of connections to the database.
const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
