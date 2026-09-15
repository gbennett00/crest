import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/budget";

// Same query the home page's Server Component ran, exposed as JSON for the
// client-side query cache (lib/queries/home.ts).
export async function GET() {
  const data = await getHomeData();
  return NextResponse.json(data);
}
