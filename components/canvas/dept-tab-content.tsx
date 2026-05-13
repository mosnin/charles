/**
 * Dept tab dispatcher — given (dept, tab), render the right component.
 *
 * Server component on purpose: most tabs do server-side fetches. The
 * lookup is a flat switch because there are 18 combinations and a switch
 * reads better than a map of dynamic imports for that count.
 *
 * Unknown combinations render nothing — the page-level guard already
 * 404s on bad dept slugs and falls back to the default tab on bad tab
 * slugs, so this function is the inner cap.
 */

import type { DepartmentSlug } from '@/lib/departments/autonomy';
import { SalesEnrich } from './dept-tabs/sales-enrich';
import { SalesResearch } from './dept-tabs/sales-research';
import { MarketingAnalytics } from './dept-tabs/marketing-analytics';
import { MarketingSocial } from './dept-tabs/marketing-social';
import { MarketingImages } from './dept-tabs/marketing-images';
import { EngineeringRepos } from './dept-tabs/engineering-repos';
import { EngineeringDeploys } from './dept-tabs/engineering-deploys';
import { EngineeringEnv } from './dept-tabs/engineering-env';
import { EngineeringDatabase } from './dept-tabs/engineering-database';
import { DesignBrand } from './dept-tabs/design-brand';
import { DesignAssets } from './dept-tabs/design-assets';
import { DesignDocs } from './dept-tabs/design-docs';
import { OpsRevenue } from './dept-tabs/ops-revenue';
import { OpsExpenses } from './dept-tabs/ops-expenses';
import { OpsRunway } from './dept-tabs/ops-runway';

interface Props {
  deptSlug: DepartmentSlug;
  tabSlug: string;
  spaceId: string;
  spaceSlug: string;
}

export function DeptTabContent({ deptSlug, tabSlug, spaceId, spaceSlug }: Props) {
  const key = `${deptSlug}:${tabSlug}`;
  switch (key) {
    // Sales
    case 'sales:enrich':
      return <SalesEnrich />;
    case 'sales:research':
      return <SalesResearch spaceSlug={spaceSlug} />;

    // Marketing
    case 'marketing:analytics':
      return <MarketingAnalytics spaceId={spaceId} spaceSlug={spaceSlug} />;
    case 'marketing:social':
      return <MarketingSocial spaceSlug={spaceSlug} />;
    case 'marketing:images':
      return <MarketingImages spaceSlug={spaceSlug} />;

    // Engineering
    case 'engineering:repos':
      return <EngineeringRepos spaceId={spaceId} spaceSlug={spaceSlug} />;
    case 'engineering:deploys':
      return <EngineeringDeploys spaceSlug={spaceSlug} />;
    case 'engineering:env':
      return <EngineeringEnv spaceSlug={spaceSlug} />;
    case 'engineering:database':
      return <EngineeringDatabase spaceSlug={spaceSlug} />;

    // Design
    case 'design:brand':
      return <DesignBrand spaceId={spaceId} spaceSlug={spaceSlug} />;
    case 'design:assets':
      return <DesignAssets spaceSlug={spaceSlug} />;
    case 'design:docs':
      return <DesignDocs spaceSlug={spaceSlug} />;

    // Ops/Finance
    case 'ops_finance:revenue':
      return <OpsRevenue spaceId={spaceId} spaceSlug={spaceSlug} />;
    case 'ops_finance:expenses':
      return <OpsExpenses spaceSlug={spaceSlug} />;
    case 'ops_finance:runway':
      return <OpsRunway spaceSlug={spaceSlug} />;

    default:
      return null;
  }
}
