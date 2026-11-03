"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { ProductDialog } from "@/features/products/ProductDialog";
import { saveRecipe } from "@/features/recipes/actions";
import type { Product, Recipe } from "@/lib/api";
import { toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";

const recipeFormSchema = z.object({
  yieldQuantity: positiveDecimal(
    "Informe o rendimento, com até 6 casas decimais.",
    "O rendimento deve ser maior que zero.",
  ),
  ingredients: z
    .array(
      z.object({
        productSku: z.string().min(1, "Escolha o ingrediente."),
        quantity: positiveDecimal(
          "Informe a quantidade, com até 6 casas decimais.",
          "A quantidade deve ser maior que zero.",
        ),
      }),
    )
    .refine(
      (ingredients) => {
        const chosen = ingredients.map(({ productSku }) => productSku).filter((sku) => sku !== "");
        return new Set(chosen).size === chosen.length;
      },
      { message: "Cada ingrediente só pode aparecer uma vez." },
    ),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

const BLANK_INGREDIENT = { productSku: "", quantity: "" };

const SAVE_MESSAGES = {
  404: "O produto ou um ingrediente não existe mais. Atualize a página.",
  409: "Não foi possível salvar: o produto ou um ingrediente está inativo, ou um ingrediente leva este produto na própria receita.",
};

const valuesOf = (recipe: Recipe | null): RecipeFormValues =>
  recipe === null
    ? { yieldQuantity: "", ingredients: [BLANK_INGREDIENT] }
    : {
        yieldQuantity: toDecimalInput(recipe.yieldQuantity),
        ingredients: recipe.ingredients.map(({ product, quantity }) => ({
          productSku: product.sku,
          quantity: toDecimalInput(quantity),
        })),
      };

/** What heads a recipe wherever it is edited: a product with none is starting one. */
export function recipeTitle(product: Product, recipe: Recipe | null): string {
  return `${recipe === null ? "Nova receita" : "Receita"} de ${product.description}`;
}

interface RecipeFormProps {
  product: Product;
  recipe: Recipe | null;
  catalog: Product[];
  onSaved?: (recipe: Recipe) => void;
  /** What the place the form is shown in offers beside the saving, such as a way to leave it. */
  secondaryAction?: ReactNode;
  /** Told whenever the form starts or stops differing from the recipe it opened with. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function RecipeForm({ product, recipe, catalog, onSaved, secondaryAction, onDirtyChange }: RecipeFormProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  // The row a product missing from the catalog is being registered for, over the recipe.
  const [registeringAt, setRegisteringAt] = useState<number | null>(null);

  const form = useForm<RecipeFormValues>({ resolver: zodResolver(recipeFormSchema), defaultValues: valuesOf(recipe) });
  const rows = useFieldArray({ control: form.control, name: "ingredients" });
  const typed = useWatch({ control: form.control, name: "ingredients" });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);

    try {
      const result = await saveRecipe(product.sku, {
        yieldQuantity: toApiDecimal(values.yieldQuantity),
        ingredients: values.ingredients.map(({ productSku, quantity }) => ({
          productSku,
          quantity: toApiDecimal(quantity),
        })),
      });

      if (!result.ok) {
        setFailure(messageForFailure(result, SAVE_MESSAGES));
        return;
      }

      // The list of recipes is read again on the server, so the summary shows without a manual reload.
      router.refresh();
      toast.success("Receita salva.");
      onSaved?.(result.data);
    } catch (error) {
      setFailure(messageForFailure(error));
    }
  });

  // The server refuses an inactive ingredient, but one the recipe already has stays on offer, marked,
  // so that the operator sees what to take out instead of a row gone blank.
  const inRecipe = new Set(recipe?.ingredients.map((ingredient) => ingredient.product.sku));
  const offered = catalog.filter(({ sku, isActive }) => sku !== product.sku && (isActive || inRecipe.has(sku)));

  const { errors, isDirty } = form.formState;

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  const listError = errors.ingredients?.root?.message ?? errors.ingredients?.message;

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor="recipe-yield">Rendimento ({unitLabel(product.unit)})</Label>
          <NumericInput id="recipe-yield" {...form.register("yieldQuantity")} />
          {errors.yieldQuantity ? <p className="text-sm text-destructive">{errors.yieldQuantity.message}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Ingredientes para esse rendimento</legend>

          {rows.fields.map((row, index) => {
            const position = index + 1;
            const chosen = offered.find(({ sku }) => sku === typed[index]?.productSku);
            const rowErrors = errors.ingredients?.[index];

            return (
              <div key={row.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={`Ingrediente ${position}`}
                    className="max-w-md flex-1"
                    {...form.register(`ingredients.${index}.productSku`)}
                    // Follows the form, so that a product registered here is chosen once its option is drawn.
                    value={typed[index]?.productSku ?? ""}
                  >
                    <option value="">Selecione um ingrediente</option>
                    {offered.map(({ sku, description, unit, isActive }) => (
                      <option key={sku} value={sku}>
                        {description} ({unitLabel(unit)}){isActive ? "" : " — inativo"}
                      </option>
                    ))}
                  </NativeSelect>
                  <IconButton
                    label={`Cadastrar ingrediente na linha ${position}`}
                    hint="Cadastrar ingrediente"
                    onClick={() => setRegisteringAt(index)}
                  >
                    <PlusIcon />
                  </IconButton>
                  <NumericInput
                    aria-label={`Quantidade do ingrediente ${position}`}
                    className="w-32"
                    {...form.register(`ingredients.${index}.quantity`)}
                  />
                  <span data-testid={`ingredient-unit-${position}`} className="w-8">
                    {chosen === undefined ? "" : unitLabel(chosen.unit)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remover ingrediente ${position}`}
                    // A recipe takes at least one ingredient.
                    disabled={rows.fields.length === 1}
                    onClick={() => rows.remove(index)}
                  >
                    Remover
                  </Button>
                </div>
                {rowErrors?.productSku ? (
                  <p className="text-sm text-destructive">{rowErrors.productSku.message}</p>
                ) : null}
                {rowErrors?.quantity ? <p className="text-sm text-destructive">{rowErrors.quantity.message}</p> : null}
              </div>
            );
          })}

          {listError !== undefined ? <p className="text-sm text-destructive">{listError}</p> : null}

          <Button type="button" variant="outline" className="self-start" onClick={() => rows.append(BLANK_INGREDIENT)}>
            Adicionar ingrediente
          </Button>
        </fieldset>

        {failure !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Salvar receita
          </Button>
          {secondaryAction}
        </div>
      </form>

      {/* Outside the form: a submit inside a portal still bubbles to the form that renders it. */}
      <ProductDialog
        open={registeringAt !== null}
        onOpenChange={(open) => (open ? undefined : setRegisteringAt(null))}
        onCreated={({ sku }) => {
          if (registeringAt !== null) {
            form.setValue(`ingredients.${registeringAt}.productSku`, sku, { shouldDirty: true, shouldValidate: true });
          }
        }}
      />
    </>
  );
}
