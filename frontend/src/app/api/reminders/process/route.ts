import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/server/reminders/auth";
import { processDueReminders } from "@/server/reminders/scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  const result = await processDueReminders();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
