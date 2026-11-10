import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER, SESSION_COOKIE } from "@/server/auth/proxy-contract";
import { SESSION_ENDED_PATH, SIGN_IN_PATH, signInUrl } from "@/shared/sign-in";

/**
 * Keeps anonymous visitors out of the screens and signed-in ones out of the sign-in screen. It
 * only looks at whether the cookie is there: whether it still opens a session is the layout's
 * question, answered against the database once per request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasCookie = request.cookies.has(SESSION_COOKIE);

  // Where a stale cookie is dropped: it must be reached with the cookie, and harmlessly without it.
  if (pathname === SESSION_ENDED_PATH) return NextResponse.next();

  if (pathname === SIGN_IN_PATH) {
    return hasCookie ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  const requestedPath = `${pathname}${search}`;

  if (!hasCookie) return NextResponse.redirect(new URL(signInUrl(requestedPath), request.url));

  // Set here, over whatever the client sent, so the render can trust it as the way back.
  const headers = new Headers(request.headers);

  headers.set(REQUEST_PATH_HEADER, requestedPath);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything but the API, Next's own assets and the files in `public`.
  matcher: ["/((?!v1|_next|favicon\\.svg).*)"],
};
