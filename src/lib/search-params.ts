/** What a page receives from Next for the address's query string. */
export type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

/** The query string of a page as the filter helpers read it, a repeated parameter kept repeated. */
export async function toSearchParams(input: SearchParamsInput): Promise<URLSearchParams> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(await input)) {
    for (const item of [value].flat()) if (item !== undefined) params.append(key, item);
  }

  return params;
}
