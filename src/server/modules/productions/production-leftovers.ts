import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);

/**
 * What a lot holds after `taken` that is not a whole packaging of `content`: what is left of the
 * packagings opened, which a product that cannot be kept once opened loses. Zero when none.
 */
export function leftoverOf(
  lotQuantity: Prisma.Decimal,
  taken: Prisma.Decimal,
  content: Prisma.Decimal,
): Prisma.Decimal {
  const left = lotQuantity.sub(taken);

  if (content.lte(0) || left.lte(0)) return ZERO;

  return left.mod(content);
}

/**
 * What is left of a lot's opened packagings split among the inputs that opened them, by what each
 * took: the items of a production are made together and share an opened packaging. Each share is
 * kept to the 6 places the stock holds, the last taking what rounding left; a share of nothing is
 * left out.
 */
export function splitLeftover(
  left: Prisma.Decimal,
  takes: { inputId: string; taken: Prisma.Decimal }[],
): { inputId: string; quantity: Prisma.Decimal }[] {
  const total = Prisma.Decimal.sum(0, ...takes.map(({ taken }) => taken));

  if (left.lte(0) || total.lte(0)) return [];

  let given = ZERO;

  return takes
    .map(({ inputId, taken }, index) => {
      const quantity =
        index === takes.length - 1
          ? left.sub(given)
          : left.mul(taken).div(total).toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);

      given = given.add(quantity);

      return { inputId, quantity };
    })
    .filter(({ quantity }) => quantity.gt(0));
}
