import {
  MeasurementUnit,
  Permission,
  ProductionItemStatus,
  ProductionStatus,
  ProductKind,
  StockMovementType,
  StockOutflowKind,
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_UNITS,
  PERMISSIONS,
  PRODUCT_KINDS,
  PRODUCTION_ITEM_STATUSES,
  PRODUCTION_STATUSES,
  STOCK_MOVEMENT_TYPES,
  STOCK_OUTFLOW_KINDS,
} from "@/shared/enums";

describe("shared enums", () => {
  it.each([
    ["permissions", PERMISSIONS, Permission],
    ["product kinds", PRODUCT_KINDS, ProductKind],
    ["measurement units", MEASUREMENT_UNITS, MeasurementUnit],
    ["stock movement types", STOCK_MOVEMENT_TYPES, StockMovementType],
    ["stock outflow kinds", STOCK_OUTFLOW_KINDS, StockOutflowKind],
    ["production statuses", PRODUCTION_STATUSES, ProductionStatus],
    ["production item statuses", PRODUCTION_ITEM_STATUSES, ProductionItemStatus],
  ])("lists exactly the %s the database knows", (_label, shared, prisma) => {
    expect([...shared].sort()).toEqual(Object.values(prisma).sort());
  });
});
