import { describe, expect, test, vi } from 'vitest'
import { scrubEvent, startErrorReporting } from './errorReporting'

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

  test('서버가 준 release(배포 sha)를 쓰고, 없으면 번들 이름으로 물러난다', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const init = vi.fn()
    await startErrorReporting(async () => ({ init }), async () => ({ sentryDsn: 'https://k@gt.example/2', environment: 'production', release: sha }))
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ release: sha, beforeSend: scrubEvent }))

    const script = document.createElement('script')
    script.type = 'module'
    script.src = '/assets/index-AbC123.js'
    document.head.append(script)
    try {
      const init2 = vi.fn()
      await startErrorReporting(async () => ({ init: init2 }), async () => ({ sentryDsn: 'https://k@gt.example/2', environment: 'production', release: null }))
      expect(init2).toHaveBeenCalledWith(expect.objectContaining({ release: 'AbC123' }))
    } finally {
      script.remove()
    }
  })
})

describe('보내기 전 지우기(beforeSend)', () => {
  test('요청 쿠키·본문·자격 헤더를 지우고 나머지 헤더는 둔다', () => {
    const out = scrubEvent({
      request: {
        url: 'https://daypage.example/api/me',
        cookies: { sessionid: 's' },
        data: { password: 'p' },
        headers: { Cookie: 'sessionid=s', Authorization: 'Bearer t', 'X-CSRFToken': 'c', 'User-Agent': 'ua' },
      },
    })
    expect(out.request).toEqual({ url: 'https://daypage.example/api/me', headers: { 'User-Agent': 'ua' } })
  })

  test('메시지·예외 값·주소·브레드크럼의 토큰 모양 문자열을 지운다', () => {
    const token = 'a'.repeat(40)
    const jwt = 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl'
    const out = scrubEvent({
      message: `실패 Bearer ${token}`,
      request: { url: `https://daypage.example/x?t=${token}` },
      exception: { values: [{ value: `jwt ${jwt} 거절` }] },
      breadcrumbs: [{ message: `csrf ${token}`, data: { url: `/api/y?k=${token}` } }],
    })
    expect(out.message).toBe('실패 [Filtered]')
    expect(out.request?.url).toBe('https://daypage.example/x?t=[Filtered]')
    expect(out.exception?.values?.[0].value).toBe('jwt [Filtered] 거절')
    expect(out.breadcrumbs?.[0]).toEqual({ message: 'csrf [Filtered]', data: { url: '/api/y?k=[Filtered]' } })
  })

  test('짧은 낱말·숫자는 그대로 둔다', () => {
    expect(scrubEvent({ message: 'TypeError: page 12 not found (index-AbC123.js)' }).message).toBe(
      'TypeError: page 12 not found (index-AbC123.js)',
    )
  })
})
