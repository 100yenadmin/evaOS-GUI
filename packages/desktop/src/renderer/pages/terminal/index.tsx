import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const TerminalPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='terminal'
    title='Terminal'
    subtitle='Customer VM shell runtime loaded from broker-owned runtime evidence. Actions stay brokered and do not expose VM credentials in renderer state.'
    issueRef='#108'
  />
);

export default TerminalPage;
