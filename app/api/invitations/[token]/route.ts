// TODO(charles): re-implement against agent task/notification model.
// Was Chippi CRM (Invitation / BrokerageMembership / notifyBroker); gutted
// in the fork cleanup. Returns 404 so the team-invite flow gracefully
// surfaces "invitation not found" instead of crashing.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Params) {
  await params; // preserve the dynamic-param contract
  return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
}

export async function POST(_req: Request, { params }: Params) {
  await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
}
