import { apiHandler } from "@/server/http/handler";
import { PUBLIC } from "@/server/modules/auth/auth.access";
import { messageSchema, refreshBodySchema, sessionTokensSchema } from "@/server/modules/auth/auth.schemas";
import { INVALID_CREDENTIALS, refreshSession } from "@/server/modules/auth/auth.service";

export const POST = apiHandler(
  {
    auth: PUBLIC,
    tags: ["auth"],
    summary: "Rotaciona o par de tokens",
    body: refreshBodySchema,
    response: { 200: sessionTokensSchema, 401: messageSchema },
  },
  async (request, reply) => {
    const tokens = await refreshSession(request.body.refreshToken);

    if (tokens === null) return reply.code(401).send(INVALID_CREDENTIALS);

    return reply.send(tokens);
  },
);
