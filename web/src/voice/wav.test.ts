import { describe, it, expect } from 'vitest'
import { encodeWav, downsampleMono } from './wav.js'

describe('encodeWav', () => {
  it('生成合法 16-bit 单声道 WAV 头', () => {
    const buf = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000)
    const v = new DataView(buf)
    const str = (off: number, n: number) => String.fromCharCode(...new Uint8Array(buf, off, n))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1)      // PCM
    expect(v.getUint16(22, true)).toBe(1)      // 单声道
    expect(v.getUint32(24, true)).toBe(16000)  // 采样率
    expect(v.getUint16(34, true)).toBe(16)     // 位深
    expect(str(36, 4)).toBe('data')
    expect(buf.byteLength).toBe(44 + 5 * 2)    // 头 + 5 样本×2 字节
  })
  it('样本钳制到 [-1,1] 并转 int16', () => {
    const buf = encodeWav(new Float32Array([1, -1]), 8000)
    const v = new DataView(buf)
    expect(v.getInt16(44, true)).toBe(0x7fff)
    expect(v.getInt16(46, true)).toBe(-0x8000)
  })
})

describe('downsampleMono', () => {
  it('48k→16k 长度约为 1/3', () => {
    const input = new Float32Array(4800).fill(0.2)
    const out = downsampleMono(input, 48000, 16000)
    expect(out.length).toBe(1600)
    expect(out[0]).toBeCloseTo(0.2, 5)
  })
  it('目标率≥源率时原样返回', () => {
    const input = new Float32Array([1, 2, 3])
    expect(downsampleMono(input, 16000, 16000)).toEqual(input)
  })
})
