# GPT Workflows

本项目使用 GPT 驱动的 GitHub Actions 工作流辅助 PR 审查。

## evaOS macOS-first PR lane

During the evaOS Workbench controlled 1.0 finish-line sprint, PR checks are macOS-first:

- Blocking PR checks are code quality, coverage, release-script safety, macOS unit tests, and macOS build/install smoke.
- Windows and Linux/Ubuntu compatibility builds are explicitly deferred until after the controlled macOS 1.0 release.
- Windows checks only run from `PR Checks` when `workflow_dispatch.run_windows_checks` is explicitly set for post-release hardening or a Windows-touching change.
- Linux and Windows release artifacts remain covered by release/manual workflows, not routine parity PRs, and skipped cross-platform jobs are not blockers for the macOS RC.

This keeps day-to-day parity work focused on the platform used by the beta audience while preserving a post-release path for cross-platform hardening.

## evaOS release target profile

Manual release workflows accept `release_target_platforms` and the scripts honor `EVAOS_RELEASE_TARGET_PLATFORMS`.

- `all` is the default and preserves the existing Windows, macOS, and Linux release contract.
- `macos` is the controlled 1.0 RC profile. It builds, prepares, verifies, canaries, and distributes only macOS x64/arm64 desktop assets plus macOS updater metadata.
- Windows and Linux assets are deferred in the `macos` profile; do not treat their absence as a release failure for the controlled 1.0 RC.

## evaOS macOS RC DMG finalization

For the current controlled RC, use one lane at a time:

1. Product or polish PR: focused tests plus PR macOS smoke. Do not run full signing/notarization/canary/distribution for copy or layout changes.
2. Staged RC artifact: dispatch `Build and Release` with `beta_release_ack=evaos-beta`, `release_target_platforms=macos`, and `macos_dmg_finalization=local`. This builds app-notarized DMGs, uploads artifacts, and stops before tag/release creation.
3. Local DMG finalization: download the exact staged DMGs, Developer ID sign the DMG containers, submit them to Apple, staple them, and verify `xcrun stapler validate <dmg>` plus `spctl --assess --type open --context context:primary-signature <dmg>`.
4. Updater metadata: regenerate `latest-mac.yml` and `latest-arm64-mac.yml` from the finalized DMGs because DMG signing/stapling changes the bytes and checksums.
5. Trusted manifest: attach the finalized DMGs/updater metadata to the GitHub prerelease, then run `Register evaOS Beta Local-Signed DMG Manifest` with `local_signed_dmg_fallback_ack=evaos-local-signed-dmg`.
6. Canary and distribution: run `evaOS Beta RC Canary` and `Distribute evaOS Beta Release Assets` with the manifest registration `trusted_manifest_run_id`; distribution remains GitHub-release based, not S3/AWS.

### Agent operating rule

Agents working on the finish-line sprint must treat macOS as the only active release platform. Do not open, block, or delay parity PRs for Windows or Ubuntu/Linux failures unless the PR explicitly changes Windows packaging, Linux packaging, Electron builder platform metadata, or shared runtime code that cannot be proven safely on macOS. If a cross-platform concern is found, file it as post-1.0 follow-up work and keep the macOS RC lane moving.

## 架构概览

```
.github/
├── actions/                          # 公共 Composite Actions
│   ├── gather-pr-diff/action.yml     # 收集 PR diff 和变更文件列表
│   ├── read-file-contents/action.yml # 按优先级读取变更文件内容
│   └── call-openai/action.yml        # 调用 OpenAI API（含重试逻辑）
└── workflows/
    ├── gpt-review.yml                # 代码质量审查
    ├── gpt-pr-assessment.yml         # PR 价值评估
    └── pr-checks.yml                 # PR 检查入口（触发 gpt-review + gpt-pr-assessment）
```

## 两个 GPT 工作流对比

|              | GPT Review                                                            | GPT PR Assessment                                                          |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **目的**     | 代码质量审查（bug、安全、性能）                                       | 维护者价值评估（合并优先级、风险）                                         |
| **角色**     | 代码审查专家                                                          | 项目维护者 / 技术负责人                                                    |
| **触发**     | PR 创建时自动触发（via pr-checks.yml）+ 手动触发（workflow_dispatch） | 外部贡献者 PR 自动触发（via pr-checks.yml）+ 手动触发（workflow_dispatch） |
| **额外数据** | 无                                                                    | 关联 Issue 内容                                                            |
| **输出方式** | PR Review（createReview）                                             | Issue Comment（可更新，不重复创建）                                        |
| **输出模板** | 按严重性分级的问题列表                                                | 7 维度结构化评估报告                                                       |

## 公共 Actions

三个 Composite Action 封装了两个工作流的公共逻辑，避免重复代码：

### `gather-pr-diff`

收集 PR 的 diff 和变更文件列表。

