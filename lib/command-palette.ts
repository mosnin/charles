/**
 * Command palette catalog. Pure types and item data.
 *
 * Every navigable destination, every action the founder can take from
 * anywhere — listed once, in order, with the icon, keywords, and group.
 * The React component renders this; tests assert against it.
 *
 * Hard rule: items are slug-relative. The renderer prefixes the workspace
 * slug at render time so this file stays a static catalog with no runtime
 * dependency on the current space.
 */
import {
  Activity,
  BookOpen,
  CheckSquare,
  Code2,
  CreditCard,
  Cpu,
  Eye,
  FileText,
  Home,
  Inbox,
  LineChart,
  LogOut,
  Mail,
  MessageSquare,
  Network,
  Palette,
  Plug,
  Plus,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CommandKind = 'nav' | 'action';

export const COMMAND_GROUPS = ['Workspace', 'Create', 'Settings', 'Account'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  group: CommandGroup;
  /** Slug-relative href for `nav` items (the host prefixes `/s/{slug}`). */
  href?: string;
  /** Action slug for `action` items. The host owns the side effect. */
  action?: string;
  /** Extra search terms beyond the label. */
  keywords?: readonly string[];
}

export const COMMAND_ITEMS: readonly CommandItem[] = [
  // Workspace (nav)
  { id: 'home',      kind: 'nav', label: 'Home',              shortcut: 'H', icon: Home,          group: 'Workspace', href: '',           keywords: ['mission', 'dashboard', 'start'] },
  { id: 'chat',      kind: 'nav', label: 'Chat with Charles', shortcut: 'C', icon: MessageSquare, group: 'Workspace', href: '/chat',      keywords: ['ask', 'prompt', 'assistant', 'chippi'] },
  { id: 'inbox',     kind: 'nav', label: 'Inbox',             shortcut: 'I', icon: Inbox,         group: 'Workspace', href: '/inbox',     keywords: ['approvals', 'drafts', 'review'] },
  { id: 'tasks',     kind: 'nav', label: 'Tasks',             shortcut: 'T', icon: CheckSquare,   group: 'Workspace', href: '/tasks',     keywords: ['todo', 'to-do', 'work'] },
  { id: 'documents', kind: 'nav', label: 'Documents',         shortcut: 'D', icon: BookOpen,      group: 'Workspace', href: '/documents', keywords: ['docs', 'memory', 'notes'] },
  { id: 'brand',     kind: 'nav', label: 'Brand',                            icon: Palette,       group: 'Workspace', href: '/brand',     keywords: ['identity', 'voice', 'logo'] },
  { id: 'analytics', kind: 'nav', label: 'Analytics',                        icon: LineChart,     group: 'Workspace', href: '/analytics', keywords: ['metrics', 'stats', 'numbers'] },
  { id: 'campaigns', kind: 'nav', label: 'Campaigns',                        icon: Mail,          group: 'Workspace', href: '/campaigns', keywords: ['email', 'outreach', 'marketing'] },

  // Create (action)
  { id: 'new-task',     kind: 'action', label: 'New task',           icon: Plus,     group: 'Create', action: 'new-task',     keywords: ['todo', 'add', 'create'] },
  { id: 'new-document', kind: 'action', label: 'Open document',      icon: FileText, group: 'Create', action: 'new-document', keywords: ['doc', 'write', 'note'] },
  { id: 'new-brand',    kind: 'nav',    label: 'Start brand wizard', icon: Palette,  group: 'Create', href: '/brand',         keywords: ['identity', 'setup'] },

  // Settings
  { id: 'settings-departments',  kind: 'nav', label: 'Departments',  icon: Network,    group: 'Settings', href: '/settings/departments',  keywords: ['agents', 'teams'] },
  { id: 'settings-team',         kind: 'nav', label: 'Team',         icon: Users,      group: 'Settings', href: '/settings/team',         keywords: ['people', 'members'] },
  { id: 'settings-billing',      kind: 'nav', label: 'Billing',      icon: CreditCard, group: 'Settings', href: '/settings/billing',      keywords: ['subscription', 'payment', 'plan'] },
  { id: 'settings-mcp',          kind: 'nav', label: 'MCP',          icon: Code2,      group: 'Settings', href: '/settings/mcp',          keywords: ['tools', 'server'] },
  { id: 'settings-usage',        kind: 'nav', label: 'Usage',        icon: Activity,   group: 'Settings', href: '/settings/usage',        keywords: ['cost', 'tokens', 'spend'] },
  { id: 'settings-audit',        kind: 'nav', label: 'Audit log',    icon: Eye,        group: 'Settings', href: '/settings/audit',        keywords: ['history', 'log'] },
  { id: 'settings-runs',         kind: 'nav', label: 'Agent runs',   icon: Cpu,        group: 'Settings', href: '/settings/runs',         keywords: ['executions', 'jobs'] },
  { id: 'settings-integrations', kind: 'nav', label: 'Integrations', icon: Plug,       group: 'Settings', href: '/integrations',          keywords: ['connect', 'apps'] },

  // Account
  { id: 'sign-out', kind: 'action', label: 'Sign out', icon: LogOut, group: 'Account', action: 'sign-out', keywords: ['logout', 'leave'] },
];

/**
 * Case-insensitive substring match over label + keywords.
 * Empty query returns the full catalog in declaration order.
 */
export function matchCommands(query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COMMAND_ITEMS];
  return COMMAND_ITEMS.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
    return false;
  });
}
