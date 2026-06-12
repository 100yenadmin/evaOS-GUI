import React from 'react';
import EvaosDashboardHandoffPage from '@renderer/pages/evaos-dashboard-handoff';

const CREATIVE_STUDIO_URL = 'https://www.comfy.org/cloud';

const CreativeStudioPage: React.FC = () => (
  <EvaosDashboardHandoffPage
    title='Creative Studio'
    eyebrow='Creative generation'
    description='Open the hosted Creative Studio workspace for this controlled RC while the native broker runtime is finalized.'
    dashboardUrl={CREATIVE_STUDIO_URL}
    issueRef='#272'
    targetLabel='Open hosted studio'
    targetDescription='For this controlled RC, Creative Studio opens in the hosted Comfy Cloud surface while native broker-owned generation runtime parity is tracked in #272.'
    buttonLabel='Open Creative Studio'
    openedMessage='Opened Creative Studio in your browser.'
    failedMessage='Could not open Creative Studio. Use the link again or email support@electricsheephq.com.'
  />
);

export default CreativeStudioPage;
