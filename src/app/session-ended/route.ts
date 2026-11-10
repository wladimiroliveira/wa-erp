import { leaveStaleSession } from "@/server/auth/stale-session";

// Reached from a render that found the session cookie stale; see `leaveStaleSession`.
export const GET = leaveStaleSession;
