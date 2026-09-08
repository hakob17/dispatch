import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  const blocks = await db.contentBlock.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(blocks);
}

const blockSchema = z.object({
  name: z.string().min(1).regex(/^[\w-]+$/, "letters, digits, _ and - only"),
  content: z.string(),
});

export async function POST(req: NextRequest) {
  const body = blockSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const block = await db.contentBlock.create({ data: body.data });
    return NextResponse.json(block, { status: 201 });
  } catch {
    return NextResponse.json({ error: "name already exists" }, { status: 409 });
  }
}
