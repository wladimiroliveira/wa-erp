import type {
  CurrentUser,
  Entry,
  Loss,
  LossReason,
  PreWeighing,
  PreWeighingPlan,
  Product,
  Recipe,
  RecipeSummary,
  Role,
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
    gtin: null,
    description: "Farinha de trigo",
    kind: "GOODS",
    unit: "KILOGRAM",
    isActive: true,
    minimumQuantity: null,
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
    lot: { id: "018f0000-0000-7000-8000-000000000060", expiresAt: null, supplier: null, quantity: "10" },
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
    ...over,
  };
}

export function aProductStock(over: Partial<ProductStock> = {}): ProductStock {
  return { ...aStockItem(), lots: [aStockLot()], ...over };
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
      },
    ],
    ...over,
  };
}

export function aPreWeighing(over: Partial<PreWeighing> = {}): PreWeighing {
  return {
    id: "018f0000-0000-7000-8000-0000000000a0",
    product: { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "KILOGRAM" },
    quantity: "10",
    createdAt: "2026-10-13T12:00:00.000Z",
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
