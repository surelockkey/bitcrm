import type { AutomationRule, AutomationRun, AutomationSpec } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The Automation Center lives under the messaging gateway route. */
const BASE = "/messaging/automations";

export const listAutomations = (): Promise<AutomationRule[]> => http.get<AutomationRule[]>(BASE);

export const getAutomation = (id: string): Promise<AutomationRule> =>
  http.get<AutomationRule>(`${BASE}/${id}`);

export interface UpdateAutomationBody {
  enabled?: boolean;
  name?: string;
  spec?: AutomationSpec;
}

export const updateAutomation = (id: string, body: UpdateAutomationBody): Promise<AutomationRule> =>
  http.patch<AutomationRule>(`${BASE}/${id}`, body);

/** The rule's last firings, newest first (30-day history). */
export const listAutomationRuns = (id: string, limit = 20): Promise<AutomationRun[]> =>
  http.get<AutomationRun[]>(`${BASE}/${id}/runs?limit=${limit}`);

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
