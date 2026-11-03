import { z } from "zod";
import { permissionSchema } from "@/shared/enums";

// The response never carries passwordHash. Building it field by field, instead of spreading the
// record, is what keeps a future column from leaking by accident.
export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
  roleId: z.uuid().nullable(),
  extraPermissions: z.array(permissionSchema),
  permissions: z.array(permissionSchema),
  isActive: z.boolean(),
});

export const createUserBodySchema = z.object({
  name: z.string().min(1).max(120),
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8),
  roleId: z.uuid().nullable().optional(),
  extraPermissions: z.array(permissionSchema).optional(),
});

export const updateUserBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    roleId: z.uuid().nullable().optional(),
    extraPermissions: z.array(permissionSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update." });

export const userIdParamsSchema = z.object({ id: z.uuid() });

export const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8),
});
