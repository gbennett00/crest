"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, Eye, EyeOff, Laptop, LogOut, Moon, Send, Sun, Upload, UserRound } from "lucide-react";
import { usePrivacyMode } from "@/lib/privacy-mode";
import { createClient } from "@/lib/supabase/client";
import {
  getExistingSubscription,
  pushSupported,
  subscribeToPushManager,
} from "@/lib/push/client-subscribe";
import {
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/actions";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICON_SIZE = 15;

const THEME_META = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Laptop },
} as const;

export function UserMenu({ isProduction = false }: { isProduction?: boolean }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { privacyMode, togglePrivacyMode } = usePrivacyMode();
  const [mounted, setMounted] = useState(false);
  const [notifSupported, setNotifSupported] = useState(false);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [notifPending, setNotifPending] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // next-themes is only correct after mount; gate theme UI to avoid a hydration
  // mismatch on the active radio item.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!pushSupported()) return;
    setNotifSupported(true);
    getExistingSubscription().then((sub) => setSubscribed(!!sub));
  }, []);

  async function toggleNotifications(checked: boolean) {
    setNotifPending(true);
    try {
      if (checked) {
        const sub = await subscribeToPushManager();
        const json = sub.toJSON() as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        const { error } = await subscribeToPush({
          endpoint: json.endpoint,
          keys: json.keys,
        });
        if (error) throw new Error(error);
        setSubscribed(true);
      } else {
        const sub = await getExistingSubscription();
        if (sub) {
          await unsubscribeFromPush(sub.endpoint);
          await sub.unsubscribe();
        }
        setSubscribed(false);
      }
    } catch (err) {
      console.error("Failed to toggle push notifications", err);
    } finally {
      setNotifPending(false);
    }
  }

  async function handleTestPush() {
    setTestStatus("sending");
    const { error } = await sendTestPush();
    setTestStatus(error ? "error" : "sent");
    setTimeout(() => setTestStatus("idle"), 3000);
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Account menu"
        >
          <UserRound size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {mounted && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 pl-8">
              {(() => {
                const current = THEME_META[(theme as keyof typeof THEME_META) ?? "system"] ?? THEME_META.system;
                const CurrentIcon = current.Icon;
                return (
                  <>
                    <CurrentIcon size={ICON_SIZE} />
                    Theme
                    <span className="ml-auto mr-1 text-xs text-muted-foreground">
                      {current.label}
                    </span>
                  </>
                );
              })()}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light" className="gap-2">
                    <Sun size={ICON_SIZE} /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark" className="gap-2">
                    <Moon size={ICON_SIZE} /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system" className="gap-2">
                    <Laptop size={ICON_SIZE} /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={privacyMode}
          onCheckedChange={togglePrivacyMode}
          className="gap-2"
        >
          {privacyMode ? <EyeOff size={ICON_SIZE} /> : <Eye size={ICON_SIZE} />}
          Hide amounts
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/import")} className="gap-2 pl-8">
          <Upload size={ICON_SIZE} /> Import from YNAB
        </DropdownMenuItem>
        {notifSupported && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={subscribed ?? false}
              onCheckedChange={toggleNotifications}
              disabled={notifPending || subscribed === null}
              className="gap-2"
            >
              <Bell size={ICON_SIZE} />
              Push notifications
            </DropdownMenuCheckboxItem>
            {subscribed && !isProduction && (
              <DropdownMenuItem
                onClick={handleTestPush}
                disabled={testStatus === "sending"}
                className="gap-2 pl-8"
              >
                <Send size={ICON_SIZE} />
                {testStatus === "sent"
                  ? "Sent!"
                  : testStatus === "error"
                    ? "Failed to send"
                    : "Send test notification"}
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="gap-2 pl-8">
          <LogOut size={ICON_SIZE} /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
