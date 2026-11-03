import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  createPreWeighingBodySchema,
  listPreWeighingsQuerySchema,
  preWeighingPageSchema,
  preWeighingSchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { listPreWeighingsPage, recordPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["pre-weighings"],
    summary: "Registra a pré-pesagem dos ingredientes de um produto",
    body: createPreWeighingBodySchema,
    response: { 201: preWeighingSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await recordPreWeighing({ ...request.body, createdById: request.currentUser!.id });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["pre-weighings"],
    summary: "Lista as pré-pesagens, das mais recentes para as mais antigas",
    query: listPreWeighingsQuerySchema,
    response: { 200: preWeighingPageSchema },
  },
  async (request, reply) => reply.send(await listPreWeighingsPage(request.query)),
);
