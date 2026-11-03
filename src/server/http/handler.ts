import type { z } from "zod";
import type { Permission } from "@prisma/client";
import { authenticateBearer } from "@/server/auth/bearer";
import { AUTHENTICATED, PUBLIC, type AccessRule, type AuthenticatedUser } from "@/server/modules/auth/auth.access";
import { hasPermission } from "@/server/modules/auth/auth.permissions";
import { rateLimiter, type RateLimitRule } from "./rate-limit";

/** The body of each status a route may answer with, as the schema it is serialized through. */
export type ResponseSchemas = Partial<Record<number, z.ZodType>>;

/** What a handler hands back: a status and the body to serialize under that status's schema. */
export type Sent = { readonly status: number; readonly body: unknown };

type BodyOf<R extends ResponseSchemas, S extends number> = S extends keyof R
  ? NonNullable<R[S]> extends z.ZodType
    ? z.input<NonNullable<R[S]>>
    : never
  : never;

/** Builds the answer. `send` alone answers 200; `code` picks another declared status first. */
export interface Reply<R extends ResponseSchemas> {
  send(body: BodyOf<R, 200>): Sent;
  code<S extends keyof R & number>(status: S): { send(body: BodyOf<R, S>): Sent };
}

const reply: Reply<ResponseSchemas> = {
  send: (body) => ({ status: 200, body }),
  code: (status) => ({ send: (body) => ({ status, body }) }),
};

type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerRequest<Params, Query, Body> {
  params: Params;
  query: Query;
  body: Body;
  /** Who is calling, once the access rule is anything but PUBLIC. */
  currentUser?: AuthenticatedUser;
  ip: string;
  headers: Headers;
}

export type HandlerRateLimit = RateLimitRule & {
  /** Who the budget belongs to; runs after validation, so it may read the body. */
  keyGenerator: (request: HandlerRequest<unknown, unknown, unknown>) => string;
};

/** What a route declares about itself. The method is the export's name and the path is the file's. */
export interface HandlerSpec<
  Params extends z.ZodType | undefined,
  Query extends z.ZodType | undefined,
  Body extends z.ZodType | undefined,
  Responses extends ResponseSchemas,
> {
  /**
   * Required, never defaulted: a route with no declared access is a route nobody decided about,
   * and the type system refusing it beats an endpoint quietly open in production.
   */
  auth: AccessRule;
  tags: string[];
  summary: string;
  params?: Params;
  query?: Query;
  body?: Body;
  response: Responses;
  rateLimit?: HandlerRateLimit;
}

/** A declaration with its schemas erased, as the documentation reads it. */
export type Spec = HandlerSpec<z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined, ResponseSchemas>;

/** The context Next hands a route handler: the dynamic segments of the file's path. */
export type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

export type RouteHandler = ((request: Request, context: RouteContext) => Promise<Response>) & { spec: Spec };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (body === undefined || status === 204) return new Response(null, { status, headers });

  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

const unauthorized = () => json(401, { message: "Authentication required." });
const forbidden = () => json(403, { message: "Permission denied." });

const badRequest = (message: string) => json(400, { statusCode: 400, error: "Bad Request", message });

const validationMessage = (where: string, error: z.ZodError) =>
  `${where}/${error.issues.map((issue) => `${issue.path.join("/")} ${issue.message}`).join(", ")}`;

/** The address the request came from: the first hop the proxy recorded, or the socket when there is none. */
function ipOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  return forwarded?.split(",")[0]?.trim() || "127.0.0.1";
}

/** A parameter repeated in the query string arrives as an array, one written once as a string. */
function queryOf(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams) {
    const current = query[key];

    query[key] = current === undefined ? value : [current, value].flat();
  }

  return query;
}

type ParsedBody = { ok: true; body: unknown } | { ok: false; response: Response };

