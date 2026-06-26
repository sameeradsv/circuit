import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/server/reminders/auth";
import { processDueReminders } from "@/server/reminders/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  const result = await processDueReminders();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  if (process.env.GITHUB_PAGES === "true") {
    return NextResponse.json({ status: "disabled", reason: "Static export does not run reminder jobs" });
  }
  return POST(request);
}
