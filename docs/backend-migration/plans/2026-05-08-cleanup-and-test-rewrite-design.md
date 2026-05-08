# AionUi 前端清理与测试重写总设计

- **日期**:2026-05-08
- **状态**:方案评审
- **范围**:仅设计,不含代码实现
- **上游共享分支**:`feat/backend-migration`
- **对应工作分支**:`feat/cleanup-and-test-rewrite` 及子里程碑 feature 分支

## 背景

`feat/backend-migration` 的 M1-M9 已完成、`ci-web-cli-release-integration` 已合入,
`aionui-backend`(Rust)已接管全部业务能力。前端仓库现存两类收尾负债:

1. **前端残留代码**:部分 bridge / service / utils 对应的业务已全部迁到 backend,
   adapter(`common/adapter/ipcBridge.ts`)已经把请求改走 HTTP/WS,老 bridge 文件
   里的 `ipcBridge.xxx.provider(...)` 实际上注册的是 no-op(见"关键事实 A"),
   处于**纯死代码**状态,浪费阅读成本、增大打包体积。
2. **单元测试大面积失败**:`tests/unit/**` / `tests/integration/**` /
   `tests/regression/**` 共 ~875 个测试文件,M1-M9 大规模重构后有 168 个测试 /
   49 个测试文件失败,CI 在三个 workflow 中临时注释了 `bunx vitest run`(见
   `docs/backend-migration/handoffs/ci-web-cli-release-outcome.md` 的"未解决的
   TODO"节)。**必须尽快修,不得让这个临时状态长期化**。

## 核心目标

- **清理已迁后端的前端残留代码**,让仓库不再保留与 adapter 行为冲突的死代码
- **按现有前端代码重写单元测试**,让 `bunx vitest run` 重新变绿
- **取消 CI 中 `bunx vitest run` 的临时注释**,让单测重新成为门禁
- **协作方式对齐 M 系列里程碑模型**:多条 feature 分支接力、基线同步、
  handoff notes,不 push 共享分支、不建 PR,整条链完成后由人类统一决定合回

## 关键事实(支撑清理判断)

### 关键事实 A:adapter `provider()` 是 no-op

`packages/desktop/src/common/adapter/httpBridge.ts` 里 `httpGet` / `httpPost` /
`httpPut` / `httpPatch` / `httpDelete` / `stubProvider` 返回的对象都有
`provider: () => {}` 的实现。`common/index.ts` 直接把 `adapter/ipcBridge` re-export
给全应用:

```ts
// packages/desktop/src/common/index.ts
export * as ipcBridge from './adapter/ipcBridge';
```

这意味着**全仓 `ipcBridge.xxx.provider(...)` 都是 no-op**,前端 process/bridge/
里的 `.provider(handler)` 注册**根本不会被调用**。老 bridge 文件对 runtime 完全
无效,只是注册了永不触发的 callback。

### 关键事实 B:backend 已完整覆盖 7 个领域

本次清理聚焦在以下 7 个领域 + file preview,这些都是用户在 `feat/backend-migration`
期间已完成迁移的模块:

| 前端领域 | 对应 backend crate | adapter 路由 |
|---|---|---|
| assistants | aionui-assistant | `/api/assistants/*` |
| skills | aionui-extension/hub | `/api/skills/*` |
| extension | aionui-extension | `/api/extension/*` |
| providers | aionui-system/provider + bedrock_probe + model_fetcher | `/api/providers/*` + `/api/bedrock/test-connection` |
| system(client-pref / language) | aionui-system/settings + client_pref | `/api/settings/client` |
| cron | aionui-cron | `/api/cron/jobs/*` |
| assets | aionui-assets | (static) |
| file preview(office watch / preview history / document convert) | aionui-office(含 `watch_manager.rs`) | `/api/ppt-preview/*`、`/api/word-preview/*`、`/api/excel-preview/*`、`/api/preview-history/*`、`/api/document/convert` |

backend `aionui-office::watch_manager` 提供 `OfficecliWatchManager` +
`DefaultProcessSpawner`,已经在 backend 端 spawn `officecli watch` 子进程,
前端无需再维护。

### 关键事实 C:测试现状

- `tests/` 下共 875 个文件,大头在 `tests/unit/`(400+)、`tests/integration/`、
  `tests/regression/`
- `packages/desktop/src/process/bridge/__tests__/webuiQR.test.ts` 是仓内唯一的
  同目录单测(M 系列新加)
- `packages/web-host/src/**/*.unit.test.ts` 是 web-host 的自有测试体系
- CI 注释位置(`commit 2cae1bc19`):
  - `.github/workflows/_build-reusable.yml:67`
  - `.github/workflows/build-and-release.yml:52`
  - `.github/workflows/pack-web-cli.yml:67`

## 统一约束(UC)

以下约束是跨里程碑的硬性约束,**不得被 N1-N5 任何一个里程碑自主覆盖或简化**。
任何偏离需 escalate 给人类。

### UC-A:清理范围

本次清理**只动以下 7 个领域 + file preview**,其余模块一律不动:

- assets / skills / extension / assistant / providers / system(仅 client-pref
  迁移部分) / cron / file preview

**明确不动的领域**(团队协作保护):

- team / acp / conversation / mcp / shell / pet / agent/ / task/ / worker/
- windowControls / tray / autoUpdate / deepLink / zoom / initAgent / shellEnv
- webui / auth / remoteAgent / workspaceSnapshot

### UC-B:保留名单(不得删除)

以下文件**明确保留**,即使乍看像死代码也不删:

| 文件 | 理由 |
|---|---|
| `packages/desktop/src/process/utils/migrateAssistants.ts` | 一次性迁移 bootstrap,老用户从 electron local storage 升级到 backend 首启需要 |
| `packages/desktop/src/process/utils/runBackendMigrations.ts` | 同上,是 migrateAssistants 的 orchestrator |
| `packages/desktop/src/process/bridge/systemSettingsBridge.ts` | 整文件保留:内含 close-to-tray / keep-awake / pet-size / cronNotificationEnabled / language 等 Electron-only 或本地副作用逻辑,adapter 已迁走的部分在 adapter 里直接走 HTTP,本文件保留不动 |
| `packages/desktop/src/process/utils/previewUtils.ts` | 二次 grep 发现仍被 `task/AcpAgentManager.ts:25`(`handlePreviewOpenEvent`)使用,task 不在 UC-A 范围内 |
| `packages/desktop/src/process/services/ccSwitchModelSource.ts` | 二次 grep 发现被 `process/agent/acp/*` 和 `process/acp/compat/AcpAgentV2.ts` 使用,acp 不在 UC-A 范围内 |

### UC-C:测试布局

- 新测试存放于 `tests/unit/<module>/...`,**按功能模块镜像 `tests/e2e/features/`** 的分类
- 命名约定:
  - 单测:`<Name>.test.ts`
  - 需要 jsdom 的测试:`<Name>.dom.test.ts` 或 `<Name>.dom.test.tsx`
  - 集成测试(若有):`<Name>.integration.test.ts`
- **保留不动**:
  - `tests/e2e/**`(e2e 体系不在本次范围)
  - `tests/fixtures/**`
  - `tests/vitest.setup.ts`
  - `tests/vitest.dom.setup.ts`
- `vitest.config.ts` 的 `include` 配置**保持现状不改**(现有 `tests/unit/**/*.test.ts`
  + `tests/unit/**/*.dom.test.ts` 的 glob 对新布局天然适配)

### UC-D:测试覆盖最低清单

新测试文件数**不低于 60**,按层次分布:

- L1(utils / mapper / pure function):必盖
- L2(hook):关键用户行为必盖
- L3(component DOM/jsdom):关键交互必盖
- L4(bootstrap / 一次性迁移):必盖

按领域分配见"落地路径"一节。`vitest.config.ts` 的 `coverage.thresholds` 保持
现状(`statements/branches/functions/lines: 0`),不在本次设置硬性百分比门禁;
门禁靠"清单必须全部落地 + `bunx vitest run` 全绿"判定。

### UC-E:恢复 CI

以下三处 `bunx vitest run` 的注释必须在 N5 里取消,回到门禁状态:

- `.github/workflows/_build-reusable.yml:67-69`
- `.github/workflows/build-and-release.yml:52-55`
- `.github/workflows/pack-web-cli.yml:67-69`

**不保留**"暂时禁用"的注释块,直接恢复 `- name: Run unit tests` + `run: bunx vitest run`
两行;handoff 文档中对应的 TODO 标记为 DONE。

### UC-F:验证真实性(反偷懒硬约束)

M 系列执行期暴露的问题:验证只口头"声明通过"不贴原始输出;改 CI workflow
只改完 push 不等 CI 跑;删代码只凭经验不 grep 外部引用。`feat/ci-web-cli-release-integration`
分支上积累的一批修复(commits `36b7f90c1` / `3a0a35acb` / `654404a17` / `c7c38e58b`
/ `5fcfa5139` / `da5b340c2` / `a1caf0fb3` / `e091bd19c` / `fecc12831` / `2cae1bc19`
等)绝大多数本可以通过里程碑 handoff 阶段的真实验证拦下。本次链路明确禁止
以下做法,下列五条是硬约束:

#### UC-F-1:handoff 必须贴原始命令输出

requirements 里每一条"自动化门禁"命令,handoff 对应位置必须附:

- 完整命令(`$ <command>`)
- 原始 stdout + stderr 的**头 10 行 + 尾 10 行 + 总行数**
- 退出码(`$ echo $?`)

**禁止**:"tsc 通过"、"vitest 绿"、"按经验无影响"这类转述。

命令输出过长时允许截断,格式:

```
$ bunx vitest run
<头 10 行>
... (总计 N 行,完整输出见 <路径> 或 CI run log)
<尾 10 行>
$ echo $?
0
```

任何非 0 退出的命令必须在 handoff 的**诊断**节说明根因 + 修复动作,
不得 `|| true` 吞错。

#### UC-F-2:改 CI workflow 必须触发真实 CI run(N5 强制,其它里程碑按需)

当里程碑改动了 `.github/workflows/**` 下任何文件:

- push 后必须**等对应 workflow run 跑完**,不得 push 了就写 handoff 宣告完成
- handoff 必须包含:
  - `gh run list --branch <branch> --limit 5 --json databaseId,name,status,conclusion,url` 原始 JSON 输出
  - 被修改的 workflow(或被恢复的 step)所在 run 的 `conclusion: success` URL
  - 如果某个 workflow 的触发条件是 `workflow_call` 或 `workflow_dispatch` 无法通过
    普通 push 触发,handoff 必须说明"用何种方式触发、URL、conclusion";实在无法
    触发的要 escalate,不得默认"按经验应该能通过"
- CI fail 时:**不得 merge 基线后再 push"冲一冲"来掩盖**,必须修到真绿或 escalate
- **N5 的 handoff 至少包含 2 次 CI 成功**:
  - 第一次:workflow 改完初次 push 触发
  - 第二次:merge `origin/feat/backend-migration` 基线后再次 push 触发
  两次 run 的 URL 都要贴

#### UC-F-3:删除代码必须 grep 证明无外部引用

删除任何源文件前,必须跑并在 handoff 贴输出:

```bash
# basename 不带扩展名;glob 涵盖 ts/tsx/js/json/yml/yaml
grep -rn "<basename>" \
  packages/ scripts/ tests/ \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --include='*.json' --include='*.yml' --include='*.yaml'
```

预期:无输出,或仅在待删文件本身 / 测试文件 / 已明确可删集合内的引用。

- handoff 贴每个待删文件的完整 grep 输出,一一标注"self-reference"或"consumer 也在删除集合中"
- 发现外部引用必须 escalate,**不得自行判断"那个引用可以忽略"**
- 删除后再跑一次 `bunx tsc --noEmit`,错误数必须保持为 0

#### UC-F-4:新增测试必须证明实际执行

- 使用 `bunx vitest run --reporter=verbose`,handoff 贴输出(至少列出每个新增
  测试文件对应的 `✓` 行 + 总计 `N passed` 数字)
- 总 test count **必须 ≥ requirements 清单预期数**;低于预期需 escalate 解释
- **禁止 `.skip` / `.todo`**;特殊情况必须有 `// BLOCKED: <reason + issue/tracking>`
  行内注释,并在 handoff 独立一节列出所有被 block 的点 + 跟进计划
- 测试不得依赖真实网络 / 真实文件系统之外的外部服务(backend / OAuth / …);
  全部走 N3 沉淀的 `mockHttpBridge` 或 `vi.mock`

#### UC-F-5:本地门禁顺序 + 基线同步后必须完整复跑

标准验证顺序(任何一步 fail 必须修到绿才能下一步):

```bash
# Step 1 — 初次本地门禁
bun run lint
bunx tsc --noEmit
bunx vitest run
prek run --from-ref origin/feat/backend-migration --to-ref HEAD

# Step 2 — 里程碑专属业务回归(见各 requirements)

# Step 3 — 同步基线(merge 不是 rebase,保留下游 SHA 有效性)
git fetch origin feat/backend-migration
git merge origin/feat/backend-migration --no-ff \
  -m "chore(nx): sync with feat/backend-migration"

# Step 4 — 合并后完整复跑 Step 1 的四条,不得跳过
bun run lint
bunx tsc --noEmit
bunx vitest run
prek run --from-ref origin/feat/backend-migration --to-ref HEAD

# Step 5 — push(如改了 workflow,等 UC-F-2 规定的 CI 跑完)
git push -u origin <branch>
```

Step 4 发现新失败的处理:

- **基线引入的破坏性变更** → escalate,**不自行修**(不应该在本里程碑 scope 里扩大范围)
- **本里程碑和基线的隐性冲突**(文件无冲突但语义冲突)→ 修之 + 在 handoff
  "Deviations"节如实说明

## 落地路径与里程碑

5 个里程碑通过 feature 分支链接力。分支从 `feat/backend-migration` 逐级拉起,
每个里程碑完成后必须 merge 最新 `origin/feat/backend-migration` 再 push。

```
feat/backend-migration (共享, agent 只读)
    │
[N1] feat/cleanup-and-test-rewrite                      ← N1 从 backend-migration 拉
    │   前端死代码清理(7 文件 / ~1748 行)
    │
[N2] feat/n2-legacy-test-cleanup                        ← N2 从 N1 拉
    │   删 tests/unit|integration|regression + 建新布局骨架
    │
[N3] feat/n3-test-rewrite-adapter-common                ← N3 从 N2 拉
    │   测试重写 · adapter/common(~6 文件) + mock 模板沉淀
    │
[N4] feat/n4-test-rewrite-domains                       ← N4 从 N3 拉
    │   测试重写 · 领域层(~54 文件),可内部并行(N4a/N4b/N4c)
    │
[N5] feat/n5-restore-ci                                 ← N5 从 N4 拉
    │   恢复 3 个 workflow 的 unit test step + 最终全量校验
    │
    └→ 整条链完成后由人类决定如何合回 feat/backend-migration
```

### 里程碑依赖图

```
N1 死代码清理
  ↓
N2 旧测试清理 + 新布局骨架       ← 不依赖 N1 的内容,但必须串在 N1 之后避免同时动 bridge/index.ts
  ↓
N3 adapter/common 测试重写       ← 必须先,沉淀 mock 模板供 N4 复用
  ↓
N4 领域层测试重写                ← 内部可派 3 个并行 agent(按领域分组)
  ↓
N5 恢复 CI + 最终校验            ← 整条链终点
```

### 里程碑清单

| # | 里程碑 | 动什么 | 验证证据 |
|---|---|---|---|
| **N1** | 前端死代码清理 | 删 7 文件(bedrockBridge / previewHistoryBridge / previewHistoryService / pptPreviewBridge / officeWatchBridge / documentBridge / conversionService);bridge/index.ts 移除对应 5 个 init 调用和 import | `bunx tsc --noEmit` 绿;`bun run dev` 能启动;ppt/word/excel preview 从 UI 打开正常(backend 接管);`bun run build-mac:arm64` 绿 |
| **N2** | 旧测试清理 + 新布局骨架 | 删 `tests/unit/**`、`tests/integration/**`、`tests/regression/**`、`tests/bench/**`、`packages/desktop/src/process/bridge/__tests__/`;新建 `tests/unit/<module>/` 占位目录(镜像 `tests/e2e/features/`) | `bunx vitest run` 绿(0 tests);目录结构镜像 `tests/e2e/features/` |
| **N3** | adapter/common 测试重写 | 写 `tests/unit/common-adapter/` 和 `tests/unit/common-config/` 约 6 个测试文件;同时沉淀 `tests/unit/_helpers/mockHttpBridge.ts` 供后续复用 | 这 6 个测试全绿;helper 可被其它测试 import;`bunx vitest run` 统计 ≥6 tests passed |
| **N4** | 领域层测试重写 | 写 `tests/unit/assistants/` / `skills/` / `extension/` / `providers/` / `cron/` / `previews/` / `assets/` / `bootstrap/` 约 54 个测试文件 | 所有测试全绿;`bunx vitest run` 统计 ≥60 tests passed |
| **N5** | 恢复 CI + 最终校验 | 取消 3 个 workflow 的 `bunx vitest run` 注释;更新 handoff 文档把 TODO 标为 DONE | `prek run --from-ref origin/feat/backend-migration --to-ref HEAD` 绿;3 个 workflow 的 diff 符合 UC-E;本地全量门禁绿 |

### 每个里程碑 handoff 的共用基线

每个里程碑的 handoff 文件位于 `docs/backend-migration/handoffs/N{x}-outcome.md`,
按 M 系列 500 字模板书写,必须包含:

- **自动化验证**:`bun run lint` / `bunx tsc --noEmit` / `bunx vitest run` /
  `prek run --from-ref origin/feat/backend-migration --to-ref HEAD` 全绿
- **基线同步状态**:已 merge 的 `origin/feat/backend-migration` SHA
- **产物抽查**:
  - N1:`bun run build-mac:arm64` 退出 0;dmg 可启动
  - N2:`bunx vitest run` 绿且 0 tests
  - N3/N4:`bunx vitest run` 的 passed 统计数 ≥ 本里程碑清单预期数
  - N5:3 个 workflow 的 diff

### 会话独立性

| 里程碑 | 会话独立性 | 起会话只需读 |
|---|---|---|
| **N1** | ✅ 完全独立 | 本总设计 + N1 requirements |
| **N2** | ✅ 完全独立 | 本总设计 + N1 handoff + N2 requirements |
| **N3** | ⚠️ 需少量上游 | 本总设计 + N2 handoff + N3 requirements |
| **N4** | ⚠️ 需少量上游 | 本总设计 + N3 handoff + N4 requirements(含 mock 模板路径) |
| **N5** | ✅ 完全独立 | 本总设计 + N4 handoff + N5 requirements + ci-web-cli-release-outcome.md 的 TODO 节 |

## 文件清单(N1)

N1 要删的**7 个文件 / 1748 行**,证据:`bunx tsc --noEmit` 删除后仍绿 +
adapter 已走 HTTP/WS:

| 绝对路径 | 行数 | adapter 等价路由 | backend 实现位置 |
|---|---:|---|---|
| `packages/desktop/src/process/bridge/bedrockBridge.ts` | 94 | `/api/bedrock/test-connection` | `aionui-system/src/bedrock_probe/` |
| `packages/desktop/src/process/bridge/previewHistoryBridge.ts` | 30 | `/api/preview-history/*` | `aionui-office/src/routes.rs` |
| `packages/desktop/src/process/services/previewHistoryService.ts` | 210 | 同上 | 同上 |
| `packages/desktop/src/process/bridge/pptPreviewBridge.ts` | 331 | `/api/ppt-preview/*` | `aionui-office/src/watch_manager.rs` |
| `packages/desktop/src/process/bridge/officeWatchBridge.ts` | 331 | `/api/word-preview/*` + `/api/excel-preview/*` | 同上 |
| `packages/desktop/src/process/bridge/documentBridge.ts` | 105 | `/api/document/convert` | `aionui-office/src/conversion.rs` |
| `packages/desktop/src/process/services/conversionService.ts` | 647 | 同上 | 同上 |

**需要同步更新的文件**:

- `packages/desktop/src/process/bridge/index.ts` — 移除 5 个 `init*Bridge` 的
  import、调用、re-export:`initBedrockBridge` / `initPreviewHistoryBridge` /
  `initDocumentBridge` / `initPptPreviewBridge` / `initOfficeWatchBridge`

## 测试覆盖清单(N3/N4)

按层次 L1-L4 + 领域镜像 `tests/e2e/features/` 布局。完整清单见各里程碑
requirements。这里列总量分布供总设计校对:

### N3(~6 文件):`tests/unit/common-adapter/` + `tests/unit/common-config/`

- `tests/unit/common-adapter/apiModelMapper.test.ts`
- `tests/unit/common-adapter/searchMapper.test.ts`
- `tests/unit/common-adapter/httpBridge.test.ts`
- `tests/unit/common-config/configMigration.test.ts`
- `tests/unit/common-config/storage.test.ts`
- `tests/unit/_helpers/mockHttpBridge.ts`(helper,不是测试,但 N3 一并交付)

### N4a(~18 文件):Assistants + Skills + Extension

- `tests/unit/assistants/*`(~12)
- `tests/unit/skills/*`(~3-5)
- `tests/unit/extension/*`(~2-3)

### N4b(~17 文件):Providers + Cron

- `tests/unit/providers/*`(~8)
- `tests/unit/cron/*`(~6)
- 相关共享:若有 system 类(language / client-pref)放 `tests/unit/providers/` 或新开 `tests/unit/system/`(~2-3)

### N4c(~19 文件):Previews + Assets + Bootstrap + 尾款

- `tests/unit/previews/*`(~10)
- `tests/unit/assets/*`(~2)
- `tests/unit/bootstrap/*`(~3,覆盖 `migrateAssistants` / `runBackendMigrations` / `initStorage` 里 migration 分支)
- 尾款(集成测试 `*.integration.test.ts`,如 workflow 跨 hook 校验,~2-4)

**实际数量可在 N4 requirements 展开时根据 grep 结果增减 ±5 文件,总数不低于 60**。

## 分支协作模型

严格遵循 `docs/backend-migration/plans/2026-05-07-webui-decouple-team-playbook.md`
的"分支协作模型"节:

```
feat/backend-migration (共享, agent 只读)
    │
feat/cleanup-and-test-rewrite            ← N1 分支名等于总工作分支
    │   │ push 完成后↓
    ├─ feat/n2-legacy-test-cleanup
    │   │ push 完成后↓
    ├─ feat/n3-test-rewrite-adapter-common
    │   │ push 完成后↓
    ├─ feat/n4-test-rewrite-domains
    │   │ push 完成后↓
    └─ feat/n5-restore-ci                ← 整条链终点
```

- **每个 agent 只在自己的 feature 分支上 commit + push**
- **不 push 共享分支,不建 PR,不合回共享分支**
- **push 前必须 merge `origin/feat/backend-migration`,重跑验证,再 push**
- **merge 而不是 rebase**(避免改写下游 agent 已起步的 SHA)

整条链完成后由**人类**统一决定合回方式:一次性 PR / 分段 PR 都可行。

## 风险与应对

| 风险 | 应对 |
|---|---|
| 团队协作中其它 agent 同时改了 bridge/index.ts 或相关 bridge 文件 | 每个里程碑 push 前先 `git fetch origin feat/backend-migration`,确认无竞争;merge 冲突按 playbook 规范处理,复杂冲突 escalate |
| previewUtils.ts / ccSwitchModelSource.ts 二次 grep 结果与预期不符(见已做的 grep:task 和 acp 仍在使用)→ 这两个文件不能删 | 已在 UC-B 明确保留;若未来 task / acp 也迁走,另立里程碑清理 |
| N4 的 60+ 测试里对 ipcBridge 的 HTTP mock 方式不统一 | N3 强制先产出 `tests/unit/_helpers/mockHttpBridge.ts`,N4 所有测试复用;N4 requirements 明确要求:不得自写一份新 mock 体系 |
| Vitest 4 fake timers + async 导致的 flaky | 已有记忆教训("先吃透源码的异步链路再写测试"),在 N3 helper 里提供 `await vi.advanceTimersByTimeAsync()` 等标准推进 API 的 wrapper |
| 子 agent 写复杂 mock 测试的质量风险 | 已有记忆教训("不要过早委托子 agent 写复杂 mock 测试");N4 内部并行仍以人工主导,即使派 agent 也要基于 N3 沉淀的模板 |
| N5 CI 恢复后出现本地未复现的失败 | N5 requirements 要求先在 N4 分支 `prek run` 绿才 push 改 workflow 的 commit |
| 里程碑链过长(5 个串行)导致基线同步次数多 | 每个里程碑预计 1-5 天,总体 1-2 周完成;与 `feat/backend-migration` 的冲突概率受 UC-A(范围锁定)压制 |
| N2 删 `packages/desktop/src/process/bridge/__tests__/webuiQR.test.ts`,但 webuiQR 模块仍存在 | webuiQR 仍是 Electron-only 能力(M 系列遗留),本次只删测试文件、不删源码;后续若需要 webuiQR 测试,在 N4 按新布局重写到 `tests/unit/webui/webuiQR.test.ts` |

## 非目标(明确排除)

- **不动 team / acp / conversation / mcp / shell / pet 等不在 UC-A 的领域**
- **不改 `vitest.config.ts` 的 include / coverage 配置**(新布局天然适配)
- **不动 web-host 测试**(`packages/web-host/src/**/*.unit.test.ts`)
- **不做 e2e 补强**(`tests/e2e/**` 不在本方案范围)
- **不做 CI 之外的门禁调整**(如 prek / husky 配置)
- **不补 preload 层测试**(preload 层纯 IPC 桥接,逻辑集中在 process / renderer)
- **不提供覆盖率硬性百分比门禁**(thresholds 继续为 0,先出清单再考虑)
- **不一次性写代码实现**,本文档仅交付设计;5 个 requirements + plan 另出

## 验证方式(跨里程碑统一基线)

每个里程碑执行完后,handoff 中的**机械化验证**必须包含以下命令输出:

```bash
# 自动化门禁
bun run lint
bunx tsc --noEmit
bunx vitest run
prek run --from-ref origin/feat/backend-migration --to-ref HEAD

# 基线同步确认
git log --merges --oneline -1
# 预期:有一条 "chore(nx): sync with feat/backend-migration" merge commit

# 里程碑专属产物验证(见各 requirements)
```

## 参考文档

- `docs/backend-migration/plans/2026-05-07-webui-decouple-electron-design.md` —— M 系列总设计,协作模型来源
- `docs/backend-migration/plans/2026-05-07-webui-decouple-team-playbook.md` —— 协作规范、分支模型、handoff 模板
- `docs/backend-migration/plans/2026-05-07-webui-decouple-teammate-cheatsheet.md` —— teammate 必读硬约束(精简版)
- `docs/backend-migration/handoffs/ci-web-cli-release-outcome.md` —— 单测禁用 TODO 的来源
- `/Users/zhoukai/Documents/github/aionui-backend/docs/development-workflow.md` —— 前后端联调流程

## 附录 A:grep 二次确认记录(2026-05-08)

为确认可删文件确无其它 consumer,执行了如下 grep,结果如下:

```
# previewUtils.ts
grep -rn 'previewUtils' packages/desktop/src --include='*.ts' --include='*.tsx'
  → packages/desktop/src/process/task/AcpAgentManager.ts:25:
    import { handlePreviewOpenEvent } from '@process/utils/previewUtils';
  ⇒ 结论:仍被 task 模块使用,UC-B 保留

# conversionService.ts
grep -rn 'conversionService' packages/desktop/src --include='*.ts' --include='*.tsx'
  → packages/desktop/src/process/bridge/documentBridge.ts(唯一 consumer)
  ⇒ 结论:documentBridge 删除后 conversionService 即为孤儿,可删

# ccSwitchModelSource.ts
grep -rn 'ccSwitchModelSource|ccSwitch' packages/desktop/src --include='*.ts' --include='*.tsx'
  → packages/desktop/src/process/agent/acp/acpConnectors.ts:33
    packages/desktop/src/process/agent/acp/index.ts:35
    packages/desktop/src/process/acp/compat/AcpAgentV2.ts:20
  ⇒ 结论:仍被 agent/acp 模块使用,UC-B 保留

# previewHistoryService.ts
grep -rn 'previewHistoryService' packages/desktop/src --include='*.ts' --include='*.tsx'
  → packages/desktop/src/process/bridge/previewHistoryBridge.ts(唯一 consumer)
  ⇒ 结论:previewHistoryBridge 删除后 previewHistoryService 即为孤儿,可删
```

## 附录 B:adapter HTTP 路由对照表(本次清理相关)

| 前端要删的 bridge | adapter 路由(HTTP) | 事件通道(WS) |
|---|---|---|
| bedrockBridge | `/api/bedrock/test-connection` | - |
| previewHistoryBridge | `/api/preview-history/list` `/api/preview-history/save` `/api/preview-history/get-content` | - |
| pptPreviewBridge | `/api/ppt-preview/start` `/api/ppt-preview/stop` | `ppt-preview.status` |
| officeWatchBridge | `/api/word-preview/start` `/api/word-preview/stop` `/api/excel-preview/start` `/api/excel-preview/stop` | `word-preview.status` `excel-preview.status` |
| documentBridge | `/api/document/convert` | - |

adapter 引用位置:`packages/desktop/src/common/adapter/ipcBridge.ts`:

- `export const bedrock = { testConnection: httpPost<...>('/api/bedrock/test-connection') };`(line ~601)
- `export const previewHistory = { ... }`(line 847)
- `export const pptPreview = { ... }`(line 888)
- `export const wordPreview = { ... }`(line 894)
- `export const excelPreview = { ... }`(line 902)
- `export const document = { convert: httpPost<...>('/api/document/convert') };`(通过 grep 确认)