async function bodyOf(request: Request): Promise<ParsedBody> {
  const text = await request.text();

  if (text === "") return { ok: true, body: undefined };

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: badRequest("Body is not valid JSON.") };
  }
}

async function authorize(request: Request, rule: AccessRule): Promise<{ user?: AuthenticatedUser } | Response> {
  if (rule === PUBLIC) return {};

  const user = await authenticateBearer(request);

  if (user === null) return unauthorized();

  if (rule !== AUTHENTICATED && !hasPermission(user.permissions, rule as Permission)) return forbidden();

  return { user };
}

function serialize(spec: Spec, sent: Sent): Response {
  const schema = spec.response[sent.status];

  if (schema === undefined) return json(sent.status, sent.body);

  // Serializing through the declared schema is what keeps a field nobody declared from leaking,
  // the way the previous API's serializer did.
  const result = schema.safeParse(sent.body);

  if (!result.success) {
    console.error("Response does not match its schema", result.error.issues);

    return json(500, {
      statusCode: 500,
      error: "Internal Server Error",
      message: "Response does not match its schema.",
    });
  }

  return json(sent.status, result.data);
}

/**
 * Turns a declaration and a handler into a Next route handler: authorize, validate, run, serialize.
 * The declaration stays on the returned function, for the OpenAPI document to read.
 */
export function apiHandler<
  Params extends z.ZodType | undefined = undefined,
  Query extends z.ZodType | undefined = undefined,
  Body extends z.ZodType | undefined = undefined,
  Responses extends ResponseSchemas = ResponseSchemas,
>(
  spec: HandlerSpec<Params, Query, Body, Responses>,
  handler: (
    request: HandlerRequest<Parsed<Params>, Parsed<Query>, Parsed<Body>>,
    reply: Reply<Responses>,
  ) => Promise<Sent> | Sent,
): RouteHandler {
  const erased = spec as unknown as Spec;

  async function handle(request: Request, context: RouteContext): Promise<Response> {
    try {
      const access = await authorize(request, erased.auth);

      if (access instanceof Response) return access;

      const parsedParams = erased.params?.safeParse(await context.params);

      if (parsedParams?.success === false) return badRequest(validationMessage("params", parsedParams.error));

      const parsedQuery = erased.query?.safeParse(queryOf(new URL(request.url)));

      if (parsedQuery?.success === false) return badRequest(validationMessage("query", parsedQuery.error));

      const raw = request.method === "GET" ? { ok: true as const, body: undefined } : await bodyOf(request);

      if (!raw.ok) return raw.response;

      const parsedBody = erased.body?.safeParse(raw.body);

      if (parsedBody?.success === false) return badRequest(validationMessage("body", parsedBody.error));

      const handlerRequest: HandlerRequest<unknown, unknown, unknown> = {
        params: parsedParams?.data,
        query: parsedQuery?.data,
        body: parsedBody?.data,
        currentUser: access.user,
        ip: ipOf(request),
        headers: request.headers,
      };

      if (erased.rateLimit !== undefined) {
        const budget = rateLimiter.consume(erased.rateLimit.keyGenerator(handlerRequest), erased.rateLimit);

        if (!budget.allowed) {
          const retryAfter = Math.ceil(budget.retryAfterMs / 1000);

          return json(
            429,
            {
              statusCode: 429,
              error: "Too Many Requests",
              message: `Rate limit exceeded, retry in ${retryAfter} seconds`,
            },
            { "retry-after": String(retryAfter) },
          );
        }
      }

      const sent = await handler(
        handlerRequest as HandlerRequest<Parsed<Params>, Parsed<Query>, Parsed<Body>>,
        reply as unknown as Reply<Responses>,
      );

      return serialize(erased, sent);
    } catch (error) {
      console.error("Unhandled error in route handler", error);

      return json(500, { statusCode: 500, error: "Internal Server Error", message: "Internal server error." });
    }
  }

  return Object.assign(handle, { spec: erased });
}
