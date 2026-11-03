import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { SessionProvider } from "@/features/auth/session-context";
import { TableLayoutsProvider } from "@/features/table-layouts/table-layouts-context";
import type { CurrentUser, TableLayout } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { aCurrentUser } from "@/tests/samples";

export interface RenderOptions {
  /** The address the screen opens at, query string included. */
  route?: string;
  /** What a dynamic segment of that address holds, as `useParams` would read it. */
  params?: Record<string, string>;
  /** Who is signed in, as the server layout would hand it over. */
  user?: CurrentUser;
  /** How the user arranged their tables, as the server layout would hand it over. */
  tableLayouts?: TableLayout[];
}

/**
 * The providers go through Testing Library's `wrapper` option rather than being wrapped
 * around the JSX by hand. That is what makes the returned `rerender` usable: it
 * re-renders only what it is given, so hand-wrapped providers would be dropped on the
 * second render and the component would fail looking for a context that was there a
 * moment before.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", params = {}, user = aCurrentUser(), tableLayouts = [] }: RenderOptions = {},
): RenderResult {
  navigation.reset(route, params);

  function Providers({ children }: { children: ReactNode }) {
    return (
      <SessionProvider user={user}>
        <TableLayoutsProvider initial={tableLayouts}>{children}</TableLayoutsProvider>
      </SessionProvider>
    );
  }

  return render(ui, { wrapper: Providers });
}
