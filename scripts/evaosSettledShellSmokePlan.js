#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_PLAN_PATH =
  process.env.AIONUI_SETTLED_SHELL_SMOKE_PLAN_PATH ||
  '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/shell-smoke-plan.md';

const COMMON_WAIT_SELECTORS = ['[data-testid="evaos-support-bubble"]', 'body:text("evaOS Workbench Beta")'];

const SETTLED_SHELL_SCREENSHOT_PLAN = [
  {
    id: 'home',
    route: '/home',
    screenshot: '00-home.png',
    target: 'Home route with signed-in Workbench shell entry point',
    waitSelectors: [
      'body:text("evaOS Workbench Beta")',
      'body:text("Home")',
      'body:text("Mission Control")',
      'body:text("Mac & iPhone")',
    ],
    notes: [
      'Capture after the Home route settles; this proves the old Workbench Home entry is route-owned, not just sidebar copy.',
      'If signed out, the proof may show sign-in repair copy but must not redirect to an upstream AionUi placeholder.',
    ],
  },
  {
    id: 'sidebar-footer',
    route: '/guid',
    screenshot: '01-sidebar-footer.png',
    target: 'Sidebar brand, route order, footer controls, account/version/support affordances',
    waitSelectors: [
      'body:text("evaOS Workbench Beta")',
      'body:text("New Chat")',
      'body:text("Settings")',
      '.sider-footer',
    ],
    notes: [
      'Capture the full app frame at 1440x1000 with the sidebar expanded.',
      'Footer proof should include auth/customer/version/support state without exposing session or provider secrets.',
    ],
  },
  {
    id: 'new-chat-agent-order',
    route: '/guid',
    screenshot: '02-new-chat-agent-order.png',
    target: 'New Chat agent pill order: evaOS/OpenClaw first, Hermes second, custom/preset rows after native agents',
    waitSelectors: [
      'body:text("New Chat")',
      '[data-agent-pill="true"]',
      '[data-testid="agent-pill-openclaw-gateway"], [data-testid="agent-pill-openclaw"]',
      '[data-testid="agent-pill-hermes"]',
    ],
    notes: [
      'Use the settled New Chat shell after detected agents load.',
      'Agent order should match evaosAgentPresentationSortRank, with custom/remote rows behind native evaOS/Hermes rows.',
    ],
  },
  {
    id: 'settings-system',
    route: '/settings/system',
    screenshot: '03-settings-system.png',
    target: 'Settings System page',
    waitSelectors: ['body:text("Settings")', 'body:text("System")'],
    notes: [
      'Capture system preferences in the route shell, not the modal overlay unless the parity fix chooses modal-only UI.',
    ],
  },
  {
    id: 'settings-themes',
    route: '/settings/display',
    screenshot: '04-settings-themes.png',
    target: 'Settings theme/display page with evaOS Default and CSS theme cards',
    waitSelectors: ['body:text("CSS Settings")', 'body:text("Theme")', 'body:text("evaOS Default")'],
    notes: ['Wait for theme cards to render before screenshotting so the palette/preview state is visible.'],
  },
  {
    id: 'settings-about',
    route: '/settings/about',
    screenshot: '05-settings-about.png',
    target: 'Settings About page with beta identity, channel, bundle ID, protocol, and support path',
    waitSelectors: [
      'body:text("evaOS Workbench Beta")',
      'body:text("Build identity")',
      'body:text("com.evaos.workbench.beta")',
      'body:text("evaos-workbench-beta")',
    ],
    notes: ['Verify old AionUi/iOfficeAI/aionui.com identity strings are absent in the final proof.'],
  },
  {
    id: 'mac-iphone',
    route: '/native-companion',
    screenshot: '06-mac-iphone.png',
    target: 'Mac & iPhone native companion status and repair handoff',
    action: 'click-native-companion-advanced-diagnostics',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Mac & iPhone")',
      'body:text("Native companion status matrix")',
      'body:text("Boundary clean")',
    ],
    notes: [
      'Capture repair/ready copy after the native companion status settles; do not expose callback or local secrets.',
    ],
  },
  {
    id: 'evaos',
    route: '/evaos',
    screenshot: '07-evaos.png',
    target: 'evaOS primary agent workspace dashboard',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("evaOS")',
      'body:text("Primary evaOS agent workspace")',
      'body:text("Customer context")',
    ],
    notes: [
      'Default shell proof may be honest empty/error state; fixture/live proof must wait for broker runtime markers.',
    ],
  },
  {
    id: 'hermes',
    route: '/hermes',
    screenshot: '08-hermes.png',
    target: 'Hermes agent dashboard',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Hermes")',
      'body:text("Hermes agent dashboard")',
      'body:text("Customer context")',
    ],
    notes: ['Keep evaOS and Hermes screenshots separate because native readiness can gate them differently.'],
  },
  {
    id: 'mission-control',
    route: '/mission-control',
    screenshot: '09-mission-control.png',
    target: 'Mission Control / Paperclip mission queue',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Mission Control")',
      'body:text("Paperclip mission queue")',
      'body:text("Customer context")',
    ],
    notes: ['For loaded proof, wait for paperclip runtime status and audit/source markers before screenshotting.'],
  },
  {
    id: 'terminal',
    route: '/terminal',
    screenshot: '10-terminal.png',
    target: 'Terminal customer VM shell status',
    waitSelectors: [...COMMON_WAIT_SELECTORS, 'body:text("Terminal")', '[data-testid="evaos-terminal-status"]'],
    notes: [
      'If signed out or missing scope, capture the guarded fallback separately and do not overclaim VM readiness.',
    ],
  },
  {
    id: 'business-browser',
    route: '/business-browser',
    screenshot: '11-business-browser.png',
    target: 'Business Browser brokered runtime state',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Business Browser")',
      'body:text("Brokered browser and VM runtime state")',
    ],
    notes: [
      'Loaded-state proof should include current URL summary, runtime source, and browser audit ID with no grant handles.',
    ],
  },
  {
    id: 'design-workspace',
    route: '/design-workspace',
    screenshot: '12-design-workspace.png',
    target: 'Design Workspace route and sidebar entry',
    waitSelectors: [...COMMON_WAIT_SELECTORS, 'body:text("Design Workspace")', 'body:text("OpenDesign workspace")'],
    notes: [
      'This is a post-parity-fix target route. If it still redirects to #/guid, record it as a route gap instead of a pass.',
    ],
  },
  {
    id: 'creative-studio',
    route: '/creative-studio',
    screenshot: '13-creative-studio.png',
    target: 'Creative Studio route and external-runtime handoff state',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Creative Studio")',
      'body:text("External creative generation workspace")',
    ],
    notes: [
      'This is a post-parity-fix target route. Screenshot should prove the shell handoff/guard state, not external Comfy Cloud readiness.',
    ],
  },
  {
    id: 'connected-apps',
    route: '/connected-apps',
    screenshot: '14-connected-apps.png',
    target: 'Connected Apps provider profiles and grant/revoke state',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Connected Apps")',
      'body:text("Brokered provider status, grants, and revocation")',
    ],
    notes: [
      'Loaded-state proof should show provider source pointers and status badges without renderer-visible grant handles.',
    ],
  },
  {
    id: 'people-access',
    route: '/people-access',
    screenshot: '15-people-and-access.png',
    target: 'People & Access member, role, invite, and seat-policy state',
    waitSelectors: [...COMMON_WAIT_SELECTORS, 'body:text("People Access")', 'body:text("Load a customer account")'],
    notes: [
      'Parity target label is People & Access; current route copy may still read People Access until the naming fix lands.',
      'Loaded-state proof should wait for member rows, role badges, and account policy audit ID.',
    ],
  },
  {
    id: 'company-brain',
    route: '/company-brain',
    screenshot: '16-company-brain.png',
    target: 'Company Brain directory, account brief, timeline, query, and exception evidence',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Company Brain")',
      'body:text("Org-scoped account directory")',
    ],
    notes: ['Loaded-state proof should include directory/query source pointers and no raw embeddings or prompts.'],
  },
  {
    id: 'approvals',
    route: '/approval-center',
    screenshot: '17-approvals.png',
    target: 'Approvals / Approval Center request list and decision controls',
    waitSelectors: [
      ...COMMON_WAIT_SELECTORS,
      'body:text("Approval Center")',
      'body:text("Human decisions for risky agent actions")',
    ],
    notes: [
      'Parity target label is Approvals; current route copy may still read Approval Center until the naming fix lands.',
      'Loaded-state proof should show request rows, decision source, and audit ID after a deny/approve loop.',
    ],
  },
];

