import type {
  MeasurementUnit as PrismaMeasurementUnit,
  Permission as PrismaPermission,
  ProductKind as PrismaProductKind,
  ProductionStatus as PrismaProductionStatus,
  StockMovementType as PrismaStockMovementType,
} from "@prisma/client";
import { z } from "zod";

// The enums the client and the server share. Only the types are taken from Prisma: its runtime
// client must stay out of the browser bundle, and a test keeps these lists equal to the database's.

export const PERMISSIONS = [
  "CATALOG_READ",
  "CATALOG_CREATE",
  "CATALOG_UPDATE",
  "ENTRIES_READ",
  "ENTRIES_CREATE",
  "PRODUCTION_READ",
  "PRODUCTION_CREATE",
  "SALES_READ",
  "SALES_CREATE",
  "REPORTS_READ",
  "PRICING_READ",
  "PRICING_UPDATE",
  "LOSSES_CREATE",
  "LOSSES_UPDATE",
  "ACCESS_READ",
  "ACCESS_CREATE",
  "ACCESS_UPDATE",
] as const satisfies readonly PrismaPermission[];

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];

export const PRODUCT_KINDS = ["GOODS", "MANUFACTURED"] as const satisfies readonly PrismaProductKind[];

export const productKindSchema = z.enum(PRODUCT_KINDS);
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const MEASUREMENT_UNITS = [
  "UNIT",
  "KILOGRAM",
  "GRAM",
  "LITER",
  "MILLILITER",
] as const satisfies readonly PrismaMeasurementUnit[];

export const measurementUnitSchema = z.enum(MEASUREMENT_UNITS);
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const STOCK_MOVEMENT_TYPES = [
  "ENTRY",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "BALANCE_ADJUSTMENT",
  "LOSS",
  "OPENED_LEFTOVER",
] as const satisfies readonly PrismaStockMovementType[];

export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const PRODUCTION_STATUSES = [
  "IN_PROGRESS",
  "FINISHED",
  "CANCELED",
] as const satisfies readonly PrismaProductionStatus[];

export const productionStatusSchema = z.enum(PRODUCTION_STATUSES);
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
