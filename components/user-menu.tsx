"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Bell, Crown, Eye, EyeOff, Laptop, LogOut, Moon, Send, Sun, Upload, Users, UserRound } from "lucide-react";
import { usePrivacyMode } from "@/lib/privacy-mode";
import { setActivePlan } from "@/app/(app)/members/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { useMembers } from "@/lib/queries/members";
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
  const queryClient = useQueryClient();
  const { data: membersData } = useMembers();
  const [switchingPlan, startSwitchPlan] = useTransition();
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
        if (error) {
          // The browser already holds this PushManager subscription even
          // though the server never got a matching row — leaving it in
          // place would make the toggle read as "enabled" on every future
          // visit with nothing server-side to actually deliver to.
          await sub.unsubscribe();
          throw new Error(error);
        }
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

  function switchPlan(planId: string) {
    if (planId === membersData?.activePlanId) return;
    startSwitchPlan(async () => {
      const result = await setActivePlan(planId);
      if (result?.error) {
        console.error("Failed to switch plan", result.error);
        return;
      }
      // Every cached screen belongs to the previous plan.
      await invalidateAllLedgerQueries(queryClient);
      router.refresh();
    });
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
      <DropdownMenuContent align="end" className="w-64">
        {membersData && membersData.plans.length > 0 && (
          <>
            <DropdownMenuLabel
              inset
              className="py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Plans
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={membersData.activePlanId}
              onValueChange={switchPlan}
            >
              {membersData.plans.map((plan) => (
                <DropdownMenuRadioItem
                  key={plan.planId}
                  value={plan.planId}
                  disabled={switchingPlan}
                >
                  <span className="min-w-0 flex-1 truncate">{plan.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {plan.role === "owner" ? (
                      <>
                        <Crown size={12} /> Owner
                      </>
                    ) : (
                      "Shared"
                    )}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild className="pl-10">
          <Link href="/members">
            <Users size={ICON_SIZE} /> Members
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {mounted && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="pl-10">
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
                  <DropdownMenuRadioItem value="light">
                    <Sun size={ICON_SIZE} /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon size={ICON_SIZE} /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
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
        >
          {privacyMode ? <EyeOff size={ICON_SIZE} /> : <Eye size={ICON_SIZE} />}
          Hide amounts
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/import")} className="pl-10">
          <Upload size={ICON_SIZE} /> Import from YNAB
        </DropdownMenuItem>
        {notifSupported && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={subscribed ?? false}
              onCheckedChange={toggleNotifications}
              disabled={notifPending || subscribed === null}
            >
              <Bell size={ICON_SIZE} />
              Push notifications
            </DropdownMenuCheckboxItem>
            {subscribed && !isProduction && (
              <DropdownMenuItem
                onClick={handleTestPush}
                disabled={testStatus === "sending"}
                className="pl-10"
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
        <DropdownMenuItem onClick={logout} className="pl-10">
          <LogOut size={ICON_SIZE} /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
