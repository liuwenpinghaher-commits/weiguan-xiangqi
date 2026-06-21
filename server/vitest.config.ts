import { defineConfig } from 'vitest/config'

// 测试只在 src/ 的 TS 源上跑。dist/ 是 `npm run build` 的编译产物(含 *.test.js 双胞胎),
// vitest@2 默认会跳过它,但 vitest@4 收紧了默认 exclude,会把 dist/ 下的 *.test.js 也收进来
// → 同一套用例跑两遍(测试数翻倍),且 dist 与 src 两份集成测试同时各起一个 SurrealDB,
//   争抢同一端口/同一 namespace,数据互相污染("长度 1 实得 2")。
// 显式把 dist 排除掉:测试源唯一真相是 src/*.test.ts,dist 不该被当测试目录。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
