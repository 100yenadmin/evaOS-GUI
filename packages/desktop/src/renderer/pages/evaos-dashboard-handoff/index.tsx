/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Button, Tag } from '@arco-design/web-react';
import { Link, Open, Refresh } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { openEvaosExternalUrl } from '@/renderer/utils/platform';

type EvaosDashboardHandoffPageProps = {
  title: string;
  eyebrow: string;
  description: string;
  dashboardUrl: string;
  issueRef: string;
};

const EvaosDashboardHandoffPage: React.FC<EvaosDashboardHandoffPageProps> = ({
  title,
  eyebrow,
  description,
  dashboardUrl,
  issueRef,
}) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [opening, setOpening] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const openDashboard = React.useCallback(async () => {
    setOpening(true);
    setMessage(null);
    try {
      await openEvaosExternalUrl(dashboardUrl);
      setMessage('Opened the Electric Sheep dashboard in your browser.');
    } catch (error) {
      console.error(`[EvaosDashboardHandoffPage] Failed to open ${title}:`, error);
      setMessage('Could not open the dashboard. Use the button again or email support@electricsheephq.com.');
    } finally {
      setOpening(false);
    }
  }, [dashboardUrl, title]);

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <main className='mx-auto flex w-full max-w-860px flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <p className='m-0 text-12px font-semibold uppercase tracking-1px text-t-tertiary'>{eyebrow}</p>
            <h1 className='m-0 mt-4px text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>{title}</h1>
            <p className='m-0 mt-6px max-w-700px text-14px leading-22px text-t-secondary'>{description}</p>
          </div>
          <Tag color='arcoblue'>Website handoff</Tag>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-18px'>
          <div className='flex flex-wrap items-start justify-between gap-16px'>
            <div className='flex min-w-0 items-start gap-12px'>
              <span className='mt-1px flex size-42px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                <Link theme='outline' size='22' />
              </span>
              <div className='min-w-0'>
                <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>Open in dashboard</h2>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  For this controlled RC, this surface stays on the production Electric Sheep dashboard while native
                  Workbench parity is tracked in {issueRef}.
                </p>
                <p className='m-0 mt-6px break-all text-12px leading-18px text-t-tertiary'>{dashboardUrl}</p>
              </div>
            </div>
            <Button type='primary' icon={<Open theme='outline' size='16' />} loading={opening} onClick={openDashboard}>
              Open dashboard
            </Button>
          </div>
          {message ? (
            <div className='mt-14px flex items-start gap-8px rounded-8px bg-fill-2 px-12px py-10px text-12px leading-18px text-t-secondary'>
              <Refresh theme='outline' size='15' className='mt-1px shrink-0' />
              <span>{message}</span>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
};

export default EvaosDashboardHandoffPage;
