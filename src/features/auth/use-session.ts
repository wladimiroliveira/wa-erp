import { useContext } from "react";
import { SessionContext, type SessionValue } from "@/features/auth/session-context";

export function useSession(): SessionValue {
  const value = useContext(SessionContext);

  if (value === null) throw new Error("useSession must be used inside a SessionProvider.");

  return value;
}