- **输入**: `pr_number`（手动触发时需要）
- **输出**: `skip`, `pr_number`, `additions`, `deletions`, `total_lines`, `file_count`, `diff_truncated`
- **临时文件**: `pr_diff.txt`, `file_list.json`（写入 `RUNNER_TEMP`）

### `read-file-contents`

按优先级顺序读取变更文件的完整内容，供 GPT 做跨文件分析。

- **输出**: `contents_truncated`
- **临时文件**: `file_contents.txt`（写入 `RUNNER_TEMP`）
- **前置条件**: 需要先运行 `checkout` 和 `gather-pr-diff`
- **限制**: 跳过锁文件/二进制文件，总内容上限 80K 字符

文件读取优先级（由高到低）：

1. `packages/desktop/src/process/`, `packages/desktop/src/process/agent/`, `packages/desktop/src/process/webserver/` — 核心后端
2. `packages/desktop/src/process/channels/` — Agent 通信
3. `packages/desktop/src/common/` — 公共模块
4. `packages/desktop/src/process/worker/` — Worker 进程
5. `packages/desktop/src/renderer/` — 前端 UI
6. 其他 `.ts/.tsx/.js/.jsx` 文件
7. 其余文件

### `call-openai`

调用 OpenAI Chat Completions API，包含自动重试、截断提示和长度限制处理。

- **输入**: `openai_api_key`, `output_file`, `diff_truncated`, `contents_truncated`
- **临时文件读取**: `system_prompt.txt`, `user_prompt.txt`（从 `RUNNER_TEMP` 读取）
- **临时文件写入**: `{output_file}`（写入 `RUNNER_TEMP`）
- **模型**: `gpt-5.2`
- **重试策略**: 最多 2 次重试，指数退避（429/5xx 状态码和网络错误）

## 数据流

```
                    ┌─────────────────────┐
                    │  gather-pr-diff     │
                    │  (GitHub API)       │
                    └────────┬────────────┘
                             │
                   pr_diff.txt, file_list.json
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              │              ▼
     ┌────────────────┐     │    ┌───────────────────┐
     │ read-file-     │     │    │ fetch PR metadata  │
     │ contents       │     │    │ + linked issues    │
     │ (本地文件系统)  │     │    │ (assessment only)  │
     └───────┬────────┘     │    └────────┬──────────┘
             │              │             │
   file_contents.txt        │    pr_meta.json,
             │              │    linked_issues.json
             └──────┬───────┘             │
                    │                     │
                    ▼                     │
          ┌──────────────────┐            │
          │ Construct GPT    │◄───────────┘
          │ Prompts          │
          │ (各工作流自定义)   │
          └────────┬─────────┘
                   │
         system_prompt.txt, user_prompt.txt
                   │
                   ▼
          ┌──────────────────┐
          │  call-openai     │
          │  (OpenAI API)    │
          └────────┬─────────┘
                   │
            {output_file}
                   │
                   ▼
          ┌──────────────────┐
          │ Post Comment     │
          │ (各工作流自定义)   │
          └──────────────────┘
```

## 语言检测

两个工作流都会自动检测 PR 标题和描述的语言，并使用相同语言输出回复：

- PR 内容为中文 → 中文评论
- PR 内容为英文 → 英文评论
- 混合或无法判断 → 默认英文

## 使用方式

### GPT Review（自动 + 手动触发）

**自动触发**：通过 `pr-checks.yml` 在 PR 首次提交时自动触发，无需手动操作。

**手动触发**：

1. 进入 GitHub 仓库 → Actions 页面
2. 左侧选择 **GPT Review**
3. 点击 **Run workflow**
4. 输入 PR number
5. 等待执行完成，审查结果将以 PR Review 形式出现

### GPT PR Assessment（自动 + 手动触发）

**自动触发**：当非项目成员（即 `author_association` 既不是 `OWNER` 也不是 `MEMBER`）首次提交 PR 时，`pr-checks.yml` 会在代码质量检查通过后自动触发评估。

**手动触发**：

1. 进入 GitHub 仓库 → Actions 页面
2. 左侧选择 **GPT PR Assessment**
3. 点击 **Run workflow**
4. 输入 PR number
5. 等待执行完成，评估报告将作为评论出现在 PR 中

重复对同一 PR 触发时，评论会被**更新**而非重复创建。

## Secrets 配置

| Secret           | 用途                                |
| ---------------- | ----------------------------------- |
| `OPENAI_API_KEY` | OpenAI API 访问密钥，两个工作流共用 |

## 修改指南

- **更换模型**: 修改 `.github/actions/call-openai/action.yml` 中的 `model` 字段
- **调整重试逻辑**: 修改 `.github/actions/call-openai/action.yml` 中的 `callOpenAI` 函数
- **修改文件优先级**: 修改 `.github/actions/read-file-contents/action.yml` 中的 `filePriority` 函数
- **修改 Review prompt**: 修改 `gpt-review.yml` 中的 "Construct GPT prompts" step
- **修改 Assessment prompt**: 修改 `gpt-pr-assessment.yml` 中的 "Construct GPT prompts" step
