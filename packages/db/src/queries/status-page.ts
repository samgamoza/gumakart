import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "../client";
import { opsAlerts, statusIncidentUpdates, statusIncidents, type IncidentImpact, type IncidentStatus } from "../schema/index";

/**
 * Phase 16 — public status page (kart.guma.one/status). Components show the worst of:
 * open incidents posted by Guma Kart ops, and automatic alerts that map to a component.
 * Internal alert details never reach the public page — only "degraded".
 */

export const STATUS_COMPONENTS = [
  { id: "checkout", label: "Checkout & online stores" },
  { id: "dashboard", label: "Seller dashboard" },
  { id: "pos", label: "POS" },
  { id: "notifications", label: "SMS & email updates" },
  { id: "payments", label: "Online payments" },
  { id: "channels", label: "Messenger, Instagram, Shopee & Lazada" },
  { id: "api", label: "API & webhooks" },
] as const;
export type StatusComponentId = (typeof STATUS_COMPONENTS)[number]["id"];
export type ComponentState = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";

const INCIDENT_STATUSES: IncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];
const IMPACTS: IncidentImpact[] = ["minor", "major", "maintenance"];

export class StatusPageError extends Error {}

/** Which automatic alert keys affect which public component. */
export function componentForAlert(key: string): StatusComponentId | null {
  if (key.startsWith("outbox_") || key === "sms_failures") return "notifications";
  if (key.startsWith("webhook_")) return "api";
  if (key.startsWith("cron_missing:/api/cron/outbox") || key.startsWith("cron_failing:/api/cron/outbox")) return "notifications";
  if (key.startsWith("cron_missing:/api/cron/automations") || key.startsWith("cron_failing:/api/cron/automations")) return "notifications";
  if (key.startsWith("cron_missing:/api/cron/campaigns") || key.startsWith("cron_failing:/api/cron/campaigns")) return "notifications";
  if (key.startsWith("cron_missing:/api/cron/webhooks") || key.startsWith("cron_failing:/api/cron/webhooks")) return "api";
  if (key.startsWith("cron_missing:/api/cron/marketplaces") || key.startsWith("cron_failing:/api/cron/marketplaces")) return "channels";
  return null;
}

const RANK: Record<ComponentState, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
const worse = (a: ComponentState, b: ComponentState) => (RANK[b] > RANK[a] ? b : a);

export interface IncidentView {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  components: StatusComponentId[];
  createdAt: Date;
  resolvedAt: Date | null;
  updates: Array<{ status: IncidentStatus; message: string; createdAt: Date }>;
}

async function withUpdates(rows: Array<typeof statusIncidents.$inferSelect>): Promise<IncidentView[]> {
  if (rows.length === 0) return [];
  const ups = await getDb()
    .select()
    .from(statusIncidentUpdates)
    .where(inArray(statusIncidentUpdates.incidentId, rows.map((r) => r.id)))
    .orderBy(desc(statusIncidentUpdates.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    impact: r.impact,
    status: r.status,
    components: r.components.filter((c): c is StatusComponentId => STATUS_COMPONENTS.some((s) => s.id === c)),
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    updates: ups.filter((u) => u.incidentId === r.id).map((u) => ({ status: u.status, message: u.message, createdAt: u.createdAt })),
  }));
}

export async function listIncidents(options: { days?: number } = {}): Promise<IncidentView[]> {
  const since = new Date(Date.now() - (options.days ?? 30) * 86_400_000);
  const rows = await getDb()
    .select()
    .from(statusIncidents)
    .where(or(isNull(statusIncidents.resolvedAt), gt(statusIncidents.createdAt, since)))
    .orderBy(desc(statusIncidents.createdAt))
    .limit(50);
  return withUpdates(rows);
}

export async function createIncident(input: { title: string; impact: IncidentImpact; components: string[]; message: string; createdBy: string; status?: IncidentStatus }): Promise<string> {
  const title = input.title.trim().slice(0, 160);
  const message = input.message.trim().slice(0, 1000);
  const components = [...new Set(input.components)].filter((c) => STATUS_COMPONENTS.some((s) => s.id === c));
  if (!title || !message) throw new StatusPageError("Add a title and a first update.");
  if (components.length === 0) throw new StatusPageError("Pick at least one affected part.");
  if (!IMPACTS.includes(input.impact)) throw new StatusPageError("Unknown impact.");
  const status = input.status && INCIDENT_STATUSES.includes(input.status) ? input.status : "investigating";
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(statusIncidents)
      .values({ title, impact: input.impact, status, components, createdBy: input.createdBy.slice(0, 120), resolvedAt: status === "resolved" ? new Date() : null })
      .returning({ id: statusIncidents.id });
    await tx.insert(statusIncidentUpdates).values({ incidentId: row!.id, status, message });
    return row!.id;
  });
}

export async function addIncidentUpdate(id: string, input: { status: IncidentStatus; message: string }): Promise<void> {
  const message = input.message.trim().slice(0, 1000);
  if (!message) throw new StatusPageError("Write what changed.");
  if (!INCIDENT_STATUSES.includes(input.status)) throw new StatusPageError("Unknown status.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(statusIncidents)
      .set({ status: input.status, resolvedAt: input.status === "resolved" ? new Date() : null })
      .where(eq(statusIncidents.id, id))
      .returning({ id: statusIncidents.id });
    if (!row) throw new StatusPageError("That incident doesn't exist.");
    await tx.insert(statusIncidentUpdates).values({ incidentId: id, status: input.status, message });
  });
}

export interface PublicStatus {
  overall: ComponentState;
  components: Array<{ id: StatusComponentId; label: string; state: ComponentState }>;
  active: IncidentView[];
  history: IncidentView[];
  updatedAt: Date;
}

export function incidentState(impact: IncidentImpact): ComponentState {
  return impact === "maintenance" ? "maintenance" : impact === "major" ? "major_outage" : "partial_outage";
}

export async function getPublicStatus(now = new Date()): Promise<PublicStatus> {
  const [incidents, alerts] = await Promise.all([
    listIncidents({ days: 30 }),
    getDb().select({ key: opsAlerts.key, severity: opsAlerts.severity }).from(opsAlerts).where(isNull(opsAlerts.resolvedAt)),
  ]);
  const state = new Map<StatusComponentId, ComponentState>(STATUS_COMPONENTS.map((c) => [c.id, "operational"]));
  const active = incidents.filter((i) => !i.resolvedAt);
  for (const i of active) for (const c of i.components) state.set(c, worse(state.get(c)!, incidentState(i.impact)));
  for (const a of alerts) {
    const c = componentForAlert(a.key);
    if (c) state.set(c, worse(state.get(c)!, "degraded"));
  }
  const components = STATUS_COMPONENTS.map((c) => ({ id: c.id, label: c.label, state: state.get(c.id)! }));
  const overall = components.reduce<ComponentState>((acc, c) => worse(acc, c.state), "operational");
  return { overall, components, active, history: incidents.filter((i) => i.resolvedAt), updatedAt: now };
}

export async function getIncident(id: string): Promise<IncidentView | null> {
  const rows = await getDb().select().from(statusIncidents).where(and(eq(statusIncidents.id, id))).orderBy(asc(statusIncidents.createdAt)).limit(1);
  const [one] = await withUpdates(rows);
  return one ?? null;
}
