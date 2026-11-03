import type { StockMovementType } from "@/lib/api";

type Direction = { label: string; sign: "+" | "−"; badge: "secondary" | "outline" };

const IN: Direction = { label: "Entrada", sign: "+", badge: "secondary" };
const OUT: Direction = { label: "Saída", sign: "−", badge: "outline" };

// The API stores every quantity as a positive number; the type is what says whether
// it came into the stock or left it, and where it came from.
const MOVEMENT_TYPES: Record<StockMovementType, { origin: string; direction: Direction }> = {
  ENTRY: { origin: "Lançamento de entrada", direction: IN },
  PRODUCTION_CONSUMPTION: { origin: "Consumo na produção", direction: OUT },
  PRODUCTION_OUTPUT: { origin: "Produção", direction: IN },
  // Brings a negative balance back to zero, so it adds what was owed.
  BALANCE_ADJUSTMENT: { origin: "Ajuste de saldo", direction: IN },
  LOSS: { origin: "Avaria", direction: OUT },
};

/** What made the stock move: an entry, a production, a loss. */
export function movementOrigin(type: StockMovementType): string {
  return MOVEMENT_TYPES[type].origin;
}

/** Whether the movement came into the stock or left it. */
export function movementDirection(type: StockMovementType): Direction {
  return MOVEMENT_TYPES[type].direction;
}
