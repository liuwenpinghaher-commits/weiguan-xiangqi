# 围观象棋 · 记忆重构(SurrealDB 语义记忆)设计

- 日期:2026-06-20
- 状态:已与用户确认设计,待写实现计划
- 一句话:把现有"关键词检索、不去重、不处理矛盾"的 SQLite 人设记忆,重构为基于 **SurrealDB HNSW 向量检索 + 写入时 LLM 去重/作废** 的语义记忆;对外暴露异步 **`MemoryStore`** 接口,作为本子项目与控制台子项目的唯一对接契约。

## 目标与范围

**目标**:让角色记忆"记得准、不重复、能纠错"——
- 检索从关键词重合升级为**语义相似**(向量 KNN);
- 写入时**判重/判矛盾**:同一事实复述则合并,认知更新则作废旧条(`superseded_at`),相关但不同则共存;
- 对外是一个**异步 `MemoryStore` 接口**,屏蔽底层(SurrealDB / 嵌入)细节,供 `chat-engine`/`reflection` 注入与反思、供控制台做 CRUD。

**用户已确认的关键决策**
1. **执行顺序**:记忆重构**先做**(接口从难的一侧推导,控制台之后对接已稳定接口)。
2. **向量化范围**:**只 fact/insight** 走嵌入 + 写入时 LLM 合并/作废;**episode**(每条弹幕、importance 1、高频)保持廉价 append,不嵌入、不参与 KNN、不参与 judge。理由:`chat-engine.ts:142` 注入时只取 `['fact','insight']`,episode 当前从不被语义检索,只作日志。
3. **部署**:复用已装的 `~/.surrealdb/surreal`(v3.1.5),以**独立服务进程**模式运行(文件引擎 SurrealKV),server 经 `surrealdb` JS 客户端走 WebSocket 连接。(嵌入式 `@surrealdb/node` 是另一套 native 模块,复用不了已装二进制,故不选。)
4. **旧数据**:**全新开始**,不迁移现有 `persona_memory`。开发期数据量小且多为测试数据;避开一次性回填脚本 + 嵌入补算的复杂度。episode 日志表可留在 SQLite 不动。

**不在范围(YAGNI)**:跨角色共享记忆;记忆的多级摘要/分层压缩;episode 的语义检索;旧 SQLite 记忆迁移;嵌入向量的离线本地模型(统一走 DashScope)。

## 现状(为何重构)

- 表 `persona_memory`,仓库 `server/src/memory/persona-memory-repo.ts`:`add/byPersona/retrieve`,缺 `update/remove/list`。
- `retrieve`(同步,better-sqlite3)打分 = `recency(14 天半衰期指数衰减) + importance/5 + relevance(中文按字/英文按词的关键词重合)`。**漏洞**:无语义(近义词/改写检索不到)、不去重(反思反复产出相似 fact)、不处理矛盾(旧认知与新认知并存)、反思产物泛泛。
- 调用点三处:
  - `chat/chat-engine.ts:98` 写 episode(每条发言,importance 1);
  - `chat/chat-engine.ts:142` 注入读 `retrieve(p.id, query, 3, now, ['fact','insight'])`;
  - `memory/reflection.ts:82` 局末写 fact/insight(LLM 反思产物)。
  三处调用方都不依赖 `add` 返回的自增 id(可平滑改为字符串 id)。

## 架构

### 1. `MemoryStore` 接口(对外契约)
`server/src/memory/store.ts`:

```ts
export interface MemoryRecord {
  id: string                       // SurrealDB record id(字符串,替代旧自增 number)
  personaId: PersonaId
  kind: 'episode' | 'fact' | 'insight'
  content: string
  importance: number
  gameId: number | null
  createdAt: string
  supersededAt: string | null      // 非空 = 已作废,不参与 retrieve
}

export interface MemoryStore {
  /** 写入。episode→廉价 append;fact/insight→embed + 去重/作废判断。返回新记录 id */
  record(e: {
    personaId: PersonaId
    kind: 'episode' | 'fact' | 'insight'
    content: string
    importance: number
    gameId: number | null
    createdAt: string
  }): Promise<string>

  /** 注入用语义检索。fact/insight 走 KNN + recency/importance 融合;episode 不参与 */
  retrieve(
    personaId: PersonaId, query: string, limit: number,
    kinds?: Array<'episode' | 'fact' | 'insight'>,
  ): Promise<MemoryRecord[]>

  /** 控制台浏览。默认排除已作废,includeSuperseded 可见 */
  list(filter: { personaId?: PersonaId; kind?: string; includeSuperseded?: boolean }): Promise<MemoryRecord[]>

  /** 控制台编辑。content 变更时重算嵌入 */
  update(id: string, patch: { content?: string; importance?: number }): Promise<void>

  /** 控制台删除 */
  remove(id: string): Promise<void>
}
```

