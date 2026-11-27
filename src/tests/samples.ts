import type {
  CurrentUser,
  Entry,
  Loss,
  Outflow,
  OutflowSummary,
  LossReason,
  PreWeighing,
  PreWeighingPlan,
  PriceEntry,
  PricingRow,
  Packaging,
  Product,
  Production,
  ProductionBatch,
  ProductionItem,
  Recipe,
  RecipeSummary,
  Role,
  StartCandidate,
  PackagingCost,
  ProductStock,
  StockItem,
  StockLot,
  StockMovement,
  StockPosition,
  Supplier,
  User,
} from "@/lib/api";

// These factories are the contract test. They are typed by the server's own schemas, so a
// sample that invents a field, or forgets one, stops compiling — which is what keeps the suite
// from passing against a server that does not exist.
export function aCurrentUser(over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "018f0000-0000-7000-8000-000000000001",
    name: "Operador",
    username: "operador",
    roleId: null,
    permissions: ["ACCESS_READ"],
    ...over,
  };
}

export function aRole(over: Partial<Role> = {}): Role {
  return {
    id: "018f0000-0000-7000-8000-000000000010",
    name: "Gerente",
    permissions: ["ACCESS_READ", "ACCESS_CREATE"],
    ...over,
  };
}

export function aUser(over: Partial<User> = {}): User {
  return {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Maria Souza",
    username: "maria",
    roleId: null,
    extraPermissions: [],
    permissions: [],
    isActive: true,
    ...over,
  };
}

export function aProduct(over: Partial<Product> = {}): Product {
  return {
    sku: "018f0000-0000-7000-8000-000000000020",
    description: "Farinha de trigo",
    kind: "GOODS",
    unit: "KILOGRAM",
    isActive: true,
    isStorableOnceOpened: true,
    minimumQuantity: null,
    packagings: [],
    ...over,
  };
}

export function aPackaging(over: Partial<Packaging> = {}): Packaging {
  return {
    id: "018f0000-0000-7000-8000-000000000101",
    brand: "MOÇA",
    content: "1",
    gtin: null,
    isActive: true,
    ...over,
  };
}

export function anEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: "018f0000-0000-7000-8000-000000000030",
    type: "ENTRY",
    quantity: "10",
    unitCost: "4",
    createdAt: "2026-10-11T12:00:00.000Z",
    product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
    lot: {
      id: "018f0000-0000-7000-8000-000000000060",
      expiresAt: null,
      supplier: null,
      quantity: "10",
      packaging: null,
    },
    stock: { quantity: "10", lastEntryCost: "4", averageCost: "4" },
    ...over,
  };
}

export function aStockMovement(over: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "018f0000-0000-7000-8000-000000000040",
    type: "ENTRY",
    quantity: "10",
    unitCost: "4",
    createdAt: "2026-10-01T12:00:00.000Z",
    product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
    lot: null,
    createdBy: { id: "018f0000-0000-7000-8000-000000000001", name: "Operador" },
    ...over,
  };
}

export function aStockItem(over: Partial<StockItem> = {}): StockItem {
  return {
    product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
    quantity: "10",
    minimumQuantity: "5",
    lastEntryCost: "4",
    averageCost: "4",
    value: "40.00",
    lotCount: 1,
    nextExpiresAt: null,
    status: "OK",
    ...over,
  };
}

export function aStockLot(over: Partial<StockLot> = {}): StockLot {
  return {
    id: "018f0000-0000-7000-8000-000000000060",
    expiresAt: null,
    supplier: null,
    initialQuantity: "10",
    quantity: "10",
    unitCost: "4",
    value: "40.00",
    createdAt: "2026-10-01T12:00:00.000Z",
    status: "OK",
    packaging: null,
    ...over,
  };
}

export function aPackagingCost(over: Partial<PackagingCost> = {}): PackagingCost {
  return {
    id: "018f0000-0000-7000-8000-000000000101",
    brand: "MOÇA",
    content: "380",
    isActive: true,
    lastEntry: null,
    history: [],
    ...over,
  };
}

export function aProductStock(over: Partial<ProductStock> = {}): ProductStock {
  return { ...aStockItem(), lots: [aStockLot()], packagings: [], ...over };
}

export function aStockPosition(over: Partial<StockPosition> = {}): StockPosition {
  return { items: [aStockItem()], totalValue: "40.00", ...over };
}

export function aSupplier(over: Partial<Supplier> = {}): Supplier {
  return { id: "018f0000-0000-7000-8000-000000000050", name: "Moinho Santa Clara", ...over };
}

export function aLossReason(over: Partial<LossReason> = {}): LossReason {
  return { id: "018f0000-0000-7000-8000-000000000070", name: "Vencimento", description: null, isActive: true, ...over };
}

export function aLoss(over: Partial<Loss> = {}): Loss {
  return {
    id: "018f0000-0000-7000-8000-000000000080",
    quantity: "2.5",
    unitCost: "4",
    note: null,
    createdAt: "2026-10-12T12:00:00.000Z",
    reason: { id: "018f0000-0000-7000-8000-000000000070", name: "Vencimento" },
    product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
    lot: { id: "018f0000-0000-7000-8000-000000000060", expiresAt: null, quantity: "7.5" },
    ...over,
  };
}

