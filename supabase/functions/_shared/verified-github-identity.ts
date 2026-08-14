interface IdentityRecord {
  provider?: unknown;
  user_id?: unknown;
  identity_data?: unknown;
}

export interface VerifiedGithubIdentity {
  provider: "github";
  user_id: string;
  provider_id: string;
}

export function verifiedGithubIdentity(identity: IdentityRecord): VerifiedGithubIdentity | null {
  const identityData = identity.identity_data;
  if (
    identity.provider !== "github" ||
    typeof identity.user_id !== "string" ||
    !identityData ||
    typeof identityData !== "object"
  ) {
    return null;
  }

  const providerId = (identityData as Record<string, unknown>).provider_id;
  if (typeof providerId !== "string" || providerId.trim().length === 0) return null;

  return {
    provider: "github",
    user_id: identity.user_id,
    provider_id: providerId.trim(),
  };
}
