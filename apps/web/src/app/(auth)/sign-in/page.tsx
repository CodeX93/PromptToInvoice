import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";
import type { OAuthProvider } from "@/components/auth/oauth-buttons";
import { features } from "@/server/env";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const { next, error } = await props.searchParams;
  const providers: OAuthProvider[] = [];
  if (features.google) providers.push("google");
  if (features.microsoft) providers.push("microsoft");
  return (
    <SignInForm
      next={safeNext(next)}
      providers={providers}
      notice={
        error === "two_factor_required"
          ? "Your account uses two-factor authentication. Sign in with your password and code."
          : undefined
      }
    />
  );
}
