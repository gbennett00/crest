import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getActivePlanId } from "@/lib/plan/active-plan";
import {
  listPendingInvitations,
  listPlanMembers,
  listUserPlans,
  type PlanInvitation,
  type PlanMember,
  type UserPlan,
} from "@/lib/plan/invitations";

export type MembersResponse = {
  activePlanId: string;
  activePlanName: string | null;
  currentUserId: string;
  isOwner: boolean;
  members: PlanMember[];
  plans: UserPlan[];
  invitations: PlanInvitation[];
};

// Members/plans data for the client-side query cache (lib/queries/members.ts).
// Lives in a route handler rather than the page's Server Component so the
// Supabase session can refresh itself here (route handlers can write cookies;
// RSCs can't), matching how every other data screen in the app loads.
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const planId = await getActivePlanId(supabase);
    const [members, plans] = await Promise.all([
      listPlanMembers(supabase, planId),
      listUserPlans(supabase),
    ]);

    const isOwner = members.find((m) => m.userId === user.id)?.role === "owner";
    const invitations = isOwner
      ? await listPendingInvitations(supabase, planId)
      : [];
    const activePlanName = plans.find((p) => p.planId === planId)?.name ?? null;

    const body: MembersResponse = {
      activePlanId: planId,
      activePlanName,
      currentUserId: user.id,
      isOwner,
      members,
      plans,
      invitations,
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
