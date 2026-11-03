export { localToday } from "@/shared/dates";

// A date column comes back as midnight UTC of its day.
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The same for a date that may not be there, as the expiry of a lot that never expires.
export function toOptionalDateString(date: Date | null): string | null {
  return date === null ? null : toDateString(date);
}

// The calendar day that many days after another one.
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return toDateString(date);
}
