import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { setLocale } from './format';

export interface Me {
  user: { id: string; email: string; name: string };
  organizations: { id: string; name: string }[];
  tenant: { id: string; name: string; currency: string; locale: string; workspace_term: string; workspace_term_plural: string; faith_based: boolean; billing_enabled: boolean; tax_jurisdiction: string; invoice_terms: string; legal_name?: string } | null;
  role: string | null; permissions: string[]; allMinistries: boolean; ministryIds: string[];
  features: { ai: boolean; smtp: boolean; quickbooks: boolean; google: boolean; googleMaps: boolean; plaid: boolean };
  permissionCatalog: Record<string, string>;
}
export interface Workspace { id: string; name: string; color: string; donor_count: number; giving_ytd: number; lifetime: number; archived: boolean; description?: string }

interface Ctx {
  me: Me | null; loading: boolean; reload: () => Promise<void>;
  can: (p: string) => boolean; workspaces: Workspace[]; reloadWorkspaces: () => Promise<void>;
  term: string; terms: string;
}
const SessionCtx = createContext<Ctx>(null as any);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const reloadWorkspaces = useCallback(async () => { try { setWorkspaces(await api.get('/workspaces')); } catch { setWorkspaces([]); } }, []);
  const reload = useCallback(async () => {
    try {
      const m = await api.get<Me>('/auth/me'); setMe(m);
      if (m.tenant) { setLocale(m.tenant.currency, m.tenant.locale); await reloadWorkspaces(); }
    } catch { setMe(null); }
    finally { setLoading(false); }
  }, [reloadWorkspaces]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const f = () => setMe(null); window.addEventListener('ainp:unauthorized', f); return () => window.removeEventListener('ainp:unauthorized', f); }, []);
  const can = useCallback((p: string) => Boolean(me?.permissions.includes(p)), [me]);
  return (
    <SessionCtx.Provider value={{ me, loading, reload, can, workspaces, reloadWorkspaces, term: me?.tenant?.workspace_term ?? 'Ministry', terms: me?.tenant?.workspace_term_plural ?? 'Ministries' }}>
      {children}
    </SessionCtx.Provider>
  );
}
export const useSession = () => useContext(SessionCtx);
