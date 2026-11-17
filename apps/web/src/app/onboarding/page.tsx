import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { requireUser } from "@/server/session";
import { sysDb } from "@/server/db";
import { eq, schema } from "@pti/db";
import { COUNTRY_CODES, countryName } from "@pti/core";
import { guessCountry } from "@/lib/locale-defaults";
import { safeNext } from "@/lib/safe-redirect";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { user } = await requireUser();
  const [membership] = await sysDb.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.userId, user.id)).limit(1);
  if (membership) redirect("/app");
  const { next } = await props.searchParams;
  const country = guessCountry((await headers()).get("accept-language")?.split(",")[0]);

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <Wordmark className="text-lg" />
      <p className="label-caps mt-14">Step 1 of 1</p>
      <h1 className="mt-2 text-4xl leading-tight">Tell us who's sending the invoices.</h1>
      <p className="text-ink-2 mt-3 max-w-md leading-relaxed">
        This becomes the header of every invoice: who you are, where you're based, and how you handle tax. You can change it
        later.
      </p>
      <div className="mt-12">
        <OnboardingForm
          defaultName={user.name}
          defaultCountry={country}
          next={safeNext(next, "/app?welcome=1")}
          countries={COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name))}
        />
      </div>
    </div>
  );
}
