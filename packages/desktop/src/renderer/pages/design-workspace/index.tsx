import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const DesignWorkspacePage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='opendesign'
    title='Design Workspace'
    subtitle='OpenDesign workspace loaded through broker-owned runtime evidence.'
    issueRef='#181'
  />
);

export default DesignWorkspacePage;
