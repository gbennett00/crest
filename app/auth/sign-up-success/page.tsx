import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription>Confirm your account to get started</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to your email. Click it to activate your
          account, then sign in.
        </p>
        <p className="text-sm text-center">
          <Link href="/auth/login" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
