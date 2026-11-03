import { jwtVerify, SignJWT } from "jose";

// The payload carries only the subject. Permissions travel from the database on every request, so
// putting them in here would make that freshness a lie.
export type AccessTokenPayload = { sub: string; iat: number; exp: number };

export type AccessTokenOptions = { secret: string; ttlMinutes: number };

const ALGORITHM = "HS256";

const keyOf = (secret: string) => new TextEncoder().encode(secret);

export function signAccessToken(options: AccessTokenOptions, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${options.ttlMinutes}m`)
    .sign(keyOf(options.secret));
}

export async function verifyAccessToken(
  options: AccessTokenOptions,
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(options.secret), { algorithms: [ALGORITHM] });

    if (payload.sub === undefined || payload.iat === undefined || payload.exp === undefined) return null;

    return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}
