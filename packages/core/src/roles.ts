/**
 * Organisation roles and the permissions they grant. Authorisation checks in
 * the app go through `allows()` so the matrix lives in exactly one place.
 */

export const ROLES = ["owner", "admin", "member", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "invoice:read"
  | "invoice:write"
  | "invoice:issue"
  | "invoice:send"
  | "payment:write"
  | "client:read"
  | "client:write"
  | "profile:write"
  | "report:read"
  | "export:run"
  | "member:manage"
  | "billing:manage"
  | "settings:write"
  | "apikey:manage"
  | "org:delete";

const ALL: readonly Permission[] = [
  "invoice:read",
  "invoice:write",
  "invoice:issue",
  "invoice:send",
  "payment:write",
  "client:read",
  "client:write",
  "profile:write",
  "report:read",
  "export:run",
  "member:manage",
  "billing:manage",
  "settings:write",
  "apikey:manage",
  "org:delete",
];

const MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((p) => p !== "org:delete" && p !== "billing:manage")),
  member: new Set<Permission>([
    "invoice:read",
    "invoice:write",
    "invoice:issue",
    "invoice:send",
    "payment:write",
    "client:read",
    "client:write",
    "report:read",
  ]),
  accountant: new Set<Permission>(["invoice:read", "client:read", "report:read", "export:run"]),
};

export function allows(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  accountant: "Accountant (read-only)",
};
