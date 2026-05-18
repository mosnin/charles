// TODO(charles): re-implement against agent task/notification model.
// Was Chippi CRM (Tour / Lead / Waitlist / BrokerageMembership); gutted in
// the fork cleanup so callers get an empty list rather than a crash.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ notifications: [] });
}
