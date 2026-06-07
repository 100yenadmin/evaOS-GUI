/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Divider, Typography, Button, Switch } from '@arco-design/web-react';
import { Earth, Right } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import { isElectronDesktop, openExternalUrl } from '@/renderer/utils/platform';
import FeedbackReportModal from './FeedbackReportModal';
import { EVAOS_BETA_IDENTITY } from '@/common/evaos/betaIdentity';

// __APP_VERSION__ is injected by electron.vite.config.ts `define:` from the
// repo-root package.json. The previous `import packageJson from
// '../../../../../../package.json'` resolved to packages/desktop/package.json
// which is a workspace placeholder permanently pinned at "0.0.0".
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : __APP_VERSION__;
const APP_COMMIT = typeof __APP_COMMIT__ === 'undefined' ? 'local' : __APP_COMMIT__;

type LinkItem =
  | { title: string; url: string; icon: React.ReactNode; onClick?: never }
  | { title: string; onClick: () => void; icon: React.ReactNode; url?: never };

export const EVAOS_BETA_ABOUT_LINKS = {
  appName: 'evaOS Workbench Beta',
  repository: 'https://www.electricsheephq.com',
  documentation: 'https://www.electricsheephq.com',
  releases: 'https://www.electricsheephq.com/contact',
  support: 'https://www.electricsheephq.com/contact',
} as const;

// Release-audit breadcrumb only. Keep this out of rendered About/support links.
export const EVAOS_BETA_RELEASE_CONTROL_REPO = 'https://github.com/100yenadmin/AionUi';

export const EVAOS_BETA_SUPPORT_NOTICE = {
  title: 'Beta support',
  body: 'The released macOS app remains the fallback until public beta gates pass.',
  supportRoute: 'Open ElectricSheep support',
  diagnostics:
    'Support reports include route, app version, commit, channel, redacted logs, and screenshots only when requested.',
} as const;

export const EVAOS_BETA_BUILD_METADATA = [
  { label: 'Channel', value: 'controlled beta' },
  { label: 'Version', value: `v${APP_VERSION}` },
  { label: 'Commit', value: APP_COMMIT },
  { label: 'Bundle ID', value: EVAOS_BETA_IDENTITY.appId },
  { label: 'Protocol', value: EVAOS_BETA_IDENTITY.protocolScheme },
  { label: 'Release repo', value: EVAOS_BETA_RELEASE_CONTROL_REPO },
  { label: 'Fallback', value: 'released macOS app' },
] as const;

