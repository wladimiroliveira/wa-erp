import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { PUBLIC } from "@/server/modules/auth/auth.access";

export const GET = apiHandler(
  {
    auth: PUBLIC,
    tags: ["health"],
    summary: "Saúde do serviço",
    response: { 200: z.object({ status: z.string() }) },
  },
  async (_request, reply) => reply.send({ status: "ok" }),
);
