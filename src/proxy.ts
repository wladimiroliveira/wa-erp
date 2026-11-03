import { NextResponse, type NextRequest } from "next/server";
import { SIGN_IN_RETURN_PARAM } from "@/features/auth/LoginPage";
import { SESSION_COOKIE } from "@/server/auth/session";

const SIGN_IN_PATH = "/login";

/**
 * Keeps anonymous visitors out of the screens and signed-in ones out of the sign-in screen. It
 * only looks at whether the cookie is there: whether it still opens a session is the layout's
 * question, answered against the database once per request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasCookie = request.cookies.has(SESSION_COOKIE);

  if (pathname === SIGN_IN_PATH) {
    return hasCookie ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (hasCookie) return NextResponse.next();

  const signIn = new URL(SIGN_IN_PATH, request.url);

  signIn.searchParams.set(SIGN_IN_RETURN_PARAM, `${pathname}${search}`);

  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything but the API, Next's own assets and the files in `public`.
  matcher: ["/((?!v1|_next|favicon\\.svg).*)"],
};
