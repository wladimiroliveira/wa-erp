const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });

/** Writes an API timestamp in the operator's own timezone: `02/10/2026 09:00`. */
export function formatDateTime(iso: string): string {
  const moment = new Date(iso);

  return `${DATE.format(moment)} ${TIME.format(moment)}`;
}

/**
 * Writes an API calendar day (`2099-12-31`) as `31/12/2099`. It is rearranged as text on
 * purpose: parsing it into a `Date` would shift it a day back west of Greenwich.
 */
export function formatDate(day: string): string {
  const [year, month, date] = day.split("-");

  return `${date}/${month}/${year}`;
}

/** The operator's own calendar day, in the form a date field and the server hold it. */
export { localToday as todayIso } from "@/shared/dates";
