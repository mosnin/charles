/**
 * The first thing Charles says to a new founder.
 *
 * After onboarding, Charles writes one message into a fresh conversation
 * and queues one task. The message cites what the wizard captured (name,
 * idea stage, pitch) and proposes a single concrete next move. The task
 * mirrors that move so the founder can act from either surface.
 *
 * Pure function — no DB, no Clerk, no side effects. The caller (the
 * onboarding/complete route) handles the writes. Pinned by
 * tests/lib/onboarding-first-message.test.ts.
 */

import type { FounderIdeaStage } from '@/lib/workspace-templates/auto-pick';

export interface FirstMessageInput {
  founderName?: string | null;
  ideaStage?: FounderIdeaStage | null;
  companyName?: string | null;
  oneLinePitch?: string | null;
}

export interface FirstMessageOutput {
  /** Title of the seeded Conversation row. */
  conversationTitle: string;
  /** Content of the first assistant Message, as the chat will render it. */
  messageContent: string;
  /** Title of the seeded Task row — what the founder sees on /tasks. */
  firstTaskTitle: string;
}

interface StageCopy {
  conversationTitle: string;
  /** What Charles says about the founder's situation. Sentence fragment. */
  reflection: string;
  /** The proposed next move — what to do today. */
  move: string;
  /** What the task on /tasks will be titled. */
  taskTitle: string;
}

const STAGE_COPY: Record<FounderIdeaStage, StageCopy> = {
  'pre-idea': {
    conversationTitle: 'Welcome from Charles',
    reflection: "You said you're pre-idea — looking for what to build.",
    move:
      "Write down one problem you've watched yourself or someone close to you struggle with this week. Be specific — names, moments, the exact friction. We'll come back to it.",
    taskTitle: "Capture one problem you've watched someone struggle with this week",
  },
  idea: {
    conversationTitle: 'Welcome from Charles',
    reflection: "You said you've got an idea — that's the spark.",
    move:
      "Describe it in one sentence: who has the problem, what you're going to do about it, and why now. Reply with it here. If it doesn't fit in a sentence, the idea isn't ready yet — that's also useful to know.",
    taskTitle: 'Write the one-sentence version of your idea',
  },
  'pre-mvp': {
    conversationTitle: 'Welcome from Charles',
    reflection: "You're pre-MVP — you know what to build, the job now is to build the smallest version that works.",
    move:
      "Write down what to CUT for v1. The version you'd ship in a week, not a quarter. Everything that doesn't survive that cut is a distraction until v2.",
    taskTitle: "Define what to cut for v1 — the version you'd ship in a week",
  },
  mvp: {
    conversationTitle: 'Welcome from Charles',
    reflection: "You've got an MVP — congratulations on the hardest part most founders never finish.",
    move:
      "The job now is to find out if anyone wants it. Pick one person who'd use this if it worked — not a friend, not 'people like X'. One real person. Reply with their name and we'll figure out how to get it in front of them this week.",
    taskTitle: 'Name one real person who would use the MVP if it worked',
  },
  customers: {
    conversationTitle: 'Welcome from Charles',
    reflection: "You have customers — real people paying attention.",
    move:
      "Pick the one customer who'd be most upset if you disappeared tomorrow, and write down what they'd say. That's your product. Reply here with what you'd write.",
    taskTitle: 'Write what your most-loyal customer would say if you disappeared',
  },
  revenue: {
    conversationTitle: 'Welcome from Charles',
    reflection: "You're making money — the product is real.",
    move:
      "Time to find the lever. Which of these moves the next inch fastest: new users, retention, average revenue, or insight into who buys? Reply with the one you're focused on this week and I'll help keep the others quiet.",
    taskTitle: 'Pick the one lever this week: users, retention, revenue, or insight',
  },
  public: {
    conversationTitle: 'Welcome from Charles',
    reflection: "You're public and scaling — most founders don't get here.",
    move:
      "At this stage the question is no longer 'what do we build' but 'what do we stop building'. Name one thing the product currently does that you'd cut if you started over today.",
    taskTitle: 'Name one thing the product does today that you would cut if starting over',
  },
};

const FALLBACK: StageCopy = {
  conversationTitle: 'Welcome from Charles',
  reflection: "I'm Charles — your second brain for the company.",
  move:
    "Tell me what you'd most like to ship this week. I'll capture it, break it down, and we'll work it together.",
  taskTitle: "Tell Charles what you most want to ship this week",
};

function greeting(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Welcome.';
  return `Welcome, ${trimmed}.`;
}

function contextLine(input: FirstMessageInput): string | null {
  const pitch = input.oneLinePitch?.trim();
  const company = input.companyName?.trim();
  if (pitch) return `You're working on: ${pitch}`;
  if (company) return `You're working on ${company}.`;
  return null;
}

export function buildFirstMessage(input: FirstMessageInput): FirstMessageOutput {
  const copy = input.ideaStage ? (STAGE_COPY[input.ideaStage] ?? FALLBACK) : FALLBACK;

  const lines: string[] = [];
  lines.push(`${greeting(input.founderName)} ${copy.reflection}`);

  const context = contextLine(input);
  if (context) {
    lines.push('');
    lines.push(context);
  }

  lines.push('');
  lines.push(copy.move);
  lines.push('');
  lines.push("I've also added this to your task list — open the Tasks tab whenever you're ready.");

  return {
    conversationTitle: copy.conversationTitle,
    messageContent: lines.join('\n'),
    firstTaskTitle: copy.taskTitle,
  };
}
