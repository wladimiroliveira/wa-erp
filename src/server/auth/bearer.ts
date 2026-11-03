import { loadEnv } from "@/server/lib/env";
import type { AuthenticatedUser } from "@/server/modules/auth/auth.access";
import { verifyAccessToken } from "@/server/modules/auth/auth.jwt";
import { loadAuthenticatedUser } from "@/server/modules/auth/auth.repository";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (header === null || !header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();

  return token === "" ? null : token;
}

/** Who the access token of the request belongs to, or null for no token, a bad one, or one of nobody. */
export async function authenticateBearer(request: Request): Promise<AuthenticatedUser | null> {
  const token = bearerToken(request);

  if (token === null) return null;

  const env = loadEnv();
  const payload = await verifyAccessToken({ secret: env.JWT_SECRET, ttlMinutes: env.ACCESS_TOKEN_TTL_MINUTES }, token);

  if (payload === null) return null;

  return loadAuthenticatedUser(payload.sub);
}
