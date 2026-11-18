import type { CreatePreWeighingBody, PreWeighingPlan, PreWeighingStageBody } from "@/lib/api";

export type WeighingRow = {
  /** SKUs of the stages from the root down to the one this line is weighed in. */
  path: string[];
  product: PreWeighingPlan["product"];
  plannedQuantity: string;
};

/** Every bought line of every stage, depth first; manufactured lines are taken from stock or made, not weighed. */
export function weighingRowsOf(plan: PreWeighingPlan, path: string[] = []): WeighingRow[] {
  const here = [...path, plan.product.sku];

  return plan.items.flatMap((item) =>
    item.manufactured
      ? item.manufactured.stage
        ? weighingRowsOf(item.manufactured.stage, here)
        : []
      : [{ path: here, product: item.product, plannedQuantity: item.plannedQuantity }],
  );
}

/** The body that records the plan: `weighed[i]` is the quantity of `weighingRowsOf(plan)[i]`. */
export function createBodyOf(plan: PreWeighingPlan, weighed: string[], parentId?: string): CreatePreWeighingBody {
  const body = stageBodyOf(plan, weighed, { next: 0 });

  return parentId ? { ...body, parentId } : body;
}

function stageBodyOf(plan: PreWeighingPlan, weighed: string[], cursor: { next: number }): PreWeighingStageBody {
  const items: PreWeighingStageBody["items"] = [];
  const stages: PreWeighingStageBody[] = [];

  for (const item of plan.items) {
    if (!item.manufactured) {
      items.push({ productSku: item.product.sku, weighedQuantity: weighed[cursor.next++] });
      continue;
    }

    items.push({ productSku: item.product.sku });

    if (item.manufactured.stage) stages.push(stageBodyOf(item.manufactured.stage, weighed, cursor));
  }

  return { productSku: plan.product.sku, quantity: plan.quantity, items, stages };
}
