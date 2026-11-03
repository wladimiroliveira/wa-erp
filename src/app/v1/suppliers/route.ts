import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { listSuppliers } from "@/server/modules/suppliers/suppliers.repository";
import { createSupplierBodySchema, supplierSchema } from "@/server/modules/suppliers/suppliers.schemas";
import { createSupplier } from "@/server/modules/suppliers/suppliers.service";

export const GET = apiHandler(
  {
    auth: Permission.CATALOG_READ,
    tags: ["suppliers"],
    summary: "Lista os fornecedores",
    response: { 200: z.array(supplierSchema) },
  },
  async (_request, reply) => reply.send(await listSuppliers()),
);

export const POST = apiHandler(
  {
    auth: Permission.CATALOG_CREATE,
    tags: ["suppliers"],
    summary: "Cadastra um fornecedor",
    body: createSupplierBodySchema,
    response: { 201: supplierSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await createSupplier(request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
