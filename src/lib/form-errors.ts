import type { Failure } from "@/server/lib/result";

const FALLBACK = "Não foi possível concluir a operação. Tente de novo.";

const isFailure = (value: unknown): value is Failure =>
  typeof value === "object" && value !== null && (value as Failure).ok === false && "status" in value;

/**
 * The server answers in English and the interface is in Portuguese, so its message never
 * reaches the screen. The caller supplies the wording for the statuses it knows the meaning of
 * in its own context; everything else, an action that threw included, falls back to a sentence
 * that is honest without pretending to explain.
 */
export function messageForFailure(failure: unknown, byStatus: Partial<Record<number, string>> = {}): string {
  if (!isFailure(failure)) return FALLBACK;

  return byStatus[failure.status] ?? FALLBACK;
}
