"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { DeficitDialog } from "@/features/entries/DeficitDialog";
import { createEntry, type CreateEntryResult } from "@/features/entries/actions";
import { findByGtin } from "@/features/entries/barcode";
import { MAX_PACKAGE_COUNT } from "@/server/modules/entries/entries.schemas";
import { quantityOf } from "@/features/stock/stock-format";
import type { CreateEntryBody, Entry, Product, Supplier } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/dates";
import { formatDecimal, formatMoney, isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";
import { roundToCents } from "@/shared/fixed-point";
import { packagedQuantity, packageUnitCost } from "@/shared/packaging-entry";
import { readableQuantity } from "@/shared/units";

/** What the packaging select holds when the entry is in the product's own unit. */
const LOOSE = "LOOSE";

const isPackaged = (packaging: string) => packaging !== "" && packaging !== LOOSE;

const isCount = (typed: string) => /^\d+$/.test(typed) && Number(typed) >= 1 && Number(typed) <= MAX_PACKAGE_COUNT;

const isPrice = (typed: string) => isDecimalInput(typed) && /^\d+(\.\d{1,2})?$/.test(toApiDecimal(typed));

const entryFormSchema = z
  .object({
    barcode: z.string(),
    productSku: z.string().min(1, "Escolha o produto."),
    // A packaging id, LOOSE, or empty for a product that has no packaging.
    packaging: z.string(),
    quantity: z.string(),
    unitCost: z.string(),
    packageCount: z.string(),
    packagePrice: z.string(),
    expiresAt: z.string(),
    noExpiry: z.boolean(),
    supplierId: z.string(),
  })
  // Only the fields of the chosen way of receiving are asked for.
  .superRefine((entry, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });

    if (isPackaged(entry.packaging)) {
      if (!isCount(entry.packageCount))
        issue("packageCount", "Informe um número inteiro de embalagens, de 1 a 99.999.");
      if (!isPrice(entry.packagePrice)) issue("packagePrice", "Informe o preço com até 2 casas decimais.");
      return;
    }

    if (!isDecimalInput(entry.quantity)) issue("quantity", "Informe a quantidade, com até 6 casas decimais.");
    else if (Number(toApiDecimal(entry.quantity)) <= 0) issue("quantity", "A quantidade deve ser maior que zero.");

    if (!isDecimalInput(entry.unitCost)) issue("unitCost", "Informe o custo unitário, com até 6 casas decimais.");
  })
  // A lot with no expiry is something the operator says, never something a blank field implies.
  .refine((entry) => entry.noExpiry || entry.expiresAt !== "", {
    path: ["expiresAt"],
    message: 'Informe a validade ou marque "Sem data de validade".',
  })
  .refine((entry) => entry.noExpiry || entry.expiresAt === "" || entry.expiresAt >= todayIso(), {
    path: ["expiresAt"],
    message: "A validade não pode ser anterior a hoje.",
  });

type EntryForm = z.infer<typeof entryFormSchema>;

const EMPTY_FORM: EntryForm = {
  barcode: "",
  productSku: "",
  packaging: "",
  quantity: "",
  unitCost: "",
  packageCount: "",
  packagePrice: "",
  expiresAt: "",
  noExpiry: false,
  supplierId: "",
};

const SAVE_MESSAGES = {
  404: "O produto ou o fornecedor já não existe mais. Atualize a página.",
  409: "Esse produto está inativo e não recebe entradas.",
};

function toBody(values: EntryForm): CreateEntryBody {
  const common = {
    productSku: values.productSku,
    expiresAt: values.noExpiry ? null : values.expiresAt,
    ...(values.supplierId === "" ? {} : { supplierId: values.supplierId }),
  };

  if (isPackaged(values.packaging)) {
    return {
      ...common,
      packagingId: values.packaging,
      packageCount: Number(values.packageCount),
      packagePrice: toApiDecimal(values.packagePrice),
    };
  }

  return { ...common, quantity: toApiDecimal(values.quantity), unitCost: toApiDecimal(values.unitCost) };
}

/** The packaging a product is received in unless the operator says otherwise: its first active one. */
const defaultPackagingOf = (product: Product | undefined) =>
  product === undefined ? "" : (product.packagings.find(({ isActive }) => isActive)?.id ?? "");

/** How a packaging reads in a list: its content in the unit that shows it best. */
const packagingLabel = (content: string, unit: Product["unit"]) => {
  const readable = readableQuantity(content, unit);

  return quantityOf(readable.quantity, readable.unit);
};

/** What the recorded entry amounts to: "10 × 380 g (3,8 kg)" when it came in packagings. */
function receivedOf({ quantity, product, lot }: Entry): string {
  const total = quantityOf(quantity, product.unit);

  if (lot.packaging === null) return total;

  return `${lot.packaging.count} × ${packagingLabel(lot.packaging.content, product.unit)} (${total})`;
}

