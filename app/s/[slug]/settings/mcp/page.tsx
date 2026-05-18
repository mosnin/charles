/**
 * MCP keys — let external clients (Claude Desktop, Cursor, custom agents)
 * read this workspace through one hardened endpoint. Read-only by design.
 * The page is one scroll: what MCP is, how to point at it, the keys you
 * hold, how to mint another. No tabs, no nested settings.
 */
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { McpActions } from './mcp-actions';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
  SECTION_LABEL,
} from '@/lib/typography';

interface McpKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function appUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.NEXT_PUBLIC_ROOT_DOMAIN
      ? `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
      : 'https://app.charles.dev');
  return url.replace(/\/$/, '');
}

export default async function McpSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data } = await supabase
    .from('McpApiKey')
    .select('id, name, keyPrefix, lastUsedAt, createdAt')
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false });
  const keys = (data ?? []) as McpKeyRow[];

  const endpoint = `${appUrl()}/api/mcp`;

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          MCP
        </h1>
        <p className={BODY_MUTED}>
          Connect Charles to external clients via MCP. Read-only by design — your data flows out, no writes flow in.
        </p>
      </header>

      <section className="space-y-3">
        <p className={SECTION_LABEL}>Endpoint</p>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 font-mono text-xs text-foreground break-all">
          {endpoint}
        </div>
        <p className="text-xs text-muted-foreground">
          Point any MCP client at this URL and authenticate with a key below.{' '}
          <Link href="/docs/MCP" className="underline underline-offset-2 hover:text-foreground">
            How to connect
          </Link>
        </p>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <p className={SECTION_LABEL}>Keys</p>
          <McpActions mode="create" />
        </div>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys yet. Mint one to connect your first client.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{k.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {k.keyPrefix}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt
                      ? ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                      : ' · Never used'}
                  </p>
                </div>
                <McpActions mode="revoke" id={k.id} name={k.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
