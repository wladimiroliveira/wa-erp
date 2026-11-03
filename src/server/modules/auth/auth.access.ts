import { Permission } from "@prisma/client";

export const PUBLIC = "public" as const;
export const AUTHENTICATED = "authenticated" as const;

export type AccessRule = typeof PUBLIC | typeof AUTHENTICATED | Permission;

export type AuthenticatedUser = { id: string; permissions: Permission[] };
export type AuthenticatedUserLoader = (userId: string) => Promise<AuthenticatedUser | null>;
