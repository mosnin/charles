import OpenAI from 'openai';
import { embedText } from '@/lib/embeddings';
import { searchVectors } from '@/lib/zilliz';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function textStream(message: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(message));
      controller.close();
    }
  });
}

/**
 * Sanitize untrusted CRM data before embedding in the AI prompt context.
 * Strips prompt-injection patterns, ChatML tokens, delimiters, and zero-width Unicode.
 */
function sanitizeCrmText(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input;
  // Strip zero-width Unicode characters (U+200B, U+200C, U+200D, U+FEFF, U+2060, U+00AD)
  s = s.replace(/[\u200B\u200C\u200D\uFEFF\u2060\u00AD]/g, '');
  // Strip ChatML tokens
  s = s.replace(/<\|im_start\|>/gi, '').replace(/<\|im_end\|>/gi, '');
  // Strip prompt delimiters (===, ###, triple backticks)
  s = s.replace(/={3,}/g, '').replace(/#{3,}/g, '').replace(/`{3,}/g, '');
  // Strip newlines followed by instruction-like patterns
  s = s.replace(/\n\s*(IGNORE|SYSTEM|ACTION|ASSISTANT|USER|HUMAN|INSTRUCTION|OVERRIDE|FORGET|DISREGARD)[:\s]/gi, '\n');
  return s;
}

export async function chatWithRAG(
  messages: ChatMessage[],
  spaceId: string,
  spaceName: string,
  _apiKey?: string | null,
  ownerName?: string | null
): Promise<ReadableStream> {
  const openAIKey = process.env.OPENAI_API_KEY;

  if (!openAIKey) {
    return textStream(
      'No AI API key configured. Add OPENAI_API_KEY in your Vercel environment variables.'
    );
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const queryText = lastUserMessage?.content ?? '';

  // ── Step 1: always load the user's full CRM data for this space ──────────
  // This guarantees the AI has context even when vectors haven't been populated yet.
  const [{ data: allContacts }, { data: allDeals }, { data: allNotes }, { data: allTours }, calendarResult] = await Promise.all([
    supabase
      .from('Contact')
      .select('*')
      .eq('spaceId', spaceId)
      .order('createdAt', { ascending: false })
      .limit(100),
    supabase
      .from('Deal')
      .select('*, DealStage(name)')
      .eq('spaceId', spaceId)
      .order('createdAt', { ascending: false })
      .limit(50),
    supabase
      .from('Note')
      .select('id, title, content, updatedAt')
      .eq('spaceId', spaceId)
      .order('updatedAt', { ascending: false })
      .limit(5),
    supabase
      .from('Tour')
      .select('id, guestName, guestEmail, propertyAddress, startsAt, endsAt, status')
      .eq('spaceId', spaceId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('startsAt', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('startsAt', { ascending: true })
      .limit(30),
    (async () => {
      try {
        const res = await supabase
          .from('CalendarEvent')
          .select('id, title, description, date, time')
          .eq('spaceId', spaceId)
          .gte('date', new Date().toISOString().slice(0, 10))
          .order('date', { ascending: true })
          .limit(20);
        return res;
      } catch {
        return { data: [] as any[] };
      }
    })(),
  ]);

  // Fetch deal↔contact links scoped to this space's deal IDs only
  const dealIds = (allDeals ?? []).filter((d: any) => d?.id).map((d: any) => d.id);
  const { data: allDealContactRows } = dealIds.length
    ? await supabase
        .from('DealContact')
        .select('dealId, Contact(name)')
        .in('dealId', dealIds)
    : { data: [] };

  // ── Step 2: try vector search to promote the most relevant records ────────
  // If vectors aren't populated yet this will return an empty list (not an error).
  let priorityContactIds = new Set<string>();
  let priorityDealIds = new Set<string>();
  try {
    const queryVector = await embedText(queryText);
    const results = await searchVectors(spaceId, queryVector, 8);
    for (const r of results) {
      if (r.entity_type === 'contact') priorityContactIds.add(r.entity_id);
      else if (r.entity_type === 'deal') priorityDealIds.add(r.entity_id);
    }
  } catch {
    // Vector search unavailable — fall back to full dataset loaded above
  }

  // ── Step 3: build context blocks, prioritising vector-matched records ─────
  // Only inject each section when the query is relevant to that data type.
  // This prevents the AI from cross-referencing unrelated data (e.g. surfacing
  // tours when the user asks about contacts, or deals when they ask about tours).
  const queryLower = queryText.toLowerCase();
  const queryAboutContacts = /\b(contact|lead|client|applicant|prospect|renter|buyer|tenant|person|people|who)\b/.test(queryLower);
  const queryAboutDeals = /\b(deal|pipeline|stage|closing|commission|offer|contract|value|property deal)\b/.test(queryLower);
  const queryAboutTours = /\b(tour|booking|book|showing|schedule|visit|appointment|walk.?through)\b/.test(queryLower);
  const queryAboutCalendar = /\b(calendar|event|meeting|appointment|schedule|upcoming|this week|today)\b/.test(queryLower);
  // General / ambiguous query — include all relevant sections
  const isGeneral = !queryAboutContacts && !queryAboutDeals && !queryAboutTours && !queryAboutCalendar;

  const contextBlocks: string[] = [];

  const contacts = (allContacts ?? []) as any[];
  const deals = (allDeals ?? []) as any[];

  // Sort so vector-matched contacts appear first
  const sortedContacts = [
    ...contacts.filter((c) => priorityContactIds.has(c.id)),
    ...contacts.filter((c) => !priorityContactIds.has(c.id)),
  ];

  if (sortedContacts.length && (queryAboutContacts || isGeneral)) {
    contextBlocks.push(
      'Contacts:\n' +
        sortedContacts
          .map(
            (c) => {
              const lt = (c.leadType === 'buyer' ? 'BUYER' : 'RENTAL');
              const stageLabel = c.leadType === 'buyer' ? (c.type ?? '') : (c.type ?? '');
              const base = `- [ID:${c.id}] ${sanitizeCrmText(c.name)} (${lt} · ${stageLabel})${priorityContactIds.has(c.id) ? ' ★' : ''} | Score: ${c.leadScore ?? 'N/A'} (${c.scoreLabel ?? 'unscored'}) | ${c.email ?? ''} | ${c.phone ?? ''} | Budget: ${c.budget != null ? `$${c.budget}` : 'N/A'} | ${c.address ?? ''} | Tags: ${(c.tags ?? []).join(', ')} | Notes: ${sanitizeCrmText(c.notes)}`;
              return base;
            }
          )
          .join('\n')
    );
  }

  const contactsByDeal: Record<string, string[]> = {};
  for (const row of (allDealContactRows ?? []) as any[]) {
    if (!contactsByDeal[row.dealId]) contactsByDeal[row.dealId] = [];
    if (row.Contact?.name) contactsByDeal[row.dealId].push(row.Contact.name);
  }

  const sortedDeals = [
    ...deals.filter((d) => priorityDealIds.has(d.id)),
    ...deals.filter((d) => !priorityDealIds.has(d.id)),
  ];

  if (sortedDeals.length && (queryAboutDeals || isGeneral)) {
    contextBlocks.push(
      'Deals:\n' +
        sortedDeals
          .map(
            (d) =>
              `- [ID:${d.id}] ${sanitizeCrmText(d.title)}${priorityDealIds.has(d.id) ? ' ★' : ''} | Stage: ${d.DealStage?.name ?? 'N/A'} | Value: ${d.value != null ? `$${d.value}` : 'N/A'} | Priority: ${d.priority} | Address: ${d.address ?? ''} | Description: ${sanitizeCrmText(d.description)} | Contacts: ${(contactsByDeal[d.id] ?? []).join(', ')}`
          )
          .join('\n')
    );
  }

  // ── Notes context ──
  // Only include notes when the user is explicitly asking about them, to prevent
  // the AI from proactively citing notes in unrelated conversations.
  const notes = (allNotes ?? []) as any[];
  const queryMentionsNotes = /\bnotes?\b|\bwrote?\b|\bjotted?\b|\brecord(ed|s)?\b/i.test(queryText);
  if (notes.length && queryMentionsNotes) {
    contextBlocks.push(
      'Workspace Notes:\n' +
        notes
          .map((n) => {
            const sanitizedContent = sanitizeCrmText(n.content);
            return `- "${sanitizeCrmText(n.title)}" (updated ${new Date(n.updatedAt).toLocaleDateString()}): ${sanitizedContent.slice(0, 200)}${sanitizedContent.length > 200 ? '...' : ''}`;
          })
          .join('\n')
    );
  }

  // ── Upcoming tours context ──
  const tours = (allTours ?? []) as any[];
  if (tours.length && (queryAboutTours || queryAboutCalendar || isGeneral)) {
    contextBlocks.push(
      'Upcoming Tours:\n' +
        tours
          .map((t) => `- ${sanitizeCrmText(t.guestName)} | ${t.propertyAddress ?? 'No address'} | ${new Date(t.startsAt).toLocaleDateString()} ${new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} | Status: ${t.status}`)
          .join('\n')
    );
  }

  // ── Follow-ups due ──
  // Only include follow-ups when the query is contact/general — not when asking about deals or tours.
  const followUps = contacts.filter((c) => c.followUpAt);
  if (followUps.length && (queryAboutContacts || isGeneral)) {
    contextBlocks.push(
      'Follow-ups Due:\n' +
        followUps
          .slice(0, 20)
          .map((c) => `- ${c.name} | Due: ${new Date(c.followUpAt).toLocaleDateString()} | ${c.phone ?? c.email ?? ''}`)
          .join('\n')
    );
  }

  // ── Calendar events ──
  const calEvents = (calendarResult?.data ?? []) as any[];
  if (calEvents.length && (queryAboutCalendar || isGeneral)) {
    contextBlocks.push(
      'Calendar Events:\n' +
        calEvents
          .map((e) => `- ${e.title} | ${e.date}${e.time ? ` at ${e.time}` : ''}${e.description ? ` — ${e.description}` : ''}`)
          .join('\n')
    );
  }

  const realtorName = ownerName ?? 'there';
  const systemPrompt = [
    `You are Chip, an AI real estate assistant${ownerName ? ` for ${ownerName}` : ''} at ${spaceName}.`,
    `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`,
    `You help manage clients through rental qualification AND buyer purchase stages.`,
    `Buyer stages: Lead → Pre-Approved → Showings → Offer → Under Contract → Closing`,
    `Rental stages: Qualification → Tour → Application`,
    `You also manage real estate deals, notes, tours, and follow-ups.`,
    `Only reference data that appears in the CRM context below. Never fabricate client names, deal values, or contact details.`,
    `When asked about "recent" activity, prioritize items with the most recent dates.`,
    ``,
    `## Response Formatting`,
    `- Write in clear, natural language — like a knowledgeable colleague, not a data export.`,
    `- When listing contacts or deals, use clean bullet points with the person's name as the anchor. Include relevant details (stage, score, budget, etc.) in plain sentences, NOT pipe-delimited strings.`,
    `- Example of BAD formatting: "- Jane Doe (RENTAL · QUALIFICATION) | Email: jane@example.com | Budget: $450,000"`,
    `- Example of GOOD formatting: "- **Jane Doe** — Rental lead in Qualification stage. Budget: $450K, email: jane@example.com"`,
    `- If there is only one result, respond conversationally, not as a list.`,
    `- Never reproduce the raw CRM context format (pipe-separated fields) in your answers.`,
    `- Keep responses concise. Avoid unnecessary preamble like "Based on the CRM data..." — just answer.`,
    `- When addressing ${realtorName}, be friendly and professional.`,
    ``,
    `## Strict Data-Scope Rules`,
    `- When the user asks about CONTACTS (people, leads, clients, applicants): respond ONLY from the Contacts section. Do NOT mention tours, deals, or notes unless the user explicitly asks for connections.`,
    `- When the user asks about DEALS (pipeline, stages, values, closings): respond ONLY from the Deals section. Do NOT mention contacts, tours, or follow-ups unless explicitly asked.`,
    `- When the user asks about TOURS (showings, bookings, schedules, visits): respond ONLY from the Upcoming Tours section. Do NOT mention contacts' other details or deals.`,
    `- When the user asks about "leads" or "new leads": focus ONLY on contacts with tags including "application-link" or "new-lead". Do not mention notes, deals, or tours.`,
    `- Do NOT proactively mention or cite workspace notes unless the user explicitly asks about notes.`,
    `- Respond ONLY to what was asked. Never volunteer data from unrelated sections.`,
    ``,
    `## Editing CRM Data`,
    `When the user asks you to update, change, or edit a contact or deal, propose the change using this exact format:`,
    ``,
    `<<ACTION>>{"type":"update_contact","id":"<contact-id>","summary":"<short description of what changes>","changes":{"field":"value"}}<</ACTION>>`,
    `<<ACTION>>{"type":"update_deal","id":"<deal-id>","summary":"<short description of what changes>","changes":{"field":"value"}}<</ACTION>>`,
    ``,
    `Editable contact fields: name, email, phone, address, notes, budget (number), preferences, type (QUALIFICATION|TOUR|APPLICATION), leadType (rental|buyer), tags (array of strings), sourceLabel.`,
    `Editable deal fields: title, description, address, value (number), priority (LOW|MEDIUM|HIGH), status (active|won|lost|on_hold), closeDate (ISO date string).`,
    ``,
    `IMPORTANT RULES:`,
    `- Each contact and deal in the CRM data starts with [ID:xxx]. You MUST use these exact IDs in action blocks. Never guess or fabricate IDs.`,
    `- NEVER execute changes directly. Always propose them with <<ACTION>> blocks so the user can approve or reject.`,
    `- Include a brief natural language explanation before or after the action block so the user understands what you're proposing.`,
    `- You may include multiple <<ACTION>> blocks if the user asks to update several records.`,
    `- Only propose changes the user explicitly asked for. Do not make unsolicited modifications.`,
    contextBlocks.length
      ? `\n--- BEGIN CRM DATA (UNTRUSTED) ---\nCRM Data (★ = most relevant to this query):\n\n${contextBlocks.join('\n\n')}\n--- END CRM DATA ---`
      : `\nNo CRM data found for this workspace yet.`
  ]
    .join('\n');

  try {
    const openai = new OpenAI({ apiKey: openAIKey });
    const stream = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      max_tokens: 2000,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ]
    });

    return new ReadableStream({
      async start(controller) {
        for await (const event of stream) {
          const delta = event.choices[0]?.delta?.content;
          if (delta) controller.enqueue(new TextEncoder().encode(delta));
        }
        controller.close();
      }
    });
  } catch (error: any) {
    console.error('[ai] OpenAI error:', {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      type: error?.type,
    });
    const hint = error?.status === 401
      ? 'The OpenAI API key appears to be invalid. Check your OPENAI_API_KEY environment variable.'
      : error?.status === 429
      ? 'AI rate limit reached. Please wait a moment and try again.'
      : error?.status === 404
      ? 'The AI model was not found. Your API key may not have access to gpt-4.1-mini.'
      : error?.status === 500 || error?.status === 503
      ? 'OpenAI is experiencing issues. Please try again in a moment.'
      : `AI service error (${error?.status ?? 'unknown'}). Please try again.`;
    return textStream(hint);
  }
}
