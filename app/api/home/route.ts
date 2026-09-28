import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/budget";

// Same query the home page's Server Component ran, exposed as JSON for the
// client-side query cache (lib/queries/home.ts).
export async function GET() {
  try {
    return NextResponse.json(await getHomeData());
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
