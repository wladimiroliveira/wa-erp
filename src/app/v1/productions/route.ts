import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  listProductionsQuerySchema,
  productionPageSchema,
  productionSchema,
  startProductionBodySchema,
} from "@/server/modules/productions/productions.schemas";
import { listProductionsPage, startProduction } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Inicia uma produção, guiada por pré-pesagens ou livre pelas receitas",
    body: startProductionBodySchema,
    response: { 201: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await startProduction({ createdById: request.currentUser!.id, items: request.body.items });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["productions"],
    summary: "Lista as produções, das mais recentes para as mais antigas",
    query: listProductionsQuerySchema,
    response: { 200: productionPageSchema },
  },
  async (request, reply) => reply.send(await listProductionsPage(request.query)),
);
