export interface AsrProvider {
  /** 整段音频转写为文字;失败抛错;无法识别返回空串 */
  transcribe(audio: Buffer, mimeType: string): Promise<string>
}

type Responder = string | ((audio: Buffer, mimeType: string) => string)

/** 测试用:返回固定文字或由函数决定,不打网络。 */
export class FakeAsr implements AsrProvider {
  constructor(private responder: Responder = '') {}
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    return typeof this.responder === 'function' ? this.responder(audio, mimeType) : this.responder
  }
}
