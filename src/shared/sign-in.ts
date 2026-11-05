// Shared by the proxy, the server and the sign-in screen. It must stay free of "use client" and of
// imports: server code importing a client module gets references that throw, not the values below.

export const SIGN_IN_PATH = "/login";

/** Where the sign-in screen sends the operator back to, once they are in. */
export const SIGN_IN_RETURN_PARAM = "from";

/** The sign-in screen, remembering where to go back to when there is somewhere. */
export function signInUrl(returnTo: string | null): string {
  if (returnTo === null) return SIGN_IN_PATH;

  return `${SIGN_IN_PATH}?${new URLSearchParams({ [SIGN_IN_RETURN_PARAM]: returnTo })}`;
}

// Only a path of this application is a place to go back to. An absolute address written into
// the query by someone else would turn the sign-in screen into a redirect to anywhere.
export function returnPathOf(params: URLSearchParams): string {
  const from = params.get(SIGN_IN_RETURN_PARAM);

  return from !== null && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}
