import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/reminders/auth";
import { sql } from "@/server/reminders/db";
import { parseUnsubscribePayload } from "@/server/reminders/payloads";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  if (apiBase) {
    const response = await fetch(`${apiBase}/api/notifications/unsubscribe`, {
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
    const payload = parseUnsubscribePayload(await request.json());
    await sql()`
      update push_subscriptions
      set enabled = false, updated_at = now()
      where user_id = ${user.id}
        and endpoint = ${payload.endpoint}
    `;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to unsubscribe device";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
