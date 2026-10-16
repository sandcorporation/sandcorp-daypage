import { describe, expect, test, vi } from 'vitest'
import { startErrorReporting } from './errorReporting'

describe('오류 수집 켜기', () => {
  test('서버가 DSN을 주면 SDK를 불러와 그 DSN으로 켠다', async () => {
    const init = vi.fn()
    const load = vi.fn(async () => ({ init }))
    const on = await startErrorReporting(load, async () => ({ sentryDsn: 'https://k@gt.example/2', environment: 'production' }))
    expect(on).toBe(true)
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://k@gt.example/2', environment: 'production', sendDefaultPii: false }),
    )
  })

  test('DSN이 없으면(로컬) SDK를 불러오지도 않는다', async () => {
    const load = vi.fn()
    expect(await startErrorReporting(load, async () => ({ sentryDsn: null, environment: 'production' }))).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })

  test('설정을 못 받아도 앱을 막지 않는다', async () => {
    const load = vi.fn()
    expect(
      await startErrorReporting(load, async () => {
        throw new Error('network')
      }),
    ).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })
})
