# N5 恢复 CI 单测 + 最终校验 - 需求文档

- **日期**:2026-05-08
- **里程碑**:N5(整条清理与测试重写链的终点)
- **上游**:`origin/feat/n4-test-rewrite-domains`(N4 产物)
- **对应总设计**:`2026-05-08-cleanup-and-test-rewrite-design.md` →
  UC-E / UC-F / 里程碑清单 N5 行

## 做什么

把 M8/M9 期间因"legacy test debt"临时注释掉的 CI 单测 step 全部恢复,并在
真实 CI run 中验证全绿。这一步是整条链的**验收闸门**:N1-N4 的价值(死代码
清理 + 60+ 新测试)最终要通过 CI 在分支 push 后自动跑过才算数;**没有真实
CI run 的 N5 handoff 不予接受**(见 UC-F-2)。

具体动作:

1. 在以下 3 个 workflow 中取消 `bunx vitest run` 的注释,恢复为正常 step:
   - `.github/workflows/_build-reusable.yml:67-69`
   - `.github/workflows/build-and-release.yml:52-55`
   - `.github/workflows/pack-web-cli.yml:67-69`

2. 更新 `docs/backend-migration/handoffs/ci-web-cli-release-outcome.md`:
   - "未解决的 TODO" 节中关于单测禁用的段落标记为 `✅ DONE (N5 恢复于 <日期>)`
   - 新增引用:本 N5 handoff 的 CI run URL

3. **触发真实 CI run 并等通过**:push 后等 3 个 workflow 的 run 跑完;必须
   `conclusion: success`

## 不做什么(边界)

- ❌ **不动** 测试代码(N3/N4 已定稿;发现测试 bug 必须先在 N4 分支补 commit
  而不是 N5)
- ❌ **不动** `vitest.config.ts`、`bun install` 的 CI 缓存策略
- ❌ **不改** 3 个 workflow 里其它无关部分(只动 `Run unit tests` 这一步)
- ❌ **不删除** handoff 文件里历史说明(legacy test debt 的上下文要保留,供
  未来查账)
- ❌ **不新增** CI 门禁(如覆盖率阈值 / 更严格的 lint 规则)—— 后续里程碑做
- ❌ **不合回共享分支,不建 PR**
- ❌ **不因 CI flaky 导致的失败** "重跑掩盖":按 UC-F-2 规定,必须修到真绿或 escalate

## 已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 是否保留被注释掉的 "# Unit tests temporarily disabled" 注释行 | **删除**,回到 M8 之前的形态 | 这个临时状态的目的达成后,保留注释只会误导未来 reader;commit message + handoff 足够留存历史 |
| 取消注释 vs 重写整个 step | **仅取消注释**(diff 尽可能小) | M 系列的 `2cae1bc19` commit 里格式就是 `- name: Run unit tests\n  run: bunx vitest run`,恢复到原样即可 |
| 触发 CI 的方式 | **push 到 `feat/n5-restore-ci` 分支**,让 `pr-checks.yml` 和 `_build-reusable.yml` 自然触发 | 不需要开 PR;分支推送 workflow 就跑 |
| 两次 CI 成功的要求(UC-F-2) | **必须 2 次**:第一次 push 后 + merge 基线后再次 push | 证明 N4 的测试在 CI 环境稳定,且基线同步没破坏测试 |
| 跨平台验证 | `pr-checks.yml` 的 `unit-tests` job 已覆盖 ubuntu-latest / macos-14 / windows-2022,必须**三平台都 success** | 已有 matrix 机制,不需要额外配置;平台差异由此暴露 |
| CI 失败时的行为 | **按 UC-F-2 处理**:不得 push 基线后 "冲一冲";必须修到绿 / escalate;修需要改测试则回到 N4 分支追加 commit,rebase 到 N5 | 这是防御"偷懒"的硬约束,M 系列经验教训 |
| 更新 ci-web-cli-release-outcome.md 的 diff 范围 | 仅改单测禁用那一段 + 加 DONE 标记 + 本 N5 CI URL | 保持 handoff 文档稳定,不做"顺手重写" |

## 验收标准

> **UC-F 硬约束提示**:本里程碑改了 CI,必须**等真实 CI run 跑完且全绿**才能
> 写 handoff,不得 push 了就宣告完成。详见总设计 UC-F-2。

### 自动化门禁(push 前)

```bash
# 1. 3 个 workflow 的 diff 符合预期
git diff origin/feat/n4-test-rewrite-domains -- \
  .github/workflows/_build-reusable.yml \
  .github/workflows/build-and-release.yml \
  .github/workflows/pack-web-cli.yml
# 预期:3 处都是把被注释的 "- name: Run unit tests\n  run: bunx vitest run" 恢复

# 2. grep 确认"temporarily disabled"注释块已清理
grep -rn "Unit tests temporarily disabled\|暂时跳过单元测试" .github/workflows/
# 预期:无输出

# 3. handoff 文件已更新 DONE 标记
grep -n "单元测试.*DONE\|unit tests.*DONE" docs/backend-migration/handoffs/ci-web-cli-release-outcome.md
# 预期:至少 1 行命中

# 4. 本地门禁先绿(避免 push 后 CI 才发现本地已 broken)
bun run lint
bunx tsc --noEmit
bunx vitest run
prek run --from-ref origin/feat/backend-migration --to-ref HEAD
# 预期:全部退出 0
```

### 基线同步并再次本地验证(UC-F-5)

```bash
git fetch origin feat/backend-migration
git merge origin/feat/backend-migration --no-ff -m "chore(n5): sync with feat/backend-migration"
bun run lint
bunx tsc --noEmit
bunx vitest run
prek run --from-ref origin/feat/backend-migration --to-ref HEAD
# 预期:全部退出 0
```

