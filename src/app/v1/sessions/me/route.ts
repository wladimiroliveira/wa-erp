import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { currentUserSchema } from "@/server/modules/auth/auth.schemas";
import { currentUserOf } from "@/server/modules/auth/auth.service";

export const GET = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["auth"],
    summary: "Usuário atual e suas permissões efetivas",
    response: { 200: currentUserSchema },
  },
  async (request, reply) => reply.send(await currentUserOf(request.currentUser!)),
);
