/**
 * simThreshold / retrieveMinSim 标定脚本(一次性分析工具,非构建产物)。
 *
 * 用本地 Ollama bge-m3 嵌入四类中文棋类记忆对,算余弦相似度、打印分布并给出建议阈值:
 *   - judge 阈(simThreshold):让"复述/矛盾更新"触发 judge,"同域相关/中性相关不同事实"跳过;
 *   - 检索地板(retrieveMinSim):滤掉"无关"对、保住"同域相关"对。
 *
 * 跑法:  ollama serve 已起、bge-m3 已 pull;
 *         npm -w server exec tsx scripts/calibrate-sim-threshold.ts
 *         可用 OLLAMA_URL / EMBEDDING_MODEL 覆盖默认 http://localhost:11434 与 bge-m3。
 *
 * 2026-07-05 实测结论(据此把 DEFAULT_SIM_THRESHOLD=0.7、DEFAULT_RETRIEVE_MIN_SIM=0.5,
 * 见 src/memory/sqlite-memory-store.ts):
 *   复述        min 0.707  mean 0.796  max 0.872
 *   相关不同事实 min 0.485  mean 0.638  max 0.724(0.724 系"急躁→沉稳"矛盾更新)
 *   同域相关     min 0.564  mean 0.627  max 0.702
 *   无关        min 0.418  mean 0.439  max 0.480
 */
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.EMBEDDING_MODEL ?? 'bge-m3'

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  })
  if (!r.ok) throw new Error(`Ollama /api/embeddings HTTP ${r.status}`)
  const j = (await r.json()) as { embedding: number[] }
  return j.embedding
}

// [a, b]:同 persona 同 kind 下、b 作为"新记忆"相对 a 的关系
const PAIRS: Record<'复述' | '相关不同事实' | '同域相关' | '无关', [string, string][]> = {
  复述: [
    ['爱走当头炮', '喜欢用当头炮开局'],
    ['残局容易急躁', '到了残局心态不稳、容易急'],
    ['开局偏保守', '开局下得比较稳、不冒进'],
    ['不擅长马的运用', '马走得不好,常被困'],
    ['爱用屏风马防守', '防守喜欢摆屏风马'],
  ],
  相关不同事实: [
    ['残局容易急躁', '残局变得沉稳多了'],
    ['开局偏保守', '开局越来越激进、爱抢攻'],
    ['不擅长用炮', '现在炮用得很犀利'],
    ['防守差', '防守明显进步了'],
    ['爱走当头炮', '改打仙人指路了'],
  ],
  同域相关: [
    ['爱走当头炮', '喜欢弃兵抢攻'],
    ['残局容易急躁', '开局节奏偏慢'],
    ['不擅长用炮', '车的运用很熟练'],
    ['防守差', '进攻很凶'],
    ['爱用屏风马防守', '喜欢反宫马'],
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
  console.log(`模型 ${MODEL} @ ${OLLAMA_URL}\n`)
  const byCat: Record<string, number[]> = {}
  for (const [cat, pairs] of Object.entries(PAIRS)) {
    const sims: number[] = []
    for (const [a, b] of pairs) {
      const [va, vb] = [await embed(a), await embed(b)]
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

  // judge 阈:复述(应触发)vs 同域相关+中性相关不同事实(应跳过)
  const restate = stats(byCat['复述'])
  const sameDomain = stats(byCat['同域相关'])
  console.log('\n=== 建议阈值 ===')
  console.log(`judge 阈:复述 min ${restate.min.toFixed(3)}、同域相关 max ${sameDomain.max.toFixed(3)} → 取 0.70(现值)`)

  // 检索地板:无关(应滤)vs 同域相关(应留)
  const unrel = stats(byCat['无关'])
  console.log(`检索地板:无关 max ${unrel.max.toFixed(3)}、同域相关 min ${sameDomain.min.toFixed(3)} → 取 0.50(现值)`)
}

main().catch((e) => { console.error('标定失败:', e); process.exit(1) })
