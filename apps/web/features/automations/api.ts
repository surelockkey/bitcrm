import type { AutomationRule, AutomationRun, AutomationSpec } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The Automation Center lives under the messaging gateway route. */
const BASE = "/messaging/automations";

export const listAutomations = (): Promise<AutomationRule[]> => http.get<AutomationRule[]>(BASE);

export const getAutomation = (id: string): Promise<AutomationRule> =>
  http.get<AutomationRule>(`${BASE}/${id}`);

export interface CreateAutomationBody {
  name: string;
  spec: AutomationSpec;
  enabled?: boolean;
  category?: string;
  description?: string;
}

export const createAutomation = (body: CreateAutomationBody): Promise<AutomationRule> =>
  http.post<AutomationRule>(BASE, body);

export interface UpdateAutomationBody {
  enabled?: boolean;
  name?: string;
  spec?: AutomationSpec;
}

export const updateAutomation = (id: string, body: UpdateAutomationBody): Promise<AutomationRule> =>
  http.patch<AutomationRule>(`${BASE}/${id}`, body);

/** A built-in rule is turned off, never deleted — the backend refuses it. */
export const deleteAutomation = (id: string): Promise<{ id: string }> =>
  http.delete<{ id: string }>(`${BASE}/${id}`);

/** Copies the rule, off, so the copy can be edited before it runs. */
export const duplicateAutomation = (id: string, name?: string): Promise<AutomationRule> =>
  http.post<AutomationRule>(`${BASE}/${id}/duplicate`, name ? { name } : {});

/** The rule's last firings, newest first (30-day history). */
export const listAutomationRuns = (id: string, limit = 20): Promise<AutomationRun[]> =>
  http.get<AutomationRun[]>(`${BASE}/${id}/runs?limit=${limit}`);

export interface AutomationRunsFeedParams {
  limit?: number;
  cursor?: string;
  ruleId?: string;
  outcome?: string;
  since?: string;
}

export interface AutomationRunsFeed {
  items: AutomationRun[];
  nextCursor?: string;
}

/** Every rule's firings in one stream — the workspace-wide history. */
export const listAutomationRunsFeed = (
  params: AutomationRunsFeedParams = {},
): Promise<AutomationRunsFeed> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : "";
  return http.get<AutomationRunsFeed>(`${BASE}/runs${suffix}`);
};

/** Evaluate the rule against one job and render what it would send. Nothing is sent. */
export const testAutomation = (id: string, dealId: string): Promise<AutomationRun> =>
  http.post<AutomationRun>(`${BASE}/${id}/test`, { dealId });

export interface AutomationCoverageRow {
  id: string;
  name: string;
  runnable: boolean;
  reason?: string;
  trigger?: string;
  actions: string[];
  workizEnabled?: boolean;
  workizTriggered?: number;
  written: boolean;
}

export interface AutomationCoverage {
  rules: number;
  runnable: number;
  written: number;
  coverage: AutomationCoverageRow[];
}

/** Writes the translation of every imported Workiz rule to its row. */
export const migrateAutomations = (dryRun = false): Promise<AutomationCoverage> =>
  http.post<AutomationCoverage>(`${BASE}/migrate${dryRun ? "?dryRun=true" : ""}`, {});
