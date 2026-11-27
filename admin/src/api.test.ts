import { api, ApiError } from './api'

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
    ['HTML 500', '<h1>Server Error</h1>', 500, 'Internal Server Error', SERVER_MESSAGE],
    ['statusText가 빈 502', '', 502, '', SERVER_MESSAGE],
    ['HTML 403', '<h1>Forbidden</h1>', 403, 'Forbidden', REQUEST_MESSAGE],
    ['detail이 빈 글', '{"detail":""}', 400, 'Bad Request', REQUEST_MESSAGE],
    ['서버가 준 detail', '{"detail":"이미 닫힌 노트예요"}', 409, 'Conflict', '이미 닫힌 노트예요'],
  ])('%s', async (_, body, status, statusText, message) => {
    const error = await failure(body, { status, statusText })
    expect(error.message).toBe(message)
    expect(error.status).toBe(status)
  })
})
