import { z } from "zod";

// Text that is optional: one left blank is the same as none.
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((text) => (text === "" ? null : text));
