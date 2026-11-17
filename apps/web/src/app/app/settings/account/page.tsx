import type { Metadata } from "next";
import { headers } from "next/headers";
import { Section } from "@/components/ui/section";
import { auth } from "@/server/auth";
import { requireOrg } from "@/server/session";
import { ChangePassword, DeleteAccount, ProfileBasics, Sessions } from "./account-forms";
import { TwoFactor } from "./two-factor";

export const metadata: Metadata = { title: "Account & security" };

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export default async function AccountPage() {
  const ctx = await requireOrg();
  const sessions = await auth.api.listSessions({ headers: await headers() });
  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.user.timeZone,
  });
  return (
    <>
      <Section title="Profile" description={ctx.user.email}>
        <ProfileBasics
          name={ctx.user.name}
          timeZone={ctx.user.timeZone}
          zones={["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")]}
        />
      </Section>
      <Section title="Password">
        <ChangePassword />
      </Section>
      <Section
        title="Two-step verification"
        description="Require a code from your phone when signing in. Strongly recommended for owners."
      >
        <TwoFactor enabled={ctx.user.twoFactorEnabled} />
      </Section>
      <Section title="Signed-in devices">
        <Sessions
          sessions={sessions
            .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
            .map((s) => ({
              id: s.id,
              token: s.token,
              device: describeAgent(s.userAgent),
              ip: s.ipAddress ?? null,
              lastSeen: fmt.format(new Date(s.updatedAt)),
              current: s.id === ctx.sessionId,
            }))}
        />
      </Section>
      <Section title="Delete account" description="Removes your login and personal data. If you're the only owner of an organisation, transfer ownership or delete the organisation first.">
        <DeleteAccount />
      </Section>
    </>
  );
}
