import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError, api, closeStream, type Me } from "./api";

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ me: null, loading: true, reload: async () => null, signOut: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const m = await api<Me>("/api/me");
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const signOut = useCallback(async () => {
    closeStream();
    await api("/api/auth/logout", { body: {} }).catch(() => {});
    setMe(null);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return <Ctx.Provider value={{ me, loading, reload, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** Signed in and device-verified, or sent to the right step of the login flow. */
export function RequireVerified({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return null;
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (me.session.stage !== "verified") return <Navigate to="/verify" replace />;
  if (admin && me.user.role !== "admin") return <Navigate to="/app" replace />;
  return <>{children}</>;
}
