import { test, expect } from '@playwright/test'

test.describe('围观象棋 (weiguan-xiangqi) 真实业务深度 E2E 闭环', () => {
  test('1. 控制台与开局配置：围观棋友团性格配置、难度/模式切换（陪练 vs 拟人）与执方切换', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/#/console')
    await expect(page.getByRole('heading', { name: '控制台' })).toBeVisible()

    // 验证四位围观棋友团角色（林教练、炮儿爷、吃瓜阿强、老黑）在角色面板可查看与配置
    await expect(page.getByRole('heading', { name: 'coach(观棋)' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'laopaoer(观棋)' })).toBeVisible()
    await expect(page.locator('input[value="林教练"]')).toBeVisible()
    await expect(page.locator('input[value="炮儿爷"]')).toBeVisible()

    // 切换到「运行参数」查看导演难度/强度与内置引擎参数
    await page.getByRole('button', { name: '运行参数' }).click()
    await expect(page.getByText(/陪练|拟人|多主变|思考时长/).first()).toBeVisible()

    // 回到对局首页，验证引擎状态无报错告警（BuiltinEngine 已就绪）
    await page.goto('/#/')
    await expect(page.getByRole('button', { name: '开始对局' })).toBeVisible()
    await expect(page.getByText(/引擎不可用|引擎异常/)).toHaveCount(0)

    // 切换模式：拟人对手 <-> 陪练
    const humanlikeBtn = page.getByRole('button', { name: '切换为拟人对手模式' })
    const coachBtn = page.getByRole('button', { name: '切换为陪练模式' })
    await humanlikeBtn.click()
    await expect(humanlikeBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('AI 像真人棋风，输赢自然')).toBeVisible()
    await coachBtn.click()
    await expect(coachBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('AI 会带你、动态控盘')).toBeVisible()

    expect(pageErrors).toEqual([])
  })

  test('2. 走子交互、合法性校验、AI 引擎应对、棋友团弹幕与无 TTS Key 优雅降级', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/#/')
    await page.getByRole('button', { name: '开始对局' }).click()
    await expect(page.getByLabel('对局状态')).toContainText('对局开始，请走棋')

    // 1) 点选红方右炮 h3(Pikafish h2)，校验请求 /legal-moves 并走到中路 e3(Pikafish e2：炮二平五)
    const legalRespPromise = page.waitForResponse((r) => r.url().includes('/legal-moves') && r.status() === 200)
    await page.locator('[data-square="h3"]').click()
    const legalResp = await legalRespPromise
    const legalJson = (await legalResp.json()) as { squares: string[] }
    expect(legalJson.squares).toContain('e2')

    // 点击 e3 完成「炮二平五」，等待 AI 引擎自动应手并更新行棋记录
    await page.locator('[data-square="e3"]').click()
    await expect(page.getByLabel('对局状态')).toContainText(/AI 走了.*轮到您走/)
    await expect(page.getByRole('list', { name: '走法历史' })).toContainText('炮二平五')

    // 2) 非法走子拦截校验：发送非法着法 h2a9，服务端拒绝并触发前端回退与红字提示
    await page.evaluate(() => {
      const fn = (window as unknown as { __weiguanPlayMove?: (m: string) => void }).__weiguanPlayMove
      fn?.('h2a9')
    })
    await expect(page.getByLabel('对局状态')).toContainText('非法着法，已回退到当前局面')

    // 3) 再走一手合法着法：马二进三 (h1 -> g3，Pikafish h0g2)
    await page.locator('[data-square="h1"]').click()
    await page.locator('[data-square="g3"]').click()
    await expect(page.getByLabel('对局状态')).toContainText(/AI 走了.*轮到您走/)

    // 4) 棋友团弹幕互动与语音播报降级（无 DashScope/TTS Key 时优雅降级不报错）
    const chatInput = page.getByLabel('弹幕输入框')
    await chatInput.fill('教练，这步之后我该怎么走？')
    await page.getByRole('button', { name: '发送弹幕' }).click()

    const chatList = page.getByLabel('观众弹幕列表')
    await expect(chatList).toContainText('教练，这步之后我该怎么走？')
    await expect(chatList).toContainText(/结合当前盘面看|这一手我得再看看盘面/)

    // 测试语音静音/开启切换不抛异常
    const muteBtn = page.getByRole('button', { name: /语音播报/ })
    if (await muteBtn.isEnabled()) {
      await muteBtn.click()
      await muteBtn.click()
    }

    expect(pageErrors).toEqual([])
  })

  test('3. 终局收尾、逐手失分诊断（cploss / Elo 评估）、复盘回放与成长曲线全链路闭环', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/#/')
    await page.getByRole('button', { name: '开始对局' }).click()
    await expect(page.getByLabel('对局状态')).toContainText('对局开始，请走棋')

    // 走第一手：炮二平五 (h3 -> e3)
    await page.locator('[data-square="h3"]').click()
    await page.locator('[data-square="e3"]').click()
    await expect(page.getByLabel('对局状态')).toContainText(/AI 走了.*轮到您走/)

    // 走第二手：马二进三 (h1 -> g3，Pikafish h0g2)
    await page.locator('[data-square="h1"]').click()
    await page.locator('[data-square="g3"]').click()
    await expect(page.getByLabel('对局状态')).toContainText(/AI 走了.*轮到您走/)

    // 发一条观众席互动消息以便复盘页验证对话回放
    await page.getByLabel('弹幕输入框').fill('复盘归档测试发言')
    await page.getByRole('button', { name: '发送弹幕' }).click()
    await expect(page.getByLabel('观众弹幕列表')).toContainText('复盘归档测试发言')

    // 点击「认输」结束本局，触发终局收尾与自动诊断
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '认输' }).click()
    await expect(page.getByLabel('对局状态')).toContainText('对局结束')

    // 1) 进入「查看复盘」页 (#/review/:id) 验证棋谱逐步回放与观众席回放
    const reviewLink = page.getByRole('link', { name: '查看复盘' })
    await expect(reviewLink).toBeVisible()
    const href = (await reviewLink.getAttribute('href')) ?? ''
    const gameIdMatch = href.match(/#\/review\/(\d+)/)
    expect(gameIdMatch).not.toBeNull()
    const gameId = gameIdMatch![1]

    await reviewLink.click()
    await expect(page.getByRole('heading', { name: new RegExp(`复盘 · 第 ${gameId} 局`) })).toBeVisible()
    await expect(page.getByText('0 / 4')).toBeVisible()
    await page.getByRole('button', { name: '下一手' }).click()
    await expect(page.getByText('1 / 4')).toBeVisible()
    await page.getByRole('button', { name: '上一手' }).click()
    await expect(page.getByText('0 / 4')).toBeVisible()
    await expect(page.getByRole('heading', { name: '观众席回放' })).toBeVisible()
    await expect(page.getByText('复盘归档测试发言')).toBeVisible()

    // 2) 进入「去诊断本局」页 (#/analysis/:id) 验证逐手失分诊断（cpLoss / 最佳着）
    await page.getByRole('link', { name: `诊断第${gameId}局` }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`第 ${gameId} 局 · 诊断`) })).toBeVisible()
    await page.getByRole('button', { name: '诊断本局' }).click()
    await expect(page.locator('table tbody tr')).toHaveCount(4)
    await expect(page.locator('table')).toContainText('h2e2')

    // 3) 进入「成长」页 (#/growth) 验证估算 Elo / ACPL / 准确率与成长报告闭环
    await page.goto('/#/growth')
    await expect(page.getByRole('heading', { name: /成长|棋力/ }).first()).toBeVisible()
    await expect(page.getByText(/Elo|ACPL|准确率/).first()).toBeVisible()

    expect(pageErrors).toEqual([])
  })
})
