import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { productionIdParamsSchema, productionSchema } from "@/server/modules/productions/productions.schemas";
import { cancelProduction } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Cancela uma produção em andamento e libera as pré-pesagens que a guiavam",
    params: productionIdParamsSchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await cancelProduction(request.params.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
