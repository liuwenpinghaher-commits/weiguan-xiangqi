// 库无关:解析标准象棋 FEN(行 top→bottom = rank 9→0)+ Pikafish 坐标(file a-i, rank 0-9,rank0=红底)
// 产出中文纵线记谱:红用 一二三四五六七八九(红方右→左),黑用阿拉伯数字(黑方左→右)
const RED_PIECE: Record<string, string> = { R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵' }
const BLACK_PIECE: Record<string, string> = { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' }
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const DIAGONAL = new Set(['N', 'B', 'A']) // 马/相(象)/士 用"目标路",其余用步数

/** 解析 FEN 棋盘到 [rank][file] 的 piece char('' = 空)。rank 0=红底, file 0=a */
function parseBoard(fen: string): string[][] {
  const rows = fen.split(' ')[0].split('/')
  if (rows.length !== 10) throw new Error(`bad FEN: ${fen}`)
  const board: string[][] = Array.from({ length: 10 }, () => Array(9).fill(''))
  for (let r = 0; r < 10; r++) {
    const rank = 9 - r // rows[0]=顶部=rank9, rows[9]=底部=rank0
    let file = 0
    for (const ch of rows[r]) {
      if (/[1-9]/.test(ch)) file += parseInt(ch)
      else { board[rank][file] = ch; file++ }
    }
  }
  return board
}

function pieceAt(board: string[][], file: number, rank: number): string {
  return board[rank]?.[file] ?? ''
}

function parseMove(move: string): { f1: number; r1: number; f2: number; r2: number } {
  const m = move.match(/^([a-i])([0-9])([a-i])([0-9])$/)
  if (!m) throw new Error(`bad move: ${move}`)
  const fi = (c: string) => c.charCodeAt(0) - 97
  return { f1: fi(m[1]), r1: +m[2], f2: fi(m[3]), r2: +m[4] }
}

/** 某方某 file 的"路"号:红=9-file(写中文),黑=file+1(写阿拉伯) */
function laneStr(file: number, red: boolean): string {
  return red ? CN_NUM[9 - file - 1] : String(file + 1)
}
function stepStr(n: number, red: boolean): string {
  return red ? CN_NUM[n - 1] : String(n)
}

/** 把一步棋(走子前 FEN + Pikafish 记法)描述成中文,如 "红炮二平五"、"黑马2进3"、"红炮五进五(吃卒)" */
export function describeMoveZh(fenBefore: string, move: string): string {
  const { f1, r1, f2, r2 } = parseMove(move)
  const board = parseBoard(fenBefore)
  const ch = pieceAt(board, f1, r1)
  if (!ch) throw new Error(`no piece at from-square of ${move}`)
  const red = ch === ch.toUpperCase()
  const pieceZh = red ? RED_PIECE[ch.toUpperCase()] : BLACK_PIECE[ch.toLowerCase()]
  const sideZh = red ? '红' : '黑'
  const fromLane = laneStr(f1, red)

  let action: string
  if (r1 === r2) {
    action = `平${laneStr(f2, red)}`
  } else {
    const forward = red ? r2 > r1 : r2 < r1 // 红进=rank增大;黑进=rank减小
    const dir = forward ? '进' : '退'
    const val = DIAGONAL.has(ch.toUpperCase())
      ? laneStr(f2, red)                 // 斜行子:写目标路
      : stepStr(Math.abs(r2 - r1), red)  // 直行子:写步数
    action = `${dir}${val}`
  }

  const captured = pieceAt(board, f2, r2)
  const capturedZh = captured
    ? (captured === captured.toUpperCase() ? RED_PIECE[captured] : BLACK_PIECE[captured])
    : ''
  const capStr = capturedZh ? `(吃${capturedZh})` : ''

  return `${sideZh}${pieceZh}${fromLane}${action}${capStr}`
}
