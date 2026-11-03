"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { kindLabel, PRODUCT_KINDS } from "@/features/products/product-kinds";
import { createProduct, updateProduct } from "@/features/products/actions";
import type { Product } from "@/lib/api";
import { isDecimalInput, toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { hasValidCheckDigit } from "@/lib/gtin";
import { unitLabel, unitName, UNITS } from "@/lib/units";

const productFormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Informe a descrição do produto.")
    .max(120, "A descrição pode ter no máximo 120 caracteres."),
  kind: z.enum(PRODUCT_KINDS, "Escolha o tipo."),
  unit: z.enum(UNITS, "Escolha a unidade."),
  gtin: z
    .string()
    .trim()
    .refine((typed) => typed === "" || /^\d{8,14}$/.test(typed), "O GTIN tem de 8 a 14 dígitos, só números.")
    .refine(
      (typed) => !/^\d{8,14}$/.test(typed) || hasValidCheckDigit(typed),
      "O dígito verificador do GTIN não confere. Revise o código.",
    ),
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
    ? { description: "", gtin: "", minimumQuantity: "" }
    : {
        description: product.description,
        kind: product.kind,
        unit: product.unit,
        gtin: product.gtin ?? "",
        minimumQuantity: product.minimumQuantity === null ? "" : toDecimalInput(product.minimumQuantity),
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
  // survive. Kind and unit are the product's for good once registered.
  function send({ description, kind, unit, gtin, minimumQuantity }: ProductForm) {
    const minimum = minimumQuantity === "" ? null : toApiDecimal(minimumQuantity);

    if (product !== null) {
      return updateProduct(product.sku, { description, gtin: gtin === "" ? null : gtin, minimumQuantity: minimum });
    }

    return createProduct({
      description,
      kind,
      unit,
      ...(gtin === "" ? {} : { gtin }),
      ...(minimum === null ? {} : { minimumQuantity: minimum }),
    });
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);

    try {
      const result = await send(values);

      if (!result.ok) {
        setFailure(messageForFailure(result, SAVE_MESSAGES));
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
  const editing = product !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-description">Descrição</Label>
            <Input id="product-description" autoFocus autoComplete="off" {...form.register("description")} />
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-gtin">GTIN (opcional)</Label>
            <NumericInput id="product-gtin" format="digits" maxLength={14} {...form.register("gtin")} />
            {errors.gtin ? <p className="text-sm text-destructive">{errors.gtin.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-minimum">Estoque mínimo (opcional)</Label>
            <NumericInput
              id="product-minimum"
              trailing={UNITS.includes(unit) ? unitLabel(unit) : undefined}
              {...form.register("minimumQuantity")}
            />
            {errors.minimumQuantity ? (
              <p className="text-sm text-destructive">{errors.minimumQuantity.message}</p>
            ) : null}
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
