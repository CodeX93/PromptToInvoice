import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";
import type { OAuthProvider } from "@/components/auth/oauth-buttons";
import { features } from "@/server/env";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage(props: PageProps<"/sign-up">) {
  const { next } = await props.searchParams;
  const providers: OAuthProvider[] = [];
  if (features.google) providers.push("google");
  if (features.microsoft) providers.push("microsoft");
  return <SignUpForm next={safeNext(next)} providers={providers} />;
}
