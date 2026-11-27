"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { quoteOutflow, registerOutflow } from "@/features/stock-outflows/actions";
import { moneyOf, quantityOf } from "@/features/stock/stock-format";
import type { CreateOutflowBody, OutflowQuote, Product } from "@/lib/api";
import { isDecimalInput, padDecimalInput, toApiDecimal, formatDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";
import { previewOutflow } from "@/shared/outflow-preview";
import type { Failure } from "@/server/lib/result";

// The server answers in English; what the operator reads is here, by the message the server gave.
const FAILURES: Record<string, string> = {
  "Not enough stock.": "Estoque insuficiente.",
  "The product has no price.": "Produto sem preço.",
  "Only a manufactured product can be sold.": "Só produto fabricado pode ser vendido.",
  "Product is inactive.": "Produto inativo.",
};

const STATUS_FAILURES = {
  403: "Você não tem permissão para registrar saídas.",
  404: "Produto não encontrado.",
};

function failureMessage(failure: Failure): string {
  return FAILURES[failure.message] ?? messageForFailure(failure, STATUS_FAILURES);
}

const isPrice = (typed: string) => isDecimalInput(typed) && /^\d+(\.\d{1,2})?$/.test(toApiDecimal(typed));

const isPositive = (typed: string) => isDecimalInput(typed) && Number(toApiDecimal(typed)) > 0;

type Kind = CreateOutflowBody["kind"];

interface OutflowDialogProps {
  open: boolean;
  /** The products an outflow may be recorded for, as the server read them. */
  products: Product[];
  onOpenChange: (open: boolean) => void;
}

export function OutflowDialog({ open, products, onOpenChange }: OutflowDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova saída</DialogTitle>
          <DialogDescription>Venda ou doação, tirada dos lotes mais próximos do vencimento.</DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so opening the dialog again starts from an empty form. */}
        <OutflowForm products={products} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function OutflowForm({ products, onOpenChange }: Omit<OutflowDialogProps, "open">) {
  const router = useRouter();
  const [productSku, setProductSku] = useState("");
  const [kind, setKind] = useState<Kind>("SALE");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [quoted, setQuoted] = useState<{ sku: string; quote: OutflowQuote } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const product = products.find((candidate) => candidate.sku === productSku) ?? null;

  // The price and the cost belong to the product chosen: a late answer for another one is dropped.
  useEffect(() => {
    if (productSku === "") return;

    let current = true;

    quoteOutflow(productSku)
      .then((result) => {
        if (!current) return;

        if (!result.ok) {
          setFailure(failureMessage(result));
          return;
        }

        setQuoted({ sku: productSku, quote: result.data });
        setPrice(result.data.listPrice === null ? "" : formatDecimal(result.data.listPrice, 2));
      })
      .catch((error: unknown) => {
        if (current) setFailure(messageForFailure(error));
      });

    return () => {
      current = false;
    };
  }, [productSku]);

  // The price and the cost belong to the product chosen: the quote of another one does not count.
  const quote = quoted?.sku === productSku ? quoted.quote : null;
  const noPrice = quote !== null && quote.listPrice === null;
  const goods = product?.kind === "GOODS";
  const saleHint = goods ? "Só produto fabricado" : noPrice ? "Produto sem preço" : null;
  const saleAllowed = saleHint === null;
  const effectiveKind: Kind = saleAllowed ? kind : "DONATION";

  const quantityTyped = isPositive(quantity);
  const exceeds = quote !== null && quantityTyped && Number(toApiDecimal(quantity)) > Number(quote.available);
  const priceTyped = isPrice(price);

  const preview =
    quote !== null && quote.onHandCost !== null && quantityTyped && (effectiveKind === "DONATION" || priceTyped)
      ? previewOutflow({
          quantity: toApiDecimal(quantity),
          unitPrice: effectiveKind === "SALE" ? toApiDecimal(price) : null,
          unitCost: quote.onHandCost,
        })
      : null;

  const ready =
    product !== null && quote !== null && quantityTyped && !exceeds && (effectiveKind === "DONATION" || priceTyped);

  async function save(): Promise<void> {
    if (!ready) return;

    const common = {
      productSku,
      quantity: toApiDecimal(quantity),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    };
    const body: CreateOutflowBody =
      effectiveKind === "SALE"
        ? { kind: "SALE", ...common, unitPrice: toApiDecimal(padDecimalInput(price, 2)) }
        : { kind: "DONATION", ...common };

    setSaving(true);
    setFailure(null);

    try {
      const result = await registerOutflow(body);

      if (!result.ok) {
        setFailure(failureMessage(result));
        return;
      }

      toast.success(effectiveKind === "SALE" ? "Venda registrada." : "Doação registrada.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      setFailure(messageForFailure(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="outflow-product">Produto</Label>
        <NativeSelect
          id="outflow-product"
          value={productSku}
          onChange={(event) => {
            setProductSku(event.target.value);
            setFailure(null);
          }}
        >
          <option value="">Selecione o produto</option>
          {products.map((candidate) => (
            <option key={candidate.sku} value={candidate.sku}>
              {candidate.description}
            </option>
          ))}
        </NativeSelect>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Tipo</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="outflow-kind"
              checked={effectiveKind === "SALE"}
              disabled={!saleAllowed}
              onChange={() => setKind("SALE")}
            />
            Venda
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="outflow-kind"
              checked={effectiveKind === "DONATION"}
              onChange={() => setKind("DONATION")}
            />
            Doação
          </label>
        </div>
        {saleHint !== null ? <p className="text-sm text-muted-foreground">{saleHint}</p> : null}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="outflow-quantity">Quantidade</Label>
        <NumericInput
          id="outflow-quantity"
          trailing={product === null ? undefined : unitLabel(product.unit)}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        {quote !== null && product !== null ? (
          <p className="text-sm text-muted-foreground">Disponível: {quantityOf(quote.available, product.unit)}</p>
        ) : null}
        {exceeds ? <p className="text-sm text-destructive">Estoque insuficiente</p> : null}
      </div>

      {effectiveKind === "SALE" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="outflow-price">Preço</Label>
          <NumericInput
            id="outflow-price"
            leading="R$"
            minFractionDigits={2}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
      ) : null}

      {preview !== null ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {effectiveKind === "SALE" ? (
            <>
              <dt>Receita</dt>
              <dd>{moneyOf(preview.revenue)}</dd>
              <dt>Custo estimado</dt>
              <dd>{moneyOf(preview.cost)}</dd>
              <dt>Lucro</dt>
              <dd>{moneyOf(preview.profit)}</dd>
            </>
          ) : (
            <>
              <dt>Custo (prejuízo)</dt>
              <dd>{moneyOf(preview.cost)}</dd>
            </>
          )}
        </dl>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="outflow-note">Observação (opcional)</Label>
        <Input id="outflow-note" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
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
        <Button type="submit" disabled={!ready || saving}>
          Registrar saída
        </Button>
      </DialogFooter>
    </form>
  );
}
