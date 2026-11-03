import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { refreshBodySchema } from "@/server/modules/auth/auth.schemas";
import { logout } from "@/server/modules/auth/auth.service";

export const POST = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["auth"],
    summary: "Encerra a sessão, revogando o refresh token",
    body: refreshBodySchema,
    response: { 204: z.void() },
  },
  async (request, reply) => {
    await logout(request.body.refreshToken);

    return reply.code(204).send();
  },
);