实现两个:
- **`SurrealMemoryStore`**(`server/src/memory/surreal-memory-store.ts`):本子项目交付。
- **`FakeMemoryStore`**(`server/src/memory/fake-memory-store.ts`):内存版,供单测,无需起 Surreal、不打网络。

注入时钟与嵌入/LLM 依赖经构造函数传入(沿用现有 `now: () => number` 注入风格,便于测试)。

### 2. `EmbeddingProvider` 接口
`server/src/llm/embedding.ts`(仿现有 `LLMProvider` 模式):

```ts
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>  // 与输入等长;每个为定长向量
  readonly dimension: number
}
```
- `DashscopeEmbedding`:调 DashScope `text-embedding-v3`(OpenAI 兼容 `/embeddings`),默认 **1024 维**(维度配置化;实现时核对 v3 实际默认与可选维度,以代码为准)。
- `FakeEmbedding`:确定性 hash → 定长向量,供测试走完整 record/retrieve 路径而不依赖网络。

### 3. 数据模型(SurrealDB,namespace/db 固定)
启动时执行(幂等):
```surql
DEFINE TABLE memory SCHEMAFULL;
DEFINE FIELD persona_id    ON memory TYPE string;
DEFINE FIELD kind          ON memory TYPE string;            -- episode|fact|insight
DEFINE FIELD content       ON memory TYPE string;
DEFINE FIELD importance    ON memory TYPE int;
DEFINE FIELD game_id       ON memory TYPE option<int>;
DEFINE FIELD created_at    ON memory TYPE string;
DEFINE FIELD superseded_at ON memory TYPE option<string>;    -- 非空 = 失效
DEFINE FIELD embedding     ON memory TYPE option<array<float>>;  -- episode 为 NONE
DEFINE INDEX mem_hnsw    ON memory FIELDS embedding HNSW DIMENSION 1024 DIST COSINE;
DEFINE INDEX mem_persona ON memory FIELDS persona_id, kind;
```
- episode 与 fact/insight 同表,靠 `kind` + `embedding 是否为空` 区分。
- `superseded_at` 非空者从 `retrieve` 排除,`list(includeSuperseded:true)` 仍可见(可审计、可在控制台恢复/清理)。
- HNSW `DIMENSION` 与 `EmbeddingProvider.dimension` 必须一致(均由配置驱动,默认 1024)。

### 4. 写入路径(fact/insight 的去重/作废)
`record` 收到 `kind ∈ {fact,insight}` 时:
1. `embed([content])` 取向量;
2. KNN 查**同 persona、同 kind、未作废**的最近邻 1 条(及其相似度);
3. 相似度 **低于阈值** → 直接 `CREATE`(新知识,无需判断);
4. 相似度 **高于阈值** → **一次** LLM judge 调用(结构化输出 merge|supersede|keep):
   - `merge`:`UPDATE` 旧条 content(取 judge 给的归并文本)+ 提升 importance + 换新嵌入;不新增行。
   - `supersede`:给旧条 `superseded_at = now`,`CREATE` 新条(矛盾/认知更新)。
   - `keep`:两条都留(相关但确为不同事实),`CREATE` 新条。

每条新 fact/insight **最多一次 embed + 最多一次 judge**。reflection 局末按角色跑、低频(每局每角色约 2–4 fact + 1 insight),成本与延迟可控。

`kind = episode`:直接 `CREATE`,`embedding = NONE`,不查 KNN、不 judge。

阈值与 judge prompt 写进 `defaults`(后续可由控制台运行参数调,但本子项目先用常量)。

### 5. 读取路径与降级
`retrieve(personaId, query, limit, ['fact','insight'])`:
- `embed([query])` → HNSW KNN 取候选(同 persona、给定 kinds、未作废)→ 融合打分 `score = similarity + recency(指数衰减) + importance/5`(把旧的"关键词重合"换成"向量相似度",保留 recency/importance 直觉)→ 取 top-`limit`。
- `episode` 不参与语义检索(若 kinds 含 episode,按 recency 返回,保持向后兼容)。