### CI 真实验证(UC-F-2 硬门禁)

```bash
# 5. push 触发 CI
git push -u origin feat/n5-restore-ci

# 6. 列出分支上的 run
gh run list --branch feat/n5-restore-ci --limit 10 \
  --json databaseId,name,status,conclusion,url

# 7. 等每个 workflow 的 run 结束,断言每个 conclusion=success
gh run watch $(gh run list --branch feat/n5-restore-ci --workflow pr-checks.yml --limit 1 --json databaseId --jq '.[0].databaseId')
# 预期:run 结束后 exit 0
# (build-and-release.yml / pack-web-cli.yml 是 workflow_call,按 pr-checks 链路间接触发或手动 workflow_dispatch)

# 8. 第一次 CI 成功后,再次触发(证明稳定):
git commit --allow-empty -m "chore(n5): force CI re-run for stability verification"
git push
# 再次等 CI 通过
```

### Handoff 必要证据(UC-F-2)

handoff 必须包含:

- **第 1 次 CI run 的 URL + `conclusion: success`**(push 后初次触发)
- **第 2 次 CI run 的 URL + `conclusion: success`**(稳定性验证)
- 三平台(ubuntu-latest / macos-14 / windows-2022)的 `unit-tests` job 的逐平台
  summary:`N passed` 数字
- 3 个 workflow 各自的 run URL,以防 `unit-tests` 在不同 workflow 有差异

### 最终闸门

- [ ] N1-N5 全部 handoff 文件已产出,`handoffs/N{1,2,3,4,5}-outcome.md` 都存在
- [ ] 整条链最终 SHA list 准备好(供人类最终合回用):
  - `feat/cleanup-and-test-rewrite`(N1)
  - `feat/n2-legacy-test-cleanup`
  - `feat/n3-test-rewrite-adapter-common`
  - `feat/n4-test-rewrite-domains`
  - `feat/n5-restore-ci`
- [ ] 每个分支的最新 SHA 和对应 handoff 交叉引用一致

## 关键风险

| 风险 | 缓解 |
|---|---|
| N4 的测试在本地绿但 CI 因为环境差异失败(path / timer / 文件锁 / DPI) | 本需求 UC-F-2 明确:失败必须回 N4 修;执行者**不得**在 N5 commit 里改测试"兼容 CI" —— 那只会掩盖问题。若真需要,回 N4 分支追加 commit 再 rebase N5 |
| 3 个 workflow 中的某个没被分支 push 触发 | `pr-checks.yml` 在分支 push 上触发;`build-and-release.yml` 是 `workflow_call`,需从 pr-checks 链路进入;`pack-web-cli.yml` 同理。若某个 workflow 结构上无法通过分支 push 触发,handoff 必须写清"用 `gh workflow run <name> --ref <branch>` 手动触发,URL 贴出",不得跳过 |
| CI run 因 npm/bun registry 临时抖动 flaky | 本里程碑允许 `gh run rerun <id>` 一次,但必须在 handoff 写明"第 1 次 fail 是 registry timeout(非测试问题),rerun 后绿";多次 flaky(≥2)必须 escalate 并调查根因 |
| 某平台(如 Windows)特有失败 | 不得 platform-skip;回 N4 分支修到跨平台绿 |
| 基线同步引入的新破坏 | 按 UC-F-5 处理,基线带来的破坏性变更 escalate(不是本里程碑的范围) |

## 依赖上游

- **N1-N4 全部已合入链**:`origin/feat/n4-test-rewrite-domains` 必须是 N4 的
  最新 SHA
- **读 N4 handoff** 确认 54 个新测试全绿;若 N4 handoff 有未结的测试遗留,
  N5 **不能开始**

## 分支与 handoff

- 上游分支:`origin/feat/n4-test-rewrite-domains`
- 本里程碑分支:`feat/n5-restore-ci`
- handoff 位置:`docs/backend-migration/handoffs/N5-outcome.md`
- 完成后 push 前:UC-F-5 标准顺序
- **push 后不得立即写完 handoff**:必须等 UC-F-2 规定的 2 次 CI run 都绿再写

## 预计执行时间

半天到 1 天:

- 取消注释 + 更新 handoff 文档:30 分钟
- 本地门禁 + 基线同步:30 分钟
- 2 次 CI run 等待:每次 15-45 分钟,合计最多 1.5 小时;若首次失败修完再等

## Handoff 必填字段(重点)

- 本里程碑分支名 + 最新 SHA + 基线同步 merge SHA
- **UC-F-1 命令输出**:自动化门禁 1-4 条 + 5-8 条的原始输出
- **UC-F-2 CI 证据**:
  - `gh run list --branch feat/n5-restore-ci --json ...` 原始 JSON(完整)
  - 第 1 次 CI 成功 URL(`pr-checks.yml` / `_build-reusable.yml` /
    `pack-web-cli.yml` 各一条)
  - 第 2 次 CI 成功 URL(同上)
  - 三平台 `unit-tests` job 的 summary 截取(`N passed` 数字)
- 3 个 workflow 的 diff(vs `origin/feat/n4-test-rewrite-domains`)
- ci-web-cli-release-outcome.md 的 diff
- **整条链 SHA 列表**(给人类做最终合回决策用):
  - `feat/cleanup-and-test-rewrite` SHA = ...
  - `feat/n2-legacy-test-cleanup` SHA = ...
  - `feat/n3-test-rewrite-adapter-common` SHA = ...
  - `feat/n4-test-rewrite-domains` SHA = ...
  - `feat/n5-restore-ci` SHA = ...
- 若任何一次 CI rerun,必须记录原因 + 排查过程
- 最后一节:"**整条链已就绪,等待人类决定如何合回 `feat/backend-migration`**"
