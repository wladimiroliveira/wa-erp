"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { kindLabel, PRODUCT_KINDS } from "@/features/products/product-kinds";
import { createProduct, updateProduct } from "@/features/products/actions";
import {
  PackagingFields,
  packagingRowsSchema,
  rowOf,
  toCreatedPackaging,
  toEditedPackaging,
} from "@/features/products/PackagingFields";
import type { Product } from "@/lib/api";
import { isDecimalInput, toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel, unitName, UNITS } from "@/lib/units";
import { PRODUCT_CONFLICTS } from "@/server/modules/products/products.schemas";

const productFormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Informe a descrição do produto.")
    .max(120, "A descrição pode ter no máximo 120 caracteres."),
  kind: z.enum(PRODUCT_KINDS, "Escolha o tipo."),
  unit: z.enum(UNITS, "Escolha a unidade."),
  packagings: packagingRowsSchema,
  isStorableOnceOpened: z.boolean(),
  // Optional, so it is checked only once something was typed into it.
  minimumQuantity: z
    .string()
    .refine((typed) => typed === "" || isDecimalInput(typed), "Informe o estoque mínimo como um número.")
    .refine((typed) => typed === "" || Number(toApiDecimal(typed)) > 0, "O estoque mínimo tem de ser maior que zero."),
});

type ProductFormInput = z.input<typeof productFormSchema>;
type ProductForm = z.output<typeof productFormSchema>;

// Kind and unit start unset on purpose for a new product: the operator chooses them, nothing is assumed.
const valuesOf = (product: Product | null): Partial<ProductFormInput> =>
  product === null
    ? { description: "", minimumQuantity: "", packagings: [], isStorableOnceOpened: true }
    : {
        description: product.description,
        kind: product.kind,
        unit: product.unit,
        isStorableOnceOpened: product.isStorableOnceOpened,
        minimumQuantity: product.minimumQuantity === null ? "" : toDecimalInput(product.minimumQuantity),
        packagings: product.packagings.map((packaging) => rowOf(packaging, product.unit)),
      };

// The server's 409 says which value is taken; each gets its own sentence.
const CONFLICT_MESSAGES: Record<string, string> = {
  [PRODUCT_CONFLICTS.description]: "Já existe um produto com essa descrição.",
  [PRODUCT_CONFLICTS.gtin]: "Esse GTIN já está em outra embalagem.",
  [PRODUCT_CONFLICTS.content]: "O produto já tem uma embalagem com esse conteúdo.",
  [PRODUCT_CONFLICTS.inUse]: "Essa embalagem já recebeu entradas e não pode ser removida; inative-a.",
  [PRODUCT_CONFLICTS.contentLocked]:
    "Essa embalagem já recebeu entradas e o conteúdo dela não pode mudar; cadastre uma nova embalagem.",
};

const SAVE_MESSAGES = {
  409: "Já existe um produto com essa descrição ou com esse GTIN.",
  404: "Esse produto já não existe mais. Atualize a lista.",
};

interface ProductDialogProps {
  /** The product being edited; null registers a new one. */
  product?: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (product: Product) => void;
}

export function ProductDialog({ product = null, open, onOpenChange, onCreated }: ProductDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<ProductFormInput, unknown, ProductForm>({
    resolver: zodResolver(productFormSchema),
    defaultValues: valuesOf(product),
  });

  // Reopening the dialog must not show what was typed for the previous product;
  // the form is only constructed once.
  useEffect(() => {
    form.reset(valuesOf(product));
    setFailure(null);
  }, [form, product, open]);

  // A new product leaves a blank field out; an edited one says null, or what was erased would
  // survive, and sends its whole list of packagings. Kind and unit are the product's for good once registered.
  function send({ description, kind, unit, isStorableOnceOpened, minimumQuantity, packagings }: ProductForm) {
    const minimum = minimumQuantity === "" ? null : toApiDecimal(minimumQuantity);

    if (product !== null) {
      return updateProduct(product.sku, {
        description,
        isStorableOnceOpened,
        minimumQuantity: minimum,
        packagings: packagings.map(toEditedPackaging),
      });
    }

    return createProduct({
      description,
      kind,
      unit,
      isStorableOnceOpened,
      ...(minimum === null ? {} : { minimumQuantity: minimum }),
      ...(packagings.length === 0 ? {} : { packagings: packagings.map(toCreatedPackaging) }),
    });
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);

    try {
      const result = await send(values);

      if (!result.ok) {
        setFailure(
          (result.status === 409 ? CONFLICT_MESSAGES[result.message] : undefined) ??
            messageForFailure(result, SAVE_MESSAGES),
        );
        return;
      }

      // The server reads the catalog again: the list shows the product, and the stock its description and minimum.
      router.refresh();
      toast.success(product === null ? "Produto cadastrado." : "Produto salvo.");
      onOpenChange(false);
      if (product === null) onCreated?.(result.data);
    } catch (error) {
      setFailure(messageForFailure(error));
    }
  });

  const { errors } = form.formState;
  const unit = form.watch("unit");
  const isStorableOnceOpened = form.watch("isStorableOnceOpened");
  const chosenUnit = UNITS.includes(unit) ? unit : undefined;
  const editing = product !== null;
  const description = form.register("description");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-description">Descrição</Label>
            <Input
              id="product-description"
              autoFocus
              autoComplete="off"
              {...description}
              // Shown as it is stored: in upper case, the caret kept where the operator typed.
              onChange={(event) => {
                const { selectionStart, selectionEnd } = event.target;

                event.target.value = event.target.value.toLocaleUpperCase("pt-BR");
                event.target.setSelectionRange(selectionStart, selectionEnd);

                return description.onChange(event);
              }}
            />
            {errors.description ? <p className="text-sm text-destructive">{errors.description.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-kind">Tipo</Label>
            <NativeSelect id="product-kind" disabled={editing} {...form.register("kind")}>
              <option value="">Selecione o tipo</option>
              {PRODUCT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </NativeSelect>
            {errors.kind ? <p className="text-sm text-destructive">{errors.kind.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-unit">Unidade</Label>
            <NativeSelect id="product-unit" disabled={editing} {...form.register("unit")}>
              <option value="">Selecione a unidade</option>
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitName(unit)}
                </option>
              ))}
            </NativeSelect>
            {errors.unit ? <p className="text-sm text-destructive">{errors.unit.message}</p> : null}
          </div>

          <PackagingFields
            control={form.control}
            register={form.register}
            setValue={form.setValue}
            errors={errors}
            unit={chosenUnit}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-minimum">Estoque mínimo (opcional)</Label>
            <NumericInput
              id="product-minimum"
              trailing={chosenUnit === undefined ? undefined : unitLabel(chosenUnit)}
              {...form.register("minimumQuantity")}
            />
            {errors.minimumQuantity ? (
              <p className="text-sm text-destructive">{errors.minimumQuantity.message}</p>
            ) : null}
          </div>

          <div className="flex min-h-8 items-center gap-2">
            <Checkbox
              id="product-storable-once-opened"
              checked={isStorableOnceOpened}
              onCheckedChange={(checked) => form.setValue("isStorableOnceOpened", checked === true)}
            />
            <Label htmlFor="product-storable-once-opened" className="flex-1 py-1.5">
              Pode ser guardado depois de aberto
            </Label>
          </div>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
