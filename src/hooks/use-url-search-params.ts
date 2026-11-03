import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The address's query string, and a way to rewrite it in place. Next hands out the parameters
 * read-only; writing them is a navigation to the same path, replacing the history entry so the
 * back button leaves the screen instead of stepping through every filter the operator tried.
 */
export function useUrlSearchParams(): [URLSearchParams, (next: URLSearchParams) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setSearchParams = useCallback(
    (next: URLSearchParams) => {
      const search = next.toString();

      router.replace(search === "" ? pathname : `${pathname}?${search}`);
    },
    [pathname, router],
  );

  // One object per address, so an effect that depends on it runs once per change and not once per render.
  const params = useMemo(() => new URLSearchParams(searchParams), [searchParams]);

  return [params, setSearchParams];
}
