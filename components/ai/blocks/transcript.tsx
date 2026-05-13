'use client';

import { cn } from '@/lib/utils';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import { TextBlockView } from './text-block-view';
import { ToolCallBlockView } from './tool-call-block-view';
import { PermissionBlockView } from './permission-block-view';
import { PermissionPromptView, type PermissionPromptData } from './permission-prompt-view';
import { ApprovalCelebration, type ApprovalKind } from '@/components/charles/approval-celebration';

interface TranscriptProps {
  blocks: MessageBlock[];
  /** Whose turn these blocks belong to. User turns only carry text blocks. */
  role: 'user' | 'assistant';
  /**
   * When this turn is still streaming, the trailing text block gets a
   * pulsing caret. Pass `true` for the assistant turn that is currently
   * emitting deltas; omit or false for saved history.
   */
  streaming?: boolean;
  /**
   * Tool callIds that are currently in-flight (the model called them in
   * this turn but the handler hasn't resolved yet). Lets the block view
   * render the "Running" state even though `status` is still a placeholder.
   */
  liveCallIds?: Set<string>;
  /**
   * Optional interactive permission prompt. Shown below the blocks when the
   * turn paused for approval. The parent owns the approve/deny callbacks so
   * the Transcript stays a pure presentational component.
   */
  pendingApproval?: {
    prompt: PermissionPromptData;
    onApprove: (requestId: string, editedArgs?: Record<string, unknown>) => Promise<void>;
    onDeny: (requestId: string) => Promise<void>;
    onAlwaysAllow?: (requestId: string, editedArgs?: Record<string, unknown>) => Promise<void>;
    busy?: boolean;
  };
  /**
   * When present, the surface the approval prompt occupied is replaced by
   * one calm Charles-voiced sentence for ~2.5s. The parent owns the dwell —
   * the celebration calls `onDone` when its time is up so the parent can
   * clear this state and let the next streamed blocks (or whatever's next)
   * take the floor.
   */
  approvalCelebration?: {
    kind: ApprovalKind;
    subject?: string;
    onDone: () => void;
  };
  className?: string;
}

/**
 * Renders an ordered list of blocks. Each block type maps to a dedicated
 * view; this component is strictly a dispatcher. Stable keys come from
 * callId for tool-related blocks (so re-renders don't flicker during
 * streaming) and from index for text blocks (text is append-only per turn).
 */
export function Transcript({
  blocks,
  role,
  streaming,
  liveCallIds,
  pendingApproval,
  approvalCelebration,
  className,
}: TranscriptProps) {
  // Find the last text block so we can scope the streaming caret to it.
  let lastTextIndex = -1;
  if (streaming && role === 'assistant') {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 'text') {
        lastTextIndex = i;
        break;
      }
    }
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <TextBlockView
                key={`text-${i}`}
                block={block}
                role={role}
                streaming={i === lastTextIndex}
              />
            );
          case 'tool_call':
            return (
              <ToolCallBlockView
                key={`tool-${block.callId}`}
                block={block}
                live={liveCallIds?.has(block.callId)}
              />
            );
          case 'permission':
            return <PermissionBlockView key={`perm-${block.callId}`} block={block} />;
        }
      })}

      {/* Celebration takes precedence over the approval prompt — the moment
          the realtor approves a celebrate-able tool, the parent flips
          `approvalCelebration` and the prompt is swapped for the win line on
          the same surface. */}
      {approvalCelebration ? (
        <ApprovalCelebration
          kind={approvalCelebration.kind}
          subject={approvalCelebration.subject}
          onDone={approvalCelebration.onDone}
        />
      ) : (
        pendingApproval && (
          <PermissionPromptView
            prompt={pendingApproval.prompt}
            onApprove={pendingApproval.onApprove}
            onDeny={pendingApproval.onDeny}
            onAlwaysAllow={pendingApproval.onAlwaysAllow}
            busy={pendingApproval.busy}
          />
        )
      )}
    </div>
  );
}
