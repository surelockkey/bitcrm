import type {
  User,
  Role,
  CreateUserRequest,
  UpdateUserRequest,
  PaginatedResponse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

/** Single active server filter (backend applies only one, precedence-ordered). */
export interface UserFilter {
  roleId?: string;
  department?: string;
  status?: string;
}

function toQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listUsers(
  filter: UserFilter,
  cursor?: string,
): Promise<PaginatedResponse<User>> {
  return apiFetchPaginated<User>(
    `/users${toQuery({ ...filter, cursor, limit: "50" })}`,
  );
}

export function getUser(id: string): Promise<User> {
  return http.get<User>(`/users/${id}`);
}

export function createUser(body: CreateUserRequest): Promise<User> {
  return http.post<User>("/users", body);
}

export function updateUser(id: string, body: UpdateUserRequest): Promise<User> {
  return http.put<User>(`/users/${id}`, body);
}

export function assignRole(id: string, roleId: string): Promise<User> {
  return http.put<User>(`/users/${id}/role`, { roleId });
}

export function resendInvite(id: string): Promise<null> {
  return http.post<null>(`/users/${id}/invite`);
}

export function deactivateUser(id: string): Promise<null> {
  return http.delete<null>(`/users/${id}`);
}

export function reactivateUser(id: string): Promise<null> {
  return http.post<null>(`/users/${id}/reactivate`);
}

export function listRoles(): Promise<Role[]> {
  return http.get<Role[]>("/users/roles");
}
