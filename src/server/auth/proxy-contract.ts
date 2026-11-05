// What the proxy shares with the rest of the server. The proxy runs on every request, so this
// module imports nothing: whatever it pulled in would ride along on each one.

/** The one cookie of the web: it carries the session token and nothing else. */
export const SESSION_COOKIE = "wa_session";

/** The path and query the visitor asked for, set by the proxy (never trusted from the client). */
export const REQUEST_PATH_HEADER = "x-wa-request-path";
