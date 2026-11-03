import { apiHandler } from "@/server/http/handler";
import { PUBLIC } from "@/server/modules/auth/auth.access";
import { loginBodySchema, messageSchema, sessionTokensSchema } from "@/server/modules/auth/auth.schemas";
import { INVALID_CREDENTIALS, login, SIGN_IN_RATE_LIMIT } from "@/server/modules/auth/auth.service";

export const POST = apiHandler(
  {
    auth: PUBLIC,
    rateLimit: {
      ...SIGN_IN_RATE_LIMIT,
      // The key includes the username: limiting by IP alone lets one office share the budget, and
      // by username alone lets one IP sweep every account.
      keyGenerator: (request) => `${request.ip}:${(request.body as { username?: string } | undefined)?.username ?? ""}`,
    },
    tags: ["auth"],
    summary: "Autentica e devolve o par de tokens",
    body: loginBodySchema,
    response: { 200: sessionTokensSchema, 401: messageSchema },
  },
  async (request, reply) => {
    const tokens = await login(request.body);

    // The same answer for an unknown username and for a wrong password: telling them apart would
    // turn the login route into a directory of who exists.
    if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

    return reply.send(tokens);
  },
);
