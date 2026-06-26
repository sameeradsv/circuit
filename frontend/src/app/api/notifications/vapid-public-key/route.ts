import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ public_key: process.env.VAPID_PUBLIC_KEY ?? "" });
}
