"use client";

import { useRouter } from "next/navigation";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

function setTheme(t: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function UserMenu({
  name,
  email,
  orgName,
}: {
  name: string;
  email: string;
  orgName: string;
}) {
  const router = useRouter();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Menu>
      <MenuTrigger className="hover:bg-paper-sunk flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left outline-none">
        <span className="border-rule-strong bg-paper-raised figures text-2xs grid size-7 place-items-center rounded-full border">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{name}</span>
          <span className="text-ink-3 text-2xs block truncate">{orgName}</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        <MenuLabel>{email}</MenuLabel>
        <MenuItem onSelect={() => router.push("/app/settings/account")}>
          Account &amp; security
        </MenuItem>
        <MenuItem onSelect={() => router.push("/app/settings")}>Organisation settings</MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuItem onSelect={() => setTheme("light")}>Paper</MenuItem>
        <MenuItem onSelect={() => setTheme("dark")}>Carbon</MenuItem>
        <MenuItem onSelect={() => setTheme("system")}>Match system</MenuItem>
        <MenuSeparator />
        <MenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.replace("/sign-in");
            router.refresh();
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
