import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { preWeighingIdParamsSchema, preWeighingSchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { getPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["pre-weighings"],
    summary: "Consulta uma pré-pesagem registrada",
    params: preWeighingIdParamsSchema,
    response: { 200: preWeighingSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await getPreWeighing(request.params.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
