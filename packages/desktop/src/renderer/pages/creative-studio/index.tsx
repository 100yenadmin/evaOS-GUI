import React from 'react';

const CREATIVE_STUDIO_URL = 'https://www.comfy.org/cloud';

const CreativeStudioPage: React.FC = () => (
  <div className='box-border flex h-full min-h-0 w-full flex-col overflow-hidden p-12px'>
    <webview
      data-testid='evaos-creative-studio-surface'
      src={CREATIVE_STUDIO_URL}
      partition='persist:evaos-creative-studio'
      className='block h-full min-h-0 w-full flex-1 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'
      style={{ display: 'flex', height: '100%', width: '100%' }}
    />
  </div>
);

export default CreativeStudioPage;
