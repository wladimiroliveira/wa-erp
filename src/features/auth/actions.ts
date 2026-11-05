"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { SESSION_COOKIE } from "@/server/auth/proxy-contract";
import { endSession, sessionCookie, startSession } from "@/server/auth/session";
import { rateLimiter } from "@/server/http/rate-limit";
import { changeOwnPasswordBodySchema, loginBodySchema } from "@/server/modules/auth/auth.schemas";
import {
  authenticate,
  changeOwnPassword as changePassword,
  SIGN_IN_RATE_LIMIT,
} from "@/server/modules/auth/auth.service";
import { fail, type Failure } from "@/server/lib/result";
import { SIGN_IN_PATH } from "@/shared/sign-in";

export type ActionResult = { ok: true } | Failure;

const INVALID_INPUT = "Invalid input.";

/** The address the request came from: the first hop the proxy recorded, or the socket when there is none. */
async function requestIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");

  return forwarded?.split(",")[0]?.trim() || "127.0.0.1";
}

async function dropSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  jar.delete(SESSION_COOKIE);

  return token;
}

export async function signIn(input: z.input<typeof loginBodySchema>): Promise<ActionResult> {
  const parsed = loginBodySchema.safeParse(input);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  // The same budget as the API's sign-in route, keyed the same way: limiting by address alone lets
  // one office share it, and by username alone lets one address sweep every account.
  const budget = rateLimiter.consume(`${await requestIp()}:${parsed.data.username}`, SIGN_IN_RATE_LIMIT);

  if (!budget.allowed) return fail(429, "Too many attempts.");

  const user = await authenticate(parsed.data);

  // The same answer for an unknown username and for a wrong password: telling them apart would
  // turn the sign-in form into a directory of who exists.
  if (user === null) return fail(401, "Invalid credentials.");

  (await cookies()).set(sessionCookie(await startSession(user.id)));

  return { ok: true };
}

export async function signOut(): Promise<never> {
  const token = await dropSessionCookie();

  if (token !== undefined) await endSession(token);

  redirect(SIGN_IN_PATH);
}

export async function changeOwnPassword(input: z.input<typeof changeOwnPasswordBodySchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = changeOwnPasswordBodySchema.safeParse(input);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const changed = await changePassword(user.id, parsed.data);

  if (!changed) return fail(401, "Invalid credentials.");

  // The service revoked every session, this one included. Dropping the cookie here is telling the
  // truth; keeping it would send the next request to the sign-in screen with no reason given.
  await dropSessionCookie();

  return { ok: true };
}
