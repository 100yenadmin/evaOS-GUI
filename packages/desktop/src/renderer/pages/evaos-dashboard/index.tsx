import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const EvaosDashboardPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='openclaw'
    title='evaOS'
    subtitle='Primary evaOS agent workspace loaded from broker-owned runtime evidence.'
    issueRef='#152'
  />
);

export default EvaosDashboardPage;
