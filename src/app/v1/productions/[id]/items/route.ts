import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { addShortageItem } from "@/server/modules/productions/production-batches.service";
import {
  addProductionItemBodySchema,
  productionIdParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Acrescenta à produção um item de um intermediário em falta, que aguarda pesagem",
    params: productionIdParamsSchema,
    body: addProductionItemBodySchema,
    response: { 201: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await addShortageItem({ productionId: request.params.id, ...request.body });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
