import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  preWeighingPlanQuerySchema,
  preWeighingPlanSchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { previewPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["pre-weighings"],
    summary: "Calcula quanto pesar de cada ingrediente para produzir uma quantidade",
    query: preWeighingPlanQuerySchema,
    response: { 200: preWeighingPlanSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await previewPreWeighing(request.query.productSku, request.query.quantity);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