function waitSelectorsForMarkdown(waitSelectors) {
  return waitSelectors.map((selector) => `  - \`${selector}\``).join('\n');
}

function markdownForPlan(plan = SETTLED_SHELL_SCREENSHOT_PLAN) {
  return [
    '# evaOS Settled Shell Smoke Screenshot Plan',
    '',
    'Purpose: prepare the macOS local shell screenshot pass after the finish-line parity fixes settle.',
    '',
    'This plan is intentionally not a heavy build/test harness. It lists the route, wait selectors, and screenshot target for the narrow local shell smoke pass. Run it from a dependency-ready Lexar checkout when the app bundle or Electron dev shell is already available.',
    '',
    'Default viewport: `1440x1000`, full-page screenshot, sidebar expanded.',
    '',
    'Forbidden in final screenshots: `desktop_session`, `Bearer`, `provider_grant`, `grant_handle`, `access_token`, `refresh_token`, old `iOfficeAI/AionUi` branding, and overclaiming copy such as `ready to ship` unless it comes from an explicit release gate.',
    '',
    '## Screenshot Matrix',
    '',
    ...plan.flatMap((entry, index) => [
      `### ${String(index + 1).padStart(2, '0')}. ${entry.target}`,
      '',
      `- ID: \`${entry.id}\``,
      `- Route: \`#${entry.route}\``,
      `- Screenshot: \`${entry.screenshot}\``,
      '- Wait selectors:',
      waitSelectorsForMarkdown(entry.waitSelectors),
      '- Notes:',
      ...entry.notes.map((note) => `  - ${note}`),
      '',
    ]),
  ].join('\n');
}

function writePlan(outputPath = DEFAULT_PLAN_PATH, plan = SETTLED_SHELL_SCREENSHOT_PLAN) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdownForPlan(plan));
  return outputPath;
}

function main() {
  const outputPath = process.argv[2] || DEFAULT_PLAN_PATH;
  const writtenPath = writePlan(outputPath);
  console.log(`[evaos-settled-shell-smoke-plan] wrote ${writtenPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_PLAN_PATH,
  SETTLED_SHELL_SCREENSHOT_PLAN,
  markdownForPlan,
  writePlan,
};
