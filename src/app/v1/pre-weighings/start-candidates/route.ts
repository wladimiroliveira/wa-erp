import { Permission } from "@prisma/client";
import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { startCandidateSchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { listStartCandidates } from "@/server/modules/pre-weighings/pre-weighings.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["pre-weighings"],
    summary: "Lista as pré-pesagens pendentes de onde uma produção guiada pode partir",
    response: { 200: z.array(startCandidateSchema) },
  },
  async (_request, reply) => reply.send(await listStartCandidates()),
);
