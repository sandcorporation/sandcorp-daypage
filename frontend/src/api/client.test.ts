import { api, ApiError } from './client'

const SERVER_MESSAGE = '서버에 문제가 생겨 하지 못했어요. 잠시 뒤 다시 해 주세요.'
const REQUEST_MESSAGE = '요청을 처리하지 못했어요.'

afterEach(() => vi.unstubAllGlobals())

async function failure(body: string, init: ResponseInit): Promise<ApiError> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, init)))
  const error: unknown = await api('/api/x').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('api() 실패 문구', () => {
  it.each([
    ['HTML 500', '<h1>Server Error</h1>', 500, 'Internal Server Error'],
    ['빈 본문 500', '', 500, 'Internal Server Error'],
    ['statusText가 빈 502', '<html></html>', 502, ''],
  ])('%s은 상태 글 대신 서버 오류 문구', async (_, body, status, statusText) => {
    const error = await failure(body, { status, statusText })
    expect(error.message).toBe(SERVER_MESSAGE)
    expect(error.status).toBe(status)
    expect(error.code).toBeUndefined()
  })

  it.each([
    ['HTML 403', '<h1>Forbidden</h1>'],
    ['이유 없는 JSON', '{}'],
    ['detail이 빈 글', '{"detail":""}'],
    ['detail이 목록', '{"detail":[{"msg":"Field required"}]}'],
    ['본문이 null', 'null'],
  ])('%s은 요청 오류 문구', async (_, body) => {
    const error = await failure(body, { status: 403, statusText: 'Forbidden' })
    expect(error.message).toBe(REQUEST_MESSAGE)
  })

  it.each(['detail', 'message'])('서버가 준 %s와 code는 그대로', async (key) => {
    const body = JSON.stringify({ code: 'bad_name', [key]: '이름이 너무 길어요' })
    const error = await failure(body, { status: 400, statusText: 'Bad Request' })
    expect(error.message).toBe('이름이 너무 길어요')
    expect(error.status).toBe(400)
    expect(error.code).toBe('bad_name')
  })

  it('이유 없이 code만 주면 code는 남기고 기본 문구', async () => {
    const error = await failure('{"code":"busy"}', { status: 503, statusText: '' })
    expect(error.message).toBe(SERVER_MESSAGE)
    expect(error.code).toBe('busy')
  })
})
