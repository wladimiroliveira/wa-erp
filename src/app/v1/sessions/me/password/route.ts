import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { changeOwnPasswordBodySchema, messageSchema } from "@/server/modules/auth/auth.schemas";
import { changeOwnPassword, INVALID_CREDENTIALS } from "@/server/modules/auth/auth.service";

export const PATCH = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["auth"],
    summary: "Troca a própria senha",
    body: changeOwnPasswordBodySchema,
    response: { 204: z.void(), 401: messageSchema },
  },
  async (request, reply) => {
    const changed = await changeOwnPassword(request.currentUser!.id, request.body);

    if (!changed) return reply.code(401).send(INVALID_CREDENTIALS);

    return reply.code(204).send();
  },
);
