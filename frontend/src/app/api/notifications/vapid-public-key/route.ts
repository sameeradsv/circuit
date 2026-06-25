import { NextResponse } from "next/server";
import { reminderConfig } from "@/server/reminders/env";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ public_key: reminderConfig.vapidPublicKey() });
}
