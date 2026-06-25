import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/server/reminders/auth";
import { sendFixedReminder } from "@/server/reminders/fixed";

export const runtime = "nodejs";
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
  return POST(request);
}
