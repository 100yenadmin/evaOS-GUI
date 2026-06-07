import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const CreativeStudioPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='creative_studio'
    title='Creative Studio'
    subtitle='External creative generation workspace.'
    issueRef='#181'
  />
);

export default CreativeStudioPage;
