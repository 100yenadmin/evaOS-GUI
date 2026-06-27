# Workbench Renderer Dependency Ledger

This ledger supports #452. Its purpose is to keep renderer-only libraries out of production raw `app.asar/node_modules` while preserving the runtime packages used by the main process, preload scripts, native modules, MCP servers, packaged resources, and updater/release flows.

## Rule

Move a root package from `dependencies` to `devDependencies` only when all of these are true:

- It is imported only by `packages/desktop/src/renderer/**` or renderer-focused tests.
- It is bundled by the renderer Vite build into `out/renderer`.
- It is not imported by `packages/desktop/src/process/**`, `packages/desktop/src/preload/**`, `packages/desktop/src/common/**`, `packages/web-host/**`, `packages/web-cli/**`, or `scripts/**`.
- It is not explicitly included in `packages/desktop/electron-builder.yml` as a raw runtime `node_modules` or `asarUnpack` resource.

## Moved Renderer-Only Packages

| Package                                                                            | Renderer evidence                                | Runtime evidence                         | Notes                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@arco-design/web-react`                                                           | 204 renderer imports plus DOM tests              | no process/preload/common/script imports | UI component library; bundled into renderer.                                                                           |
| `@icon-park/react`                                                                 | 122 renderer imports                             | no process/preload/common/script imports | Icon library; bundled into renderer.                                                                                   |
| `mermaid`                                                                          | `components/Markdown/MermaidBlock.tsx`           | no process/preload/common/script imports | Large diagram renderer; bundled into renderer.                                                                         |
| `react-syntax-highlighter`                                                         | Markdown, diff, and code preview renderers       | no process/preload/common/script imports | Code highlighting stays in renderer chunks.                                                                            |
| `@monaco-editor/react`                                                             | HTML preview viewer                              | no process/preload/common/script imports | Editor surface stays renderer-bundled.                                                                                 |
| `@uiw/react-codemirror`, `@uiw/codemirror-extensions-langs`, `@codemirror/*`       | settings editors and preview editors             | no process/preload/common/script imports | CodeMirror editor dependencies stay build-time/renderer only.                                                          |
| `diff2html`                                                                        | diff viewer UI                                   | no process/preload/common/script imports | Diff UI wrapper stays renderer-bundled.                                                                                |
| `katex`, `react-markdown`, `rehype-*`, `remark-*`, `streamdown`                    | Markdown and preview rendering                   | no process/preload/common/script imports | Markdown/math rendering stays renderer-bundled.                                                                        |
| `react`, `react-dom`, `react-i18next`, `react-router-dom`, `react-virtuoso`, `swr` | renderer app, router, list, i18n, and data hooks | no process/preload/common/script imports | Runtime UI libraries are bundled into `out/renderer`; the app does not require raw React from `app.asar/node_modules`. |
| `@dnd-kit/*`, `@floating-ui/react`, `classnames`, `dayjs`, `qrcode.react`          | renderer UI helpers                              | no process/preload/common/script imports | Small direct dependencies kept out of production raw shipping when used only by renderer.                              |

## Kept Or Deferred Packages

These package families stay in `dependencies` for this PR. Some are proven runtime keepers; others are deferred because #452 is intentionally limited to renderer-only direct dependency moves, not broad unused-dependency removal.

- Proven main/process/preload/updater keepers: `electron-log`, `electron-squirrel-startup`, `electron-updater`, `fix-path`, `i18next`, `semver`, `zod`.
- Proven native or explicit package-shape keepers: `better-sqlite3`, `web-tree-sitter`, plus the explicit `electron-builder.yml` `node_modules` and `asarUnpack` allowlist.
- Proven API, bridge, agent, or preload keepers: `@anthropic-ai/sdk`, `@google/genai`, `@modelcontextprotocol/sdk`, `@office-ai/aioncli-core`, `@office-ai/platform`, `@sentry/electron`, `openai`.
- Proven runtime-transitive keepers found by Thin App Smoke: `diff` is required by `@office-ai/aioncli-core`; `eventemitter3` is required by `@office-ai/platform` and `@wecom/aibot-node-sdk`.
- Deferred latent or ambiguous common/runtime packages: `docx`, `html-to-text`, `jsonrepair`, `jsonwebtoken`, `mammoth`, `officeparser`, `pptx2json`, `qrcode-terminal`, `smol-toml`, `strip-json-comments`, `turndown`, `turndown-plugin-gfm`, `xlsx-republish`, `@xmldom/xmldom`.
- Deferred unused-looking server/channel/runtime packages that need a separate removal issue and package proof: `@agentclientprotocol/sdk`, `@aws-sdk/client-bedrock`, `@grammyjs/transformer-throttler`, `@larksuiteoapi/node-sdk`, `@wecom/aibot-node-sdk`, `bcryptjs`, `cookie`, `cookie-parser`, `cors`, `dingtalk-stream`, `express`, `express-rate-limit`, `grammy`, `multer`, `sharp`, `tiny-csrf`, `ws`, `yauzl`.
- Browser/node polyfill packages that need a separate audit before removal: `buffer`, `process`, `stream-browserify`.

## Verification

Local source checks:

```bash
rg -n "from ['\"](@arco-design/web-react|@codemirror/(commands|lang-css|lang-html|lang-json|lang-markdown|view)|@dnd-kit/(core|sortable|utilities)|@floating-ui/react|@icon-park/react|@monaco-editor/react|@uiw/(codemirror-extensions-langs|react-codemirror)|classnames|dayjs|diff2html|katex|mermaid|qrcode\\.react|react|react-dom|react-i18next|react-markdown|react-router-dom|react-syntax-highlighter|react-virtuoso|rehype-(katex|raw)|remark-(breaks|gfm|math)|streamdown|swr)(/[^'\"]*)?['\"]" \
  packages/desktop/src/common packages/desktop/src/process packages/desktop/src/preload packages/web-host/src packages/web-cli/src scripts
```

Remote package proof is enforced by Thin App Smoke after `electron-builder --dir` produces an unpacked `.app`:

```bash
node scripts/evaosVerifyRendererDependencyPrune.js "out/mac-arm64/AionUi.app"
```

The verifier inspects both `app.asar` and `app.asar.unpacked/node_modules`. Absence from `app.asar` alone is not enough because native/WASM/runtime packages are intentionally unpacked.

The renderer bundle must still launch and cover Markdown, diff UI, Mermaid diagrams, code highlighting, editor surfaces, settings, and updater UI.
