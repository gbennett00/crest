import { Suspense } from "react";
import { Clock, Crown } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getActivePlanId } from "@/lib/plan/active-plan";
import {
  listPendingInvitations,
  listPlanMembers,
  listUserPlans,
} from "@/lib/plan/invitations";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "@/components/members/invite-form";
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
      <Suspense fallback={<MembersSkeleton />}>
        <MembersContent />
      </Suspense>
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

async function MembersContent() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const planId = await getActivePlanId(supabase);
  const [members, plans] = await Promise.all([
    listPlanMembers(supabase, planId),
    listUserPlans(supabase),
  ]);

  const me = members.find((m) => m.userId === user?.id);
  const isOwner = me?.role === "owner";
  const activePlan = plans.find((p) => p.planId === planId);
  const invitations = isOwner
    ? await listPendingInvitations(supabase, planId)
    : [];

  return (
    <>
      {activePlan && (
        <p className="-mt-4 text-sm text-muted-foreground">
          Active plan: <span className="font-medium text-foreground">{activePlan.name}</span>
        </p>
      )}

      {plans.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your plans</h2>
          <PlanSwitcher plans={plans} activePlanId={planId} />
        </section>
      )}

      {isOwner ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Invite someone</h2>
            <p className="text-xs text-muted-foreground">
              They&apos;ll get an email inviting them to join this plan.
            </p>
          </div>
          <InviteForm />
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
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
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
                  <RevokeInvitationButton invitationId={inv.id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Members ({members.length})
        </h2>
        <ul className="divide-y rounded-lg border">
          {members.map((member) => {
            const isSelf = member.userId === user?.id;
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.email}
                    {isSelf && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
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
