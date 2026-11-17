import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink, organization, twoFactor } from "better-auth/plugins";
import { adminAc, defaultAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { schema, newId } from "@pti/db";
import { sysDb } from "./db";
import { env, features } from "./env";
import { sendEmail } from "./email/transport";
import * as templates from "./email/templates";
import { hit } from "./rate-limit";
import { logger } from "./logger";

/**
 * Authentication: email + password (verified), magic links, Google and
 * Microsoft OAuth, TOTP two-factor, and organisations with invitations.
 *
 * Auth tables have no RLS and are accessed through the system pool;
 * tenant data never is. Organisations are created through our onboarding
 * service (one transaction with the business profile), so direct creation
 * via the auth API is disabled.
 */

const accountant = defaultAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
});

export const auth = betterAuth({
  appName: "PromptToInvoice",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(sysDb, {
    provider: "pg",
    usePlural: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
      organizations: schema.organizations,
      members: schema.members,
      invitations: schema.invitations,
      twoFactors: schema.twoFactors,
    },
  }),
  advanced: {
    cookiePrefix: "pti",
    useSecureCookies: env.NODE_ENV === "production",
    database: { generateId: () => newId() },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "en", input: true },
      timeZone: { type: "string", required: false, defaultValue: "UTC", input: true },
    },
    deleteUser: { enabled: true },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 60 * 24,
    // Signed cookie cache: most requests resolve the session without a DB round-trip.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const t = templates.resetPassword({ name: user.name, url });
      await sendEmail({ to: [user.email], ...t, tag: "password-reset" });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      const t = templates.verifyEmail({ name: user.name, url });
      await sendEmail({ to: [user.email], ...t, tag: "verify-email" });
    },
  },
  socialProviders: {
    ...(features.google && {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
        prompt: "select_account",
      },
    }),
    ...(features.microsoft && {
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID ?? "",
        clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
        tenantId: "common",
      },
    }),
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google", "microsoft"] },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 5 },
      "/forget-password": { window: 3600, max: 5 },
      "/request-password-reset": { window: 3600, max: 5 },
      "/sign-in/magic-link": { window: 600, max: 5 },
      "/two-factor/verify-totp": { window: 300, max: 10 },
    },
    customStorage: {
      consume: async (key, rule) => {
        const r = await hit(`auth:${key}`, { limit: rule.max, windowSeconds: rule.window });
        return { allowed: r.allowed, retryAfter: r.allowed ? null : r.resetIn };
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: (user) => {
          logger.info({ userId: user.id }, "user signed up");
          return Promise.resolve();
        },
      },
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      roles: { owner: ownerAc, admin: adminAc, member: memberAc, accountant },
      sendInvitationEmail: async ({ email, role, organization: org, inviter, id }) => {
        const t = templates.invitation({
          inviter: inviter.user.name,
          org: org.name,
          role,
          url: `${env.APP_URL}/invite/${id}`,
        });
        await sendEmail({ to: [email], ...t, tag: "invitation" });
      },
    }),
    twoFactor({ issuer: "PromptToInvoice", backupCodeOptions: { amount: 10, length: 10 } }),
    magicLink({
      expiresIn: 600,
      disableSignUp: false,
      sendMagicLink: async ({ email, url }) => {
        const t = templates.magicLink({ url });
        await sendEmail({ to: [email], ...t, tag: "magic-link" });
      },
    }),
    // Must be last: lets server actions set auth cookies.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
