"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    magicLinkClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/two-factor";
      },
    }),
  ],
});

/** Map auth error codes to copy a person can act on. */
export function authErrorMessage(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  switch (err?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email first. We've sent you a new link.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters.";
    case "INVALID_TOKEN":
      return "This link has expired or was already used.";
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_CODE":
      return "That code isn't right. Try the current one.";
    default:
      if (err?.status === 429) return "Too many attempts. Wait a minute and try again.";
      return err?.message ?? "Something went wrong. Please try again.";
  }
}
