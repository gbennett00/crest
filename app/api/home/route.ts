import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/budget";
import { createServerTimer } from "@/lib/server-timing";

// Same query the home page's Server Component ran, exposed as JSON for the
// client-side query cache (lib/queries/home.ts).
export async function GET() {
  const timer = createServerTimer("/api/home");
  try {
    const data = await getHomeData(timer);
    timer.log();
    return NextResponse.json(data, { headers: { "Server-Timing": timer.header() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
