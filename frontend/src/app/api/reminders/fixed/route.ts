import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/server/reminders/auth";
import { sendFixedReminder } from "@/server/reminders/fixed";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  const type = new URL(request.url).searchParams.get("type") || "";
  try {
    return NextResponse.json(await sendFixedReminder(type));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send fixed reminder";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  if (process.env.GITHUB_PAGES === "true") {
    return NextResponse.json({ status: "disabled", reason: "Static export does not run reminder jobs" });
  }
  return POST(request);
}
