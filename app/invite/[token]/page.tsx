import { Suspense } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getInvitationDetails, normalizeEmail } from "@/lib/plan/invitations";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInvitation } from "@/components/members/accept-invitation";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<InfoCard title="Loading invitation…" description="" />}>
      <InviteContent params={params} />
    </Suspense>
  );
}

async function InviteContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const details = await getInvitationDetails(supabase, token);

  if (!details) {
    return (
      <InfoCard
        title="Invitation not found"
        description="This invite link is invalid. Ask whoever invited you to send a new one."
      />
    );
  }

  if (details.status === "accepted") {
    return (
      <InfoCard
        title="Invitation already accepted"
        description={`You've already joined “${details.planName}”.`}
        action={
          <Button asChild className="w-full">
            <Link href="/">Go to Crest</Link>
          </Button>
        }
      />
    );
  }

  if (details.status === "revoked") {
    return (
      <InfoCard
        title="Invitation revoked"
        description={`This invitation to “${details.planName}” is no longer active.`}
      />
    );
  }

  if (details.expired) {
    return (
      <InfoCard
        title="Invitation expired"
        description={`This invitation to “${details.planName}” has expired. Ask ${details.inviterEmail} to invite you again.`}
      />
    );
  }

  // Pending & valid — show the intro, then route to accept or to auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const inviteePath = `/invite/${token}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          You&apos;re invited to join {details.planName}
        </CardTitle>
        <CardDescription>
          <strong className="text-foreground">{details.inviterEmail}</strong>{" "}
          has invited you to collaborate on the{" "}
          <strong className="text-foreground">{details.planName}</strong> budget
          in Crest — a shared, zero-based budgeting workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Invitation sent to{" "}
          <span className="font-medium text-foreground">
            {details.inviteeEmail}
          </span>
          . It expires 7 days after it was sent.
        </div>

        {!user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in or create your account to accept. Use the email above so we
              can match your invitation.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href={`/auth/sign-up?next=${encodeURIComponent(inviteePath)}`}>
                  Create an account
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/auth/login?next=${encodeURIComponent(inviteePath)}`}>
                  I already have an account
                </Link>
              </Button>
            </div>
          </>
        ) : normalizeEmail(user.email ?? "") === normalizeEmail(details.inviteeEmail) ? (
          <AcceptInvitation token={token} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This invitation was sent to{" "}
              <span className="font-medium text-foreground">
                {details.inviteeEmail}
              </span>
              , but you&apos;re signed in as{" "}
              <span className="font-medium text-foreground">{user.email}</span>.
              Sign in with the invited address to accept.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/auth/login?next=${encodeURIComponent(inviteePath)}`}>
                Switch account
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoCard({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}
