// All callers have been migrated to useAuth from @shared/cortex.
// This shim exists only to surface a clear error if any stale import remains.
export { useAuth as useCircuitAuth } from "@shared/cortex";
export type { AuthUser as LocalUser } from "@shared/cortex";
