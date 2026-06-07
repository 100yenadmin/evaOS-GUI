import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const CreativeStudioPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='creative_studio'
    title='Creative Studio'
    subtitle='Hosted creative generation workspace opened from evaOS Workbench.'
    issueRef='#181'
  />
);

export default CreativeStudioPage;
