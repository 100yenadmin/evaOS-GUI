import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';

const QUICK_ACTIONS = [
  {
    title: 'Connected Apps',
    detail: 'Review provider grants and reconnect apps through broker-owned flows.',
    route: '/connected-apps',
  },
  {
    title: 'Approvals',
    detail: 'Review risky agent actions and keep denial/approval evidence backend-owned.',
    route: '/approval-center',
  },
  {
    title: 'Business Browser',
    detail: 'Open the shared customer browser with runtime evidence and customer isolation.',
    route: '/business-browser',
  },
  {
    title: 'Creative Studio',
    detail: 'Open the creative generation workspace through the evaOS runtime catalog.',
    route: '/creative-studio',
  },
  {
    title: 'Company Brain',
    detail: 'Inspect org-scoped accounts, briefs, and directory evidence.',
    route: '/company-brain',
  },
  {
    title: 'evaOS',
    detail: 'Open the primary evaOS agent workspace.',
    route: '/evaos',
  },
  {
    title: 'Hermes',
    detail: 'Open the Hermes agent workspace.',
    route: '/hermes',
  },
] as const;

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const webAuthenticated = status === 'authenticated';
  const brokerSessionStatus = useEvaosBrokerSessionStatus(webAuthenticated);
  const brokerAuthenticated =
    brokerSessionStatus.session?.authenticated === true && !brokerSessionStatus.session.expired;
  const customerContext = useEvaosCustomerContext(
    brokerAuthenticated,
    evaosBrokerSessionKey(brokerSessionStatus.session),
    brokerSessionStatus.loading ? { clearOnUnauthenticated: false } : undefined
  );

  const sessionText = brokerAuthenticated
    ? 'Session active'
    : brokerSessionStatus.session?.expired
      ? 'Session expired'
      : 'Sign in first';
  const customerText =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';
  const accountText = brokerSessionStatus.session?.userEmail ?? user?.username ?? 'Not signed in';

  const handleNavigate = (route: string) => {
    void navigate(route);
  };

  return (
    <div className='h-full overflow-auto bg-bg-1 px-48px py-36px text-t-primary'>
      <div className='mx-auto flex max-w-1200px flex-col gap-24px'>
        <header className='flex flex-col gap-8px'>
          <div className='text-32px font-semibold leading-40px'>Home</div>
          <p className='m-0 max-w-760px text-15px leading-24px text-t-secondary'>
            Your AI office in one place: connect apps, review approvals, open workspaces, and resume recent work.
          </p>
        </header>

        <section className='grid grid-cols-1 gap-12px md:grid-cols-3'>
          <StatusCard label='Session' value={sessionText} />
          <StatusCard label='Account' value={accountText} />
          <StatusCard label='Customer' value={customerText} />
        </section>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-2 p-20px'>
          <div className='mb-14px flex items-center justify-between gap-16px'>
            <div>
              <div className='text-18px font-semibold leading-26px'>Quick actions</div>
              <div className='text-13px leading-20px text-t-secondary'>
                Old Workbench parity surface for the fastest customer workflow entry points.
              </div>
            </div>
            <Button onClick={() => handleNavigate('/mission-control')}>Refresh Home</Button>
          </div>
          <div className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.route}
                type='button'
                onClick={() => handleNavigate(action.route)}
                className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-1 p-16px text-left text-t-primary transition-colors hover:bg-fill-2'
              >
                <div className='text-15px font-semibold leading-22px'>{action.title}</div>
                <div className='mt-4px text-13px leading-20px text-t-secondary'>{action.detail}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-2 p-16px'>
      <div className='text-11px font-semibold uppercase tracking-1px text-t-tertiary'>{label}</div>
      <div className='mt-8px break-words text-18px font-semibold leading-26px'>{value}</div>
    </div>
  );
}

export default HomePage;
