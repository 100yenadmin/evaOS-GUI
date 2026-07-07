import React, { useState } from 'react';
import { Button, Message, Modal, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';

const EVAOS_BETA_DOWNLOAD_URL = 'https://github.com/100yenadmin/evaOS-GUI/releases';

export function shouldShowBackendStartupFailureDialog(failure: BackendStartupFailureInfo | null | undefined): boolean {
  return (
    failure?.reason === 'backend_incompatible_runtime' ||
    failure?.reason === 'backend_incomplete_installation' ||
    failure?.reason === 'backend_package_architecture_mismatch' ||
    failure?.reason === 'backend_recoverable_database_corruption' ||
    failure?.reason === 'backend_startup_failed'
  );
}

export const BackendStartupFailureDialog: React.FC<{ failure: BackendStartupFailureInfo }> = ({ failure }) => {
  const { t } = useTranslation();
  const [recovering, setRecovering] = useState(false);
  const [recoveryCancelled, setRecoveryCancelled] = useState(false);

  const isIncompatibleRuntime = failure.reason === 'backend_incompatible_runtime';
  const isPackageArchitectureMismatch = failure.reason === 'backend_package_architecture_mismatch';
  const isRecoverableDatabaseCorruption = failure.reason === 'backend_recoverable_database_corruption';
  const title = isIncompatibleRuntime
    ? t('common.backendStartup.incompatibleRuntime.title')
    : isPackageArchitectureMismatch
      ? t('common.backendStartup.packageArchitectureMismatch.title')
      : isRecoverableDatabaseCorruption
        ? t('common.backendStartup.recoverableDatabaseCorruption.title')
        : t('common.backendStartup.incompleteInstallation.title');
  const description = isIncompatibleRuntime
    ? t('common.backendStartup.incompatibleRuntime.description')
    : isPackageArchitectureMismatch
      ? t('common.backendStartup.packageArchitectureMismatch.description', {
          packageArch: failure.packageArch ?? 'x64',
          deviceArch: failure.deviceArch ?? 'arm64',
          expectedArch: failure.expectedDownloadArch ?? 'arm64',
        })
      : isRecoverableDatabaseCorruption
        ? t('common.backendStartup.recoverableDatabaseCorruption.description')
        : t('common.backendStartup.incompleteInstallation.description');
  const requiredVersions = failure.requiredVersions?.map((version) => `GLIBC_${version}`).join(', ');

  const handleDownload = () => {
    window.open(EVAOS_BETA_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  };

  const handleRecoverCorruptedDatabase = async () => {
    if (recovering) return;
    setRecoveryCancelled(false);
    setRecovering(true);
    try {
      await window.electronAPI?.recoverCorruptedDatabase?.();
    } catch {
      Message.error(t('common.backendStartup.recoverableDatabaseCorruption.rebuildFailed'));
      setRecovering(false);
    }
  };

  const footer = isIncompatibleRuntime ? null : isRecoverableDatabaseCorruption ? (
    <>
      <Button disabled={recovering} onClick={() => setRecoveryCancelled(true)}>
        {t('common.cancel')}
      </Button>
      <Button type='primary' loading={recovering} onClick={handleRecoverCorruptedDatabase}>
        {t('common.backendStartup.recoverableDatabaseCorruption.confirmRebuild')}
      </Button>
    </>
  ) : (
    <Button type='primary' onClick={handleDownload}>
      {t('common.backendStartup.incompleteInstallation.downloadLatest')}
    </Button>
  );

  return (
    <div className='min-h-screen bg-bg-1'>
      <Modal visible closable={false} maskClosable={false} footer={footer} title={title}>
        <div className='text-t-1'>
          <Typography.Paragraph className='mb-0 text-t-secondary'>{description}</Typography.Paragraph>
          {isRecoverableDatabaseCorruption ? (
            <Typography.Paragraph className='mt-12px mb-0 text-12px text-t-tertiary'>
              {t('common.backendStartup.recoverableDatabaseCorruption.diagnosticsHint')}
            </Typography.Paragraph>
          ) : null}
          {recoveryCancelled ? (
            <Typography.Paragraph className='mt-12px mb-0 text-12px text-t-tertiary'>
              {t('common.backendStartup.recoverableDatabaseCorruption.cancelHint')}
            </Typography.Paragraph>
          ) : null}
          {requiredVersions ? (
            <Typography.Paragraph className='mt-12px mb-0 text-12px text-t-tertiary'>
              {t('common.backendStartup.incompatibleRuntime.requiredVersions', { versions: requiredVersions })}
            </Typography.Paragraph>
          ) : null}
        </div>
      </Modal>
    </div>
  );
};