type PlanIngredient = PreWeighingPlan["items"][number];

export function aProductSummary(over: Partial<PlanIngredient["product"]> = {}): PlanIngredient["product"] {
  return { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM", ...over };
}

/** A line of a plan: a bought ingredient with no lot to weigh it from, unless told otherwise. */
export function aPlanIngredient(over: Partial<PlanIngredient> = {}): PlanIngredient {
  return { product: aProductSummary(), plannedQuantity: "6", lots: [], shortfall: "0", manufactured: null, ...over };
}

export function aPreWeighingPlan(over: Partial<PreWeighingPlan> = {}): PreWeighingPlan {
  return {
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    quantity: "10",
    items: [
      {
        product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
        plannedQuantity: "6",
        lots: [{ id: "018f0000-0000-7000-8000-000000000060", expiresAt: null, quantity: "6" }],
        shortfall: "0",
        manufactured: null,
      },
    ],
    waste: null,
    ...over,
  };
}

export function aPreWeighing(over: Partial<PreWeighing> = {}): PreWeighing {
  return {
    id: "018f0000-0000-7000-8000-0000000000a0",
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    quantity: "10",
    createdAt: "2026-10-13T12:00:00.000Z",
    status: "PENDING",
    parent: null,
    children: [],
    items: [
      {
        product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
        plannedQuantity: "6",
        weighedQuantity: "6.05",
      },
    ],
    ...over,
  };
}

export function aStartCandidate(over: Partial<StartCandidate> = {}): StartCandidate {
  return { ...aPreWeighing(), stages: [], ...over };
}

export function aProductionBatch(over: Partial<ProductionBatch> = {}): ProductionBatch {
  return {
    id: "018f0000-0000-7000-8000-0000000000c1",
    quantity: "10",
    expiresAt: null,
    source: "PRODUCED",
    createdAt: "2026-10-14T12:00:00.000Z",
    ...over,
  };
}

export function aProductionItem(over: Partial<ProductionItem> = {}): ProductionItem {
  return {
    id: "018f0000-0000-7000-8000-0000000000b1",
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    status: "PENDING",
    finishedAt: null,
    hasLeftoversInCost: null,
    substitutedAt: null,
    weighedAt: null,
    preWeighingId: null,
    expectedQuantity: "10",
    producedQuantity: null,
    unitCost: null,
    dependsOn: [],
    awaitsWeighing: false,
    batches: [],
    extraWeighings: 0,
    extraWeighedAt: [],
    damages: [],
    inputs: [
      {
        product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
        quantity: "6",
        unitCost: null,
        leftovers: [],
      },
    ],
    ...over,
  };
}

export function aProduction(over: Partial<Production> = {}): Production {
  return {
    id: "018f0000-0000-7000-8000-0000000000b0",
    status: "IN_PROGRESS",
    createdAt: "2026-10-14T12:00:00.000Z",
    finishedAt: null,
    canceledAt: null,
    items: [aProductionItem()],
    ...over,
  };
}

export function aRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    yieldQuantity: "10",
    ingredients: [
      {
        product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo", unit: "KILOGRAM" },
        quantity: "6",
      },
    ],
    updatedAt: "2026-10-13T12:00:00.000Z",
    ...over,
  };
}

export function aRecipeSummary(over: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    yieldQuantity: "10",
    ingredientCount: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
    ...over,
  };
}

export function aPriceEntry(over: Partial<PriceEntry> = {}): PriceEntry {
  return {
    price: "2.03",
    averageCost: "1.500000",
    markupPercent: "35.00",
    createdAt: "2026-11-20T12:00:00.000Z",
    ...over,
  };
}

export function aPricingRow(over: Partial<PricingRow> = {}): PricingRow {
  const entry = aPriceEntry();

  return {
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "UNIT" },
    status: "priced",
    markupPercent: "35.00",
    onHandCost: "1.500000",
    currentPrice: entry,
    history: [entry],
    ...over,
  };
}

export function anOutflow(over: Partial<Outflow> = {}): Outflow {
  return {
    id: "018f0000-0000-7000-8000-000000000080",
    kind: "SALE",
    product: { sku: "018f0000-0000-7000-8000-000000000020", description: "Pão francês", unit: "UNIT" },
    quantity: "3",
    listPrice: "13.80",
    unitPrice: "13.80",
    cost: "27.60",
    revenue: "41.40",
    profit: "13.80",
    note: null,
    createdAt: "2026-11-10T12:00:00.000Z",
    createdBy: { id: "018f0000-0000-7000-8000-000000000001", name: "Operador" },
    ...over,
  };
}

export function anOutflowSummary(over: Partial<OutflowSummary> = {}): OutflowSummary {
  return {
    revenue: "120.00",
    saleCost: "80.00",
    profit: "40.00",
    donated: "15.00",
    result: "25.00",
    saleCount: 4,
    donationCount: 1,
    ...over,
  };
}
