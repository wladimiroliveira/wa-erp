import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { createEntryBodySchema, entryConflictSchema, entrySchema } from "@/server/modules/entries/entries.schemas";
import { recordEntry } from "@/server/modules/entries/entries.service";

export const POST = apiHandler(
  {
    auth: Permission.ENTRIES_CREATE,
    tags: ["entries"],
    summary: "Lança a entrada de um produto, na unidade dele ou em embalagens, e soma ao estoque",
    body: createEntryBodySchema,
    response: { 201: entrySchema, 400: messageSchema, 404: messageSchema, 409: entryConflictSchema },
  },
  async (request, reply) => {
    const result = await recordEntry(request.body, request.currentUser!.id);

    if (!result.ok) {
      return result.status === 409
        ? reply.code(409).send({ message: result.message, deficit: result.deficit })
        : reply.code(result.status).send({ message: result.message });
    }

    return reply.code(201).send(result.data);
  },
);
