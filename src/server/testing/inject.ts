import type { RouteHandler } from "@/server/http/handler";
import type { Method } from "@/server/routes";

/** A `route.ts` module, as `import("@/app/v1/.../route")` gives it. */
export type RouteModule = Partial<Record<Method, RouteHandler>>;

export type InjectOptions = {
  method: Method;
  url: string;
  /** The dynamic segments of the route's path, as Next would hand them over. */
  params?: Record<string, string>;
  /** Appended to the url as a query string; a value given as an array is repeated. */
  query?: Record<string, string | string[] | number | undefined>;
  /** An object is sent as JSON; a string goes as it is, for a test about a body that is not JSON. */
  payload?: unknown;
  headers?: Record<string, string>;
};

export type InjectResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json<T = any>(): T;
};

/** Calls a route handler in memory the way Next calls it: no port, no network. */
export async function inject(module: RouteModule, options: InjectOptions): Promise<InjectResponse> {
  const { method, url, params = {}, query, payload, headers = {} } = options;
  const handler = module[method];

  if (handler === undefined) throw new Error(`The route module exports no ${method} handler.`);

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of [value].flat()) if (item !== undefined) search.append(key, String(item));
  }

  const target = search.size === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}${search}`;
  const body = payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload);
  const request = new Request(`http://localhost${target}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body,
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.text();

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: text,
    json: () => JSON.parse(text),
  };
}
