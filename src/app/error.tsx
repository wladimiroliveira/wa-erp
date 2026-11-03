"use client";

import { RouteError } from "@/components/common/RouteError";

// Without this, a render failure anywhere falls through to Next's own boundary, which
// writes its message in English.
export default function ErrorBoundary({ error }: { error: Error }) {
  return <RouteError error={error} />;
}