const checkUpdate = () => {
  // 使用 window 自定义事件在渲染进程内部通信（buildEmitter 只支持主进程->渲染进程）
  // Use window custom event for renderer-side communication (buildEmitter only works main->renderer)
  window.dispatchEvent(new CustomEvent('aionui-open-update-modal', { detail: { source: 'about' } }));
};

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const isElectron = isElectronDesktop();

  const [includePrerelease, setIncludePrerelease] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('update.includePrerelease');
    setIncludePrerelease(saved === 'true');
  }, []);

  const handlePrereleaseChange = (val: boolean) => {
    setIncludePrerelease(val);
    localStorage.setItem('update.includePrerelease', String(val));
  };

  const openLink = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.log('Failed to open link:', error);
    }
  };

  const linkItems: LinkItem[] = [
    {
      title: t('settings.helpDocumentation'),
      url: EVAOS_BETA_ABOUT_LINKS.documentation,
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.updateLog'),
      url: EVAOS_BETA_ABOUT_LINKS.releases,
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.bugReport'),
      onClick: () => setShowFeedbackModal(true),
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.contactMe'),
      url: EVAOS_BETA_ABOUT_LINKS.support,
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.officialWebsite'),
      url: EVAOS_BETA_ABOUT_LINKS.repository,
      icon: <Right theme='outline' size='16' />,
    },
  ];

  return (
    <div className='flex flex-col h-full w-full'>
      {/* Content Area */}
      <div
        className={classNames(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px',
          isPageMode && 'px-0 overflow-visible'
        )}
      >
        <div className='flex flex-col max-w-500px mx-auto'>
          {/* App Info Section */}
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='text-24px font-bold text-t-primary mb-8px'>
              {EVAOS_BETA_ABOUT_LINKS.appName}
            </Typography.Title>
            <Typography.Text className='text-14px text-t-secondary mb-12px text-center'>
              {t('settings.appDescription')}
            </Typography.Text>
            <div className='flex items-center justify-center gap-8px mb-16px'>
              <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>v{APP_VERSION}</span>
              <div
                className='text-t-primary cursor-pointer hover:text-t-secondary transition-colors p-4px'
                title='Open ElectricSheep'
                aria-label='Open ElectricSheep'
                onClick={() =>
                  openLink(EVAOS_BETA_ABOUT_LINKS.repository).catch((error) =>
                    console.error('Failed to open link:', error)
                  )
                }
              >
                <Earth theme='outline' size='20' />
              </div>
            </div>

            {/* Check Update Section */}
            {isElectron && (
              <div className='flex flex-col items-center gap-12px w-full max-w-300px bg-fill-2 p-16px rounded-lg'>
                <Button type='primary' long onClick={checkUpdate}>
                  {t('settings.checkForUpdates')}
                </Button>
                <div className='flex items-center justify-between w-full'>
                  <Typography.Text className='text-12px text-t-secondary'>
                    {t('settings.includePrereleaseUpdates')}
                  </Typography.Text>
                  <Switch size='small' checked={includePrerelease} onChange={handlePrereleaseChange} />
                </div>
              </div>
            )}

            <div className='w-full mt-16px p-14px rd-8px bg-fill-2 border border-border flex flex-col gap-6px'>
              <Typography.Text className='text-13px font-600 text-t-primary'>
                {EVAOS_BETA_SUPPORT_NOTICE.title}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-secondary leading-18px'>
                {EVAOS_BETA_SUPPORT_NOTICE.body}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-secondary leading-18px'>
                {EVAOS_BETA_SUPPORT_NOTICE.diagnostics}
              </Typography.Text>
              <Typography.Text
                className='text-12px text-brand cursor-pointer hover:opacity-80'
                onClick={() =>
                  openLink(EVAOS_BETA_ABOUT_LINKS.support).catch((error) =>
                    console.error('Failed to open support link:', error)
                  )
                }
              >
                {EVAOS_BETA_SUPPORT_NOTICE.supportRoute}
              </Typography.Text>
            </div>

            <div className='w-full mt-12px p-14px rd-8px bg-fill-2 border border-border'>
              <Typography.Text className='text-13px font-600 text-t-primary'>Build identity</Typography.Text>
              <div className='mt-10px grid grid-cols-1 gap-8px'>
                {EVAOS_BETA_BUILD_METADATA.map((item) => (
                  <div key={item.label} className='flex items-center justify-between gap-12px text-12px leading-18px'>
                    <span className='text-t-tertiary'>{item.label}</span>
                    <span className='text-t-primary text-right [word-break:break-word]'>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <Divider className='my-16px' />

          {/* Links Section */}
          <div className='flex flex-col gap-4px pt-8px'>
            {linkItems.map((item, index) => (
              <div
                key={index}
                className='flex items-center justify-between px-16px py-12px rd-8px hover:bg-fill-2 transition-all cursor-pointer group'
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if ('url' in item) {
                    openLink(item.url).catch((error) => console.error('Failed to open link:', error));
                  } else {
                    item.onClick();
                  }
                }}
              >
                <Typography.Text className='text-14px text-t-primary'>{item.title}</Typography.Text>
                <div className='text-t-secondary group-hover:text-t-primary transition-colors'>{item.icon}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <FeedbackReportModal visible={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />
    </div>
  );
};

export default AboutModalContent;