/** The 409 that carries `deficit` is the negative balance waiting to be settled, not a refusal. */
function deficitOf(result: CreateEntryResult): string | null {
  if (result.ok || result.status !== 409 || !("deficit" in result)) return null;

  return typeof result.deficit === "string" ? result.deficit : null;
}

interface EntryPageProps {
  /** The catalog as the server read it. */
  products: Product[];
  suppliers: Supplier[];
}

export function EntryPage({ products, suppliers }: EntryPageProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState<Entry | null>(null);
  const [unsettled, setUnsettled] = useState<{ body: CreateEntryBody; deficit: string } | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState(false);
  // The field to focus once it is on screen: the count appears only after a barcode chose a packaging.
  const [focusNext, setFocusNext] = useState<"barcode" | "packageCount" | null>(null);

  const form = useForm<EntryForm>({ resolver: zodResolver(entryFormSchema), defaultValues: EMPTY_FORM });
  const noExpiry = form.watch("noExpiry");
  const chosenSku = form.watch("productSku");
  const packaging = form.watch("packaging");
  const packageCount = form.watch("packageCount");
  const packagePrice = form.watch("packagePrice");

  async function save(body: CreateEntryBody): Promise<void> {
    setSaving(true);

    try {
      const result = await createEntry(body);

      if (result.ok) {
        setRecorded(result.data);
        toast.success("Entrada lançada.");
        form.reset(EMPTY_FORM);
        // Ready for the next item off the invoice.
        setFocusNext("barcode");
        return;
      }

      const deficit = deficitOf(result);

      if (deficit !== null) setUnsettled({ body, deficit });
      else setFailure(messageForFailure(result, SAVE_MESSAGES));
    } catch (error) {
      setFailure(messageForFailure(error));
    } finally {
      setSaving(false);
    }
  }

  // An inactive product is refused by the server, so it is never offered.
  const active = products.filter((product) => product.isActive);
  const chosen = active.find(({ sku }) => sku === chosenSku);
  const chosenUnit = chosen === undefined ? undefined : unitLabel(chosen.unit);
  const offered = chosen?.packagings.filter(({ isActive }) => isActive) ?? [];
  const chosenPackaging = offered.find(({ id }) => id === packaging);

  // What the packagings typed so far amount to, in the product's unit.
  const amount =
    chosen !== undefined && chosenPackaging !== undefined && isCount(packageCount) && isPrice(packagePrice)
      ? `= ${quantityOf(packagedQuantity(chosenPackaging.content, Number(packageCount)), chosen.unit)} a ${formatMoney(
          roundToCents(packageUnitCost(toApiDecimal(packagePrice), chosenPackaging.content)),
        )}/${chosenUnit}`
      : null;

  // A read code chooses the product and its packaging; an unknown one changes nothing.
  function readBarcode(): void {
    const read = form.getValues("barcode").trim();

    if (read === "") return;

    const found = findByGtin(active, read);

    setUnknownBarcode(found === null);

    if (found === null) return;

    form.setValue("productSku", found.product.sku, { shouldValidate: form.formState.isSubmitted });
    form.setValue("packaging", found.packaging.id);
    form.setValue("barcode", "");
    setFocusNext("packageCount");
  }

  useEffect(() => {
    if (focusNext === null) return;

    form.setFocus(focusNext);
    setFocusNext(null);
  }, [focusNext, form]);

  const product = form.register("productSku");
  const barcode = form.register("barcode");
  const owing = active.find((product) => product.sku === unsettled?.body.productSku);

  const { errors } = form.formState;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <PageTitle>Entradas</PageTitle>

      {active.length === 0 ? <p>Nenhum produto ativo cadastrado.</p> : null}

      {active.length > 0 ? (
        <form
          onSubmit={form.handleSubmit((values) => {
            setFailure(null);
            return save(toBody(values));
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-barcode">Código de barras</Label>
            <NumericInput
              id="entry-barcode"
              format="digits"
              maxLength={14}
              autoFocus
              {...barcode}
              onBlur={(event) => {
                readBarcode();
                return barcode.onBlur(event);
              }}
              // A scanner ends each code with Enter: it reads the code, it never sends the form.
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;

                event.preventDefault();
                readBarcode();
              }}
            />
            {unknownBarcode ? (
              <p className="text-sm text-destructive">Código não cadastrado em nenhuma embalagem ativa.</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-product">Produto</Label>
            <NativeSelect
              id="entry-product"
              {...product}
              // Another product is received in its own packagings, never in the previous one's.
              onChange={(event) => {
                form.setValue("packaging", defaultPackagingOf(active.find(({ sku }) => sku === event.target.value)));
                return product.onChange(event);
              }}
            >
              <option value="">Selecione um produto</option>
              {active.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.description} ({unitLabel(product.unit)})
                </option>
              ))}
            </NativeSelect>
            {errors.productSku ? <p className="text-sm text-destructive">{errors.productSku.message}</p> : null}
          </div>

          {offered.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-packaging">Embalagem</Label>
              {/* Mounted again for each product, so that it takes the packaging chosen for it. */}
              <NativeSelect key={chosenSku} id="entry-packaging" {...form.register("packaging")}>
                {offered.map(({ id, content }) => (
                  <option key={id} value={id}>
                    {packagingLabel(content, chosen!.unit)}
                  </option>
                ))}
                <option value={LOOSE}>Sem embalagem ({chosenUnit})</option>
              </NativeSelect>
            </div>
          ) : null}

          {chosenPackaging !== undefined ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-package-count">Quantidade</Label>
                <NumericInput id="entry-package-count" format="digits" {...form.register("packageCount")} />
                {errors.packageCount ? <p className="text-sm text-destructive">{errors.packageCount.message}</p> : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-package-price">Preço por embalagem</Label>
                <NumericInput
                  id="entry-package-price"
                  leading="R$"
                  minFractionDigits={2}
                  {...form.register("packagePrice")}
                />
                {errors.packagePrice ? <p className="text-sm text-destructive">{errors.packagePrice.message}</p> : null}
                {amount !== null ? <p className="text-sm text-muted-foreground">{amount}</p> : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-quantity">Quantidade</Label>
                <NumericInput id="entry-quantity" trailing={chosenUnit} {...form.register("quantity")} />
                {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="entry-unit-cost">Custo unitário</Label>
                <NumericInput id="entry-unit-cost" leading="R$" minFractionDigits={2} {...form.register("unitCost")} />
                {errors.unitCost ? <p className="text-sm text-destructive">{errors.unitCost.message}</p> : null}
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-expires-at">Validade</Label>
            <Input
              id="entry-expires-at"
              type="date"
              min={todayIso()}
              disabled={noExpiry}
              {...form.register("expiresAt")}
            />
            <div className="flex min-h-8 items-center gap-2">
              <Checkbox
                id="entry-no-expiry"
                checked={noExpiry}
                onCheckedChange={(checked) => {
                  form.setValue("noExpiry", checked === true);
                  form.setValue("expiresAt", "", { shouldValidate: form.formState.isSubmitted });
                }}
              />
              <Label htmlFor="entry-no-expiry" className="py-1.5">
                Sem data de validade
              </Label>
            </div>
            {errors.expiresAt ? <p className="text-sm text-destructive">{errors.expiresAt.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-supplier">Fornecedor (opcional)</Label>
            <NativeSelect id="entry-supplier" {...form.register("supplierId")}>
              <option value="">Sem fornecedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <Button type="submit" disabled={saving} className="self-start">
            Lançar entrada
          </Button>
        </form>
      ) : null}

      {recorded !== null ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border p-4">
          <p className="font-medium">
            Entrada lançada: {receivedOf(recorded)} de {recorded.product.description}.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Validade do lote</dt>
            <dd>{recorded.lot.expiresAt === null ? "Sem validade" : formatDate(recorded.lot.expiresAt)}</dd>
            <dt className="text-muted-foreground">Fornecedor</dt>
            <dd>{recorded.lot.supplier?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Saldo do lote</dt>
            <dd>
              {formatDecimal(recorded.lot.quantity)} {unitLabel(recorded.product.unit)}
            </dd>
            <dt className="text-muted-foreground">Estoque atual</dt>
            <dd>
              {formatDecimal(recorded.stock.quantity)} {unitLabel(recorded.product.unit)}
            </dd>
            <dt className="text-muted-foreground">Último custo</dt>
            <dd>{formatMoney(roundToCents(recorded.stock.lastEntryCost))}</dd>
            <dt className="text-muted-foreground">Custo médio</dt>
            <dd>{formatMoney(roundToCents(recorded.stock.averageCost))}</dd>
          </dl>
        </div>
      ) : null}

      <DeficitDialog
        owed={
          unsettled !== null && owing !== undefined
            ? `${owing.description} está com o estoque negativo em ${formatDecimal(unsettled.deficit)} ${unitLabel(owing.unit)}`
            : null
        }
        onCancel={() => setUnsettled(null)}
        onSettle={(deficit) => {
          if (unsettled === null) return;

          setUnsettled(null);
          void save({ ...unsettled.body, deficit });
        }}
      />
    </div>
  );
}
