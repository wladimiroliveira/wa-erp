import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WasteSection } from "@/features/pre-weighings/WasteSection";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { quantityOf } from "@/features/stock/stock-format";
import type { MeasurementUnit, PreWeighingPlan } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { formatDecimal } from "@/lib/decimal";
import { unitLabel } from "@/lib/units";
import { compatibleUnits } from "@/shared/units";
import type { UseFormRegisterReturn } from "react-hook-form";

type PlanItem = PreWeighingPlan["items"][number];
type Product = PreWeighingPlan["product"];

/** Names a weighed line by where it is in the tree, so that it keeps its value through a re-plan that still has it. */
export function rowKeyOf(path: string[], sku: string): string {
  return [...path, sku].join("_");
}

/** What the stage needs of the weighing form, one line at a time, by its key. */
export interface StageWeighing {
  register: (key: string) => UseFormRegisterReturn;
  error: (key: string) => string | undefined;
  unitOf: (key: string, product: Product, plannedQuantity: string) => MeasurementUnit;
  chooseUnit: (key: string, unit: MeasurementUnit) => void;
}

/** How much to make of each intermediate, by SKU: the same number wherever the SKU appears in the tree. */
export interface StageProduce {
  typed: (sku: string) => string | undefined;
  error: (sku: string) => string | undefined;
  change: (sku: string, unit: MeasurementUnit, typed: string) => void;
  disabled: boolean;
}

interface PreWeighingStageProps {
  plan: PreWeighingPlan;
  /** SKUs of the stages above this one, from the root. */
  path?: string[];
  weighing: StageWeighing;
  produce: StageProduce;
}

/** A stage of the plan: the ingredients to weigh, the intermediates to take or make and, below, the stage of each one made. */
export function PreWeighingStage({ plan, path = [], weighing, produce }: PreWeighingStageProps) {
  const here = [...path, plan.product.sku];
  const nested = path.length > 0;
  const bought = plan.items.filter((item) => item.manufactured === null);
  const made = plan.items.filter(
    (item): item is PlanItem & { manufactured: NonNullable<PlanItem["manufactured"]> } => item.manufactured !== null,
  );

  return (
    <div className={nested ? "flex flex-col gap-4 border-l-2 pl-4" : "flex flex-col gap-4"}>
      {nested ? (
        <h3 className="text-base font-semibold">
          Fabricar {quantityOf(plan.quantity, plan.product.unit)} de {plan.product.description}
        </h3>
      ) : (
        <h2 className="text-lg font-semibold">
          Plano para {quantityOf(plan.quantity, plan.product.unit)} de {plan.product.description}
        </h2>
      )}

      {/* The waste of the root is shown above the form, where its suggestions change the quantity asked for. */}
      {nested && plan.waste !== null ? (
        <WasteSection
          waste={plan.waste}
          unit={plan.product.unit}
          disabled={produce.disabled}
          onProduce={(quantity) => produce.change(plan.product.sku, plan.product.unit, formatDecimal(quantity))}
        />
      ) : null}

      {bought.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingrediente</TableHead>
              <TableHead>Planejado</TableHead>
              <TableHead>Lotes sugeridos</TableHead>
              <TableHead>Pesado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bought.map(({ product, plannedQuantity, lots, shortfall }) => {
              const key = rowKeyOf(here, product.sku);
              const unit = weighing.unitOf(key, product, plannedQuantity);
              const error = weighing.error(key);

              return (
                <TableRow key={product.sku}>
                  <TableCell>{product.description}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{weighedOf(plannedQuantity, product.unit, unit)}</span>
                      {compatibleUnits(product.unit).length > 1 ? (
                        <NativeSelect
                          aria-label={`Unidade de ${product.description}`}
                          className="w-20"
                          value={unit}
                          onChange={(event) => weighing.chooseUnit(key, event.target.value as MeasurementUnit)}
                        >
                          {compatibleUnits(product.unit).map((option) => (
                            <option key={option} value={option}>
                              {unitLabel(option)}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {lots.length === 0 ? (
                      <p>Nenhum lote com saldo</p>
                    ) : (
                      <ul>
                        {lots.map((lot) => (
                          <li key={lot.id}>
                            {weighedOf(lot.quantity, product.unit, unit)} —{" "}
                            {lot.expiresAt === null ? "sem validade" : `validade ${formatDate(lot.expiresAt)}`}
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* A warning, not a lock: the API records a pre-weighing the stock does not cover. */}
                    {Number(shortfall) > 0 ? (
                      <p className="font-medium text-destructive">Faltam {weighedOf(shortfall, product.unit, unit)}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <NumericInput
                        aria-label={`Pesado de ${product.description}`}
                        className="w-32"
                        {...weighing.register(key)}
                      />
                      <span>{unitLabel(unit)}</span>
                    </div>
                    {error !== undefined ? <p className="text-sm text-destructive">{error}</p> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      {made.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingrediente</TableHead>
              <TableHead>Necessário</TableHead>
              <TableHead>No estoque</TableHead>
              <TableHead>A fabricar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {made.map(({ product, manufactured }) => {
              const error = produce.error(product.sku);

              return (
                <TableRow key={product.sku}>
                  <TableCell>{product.description}</TableCell>
                  <TableCell>{quantityOf(manufactured.needed, product.unit)}</TableCell>
                  <TableCell>{quantityOf(manufactured.inStock, product.unit)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {/* Zero takes it all from stock; the stage below makes what is typed. */}
                      <NumericInput
                        aria-label={`A fabricar de ${product.description}`}
                        className="w-32"
                        value={produce.typed(product.sku) ?? formatDecimal(manufactured.toProduce)}
                        onChange={(event) => produce.change(product.sku, product.unit, event.currentTarget.value)}
                      />
                      <span>{unitLabel(product.unit)}</span>
                    </div>
                    {error !== undefined ? <p className="text-sm text-destructive">{error}</p> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      {made.map(({ product, manufactured }) =>
        manufactured.stage !== null ? (
          <PreWeighingStage
            key={product.sku}
            plan={manufactured.stage}
            path={here}
            weighing={weighing}
            produce={produce}
          />
        ) : null,
      )}
    </div>
  );
}
