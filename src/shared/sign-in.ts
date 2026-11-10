// Shared by the proxy, the server and the sign-in screen. It must stay free of "use client" and of
// imports: server code importing a client module gets references that throw, not the values below.

export const SIGN_IN_PATH = "/login";

/** Where the sign-in screen sends the operator back to, once they are in. */
export const SIGN_IN_RETURN_PARAM = "from";

/**
 * Where a cookie that no longer opens a session is dropped on the way to the sign-in screen. The
 * render cannot drop a cookie, and the proxy sends whoever has one away from the sign-in screen.
 */
export const SESSION_ENDED_PATH = "/session-ended";

const remembering = (path: string, returnTo: string | null): string =>
  returnTo === null ? path : `${path}?${new URLSearchParams({ [SIGN_IN_RETURN_PARAM]: returnTo })}`;

/** The sign-in screen, remembering where to go back to when there is somewhere. */
export function signInUrl(returnTo: string | null): string {
  return remembering(SIGN_IN_PATH, returnTo);
}

/** The way to the sign-in screen for a stale cookie, remembering where to go back to. */
export function sessionEndedUrl(returnTo: string | null): string {
  return remembering(SESSION_ENDED_PATH, returnTo);
}

// Only a path of this application is a place to go back to. An absolute address written into
// the query by someone else would turn the sign-in screen into a redirect to anywhere.
export function returnPathOf(params: URLSearchParams): string {
  const from = params.get(SIGN_IN_RETURN_PARAM);

  return from !== null && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}
