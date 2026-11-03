import { useMemo, useSyncExternalStore } from "react";

/**
 * An in-memory stand-in for `next/navigation`, installed by `setup.ts` through `vi.mock`.
 *
 * Next's hooks need the App Router mounted, which a component test never has. This keeps the
 * address in a store that React can subscribe to, so a `router.replace` made by the component
 * under test re-renders whoever reads `usePathname` or `useSearchParams`, the way the browser would.
 */
type Address = { pathname: string; search: string; params: Record<string, string> };

let address: Address = { pathname: "/", search: "", params: {} };
const listeners = new Set<() => void>();

function parse(url: string): Pick<Address, "pathname" | "search"> {
  const { pathname, search } = new URL(url, "http://localhost");

  return { pathname, search };
}

function go(url: string): void {
  address = { ...address, ...parse(url) };
  for (const listener of listeners) listener();
}

export const navigation = {
  /** Puts the address where a test wants the component to start, with the params a dynamic segment would carry. */
  reset(url = "/", params: Record<string, string> = {}): void {
    address = { ...parse(url), params };
    for (const listener of listeners) listener();
  },
  get pathname(): string {
    return address.pathname;
  },
  get search(): string {
    return address.search;
  },
  /** Path and query, as `router.replace` received them. */
  get url(): string {
    return `${address.pathname}${address.search}`;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function useAddress(): Address {
  return useSyncExternalStore(
    subscribe,
    () => address,
    () => address,
  );
}

const router = {
  push: go,
  replace: go,
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => {},
};

export function useRouter() {
  return router;
}

export function usePathname(): string {
  return useAddress().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useAddress();

  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Path patterns, as `/stock/:sku`, that `useParams` reads a dynamic segment from when a test did not say. */
let patterns: string[] = [];

export function registerPatterns(known: string[]): void {
  patterns = known;
}

/** The params `pattern` captures from `pathname`, or null when the two do not line up. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);

  if (expected.length !== actual.length) return null;

  const params: Record<string, string> = {};

  for (const [index, segment] of expected.entries()) {
    const value = actual[index]!;

    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }

  return params;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const { pathname, params } = useAddress();

  return useMemo(() => {
    const derived = patterns.map((pattern) => matchPattern(pattern, pathname)).find((match) => match !== null) ?? {};

    return { ...derived, ...params } as T;
  }, [params, pathname]);
}

export function notFound(): never {
  throw new Error("notFound() was called");
}

export function redirect(url: string): never {
  throw new Error(`redirect(${url}) was called`);
}
