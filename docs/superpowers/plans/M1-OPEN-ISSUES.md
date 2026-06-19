# M1 已知风险 / 待验证项

> 执行 M1 过程中发现、需在有 Pikafish 二进制时验证或修复的点。

## 1. 坐标记法朝向 vs 真实 Pikafish(高优先,Task 10 验证)

- 文件:`server/src/rules/position.ts` 的 `elToPika` / `pikaToEl`。
- 现状:用 `pika_rank = 10 - el_rank` 做转换,导致红方"炮二平五"输出为 `h7e7`。
- 标准 Pikafish/UCCI 约定:rank 0 在红方底线,该开局应为 `h2e2`,即正确映射很可能是 `pika_rank = el_rank - 1`(逆映射 `el = pika + 1`)。
- 影响:适配层**内部自洽**(legalMoves 的输出记法 == applyMove 接受的记法,单测全绿),因此 Task 5–9 纯逻辑不受影响;但接真实 Pikafish 时,引擎返回/接受的 move 字符串可能与适配层不一致 → 在 Task 10 会暴露为"illegal move"。
- 处置:Task 10 启动 Pikafish 后,发一个已知局面对比引擎 bestmove 与适配层 legalMoves 的记法;若朝向相反,改这两个函数的映射公式即可(改动局部、不影响其它模块)。

## 2. Pikafish 二进制与 NNUE 权重(Task 10/11 前置)

- 需下载对应平台的 Pikafish 可执行文件 + NNUE 权重,置于 `engine/`,设 `PIKAFISH_PATH`。
- 实现期核对其开源许可证与各平台二进制可用性。
