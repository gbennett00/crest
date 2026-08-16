"use client";

import { useRef, useState, useTransition } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteMember } from "@/app/(app)/members/actions";
import { CopyLink } from "@/components/members/copy-link";

export function InviteForm() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ email: string; link: string; delivered: boolean } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setNotice(null);
    const email = (formData.get("email") as string)?.trim() ?? "";
    startTransition(async () => {
      const result = await inviteMember(formData);
      if (result?.error) {
        setError(result.error);
      } else if (result?.success) {
        setNotice({
          email,
          link: result.inviteUrl ?? "",
          delivered: Boolean(result.delivered),
        });
        formRef.current?.reset();
      }
    });
  }

  return (
    <div className="space-y-3">
      <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-1.5 flex-1">
          <Label htmlFor="invite-email">Email address</Label>
          <div className="relative">
            <Mail
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="person@example.com"
              required
              className="pl-9"
            />
          </div>
        </div>
        <Button type="submit" disabled={isPending} className="gap-1.5">
          <Send size={15} />
          {isPending ? "Sending…" : "Send invite"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {notice && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
          <p className="font-medium">Invitation sent to {notice.email}</p>
          <p className="text-muted-foreground">
            {notice.delivered
              ? "They'll get an email with a link to join. It expires in 7 days."
              : "Email delivery isn't configured here, so share this link directly. It expires in 7 days."}
          </p>
          {notice.link && <CopyLink url={notice.link} />}
        </div>
      )}
    </div>
  );
}