**降级(鲁棒性,关键)**:DASHSCOPE key 缺失或 embedding/judge 调用失败时——
- 写入:照存,`embedding = NONE`,跳过 judge(日后可补嵌入);永不因嵌入失败而丢记忆。
- 读取:退回纯 `recency + importance` 排序(不语义但不崩)。
- 测试经 `FakeEmbedding` 走完整路径,不打网络。

### 6. 部署与 dev 集成
- 复用已装 `~/.surrealdb/surreal`(v3.1.5),**独立服务进程**:
  `~/.surrealdb/surreal start surrealkv:~/.surrealdb/data/weiguan.db --bind 127.0.0.1:8000 --user root --pass root`
  (本机单人、仅 127.0.0.1,无鉴权语义;root/root 仅本地占位)。
- `npm -w server run dev` 经 `concurrently` 顺带拉起该进程(绝对路径绕开 surreal 未进 PATH);数据文件目录 gitignore。
- server 用 `surrealdb` JS 客户端走 `ws://127.0.0.1:8000` 连接,启动时执行第 3 节 `DEFINE`(幂等)。
- 新增 env(均有默认,后续进控制台"密钥与模型"页):`SURREAL_URL`(默认 `ws://127.0.0.1:8000`)、`SURREAL_NS`、`SURREAL_DB`、`SURREAL_USER`/`SURREAL_PASS`、`EMBEDDING_MODEL`(默认 `text-embedding-v3`)、`EMBEDDING_DIM`(默认 1024)。

### 7. 调用点改造(三处,改为 async)
- `chat/chat-engine.ts:98`(写 episode):`this.deps.mem.add(...)` → `await this.deps.store.record(...)`;依赖类型由 `PersonaMemoryRepo` 改为 `MemoryStore`。
- `chat/chat-engine.ts:142`(注入读):`.retrieve(...)`(同步)→ `await store.retrieve(p.id, query, 3, ['fact','insight'])`;`plan()` 及其调用链改 async。
- `memory/reflection.ts:82`(写 fact/insight):`repo.add(...)` → `await store.record(...)`;`reflect()` 已是 async,内部循环改 `await`。
- `ws-server.ts:74`:构造 `SurrealMemoryStore`(注入 `EmbeddingProvider` + LLM judge + 时钟)替代 `new PersonaMemoryRepo(db)`;失败时可降级注入仅 recency 的 store(不阻塞启动)。

## 测试策略
- **`FakeMemoryStore` + `FakeEmbedding`**:三处调用点单测,不依赖 Surreal、不打网络;验证 episode append、retrieve 注入选 fact/insight。
- **`SurrealMemoryStore` 集成测试**:起临时 Surreal(`surreal start memory` 或临时 file 库),验证:record→retrieve 往返、HNSW KNN 命中近义内容、merge/supersede/keep 三分支、`superseded_at` 从 retrieve 排除而 `list(includeSuperseded)` 可见、`update` 改 content 后重算嵌入生效、`remove` 真删。
- **降级测试**:embedding 抛错 → 写入不丢(embedding=NONE)、retrieve 退回 recency 排序。
- **judge 单测**:给定相似/矛盾/无关的最近邻,judge 解析出正确分支(用 FakeLLM 固定输出)。
- 既有 **209 server + 18 web** 测试不破:三处调用改 async 需同步更新其现有测试(mock 由 sync repo 改 async store)。

## 风险与权衡
- **多一个进程**:dev 需起 Surreal;用 `concurrently` + 绝对路径消化,保持"一句 `npm run dev`"体验。生产同理(本地单人)。
- **嵌入成本/延迟**:限定只 fact/insight + 局末低频 + 每条最多一次 embed/judge;降级路径保证 key 缺失或网络故障不致崩。
- **HNSW 维度耦合**:索引 DIMENSION 与嵌入维度必须一致,二者均由配置驱动、默认 1024;改维度需重建索引(本地全新库,代价低)。
- **接口稳定性**:`MemoryStore` 设计为 async 且覆盖三处内部调用 + 控制台 CRUD;控制台子项目仅依赖此接口,底层从 Fake/Surreal 切换为 DI 改动。
- **judge 误判**:LLM 可能错判 merge/supersede;以"高于相似度阈值才触发 judge、且每条仅一次"限制影响面;被作废条不删除(`superseded_at`),控制台可人工纠正。
