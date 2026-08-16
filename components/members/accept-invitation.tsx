"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/app/invite/actions";

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(token);
      if (result?.error) {
        setError(result.error);
      } else {
        // Land on the shared plan (accept made it the active one).
        router.replace("/");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={accept} disabled={isPending} className="w-full">
        {isPending ? "Joining…" : "Accept invitation"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
