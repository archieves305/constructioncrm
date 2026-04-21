import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  findPropertyCandidates,
  listPropertyUnits,
} from "@/lib/integrations/buildium/properties";
import {
  BuildiumError,
  BuildiumNotConfiguredError,
  isBuildiumConfigured,
} from "@/lib/integrations/buildium/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  if (!isBuildiumConfigured()) {
    return NextResponse.json(
      {
        error:
          "Buildium is not configured. Set BUILDIUM_CLIENT_ID and BUILDIUM_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      buildiumPropertyId: true,
      lead: {
        select: {
          propertyAddress1: true,
          city: true,
          state: true,
          zipCode: true,
        },
      },
    },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const candidates = await findPropertyCandidates({
      address1: job.lead.propertyAddress1,
      city: job.lead.city,
      state: job.lead.state,
      zip: job.lead.zipCode,
    });

    const units = job.buildiumPropertyId
      ? await listPropertyUnits(job.buildiumPropertyId)
      : [];

    return NextResponse.json({ candidates, units });
  } catch (e) {
    if (e instanceof BuildiumNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof BuildiumError) {
      return NextResponse.json(
        { error: e.message, buildiumStatus: e.status },
        { status: 502 },
      );
    }
    const message = e instanceof Error ? e.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const buildiumPropertyId =
    typeof body.buildiumPropertyId === "string"
      ? body.buildiumPropertyId
      : null;
  const buildiumUnitId =
    typeof body.buildiumUnitId === "string" && body.buildiumUnitId
      ? body.buildiumUnitId
      : null;

  if (!buildiumPropertyId) {
    return NextResponse.json(
      { error: "buildiumPropertyId is required" },
      { status: 400 },
    );
  }

  const job = await prisma.job.update({
    where: { id },
    data: { buildiumPropertyId, buildiumUnitId },
    select: {
      id: true,
      buildiumPropertyId: true,
      buildiumUnitId: true,
    },
  });

  return NextResponse.json(job);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  await prisma.job.update({
    where: { id },
    data: { buildiumPropertyId: null, buildiumUnitId: null },
  });
  return NextResponse.json({ ok: true });
}
