// Today as the calendar day of the place the code runs in, in the form a date column takes. Shared
// by the server, which refuses a lot that already expired, and the screens, which propose the day.
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}
