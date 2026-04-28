/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import academicPaper from './academic-paper.jpg';
import beautifulMermaid from './beautiful-mermaid.jpg';
import cowork from './cowork.jpg';
import dashboardCreator from './dashboard-creator.jpg';
import excelCreator from './excel-creator.jpg';
import financialModelCreator from './financial-model-creator.jpg';
import game3d from './game-3d.jpg';
import human3Coach from './human-3-coach.jpg';
import moltbook from './moltbook.jpg';
import morphPpt3d from './morph-ppt-3d.jpg';
import morphPpt from './morph-ppt.jpg';
import openclawSetup from './openclaw-setup.jpg';
import pitchDeckCreator from './pitch-deck-creator.jpg';
import planningWithFiles from './planning-with-files.jpg';
import pptCreator from './ppt-creator.jpg';
import socialJobPublisher from './social-job-publisher.jpg';
import starOfficeHelper from './star-office-helper.jpg';
import storyRoleplay from './story-roleplay.jpg';
import uiUxProMax from './ui-ux-pro-max.jpg';
import wordCreator from './word-creator.jpg';

/** Maps preset assistant ID → portrait image URL. */
export const PRESET_PROFILE_MAP: Record<string, string> = {
  'academic-paper': academicPaper,
  'beautiful-mermaid': beautifulMermaid,
  cowork: cowork,
  'dashboard-creator': dashboardCreator,
  'excel-creator': excelCreator,
  'financial-model-creator': financialModelCreator,
  'game-3d': game3d,
  'human-3-coach': human3Coach,
  moltbook: moltbook,
  'morph-ppt-3d': morphPpt3d,
  'morph-ppt': morphPpt,
  'openclaw-setup': openclawSetup,
  'pitch-deck-creator': pitchDeckCreator,
  'planning-with-files': planningWithFiles,
  'ppt-creator': pptCreator,
  'social-job-publisher': socialJobPublisher,
  'star-office-helper': starOfficeHelper,
  'story-roleplay': storyRoleplay,
  'ui-ux-pro-max': uiUxProMax,
  'word-creator': wordCreator,
};

/** Returns the portrait image URL for a preset assistant, stripping the `builtin-` prefix. */
export function getPresetProfile(id: string): string | undefined {
  const normalized = id.replace(/^builtin-/, '');
  return PRESET_PROFILE_MAP[normalized];
}
