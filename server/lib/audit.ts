import type { Db } from '../db/pool.js';

export interface Actor { tenantId: string; userId: string | null; ip?: string }

export async function audit(db: Db, actor: Actor, category: string, action: string, description: string,
  entity?: { type: string; id?: string | null }, meta: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO audit_events(tenant_id,user_id,category,action,description,entity_type,entity_id,meta,ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.tenantId, actor.userId, category, action, description, entity?.type ?? null, entity?.id ?? null, meta, actor.ip ?? null]);
}
