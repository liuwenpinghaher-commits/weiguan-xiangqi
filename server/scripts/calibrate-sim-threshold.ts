/**
 * simThreshold 标定脚本(一次性分析工具,非构建产物)。
 *
 * 用真实 text-embedding-v3 嵌入三类记忆对(复述/细化、矛盾/更新、无关),
 * 算余弦相似度,打印分布,给出建议阈值——目标:让"相关"对(复述+矛盾,
 * 应触发 judge)落在阈值之上,"无关"对(应跳过 judge)落在阈值之下。
 *
 * 跑法:  npm -w server exec tsx --env-file=.env scripts/calibrate-sim-threshold.ts
 * 需要 server/.env 里有 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL。
 */
import { DashscopeEmbedding } from '../src/llm/dashscope-embedding.js'

// [a, b] 同 persona 同 kind 下、b 作为"新记忆"相对 a 的关系
const PAIRS: Record<'复述细化' | '矛盾更新' | '无关', [string, string][]> = {
  复述细化: [
    ['爱走当头炮', '喜欢用当头炮开局'],
    ['残局容易急躁', '到了残局心态不稳、容易急'],
    ['开局偏保守', '开局下得比较稳、不冒进'],
    ['不擅长马的运用', '马走得不好,常被困'],
    ['爱用屏风马防守', '防守喜欢摆屏风马'],
  ],
  矛盾更新: [
    ['残局容易急躁', '残局变得沉稳多了'],
    ['开局偏保守', '开局越来越激进、爱抢攻'],
    ['不擅长用炮', '现在炮用得很犀利'],
    ['防守差', '防守明显进步了'],
    ['爱走当头炮', '改打仙人指路了'],
  ],
  无关: [
    ['爱走当头炮', '昨天下了场大雨'],
    ['残局容易急躁', '喜欢喝浓茶'],
    ['开局偏保守', '养了一只橘猫'],
    ['不擅长用炮', '周末爱去爬山'],
    ['防守差', '最近在追一部电视剧'],
  ],
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

function stats(xs: number[]) {
  const s = [...xs].sort((p, q) => p - q)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return { min: s[0], max: s[s.length - 1], mean }
}

async function main() {
  const emb = new DashscopeEmbedding()
  console.log(`模型 ${process.env.EMBEDDING_MODEL ?? 'text-embedding-v3'},维度 ${emb.dimension}\n`)
  const byCat: Record<string, number[]> = {}
  for (const [cat, pairs] of Object.entries(PAIRS)) {
    const sims: number[] = []
    for (const [a, b] of pairs) {
      const [va, vb] = await emb.embed([a, b])
      const sim = cosine(va, vb)
      sims.push(sim)
      console.log(`[${cat}] ${sim.toFixed(3)}  「${a}」↔「${b}」`)
    }
    byCat[cat] = sims
    console.log()
  }

  console.log('=== 各类相似度分布 ===')
  for (const [cat, sims] of Object.entries(byCat)) {
    const { min, max, mean } = stats(sims)
    console.log(`${cat}: min ${min.toFixed(3)}  mean ${mean.toFixed(3)}  max ${max.toFixed(3)}`)
  }

  const related = [...byCat['复述细化'], ...byCat['矛盾更新']]
  const unrelated = byCat['无关']
  const relMin = Math.min(...related)
  const unrelMax = Math.max(...unrelated)
  console.log('\n=== 建议阈值 ===')
  console.log(`相关对(复述+矛盾)最低相似度 = ${relMin.toFixed(3)}`)
  console.log(`无关对最高相似度       = ${unrelMax.toFixed(3)}`)
  if (relMin > unrelMax) {
    const rec = (relMin + unrelMax) / 2
    console.log(`✅ 可分:建议阈值取中点 ≈ ${rec.toFixed(2)}(相关→触发 judge,无关→跳过)`)
  } else {
    console.log(`⚠️ 有重叠(relMin ${relMin.toFixed(3)} ≤ unrelMax ${unrelMax.toFixed(3)}):`)
    console.log(`   想不漏判相关对则阈值 ≤ ${relMin.toFixed(2)},代价是部分无关对也会触发 judge(由 judge 的 keep 分支兜底)。`)
  }
}

main().catch((e) => { console.error('标定失败:', e); process.exit(1) })
