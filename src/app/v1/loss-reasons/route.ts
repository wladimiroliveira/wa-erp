import { Permission } from "@prisma/client";
import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { createLossReasonBodySchema, lossReasonSchema } from "@/server/modules/losses/losses.schemas";
import { createLossReason, listLossReasons } from "@/server/modules/losses/losses.service";

export const GET = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["losses"],
    summary: "Lista as modalidades de avaria",
    response: { 200: z.array(lossReasonSchema) },
  },
  async (_request, reply) => reply.send(await listLossReasons()),
);

export const POST = apiHandler(
  {
    auth: Permission.LOSSES_UPDATE,
    tags: ["losses"],
    summary: "Cadastra uma modalidade de avaria",
    body: createLossReasonBodySchema,
    response: { 201: lossReasonSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await createLossReason(request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
