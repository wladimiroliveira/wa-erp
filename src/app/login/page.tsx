"use client";

import { Suspense } from "react";
import { LoginPage } from "@/features/auth/LoginPage";

// The screen reads where to go back to from the query string, which is only known in the browser.
export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
