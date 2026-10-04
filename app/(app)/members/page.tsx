"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Clock, Crown } from "lucide-react";

import { useMembers, invalidateMembers } from "@/lib/queries/members";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { useHasMounted } from "@/lib/use-has-mounted";
import { LoadError } from "@/components/load-error";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "@/components/members/invite-form";
import { CopyLink } from "@/components/members/copy-link";
import { PlanSwitcher } from "@/components/members/plan-switcher";
import {
  RemoveMemberButton,
  RevokeInvitationButton,
} from "@/components/members/member-actions";

export default function MembersPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          People who can view and edit this plan.
        </p>
      </div>
      <MembersContent />
    </div>
  );
}

function MembersSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-24 rounded-xl border bg-muted/40" />
      <div className="h-32 rounded-lg border bg-muted/40" />
    </div>
  );
}

function inviteLinkBase(): string {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envBase) return envBase;
  return typeof window !== "undefined" ? window.location.origin : "";
}

function MembersContent() {
  const hasMounted = useHasMounted();
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useMembers();

  if (hasMounted && !data && error) {
    return (
      <LoadError what="members" error={error as Error} onRetry={() => refetch()} />
    );
  }
  if (!hasMounted || (isPending && !data)) {
    return <MembersSkeleton />;
  }

  const { members, plans, invitations, isOwner, currentUserId, activePlanId, activePlanName } =
    data!;
  const base = inviteLinkBase();

  return (
    <>
      {activePlanName && (
        <p className="-mt-4 text-sm text-muted-foreground">
          Active plan:{" "}
          <span className="font-medium text-foreground">{activePlanName}</span>
        </p>
      )}

      {plans.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your plans</h2>
          <PlanSwitcher
            plans={plans}
            activePlanId={activePlanId}
            onSwitched={() => invalidateAllLedgerQueries(queryClient)}
          />
        </section>
      )}

      {isOwner ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Invite someone</h2>
            <p className="text-xs text-muted-foreground">
              Create an invite link and send it to the person yourself.
            </p>
          </div>
          <InviteForm onInvited={() => invalidateMembers(queryClient)} />
        </section>
      ) : (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Only the plan&apos;s creator can invite or remove members.
        </p>
      )}

      {isOwner && invitations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Pending invitations</h2>
          <ul className="divide-y rounded-lg border">
            {invitations.map((inv) => (
              <li key={inv.id} className="px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {inv.expired ? "Expired" : "Invitation pending"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {inv.expired && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Expired
                      </Badge>
                    )}
                    <RevokeInvitationButton
                      invitationId={inv.id}
                      onRevoked={() => invalidateMembers(queryClient)}
                    />
                  </div>
                </div>
                {!inv.expired && <CopyLink url={`${base}/invite/${inv.token}`} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Members ({members.length})</h2>
        <ul className="divide-y rounded-lg border">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.email}
                    {isSelf && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {member.role === "owner" ? (
                      <>
                        <Crown size={12} /> Creator
                      </>
                    ) : (
                      "Member"
                    )}
                  </p>
                </div>
                {isOwner && member.role !== "owner" && (
                  <RemoveMemberButton
                    userId={member.userId}
                    email={member.email}
                    onRemoved={() => invalidateMembers(queryClient)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
