import type {
  Role,
  User,
  CreateRoleRequest,
  UpdateRoleRequest,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";
import type { Schema } from "./lib";

/** All role endpoints live under the user service (`api/users` prefix). */

export function listRoles(): Promise<Role[]> {
  return http.get<Role[]>("/users/roles");
}

export function getRole(id: string): Promise<Role> {
  return http.get<Role>(`/users/roles/${id}`);
}

/** The resource → actions catalog that drives the permission matrix. */
export function getRoleSchema(): Promise<Schema> {
  return http.get<Schema>("/users/roles/schema");
}

export function createRole(body: CreateRoleRequest): Promise<Role> {
  return http.post<Role>("/users/roles", body);
}

/** Partial update — but permissions/dataScope/transitions are full replacements. */
export function updateRole(id: string, body: UpdateRoleRequest): Promise<Role> {
  return http.put<Role>(`/users/roles/${id}`, body);
}

export function deleteRole(id: string): Promise<null> {
  return http.delete<null>(`/users/roles/${id}`);
}

export function listRoleMembers(id: string): Promise<User[]> {
  return http.get<User[]>(`/users/roles/${id}/users`);
}
