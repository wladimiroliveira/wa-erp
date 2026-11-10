import { Prisma } from "@prisma/client";

/** Whether a write was refused by a unique index: a concurrent write took the value first. */
export const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Whether a write was refused by a foreign key: what it points to was removed meanwhile. */
export const isForeignKeyViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
