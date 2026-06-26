import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/reminders/auth";
import { sendToUserDevices } from "@/server/reminders/push";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const payload = await request.json();
  if (!payload?.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const result = await sendToUserDevices(user.id, payload);
  return NextResponse.json(result);
}
