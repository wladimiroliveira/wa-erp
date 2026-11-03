import { MeasurementUnit, Permission, ProductionStatus, ProductKind, StockMovementType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_UNITS,
  PERMISSIONS,
  PRODUCT_KINDS,
  PRODUCTION_STATUSES,
  STOCK_MOVEMENT_TYPES,
} from "@/shared/enums";

describe("shared enums", () => {
  it.each([
    ["permissions", PERMISSIONS, Permission],
    ["product kinds", PRODUCT_KINDS, ProductKind],
    ["measurement units", MEASUREMENT_UNITS, MeasurementUnit],
    ["stock movement types", STOCK_MOVEMENT_TYPES, StockMovementType],
    ["production statuses", PRODUCTION_STATUSES, ProductionStatus],
  ])("lists exactly the %s the database knows", (_label, shared, prisma) => {
    expect([...shared].sort()).toEqual(Object.values(prisma).sort());
  });
});
