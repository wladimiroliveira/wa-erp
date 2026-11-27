import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { staleCountSchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { countStale } from "@/server/modules/pre-weighings/pre-weighings.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["pre-weighings"],
    summary: "Conta as pré-pesagens pendentes há mais de 48 horas",
    response: { 200: staleCountSchema },
  },
  async (_request, reply) => reply.send({ count: await countStale() }),
);
