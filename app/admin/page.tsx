import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  DollarSign,
  CreditCard,
  Clock,
  AlertCircle,
  Moon,
  FileText,
  LayoutGrid,
  Briefcase,
} from 'lucide-react';
import Link from 'next/link';
import { formatCompact } from '@/lib/formatting';
import { SignupChart } from './components/signup-chart';
import { isPlatformAdmin } from '@/lib/permissions';
import { redirect } from 'next/navigation';

export default async function AdminOverviewPage() {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect('/');

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  let totalUsers = 0,
    onboardedUsers = 0,
    usersWithSpace = 0,
    signupsLast7 = 0,
    signupsLast30 = 0;
  let activeSubscriptions = 0,
    trialUsers = 0,
    pastDueUsers = 0,
    canceledUsers = 0,
    churnRate = 0,
    mrr = 0,
    totalSpaces = 0;
  let totalMissions = 0,
    totalTasks = 0;

  let recentUsers: {
    id: string;
    name: string | null;
    email: string;
    onboard: boolean;
    createdAt: string;
    space: { slug: string } | null;
  }[] = [];

  type AtRiskTrial = {
    userId: string;
    name: string | null;
    email: string;
    daysLeft: number;
  };
  type AtRiskPastDue = {
    userId: string;
    name: string | null;
    email: string;
    daysPastDue: number;
  };
  type AtRiskInactive = {
    userId: string;
    name: string | null;
    email: string;
    daysSinceCreated: number;
  };
  let trialEndingSoon: AtRiskTrial[] = [];
  let trialEndingSoonTotal = 0;
  let pastDueList: AtRiskPastDue[] = [];
  let pastDueTotal = 0;
  let inactiveWorkspaces: AtRiskInactive[] = [];
  let inactiveWorkspacesTotal = 0;
  let signupsByDay: { date: string; count: number }[] = [];
  let recentActivity: {
    type: 'signup';
    label: string;
    detail: string;
    time: string;
  }[] = [];

  try {
    const [
      totalRes,
      onboardedRes,
      withSpaceRes,
      signups7Res,
      signups30Res,
      recentRes,
      signupsRaw,
      missionsRes,
      tasksRes,
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }),
      supabase.from('User').select('*', { count: 'exact', head: true }).eq('onboard', true),
      supabase.from('User').select('*, Space!inner(id)', { count: 'exact', head: true }),
      supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .gte('createdAt', sevenDaysAgo),
      supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .gte('createdAt', thirtyDaysAgo),
      supabase
        .from('User')
        .select('id, name, email, onboard, createdAt, Space(slug)')
        .order('createdAt', { ascending: false })
        .limit(5),
      supabase
        .from('User')
        .select('createdAt')
        .gte('createdAt', thirtyDaysAgo)
        .order('createdAt', { ascending: true }),
      supabase.from('Mission').select('*', { count: 'exact', head: true }),
      supabase.from('AgentTask').select('*', { count: 'exact', head: true }),
    ]);

    totalUsers = totalRes.count ?? 0;
    onboardedUsers = onboardedRes.count ?? 0;
    usersWithSpace = withSpaceRes.count ?? 0;
    signupsLast7 = signups7Res.count ?? 0;
    signupsLast30 = signups30Res.count ?? 0;
    totalMissions = missionsRes.count ?? 0;
    totalTasks = tasksRes.count ?? 0;

    recentUsers = (recentRes.data ?? []).map((row: any) => ({
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string,
      onboard: row.onboard as boolean,
      createdAt: row.createdAt as string,
      space: row.Space?.slug ? { slug: row.Space.slug as string } : null,
    }));

    const dayMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      dayMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const row of signupsRaw.data ?? []) {
      const day = new Date((row as { createdAt: string }).createdAt).toISOString().slice(0, 10);
      if (day in dayMap) dayMap[day]++;
    }
    signupsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    const activities: typeof recentActivity = [];
    for (const u of recentUsers.slice(0, 5)) {
      activities.push({
        type: 'signup',
        label: u.name || u.email,
        detail: u.onboard ? 'Signed up & onboarded' : 'Signed up (pending onboarding)',
        time: u.createdAt,
      });
    }
    recentActivity = activities
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);

    // Revenue
    try {
      const subRes = await supabase.from('Space').select('stripeSubscriptionStatus');
      const statuses = (subRes.data ?? []) as { stripeSubscriptionStatus: string | null }[];
      totalSpaces = statuses.length;
      for (const row of statuses) {
        const s = row.stripeSubscriptionStatus;
        if (s === 'active') activeSubscriptions++;
        else if (s === 'trialing') trialUsers++;
        else if (s === 'past_due') pastDueUsers++;
        else if (s === 'canceled') canceledUsers++;
      }
      mrr = activeSubscriptions * 97;
      churnRate =
        activeSubscriptions + canceledUsers > 0
          ? Math.round((canceledUsers / (activeSubscriptions + canceledUsers)) * 100)
          : 0;
    } catch (e) {
      console.error('[admin] Revenue queries failed', e);
    }

    // At-risk
    try {
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 86_400_000).toISOString();
      const nowIso = now.toISOString();

      const [trialRes, pastDueRes, oldSpacesRes] = await Promise.all([
        supabase
          .from('Space')
          .select('id, ownerId, stripePeriodEnd, User!inner(id, name, email)')
          .eq('stripeSubscriptionStatus', 'trialing')
          .not('stripePeriodEnd', 'is', null)
          .lte('stripePeriodEnd', sevenDaysFromNow)
          .gte('stripePeriodEnd', nowIso)
          .order('stripePeriodEnd', { ascending: true }),
        supabase
          .from('Space')
          .select('id, ownerId, stripePeriodEnd, User!inner(id, name, email)')
          .eq('stripeSubscriptionStatus', 'past_due')
          .order('stripePeriodEnd', { ascending: true }),
        supabase
          .from('Space')
          .select('id, ownerId, createdAt, User!inner(id, name, email)')
          .lte('createdAt', thirtyDaysAgo)
          .limit(500),
      ]);

      const trialRows = (trialRes.data ?? []) as {
        id: string;
        ownerId: string;
        stripePeriodEnd: string | null;
        User:
          | { id: string; name: string | null; email: string }
          | { id: string; name: string | null; email: string }[]
          | null;
      }[];
      trialEndingSoonTotal = trialRows.length;
      trialEndingSoon = trialRows.slice(0, 5).map((r) => {
        const u = Array.isArray(r.User) ? r.User[0] : r.User;
        const periodEnd = r.stripePeriodEnd ? new Date(r.stripePeriodEnd).getTime() : now.getTime();
        const daysLeft = Math.max(0, Math.ceil((periodEnd - now.getTime()) / 86_400_000));
        return {
          userId: u?.id ?? r.ownerId,
          name: u?.name ?? null,
          email: u?.email ?? '',
          daysLeft,
        };
      });

      const pastDueRows = (pastDueRes.data ?? []) as {
        id: string;
        ownerId: string;
        stripePeriodEnd: string | null;
        User:
          | { id: string; name: string | null; email: string }
          | { id: string; name: string | null; email: string }[]
          | null;
      }[];
      pastDueTotal = pastDueRows.length;
      pastDueList = pastDueRows.slice(0, 5).map((r) => {
        const u = Array.isArray(r.User) ? r.User[0] : r.User;
        const periodEnd = r.stripePeriodEnd ? new Date(r.stripePeriodEnd).getTime() : now.getTime();
        const daysPastDue = Math.max(0, Math.floor((now.getTime() - periodEnd) / 86_400_000));
        return {
          userId: u?.id ?? r.ownerId,
          name: u?.name ?? null,
          email: u?.email ?? '',
          daysPastDue,
        };
      });

      // Inactive = workspace older than 30 days. The realtor-era "no recent
      // contact" heuristic is gone with the Contact table; once Charles has
      // a per-space activity signal (mission updates, agent runs) wire that
      // in to replace the simple age check.
      const oldSpaceRows = (oldSpacesRes.data ?? []) as {
        id: string;
        ownerId: string;
        createdAt: string;
        User:
          | { id: string; name: string | null; email: string }
          | { id: string; name: string | null; email: string }[]
          | null;
      }[];
      inactiveWorkspacesTotal = oldSpaceRows.length;
      inactiveWorkspaces = oldSpaceRows
        .slice(0, 5)
        .map((r) => {
          const u = Array.isArray(r.User) ? r.User[0] : r.User;
          const daysSinceCreated = Math.floor(
            (now.getTime() - new Date(r.createdAt).getTime()) / 86_400_000,
          );
          return {
            userId: u?.id ?? r.ownerId,
            name: u?.name ?? null,
            email: u?.email ?? '',
            daysSinceCreated,
          };
        });
    } catch (e) {
      console.error('[admin] At-risk queries failed', e);
    }
  } catch (err) {
    console.error('[admin] DB queries failed', { error: err });
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load admin dashboard. This is usually temporary.
          </p>
          <a
            href="/admin"
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  const notOnboarded = totalUsers - onboardedUsers;
  const onboardRate = totalUsers > 0 ? Math.round((onboardedUsers / totalUsers) * 100) : 0;

  const activityIcon = { signup: UserPlus };
  const activityColor = { signup: 'text-blue-500' };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Charles platform overview</p>
        </div>
      </div>

      {/* Quick Actions */}
      <Card className="rounded-xl border bg-card">
        <CardContent className="px-5 py-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Quick Actions
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/users">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Users size={14} />
                View all users
              </Button>
            </Link>
            <Link href="/admin/billing">
              <Button variant="outline" size="sm" className="gap-1.5">
                <CreditCard size={14} />
                View billing
              </Button>
            </Link>
            <Link href="/admin/audit-log">
              <Button variant="outline" size="sm" className="gap-1.5">
                <FileText size={14} />
                View audit log
              </Button>
            </Link>
            <Link href="/admin/spaces">
              <Button variant="outline" size="sm" className="gap-1.5">
                <LayoutGrid size={14} />
                View spaces
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Platform Overview */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Platform Overview
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'Total users',
              value: totalUsers,
              sub: `+${signupsLast7} this week`,
              icon: Users,
              color: 'text-blue-500',
              accent: false,
            },
            {
              label: 'Onboarded',
              value: onboardedUsers,
              sub: `${onboardRate}% conversion`,
              icon: CheckCircle2,
              color: 'text-emerald-500',
              accent: false,
            },
            {
              label: 'Not onboarded',
              value: notOnboarded,
              sub: 'incomplete setup',
              icon: AlertTriangle,
              color: 'text-amber-500',
              accent: notOnboarded > 0,
            },
            {
              label: 'Missions',
              value: totalMissions,
              sub: `${totalTasks} tasks`,
              icon: Briefcase,
              color: 'text-violet-500',
              accent: false,
            },
          ].map(({ label, value, sub, icon: Icon, color, accent }) => (
            <Card
              key={label}
              className={`rounded-xl border bg-card h-full ${
                accent
                  ? 'border-amber-300/50 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-500/5'
                  : ''
              }`}
            >
              <CardContent className="p-6 h-full flex flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground font-medium">{label}</p>
                    <p
                      className={`text-2xl font-bold mt-0.5 tabular-nums ${
                        accent ? 'text-amber-600 dark:text-amber-400' : ''
                      }`}
                    >
                      {value}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                  </div>
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      accent ? 'bg-amber-100 dark:bg-amber-500/10' : 'bg-muted'
                    }`}
                  >
                    <Icon
                      size={15}
                      className={accent ? 'text-amber-600 dark:text-amber-400' : color}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Revenue */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Revenue
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {[
            {
              label: 'MRR',
              value: formatCompact(mrr),
              sub: `${activeSubscriptions} active subs`,
              icon: DollarSign,
              color: 'text-emerald-500',
            },
            {
              label: 'Active subscribers',
              value: activeSubscriptions,
              sub: 'paying customers',
              icon: CheckCircle2,
              color: 'text-emerald-500',
            },
            {
              label: 'Trial users',
              value: trialUsers,
              sub: 'currently trialing',
              icon: CreditCard,
              color: 'text-blue-500',
            },
            {
              label: 'Past due',
              value: pastDueUsers,
              sub: 'payment failed',
              icon: CreditCard,
              color: 'text-amber-500',
            },
            {
              label: 'Churn rate',
              value: `${churnRate}%`,
              sub: `${canceledUsers} canceled`,
              icon: DollarSign,
              color: 'text-rose-500',
            },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <Card key={label} className="rounded-xl border bg-card h-full">
              <CardContent className="p-6 h-full flex flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground font-medium">{label}</p>
                    <p className="text-2xl font-bold mt-0.5 tabular-nums">{value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted">
                    <Icon size={15} className={color} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* At Risk */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          At Risk
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="rounded-xl border bg-card h-full">
            <CardContent className="p-5 h-full flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100 dark:bg-blue-500/15">
                    <Clock size={15} className="text-blue-500" />
                  </div>
                  <p className="text-sm font-semibold truncate">Trial ending soon</p>
                </div>
                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15 tabular-nums">
                  {trialEndingSoonTotal}
                </span>
              </div>
              {trialEndingSoon.length === 0 ? (
                <p className="text-xs text-muted-foreground flex-1">
                  No trials ending in the next 7 days.
                </p>
              ) : (
                <div className="flex-1 -mx-2">
                  {trialEndingSoon.map((u) => (
                    <Link
                      key={u.userId}
                      href={`/admin/users/${u.userId}`}
                      className="flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{u.name || u.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15 tabular-nums">
                        {u.daysLeft}d left
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href="/admin/users?filter=trialing"
                className="text-xs text-primary font-medium hover:underline underline-offset-2 mt-3 self-start"
              >
                View all →
              </Link>
            </CardContent>
          </Card>

          <Card className="rounded-xl border bg-card h-full">
            <CardContent className="p-5 h-full flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-100 dark:bg-amber-500/15">
                    <AlertCircle size={15} className="text-amber-500" />
                  </div>
                  <p className="text-sm font-semibold truncate">Past due</p>
                </div>
                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15 tabular-nums">
                  {pastDueTotal}
                </span>
              </div>
              {pastDueList.length === 0 ? (
                <p className="text-xs text-muted-foreground flex-1">No past-due accounts. Nice.</p>
              ) : (
                <div className="flex-1 -mx-2">
                  {pastDueList.map((u) => (
                    <Link
                      key={u.userId}
                      href={`/admin/users/${u.userId}`}
                      className="flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{u.name || u.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15 tabular-nums">
                        {u.daysPastDue}d
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href="/admin/users?filter=past-due"
                className="text-xs text-primary font-medium hover:underline underline-offset-2 mt-3 self-start"
              >
                View all →
              </Link>
            </CardContent>
          </Card>

          <Card className="rounded-xl border bg-card h-full">
            <CardContent className="p-5 h-full flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-100 dark:bg-violet-500/15">
                    <Moon size={15} className="text-violet-500" />
                  </div>
                  <p className="text-sm font-semibold truncate">Aging workspaces</p>
                </div>
                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-violet-700 bg-violet-50 dark:text-violet-400 dark:bg-violet-500/15 tabular-nums">
                  {inactiveWorkspacesTotal}
                </span>
              </div>
              {inactiveWorkspaces.length === 0 ? (
                <p className="text-xs text-muted-foreground flex-1">No aging workspaces.</p>
              ) : (
                <div className="flex-1 -mx-2">
                  {inactiveWorkspaces.map((u) => (
                    <Link
                      key={u.userId}
                      href={`/admin/users/${u.userId}`}
                      className="flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{u.name || u.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 text-violet-700 bg-violet-50 dark:text-violet-400 dark:bg-violet-500/15 tabular-nums">
                        {u.daysSinceCreated}d old
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href="/admin/users?filter=inactive"
                className="text-xs text-primary font-medium hover:underline underline-offset-2 mt-3 self-start"
              >
                View all →
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Growth + funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="rounded-xl border bg-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold">User growth</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Signups over the last 30 days · {signupsLast30} total
                  </p>
                </div>
              </div>
              <SignupChart data={signupsByDay} />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="rounded-xl border bg-card h-full">
            <CardContent className="p-6">
              <p className="text-sm font-semibold mb-1">Conversion funnel</p>
              <p className="text-xs text-muted-foreground mb-5">User journey breakdown</p>
              <div className="space-y-5">
                {[
                  { label: 'Signed up', value: totalUsers, pct: 100 },
                  { label: 'Onboarded', value: onboardedUsers, pct: onboardRate },
                  {
                    label: 'Created workspace',
                    value: usersWithSpace,
                    pct: totalUsers > 0 ? Math.round((usersWithSpace / totalUsers) * 100) : 0,
                  },
                  {
                    label: 'Active subscription',
                    value: activeSubscriptions,
                    pct:
                      totalSpaces > 0 ? Math.round((activeSubscriptions / totalSpaces) * 100) : 0,
                  },
                ].map(({ label, value, pct }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums">
                        {value}{' '}
                        <span className="text-muted-foreground font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent signups + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Signups
            </h2>
            <Link
              href="/admin/users"
              className="text-xs text-primary font-medium hover:underline underline-offset-2"
            >
              View all →
            </Link>
          </div>
          {recentUsers.length === 0 ? (
            <Card className="rounded-xl border bg-card">
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No users yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl border bg-card">
              <div className="divide-y divide-border">
                {recentUsers.map((user) => (
                  <Link key={user.id} href={`/admin/users/${user.id}`}>
                    <div className="px-4 py-3 hover:bg-muted/50 transition-colors duration-150">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                            {(user.name || user.email || '?')
                              .split(' ')
                              .map((n: string) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {user.name || 'No name'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {user.space?.slug && (
                            <span className="hidden sm:inline-flex text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
                              {user.space.slug}
                            </span>
                          )}
                          <span
                            className={`inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                              user.onboard
                                ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15'
                                : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
                            }`}
                          >
                            {user.onboard ? 'Onboarded' : 'Pending'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Recent Activity
          </h2>
          {recentActivity.length === 0 ? (
            <Card className="rounded-xl border bg-card">
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl border bg-card">
              <div className="divide-y divide-border">
                {recentActivity.map((item, i) => {
                  const Icon = activityIcon[item.type];
                  const color = activityColor[item.type];
                  const ago = timeAgo(item.time);
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <Icon size={14} className={color} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Last updated:{' '}
          {now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </p>
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
