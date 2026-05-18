import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const VALID_GOAL_TYPES = [
  'follow_up_sequence',
  'tour_booking',
  'offer_progress',
  'deal_close',
  'reengagement',
  'custom',
] as const;

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('AgentGoal')
    .select('*')
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { goalType, description, instructions, priority } = body;

  if (!goalType || !(VALID_GOAL_TYPES as readonly string[]).includes(goalType)) {
    return NextResponse.json(
      { error: `goalType must be one of: ${VALID_GOAL_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof description !== 'string' || description.length < 1 || description.length > 1000) {
    return NextResponse.json(
      { error: 'description must be between 1 and 1000 characters' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('AgentGoal')
    .insert({
      spaceId: space.id,
      goalType,
      description,
      instructions: instructions ?? null,
      priority: typeof priority === 'number' ? priority : 0,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
