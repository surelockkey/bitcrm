import type { SecuritySettings, UpdateSecuritySettingsRequest } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The account's security settings (Settings → Security Center). Any signed-in user may read them. */
export function getSecuritySettings(): Promise<SecuritySettings> {
  return http.get<SecuritySettings>("/users/security-settings");
}

/** Flip any of the switches (`settings.edit`). The server answers the whole row. */
export function updateSecuritySettings(body: UpdateSecuritySettingsRequest): Promise<SecuritySettings> {
  return http.put<SecuritySettings>("/users/security-settings", body);
}
