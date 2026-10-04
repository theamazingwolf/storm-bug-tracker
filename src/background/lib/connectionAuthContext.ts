const CONNECTION_ID = Symbol("storm-bug-tracker.connectionId");

type AuthWithConnectionId<A extends object> = A & { [CONNECTION_ID]?: string };

export function bindConnectionId<A extends object>(auth: A, connectionId: string): A {
  return { ...auth, [CONNECTION_ID]: connectionId } as AuthWithConnectionId<A>;
}

export function connectionIdFromAuth(auth: object): string | undefined {
  return (auth as AuthWithConnectionId<object>)[CONNECTION_ID];
}

export function oauthGrantIdentity(auth: object): string {
  const value = auth as Record<string, unknown>;
  const issued = typeof value.grantedAt === "number" ? value.grantedAt : "unissued";
  const providerId = typeof value.viewerId === "string" || typeof value.viewerId === "number" ? value.viewerId : "unknown";
  return `${String(value.kind)}:${issued}:${providerId}`;
}
