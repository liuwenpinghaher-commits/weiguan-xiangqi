# M1 已知风险 / 待验证项

> 执行 M1 过程中发现的点；audit-fixes（2026-06-20）修复后已更新状态。

## 1. 坐标记法朝向 vs 真实 Pikafish

**状态：✅ 已解决并对真机 perft 验证**

- 文件：`server/src/rules/position.ts` 的 `elToPika` / `pikaToEl`。
- 原问题：用 `pika_rank = 10 - el_rank` 做转换，导致红方"炮二平五"输出为 `h7e7`，与 Pikafish/UCCI 约定不符。
- 修复：改为 `pika_rank = el_rank - 1`（逆映射 `el = pika + 1`），对真实 Pikafish 进行了 perft 走法对比验证，引擎返回/接受的 move 字符串与适配层记法完全一致。
- 自动化测试：`web/src/board/coords.test.ts`（13 用例）覆盖坐标往返；`test(session)` 集成测试含黑方走子视角验证。

## 2. Pikafish 二进制与 NNUE 权重（外部前置依赖）

**状态：仍需手动下载（不变）**

- 需下载对应平台的 Pikafish 可执行文件 + NNUE 权重，置于 `engine/`，设 `PIKAFISH_PATH`。
- Pikafish 采用 GPL v3 许可证。
- **无引擎时降级**（已实现）：服务正常启动，打 warn；对弈/诊断功能不可用；聊天与复盘仍可用。

## 3. 终局规则（原"高风险"）

**状态：✅ 已实现（⚠️ 长捉简化）**

`df148a6 fix(rules): threefold-repetition/60-move draw + perpetual-check loss`

已实现：
- **重复局面**：同一 FEN 出现 3 次，判和（`isDrawByRepetition`）
- **60 回合无吃子**：60 回合内无吃子着法，判和（`isDrawBy60Move`）；修复了原 elephantops 的 50 半回合提前判和问题
- **长将**：同一局面下被连将且重复 3 次，判负（`isLoseByPerpetualCheck`，近似实现）

未实现（已知简化）：
- **长捉（perpetual chase）**：未实现专项判定；与完整中国象棋规则存在差距，属于已知简化
