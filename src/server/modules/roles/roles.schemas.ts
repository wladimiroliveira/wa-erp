import { z } from "zod";
import { permissionSchema } from "@/shared/enums";

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(permissionSchema),
});

export const createRoleBodySchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(permissionSchema),
});

export const updateRoleBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    permissions: z.array(permissionSchema).optional(),
  })
  .refine((body) => body.name !== undefined || body.permissions !== undefined, {
    message: "Nothing to update.",
  });

export const roleIdParamsSchema = z.object({ id: z.uuid() });
