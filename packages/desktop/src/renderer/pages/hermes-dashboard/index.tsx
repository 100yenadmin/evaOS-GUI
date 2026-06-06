import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const HermesDashboardPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='hermes'
    title='Hermes'
    subtitle='Hermes agent dashboard loaded from broker-owned runtime evidence.'
    issueRef='#159'
  />
);

export default HermesDashboardPage;
