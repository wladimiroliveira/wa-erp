import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { quantityOf } from "@/features/stock/stock-format";
import type { Recipe } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

interface RecipeViewProps {
  recipe: Recipe;
}

/** A recipe to be read: what one batch yields and what it takes, as text and nothing to type into. */
export function RecipeView({ recipe }: RecipeViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-1">
        <dt className="text-sm text-muted-foreground">Rendimento</dt>
        <dd className="text-lg font-semibold">{quantityOf(recipe.yieldQuantity, recipe.product.unit)}</dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingrediente</TableHead>
            <TableHead className="text-right">Quantidade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipe.ingredients.map(({ product, quantity }) => (
            <TableRow key={product.sku}>
              <TableCell>{product.description}</TableCell>
              <TableCell className="text-right tabular-nums">{quantityOf(quantity, product.unit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-sm text-muted-foreground">Atualizada em {formatDateTime(recipe.updatedAt)}</p>
    </div>
  );
}
