import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productionIdParamsSchema,
  productionLeftoversQuerySchema,
  productionLeftoversSchema,
} from "@/server/modules/productions/productions.schemas";
import { previewLeftovers } from "@/server/modules/productions/productions.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["productions"],
    summary:
      "Prevê o que finalizar os itens (todos os pendentes, sem `items`) descartaria das embalagens abertas, com o estoque de agora",
    params: productionIdParamsSchema,
    query: productionLeftoversQuerySchema,
    response: { 200: productionLeftoversSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await previewLeftovers(request.params.id, request.query.items);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
