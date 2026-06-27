import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/reminders/auth";
import { sql } from "@/server/reminders/db";
import { parseSubscribePayload } from "@/server/reminders/payloads";
import { materializeUpcomingReminders } from "@/server/reminders/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  if (apiBase) {
    const response = await fetch(`${apiBase}/api/notifications/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("authorization")
          ? { Authorization: request.headers.get("authorization") as string }
          : {}),
      },
      body: await request.text(),
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const payload = parseSubscribePayload(await request.json());
    const rows = await sql()`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_name, platform, enabled)
      values (${user.id}, ${payload.endpoint}, ${payload.keys.p256dh}, ${payload.keys.auth}, ${payload.device_name || null}, ${payload.platform || null}, true)
      on conflict (user_id, endpoint)
      do update set
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_name = excluded.device_name,
        platform = excluded.platform,
        enabled = true,
        updated_at = now()
      returning id, enabled
    ` as Array<{ id: number; enabled: boolean }>;

    await materializeUpcomingReminders(new Date(), user.id);
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to subscribe device";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
