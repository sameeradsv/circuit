import { NextRequest, NextResponse } from "next/server";
import { sql } from "./db";

export type AuthenticatedUser = {
  id: number;
  username: string;
};

export async function requireUser(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const rows = await sql()`
    select users.id, users.username
    from auth_sessions
    join users on users.id = auth_sessions.user_id
    where auth_sessions.token = ${match[1]}
      and auth_sessions.expires_at > now()
    limit 1
  ` as AuthenticatedUser[];

  if (!rows[0]) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }
  return rows[0];
}

export function requireCron(request: NextRequest): NextResponse | null {
  const expected = `Bearer ${process.env.REMINDER_CRON_SECRET || ""}`;
  if (!process.env.REMINDER_CRON_SECRET) {
    return NextResponse.json({ error: "Reminder processing is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "Invalid reminder processor token" }, { status: 401 });
  }
  return null;
}
