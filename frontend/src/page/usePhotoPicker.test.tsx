import { fireEvent, render, waitFor } from '@testing-library/react'
import * as Y from 'yjs'
import { ApiError } from '../api/client'
import { readPhotos, shrinkPhoto, uploadPhoto } from './photos'
import { usePhotoPicker } from './usePhotoPicker'

vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  photosEnabled: () => Promise.resolve(true),
  shrinkPhoto: vi.fn(),
  uploadPhoto: vi.fn(),
}))

const FILE_MESSAGE = '사진을 열지 못했어요. JPEG·PNG·WebP 사진으로 해 주세요.'
const NETWORK_MESSAGE = '연결이 끊겨 사진을 올리지 못했어요. 다시 연결되면 한 번 더 해 주세요.'

beforeEach(() => {
  vi.mocked(shrinkPhoto).mockReset().mockResolvedValue({ data: new Uint8Array([1]), mime: 'image/webp', width: 10, height: 10 })
  vi.mocked(uploadPhoto).mockReset().mockResolvedValue('src-1')
})

async function pick() {
  const doc = new Y.Doc()
  const show = vi.fn()
  function Harness() {
    return usePhotoPicker({ doc, noteId: 'n1', author: '졸린 수달', origin: null, scale: 1, show }).input
  }
  const { container } = render(<Harness />)
  const input = await waitFor(() => {
    const el = container.querySelector('input[type="file"]')
    if (!el) throw new Error('고르기 칸이 아직 없다')
    return el
  })
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
  await waitFor(() => expect(show).toHaveBeenCalled())
  return { doc, show }
}

test('올리기가 망 오류로 실패하면 연결 문구를 보인다', async () => {
  vi.mocked(uploadPhoto).mockRejectedValue(new TypeError('Failed to fetch'))
  const { doc, show } = await pick()
  expect(show).toHaveBeenCalledExactlyOnceWith(NETWORK_MESSAGE)
  expect(readPhotos(doc)).toHaveLength(0)
})

test('줄이기가 실패하면 파일 문구를 보이고 올리지 않는다', async () => {
  vi.mocked(shrinkPhoto).mockRejectedValue(new DOMException('decode', 'InvalidStateError'))
  const { show } = await pick()
  expect(show).toHaveBeenCalledExactlyOnceWith(FILE_MESSAGE)
  expect(uploadPhoto).not.toHaveBeenCalled()
})

test('서버가 올리기를 거절하면 서버의 말을 그대로 보인다', async () => {
  vi.mocked(uploadPhoto).mockRejectedValue(new ApiError(400, 'photo_limit', '사진이 가득 찼어요'))
  const { show } = await pick()
  expect(show).toHaveBeenCalledExactlyOnceWith('사진이 가득 찼어요')
})
