"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, Eye, EyeOff, Laptop, LogOut, Moon, Send, Sun, UserRound } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICON_SIZE = 15;

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
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {mounted && (
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
                className="gap-2"
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
        <DropdownMenuItem onClick={logout} className="gap-2">
          <LogOut size={ICON_SIZE} /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
