import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  if (apiBase) {
    const response = await fetch(`${apiBase}/api/notifications/vapid-public-key`, {
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  }
  return NextResponse.json({ public_key: process.env.VAPID_PUBLIC_KEY ?? "" });
}
