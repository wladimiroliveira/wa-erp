import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productionItemParamsSchema,
  productionSchema,
  productionSubstitutionSchema,
} from "@/server/modules/productions/productions.schemas";
import { previewSubstitution, substituteProductionItem } from "@/server/modules/productions/productions.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["productions"],
    summary: "Mostra o estoque de um intermediário contra o que os itens pendentes da produção consomem dele",
    params: productionItemParamsSchema,
    response: { 200: productionSubstitutionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await previewSubstitution({ productionId: request.params.id, itemId: request.params.itemId });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Resolve um intermediário com estoque do mesmo produto, em vez de fabricá-lo",
    params: productionItemParamsSchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await substituteProductionItem({
      productionId: request.params.id,
      itemId: request.params.itemId,
    });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
