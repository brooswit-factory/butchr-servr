export const MANAGEMENT_SCOPES=['authorizations:read','authorizations:create','authorizations:revoke','rules:read','rules:write','briefs:read','briefs:write','deployments:read'] as const;
export type ManagementScope=typeof MANAGEMENT_SCOPES[number];
