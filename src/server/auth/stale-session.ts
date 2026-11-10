import { NextResponse, type NextRequest } from "next/server";
import { returnPathOf, SIGN_IN_RETURN_PARAM, signInUrl } from "@/shared/sign-in";
import { SESSION_COOKIE } from "./proxy-contract";
import { findSessionUser } from "./session";

/**
 * Drops a session cookie that no longer opens a session and goes on to the sign-in screen, with the
 * way back. A cookie that still opens one is kept: anyone can link here, and following a link must
 * not end a session.
 */
export async function leaveStaleSession(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get(SIGN_IN_RETURN_PARAM);
  // Only a path of this application is kept; anything else is no way back at all.
  const returnTo = from !== null && returnPathOf(searchParams) === from ? from : null;
  const response = NextResponse.redirect(new URL(signInUrl(returnTo), request.url));
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (token !== undefined && (await findSessionUser(token)) === null) response.cookies.delete(SESSION_COOKIE);

  return response;
}
