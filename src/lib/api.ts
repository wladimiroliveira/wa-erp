import type { z } from "zod";
import type {
  changeOwnPasswordBodySchema,
  currentUserSchema,
  loginBodySchema,
} from "@/server/modules/auth/auth.schemas";
import type { createEntryBodySchema, entrySchema } from "@/server/modules/entries/entries.schemas";
import type {
  createLossBodySchema,
  createLossReasonBodySchema,
  lossReasonSchema,
  lossSchema,
  updateLossReasonBodySchema,
} from "@/server/modules/losses/losses.schemas";
import type {
  createPreWeighingBodySchema,
  preWeighingPageSchema,
  preWeighingPlanSchema,
  preWeighingSchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";
import type {
  finishProductionBodySchema,
  productionPageSchema,
  productionSchema,
  startProductionBodySchema,
} from "@/server/modules/productions/productions.schemas";
import type {
  createProductBodySchema,
  listProductsQuerySchema,
  productSchema,
  updateProductBodySchema,
} from "@/server/modules/products/products.schemas";
import type { recipeSchema, recipeSummarySchema, saveRecipeBodySchema } from "@/server/modules/recipes/recipes.schemas";
import type { createRoleBodySchema, roleSchema, updateRoleBodySchema } from "@/server/modules/roles/roles.schemas";
import type {
  productStockSchema,
  stockMovementPageSchema,
  stockMovementSchema,
  stockPositionSchema,
} from "@/server/modules/stock/stock.schemas";
import type { createSupplierBodySchema, supplierSchema } from "@/server/modules/suppliers/suppliers.schemas";
import type { tableLayoutBodySchema, tableLayoutSchema } from "@/server/modules/table-layouts/table-layouts.schemas";
import type {
  createUserBodySchema,
  resetPasswordBodySchema,
  updateUserBodySchema,
  userSchema,
} from "@/server/modules/users/users.schemas";

// The only module of the front end that names the server's shapes. They are read off the zod
// schemas the server validates with, as types only, so a screen never bundles server code and a
// field that moves there stops compiling here and nowhere else.
export type { MeasurementUnit, Permission, ProductKind, ProductionStatus, StockMovementType } from "@/shared/enums";

export type LoginBody = z.input<typeof loginBodySchema>;
export type CurrentUser = z.output<typeof currentUserSchema>;
export type ChangePasswordBody = z.input<typeof changeOwnPasswordBodySchema>;

export type TableLayout = z.output<typeof tableLayoutSchema>;
export type TableLayoutBody = z.input<typeof tableLayoutBodySchema>;

export type Role = z.output<typeof roleSchema>;
export type CreateRoleBody = z.input<typeof createRoleBodySchema>;
export type UpdateRoleBody = z.input<typeof updateRoleBodySchema>;

export type User = z.output<typeof userSchema>;
export type CreateUserBody = z.input<typeof createUserBodySchema>;
export type UpdateUserBody = z.input<typeof updateUserBodySchema>;
export type ResetPasswordBody = z.input<typeof resetPasswordBodySchema>;

export type Product = z.output<typeof productSchema>;
export type CreateProductBody = z.input<typeof createProductBodySchema>;
export type UpdateProductBody = z.input<typeof updateProductBodySchema>;
export type ProductStatus = NonNullable<z.output<typeof listProductsQuerySchema>["status"]>;

export type Supplier = z.output<typeof supplierSchema>;
export type CreateSupplierBody = z.input<typeof createSupplierBodySchema>;

export type CreateEntryBody = z.input<typeof createEntryBodySchema>;
export type Entry = z.output<typeof entrySchema>;
export type DeficitSettlement = NonNullable<CreateEntryBody["deficit"]>;

export type StockMovementPage = z.output<typeof stockMovementPageSchema>;
export type StockMovement = z.output<typeof stockMovementSchema>;

export type LossReason = z.output<typeof lossReasonSchema>;
export type CreateLossReasonBody = z.input<typeof createLossReasonBodySchema>;
export type UpdateLossReasonBody = z.input<typeof updateLossReasonBodySchema>;
export type CreateLossBody = z.input<typeof createLossBodySchema>;
export type Loss = z.output<typeof lossSchema>;

export type StockPosition = z.output<typeof stockPositionSchema>;
export type StockItem = StockPosition["items"][number];
export type StockStatus = StockItem["status"];

export type ProductStock = z.output<typeof productStockSchema>;
export type StockLot = ProductStock["lots"][number];
export type LotStatus = StockLot["status"];

export type PreWeighingPlan = z.output<typeof preWeighingPlanSchema>;
export type CreatePreWeighingBody = z.input<typeof createPreWeighingBodySchema>;
export type PreWeighing = z.output<typeof preWeighingSchema>;
export type PreWeighingPage = z.output<typeof preWeighingPageSchema>;

export type Production = z.output<typeof productionSchema>;
export type ProductionItem = Production["items"][number];
export type ProductionPage = z.output<typeof productionPageSchema>;
export type StartProductionBody = z.input<typeof startProductionBodySchema>;
export type FinishProductionBody = z.input<typeof finishProductionBodySchema>;

export type Recipe = z.output<typeof recipeSchema>;
export type SaveRecipeBody = z.input<typeof saveRecipeBodySchema>;
export type RecipeSummary = z.output<typeof recipeSummarySchema>;
