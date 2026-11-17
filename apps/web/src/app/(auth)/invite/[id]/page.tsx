import type { Metadata, Route } from "next";
import Link from "next/link";
import { ROLE_LABEL, isRole } from "@pti/core";
import { eq, schema } from "@pti/db";
import { sysDb } from "@/server/db";
import { getSession } from "@/server/session";
import { AcceptInvitation } from "./accept";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage(props: PageProps<"/invite/[id]">) {
  const { id } = await props.params;
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const [inv] = valid
    ? await sysDb
        .select({
          email: schema.invitations.email,
          role: schema.invitations.role,
          status: schema.invitations.status,
          expiresAt: schema.invitations.expiresAt,
          org: schema.organizations.name,
          inviter: schema.users.name,
        })
        .from(schema.invitations)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.invitations.organizationId),
        )
        .innerJoin(schema.users, eq(schema.users.id, schema.invitations.inviterId))
        .where(eq(schema.invitations.id, id))
        .limit(1)
    : [];

  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) {
    return (
      <div>
        <h1 className="text-3xl">Invitation unavailable</h1>
        <p className="text-ink-2 mt-3">
          It may have expired, been revoked or already been used. Ask for a new one.
        </p>
      </div>
    );
  }

  const session = await getSession();
  const here = `/invite/${id}`;
  return (
    <div>
      <p className="label-caps">Invitation</p>
      <h1 className="mt-2 text-3xl leading-tight">Join {inv.org}</h1>
      <p className="text-ink-2 mt-3 leading-relaxed">
        {inv.inviter} invited <span className="text-ink">{inv.email}</span> to join as{" "}
        {isRole(inv.role) ? ROLE_LABEL[inv.role] : inv.role}.
      </p>
      {!session ? (
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={`/sign-up?next=${encodeURIComponent(here)}` as Route}
            className="bg-ink text-paper grid h-11 place-items-center rounded-sm text-[15px] font-medium"
          >
            Create an account to accept
          </Link>
          <Link
            href={`/sign-in?next=${encodeURIComponent(here)}` as Route}
            className="text-ink-2 text-center text-sm underline underline-offset-4"
          >
            I already have an account
          </Link>
        </div>
      ) : session.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
        <p className="border-warning bg-warning-soft text-warning mt-8 border-l-2 px-3 py-2 text-sm">
          You're signed in as {session.user.email}. Sign in as {inv.email} to accept.
        </p>
      ) : (
        <AcceptInvitation id={id} />
      )}
    </div>
  );
}
