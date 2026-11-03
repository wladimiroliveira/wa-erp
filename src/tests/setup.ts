import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { navigation } from "@/tests/navigation";

// Every component reads the address through this in-memory router; see `tests/navigation.ts`.
vi.mock("next/navigation", () => import("@/tests/navigation"));

// jsdom has no `matchMedia`, and the app shell asks it whether the screen is a
// phone. Nothing matches, so every suite renders the wide layout.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

beforeEach(() => {
  navigation.reset();
});
