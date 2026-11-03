import { z } from "zod";
import document from "@/../openapi.json";
import { apiHandler } from "@/server/http/handler";
import { PUBLIC } from "@/server/modules/auth/auth.access";

// Serves the checked-in document, not one built on the fly: Next bundles nothing it cannot see
// at build time, and a test keeps the file equal to what the route files declare.
export const GET = apiHandler(
  {
    auth: PUBLIC,
    tags: ["docs"],
    summary: "Documento OpenAPI desta API",
    response: { 200: z.record(z.string(), z.unknown()) },
  },
  async (_request, reply) => reply.send(document),
);
