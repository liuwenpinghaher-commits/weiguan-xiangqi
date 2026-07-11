# Fix Audit Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `docs/superpowers/AUDIT-2026-07-08.md` 中列出的 P1-P3 问题，并用回归测试、类型检查和构建证明修复生效。

**Architecture:** 以 `ws-server.ts` 的权威状态机为中心，先把终局、暂停、重连、时钟、AI 先手统一到可序列化状态；再修成长数据语义、TTS/成本接口、导入导出、前端只读视图和交付脚本。每个批次先补会失败的测试，再改实现。

**Tech Stack:** TypeScript, Fastify, WebSocket, SQLite, Vitest, React, Vite.

## Global Constraints

- 全程不读取真实 `.env`，不打印 secret。
- 不 commit、不 push、不丢弃用户已有改动。
- 生产代码改动前先写失败测试，并确认 RED。
- 优先沿用现有测试文件和本项目现有依赖。
- 最终必须跑 server/web tests、server/web typecheck、server/web build。

---

### Task 1: 后端权威状态机

**Files:**
- Modify: `server/src/ws-server.ts`
- Modify: `server/src/session/game-session.ts`
- Test: `server/src/ws-server.test.ts`

**Interfaces:**
- Produces: `state` frame includes `paused`, `spectators`, `awaitingAi`, `undoRemaining`.
- Produces: AI first move terminal result calls the same finalize path as normal move.

- [x] Add failing tests for AI-first terminal finalization, paused resync, paused move error, and state frame metadata.
- [x] Run targeted tests and confirm they fail for the expected missing behavior.
- [x] Add per-game locking around clock sweeper timeout handling.
- [x] Finalize AI-first terminal results.
- [x] Return complete `state` snapshots from resync and explicit error on paused move.
- [x] Run targeted tests to GREEN.

### Task 2: 前端状态机

**Files:**
- Modify: `web/src/pages/PlayPage.tsx`
- Modify or create focused helper if needed under `web/src/pages/`
- Test: existing web tests or new pure helper tests.

**Interfaces:**
- Consumes: backend `state.paused`, `state.spectators`, `state.awaitingAi`, `state.undoRemaining`.
- Produces: clean restart path shared by primary start and secondary restart.

- [x] Add failing tests for state reducer/helper behavior where possible.
- [x] Lock board while waiting for AI first move when playing black.
- [x] Make primary start after over use full restart cleanup.
- [x] Apply resync metadata to status, spectators, waiting state, undo remaining.
- [x] Filter chat frames when current gameId is null.
- [x] Run web targeted tests/typecheck.

### Task 3: 成长和反思语义

**Files:**
- Modify: `server/src/store/analysis-repo.ts`
- Modify: `server/src/ws-server.ts`
- Modify: `server/src/memory/reflection.ts`
- Test: `server/src/store/analysis-repo.test.ts`, `server/src/ws-server.test.ts`, `server/src/memory/reflection.test.ts`

**Interfaces:**
- Produces: weakness profile filters by human moves for the requested side.
- Produces: reflection prompt can include result/diagnosis/chat/training summary.
- Produces: automatic diagnosis status is observable instead of silent.

- [x] Add failing tests for weakness profile excluding AI same-color mistakes.
- [x] Add failing tests or API checks for diagnosis status visibility.
- [x] Extend reflection input with richer summary without breaking existing parser tests.
- [x] Implement query changes and status reporting.
- [x] Run targeted tests to GREEN.

### Task 4: TTS, voice configuration, and cost controls

**Files:**
- Modify: `web/src/voice/server-tts.ts`
- Modify: `web/src/voice/browser-tts.ts`
- Modify: `server/src/ws-server.ts`
- Modify: `server/src/voice/dashscope-tts.ts`
- Test: web voice tests and `server/src/ws-server.test.ts`

**Interfaces:**
- Produces: must-keep determined by directed-to-human semantics, not every coach line.
- Produces: `/tts` is protected by local/origin guard and supports POST body.
- Produces: runtime `ttsVoice` overrides default persona voice.

- [x] Add failing tests for ordinary coach queue dropping and directed coach keep.
- [x] Add failing tests for `/tts` access guard and persona `ttsVoice` override.
- [x] Implement queue semantics, browser fallback keep option, POST/guarded TTS route.
- [x] Run targeted tests to GREEN.

### Task 5: Storage, backup, and delivery

**Files:**
- Modify: `server/src/ws-server.ts`
- Modify: `server/src/store/games-repo.ts`
- Modify: `server/src/index.ts`
- Modify: `package.json`
- Create scripts under `scripts/` if needed.
- Test: `server/src/ws-server.test.ts`, store tests, script dry checks.

**Interfaces:**
- Produces: import writes in a transaction.
- Produces: `/export` response explicitly carries scope metadata or full backup data.
- Produces: root scripts `test:all`, `build:all`, and packaging helper.

- [x] Add failing tests for import rollback and export scope metadata.
- [x] Add scripts without touching real secrets.
- [x] Make DB path resolution deterministic.
- [x] Run tests and script checks.

### Task 6: UI read-only and failure honesty

**Files:**
- Modify: `web/src/pages/GrowthPage.tsx`
- Modify: `web/src/pages/TrainingPage.tsx`
- Modify: `web/src/pages/ReviewPage.tsx`
- Modify: `web/src/api/config.ts`
- Test: web tests/typecheck/build.

**Interfaces:**
- Produces: API failure UI differs from empty data.
- Produces: training fallback warns that progress was not saved.
- Produces: review board is read-only; training board locks after answer.
- Produces: LAN behavior is either explicit via env or consistently supported.

- [x] Add focused tests where pure helpers exist; otherwise rely on typecheck/build plus code review.
- [x] Implement UI text/state changes.
- [x] Pass `disabled` correctly to read-only boards.
- [x] Make LAN config explicit and documented through env/script defaults.
- [x] Run web tests/typecheck/build.

### Task 7: Full Verification

**Files:**
- All modified files.

- [x] Run `npm -w server run test`.
- [x] Run `npm -w web run test`.
- [x] Run `npx tsc --noEmit -p server/tsconfig.json`.
- [x] Run `npm -w web run typecheck`.
- [x] Run `npm -w server run build`.
- [x] Run `npm -w web run build`.
- [x] Check `git status --short` and summarize changed files.
