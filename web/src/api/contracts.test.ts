/**
 * 角色契约一致性测试
 *
 * 防止"后端新增 PersonaId 时前端三处硬编码漏改"的漂移问题。
 *
 * canonical 集合 = 后端 PersonaId 联合类型（见 server/src/types.ts）：
 *   'player' | 'laopaoer' | 'coach' | 'netizen'
 *
 * 注意：PERSONA_NAMES 还额外包含 'human'（前端特有，代表真实用户），
 * 这不是后端 PersonaId，测试只要求 canonical 四个 key 全部存在即可。
 *
 * 新增角色时，须同步：
 *   1. server/src/types.ts 的 PersonaId 联合类型
 *   2. web/src/chat/ChatPanel.tsx 的 PERSONA_NAMES
 *   3. web/src/chat/ChatPanel.tsx 的 PERSONA_COLORS
 *   4. web/src/voice/voice-config.ts 的 VOICE_PARAMS
 *   5. 本文件的 CANONICAL_PERSONA_IDS
 */

import { describe, it, expect } from 'vitest'
import { PERSONA_NAMES, PERSONA_COLORS } from '../chat/ChatPanel.js'
import { VOICE_PARAMS } from '../voice/voice-config.js'

/** 后端权威 PersonaId 集合（新增角色须同步 server/src/types.ts 的 PersonaId） */
const CANONICAL_PERSONA_IDS = ['player', 'laopaoer', 'coach', 'netizen'] as const

describe('角色契约一致性', () => {
  it('PERSONA_NAMES 包含全部 canonical PersonaId', () => {
    for (const id of CANONICAL_PERSONA_IDS) {
      expect(PERSONA_NAMES).toHaveProperty(id)
    }
  })

  it('PERSONA_COLORS 包含全部 canonical PersonaId（且无多余键）', () => {
    const colorKeys = Object.keys(PERSONA_COLORS).sort()
    const canonicalSorted = [...CANONICAL_PERSONA_IDS].sort()

    // PERSONA_COLORS 应与 canonical 完全一致（不多不少）
    expect(colorKeys).toEqual(canonicalSorted)
  })

  it('VOICE_PARAMS 包含全部 canonical PersonaId（且无多余键）', () => {
    const voiceKeys = Object.keys(VOICE_PARAMS).sort()
    const canonicalSorted = [...CANONICAL_PERSONA_IDS].sort()

    // VOICE_PARAMS 应与 canonical 完全一致（不多不少）
    expect(voiceKeys).toEqual(canonicalSorted)
  })

  it('PERSONA_NAMES 的 canonical 部分与 PERSONA_COLORS 的 key 完全对齐', () => {
    const nameCanonicalKeys = Object.keys(PERSONA_NAMES)
      .filter((k) => (CANONICAL_PERSONA_IDS as readonly string[]).includes(k))
      .sort()
    const colorKeys = Object.keys(PERSONA_COLORS).sort()

    expect(nameCanonicalKeys).toEqual(colorKeys)
  })

  it('PERSONA_COLORS 与 VOICE_PARAMS 的 key 完全对齐', () => {
    const colorKeys = Object.keys(PERSONA_COLORS).sort()
    const voiceKeys = Object.keys(VOICE_PARAMS).sort()

    expect(colorKeys).toEqual(voiceKeys)
  })
})
