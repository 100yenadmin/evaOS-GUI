import React from 'react';
import RuntimeDashboardPage from '@renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const PaperclipMissionControlPage: React.FC = () => (
  <RuntimeDashboardPage
    runtimeKey='paperclip'
    title='Mission Control'
    subtitle='Paperclip mission queue and customer runtime status from evaOS broker evidence.'
    issueRef='#154'
  />
);

export default PaperclipMissionControlPage;
