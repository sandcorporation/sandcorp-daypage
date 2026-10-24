import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { isPageEmpty } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { dragResult } from './PhotoLayer'
import {
  addPhoto,
  canAddPhoto,
  deletePhoto,
  fitSide,
  photoBase,
  photoUrl,
  photosMap,
  PHOTO_LIMIT,
  PHOTO_MIN_SIDE,
  placePhoto,
  readPhotos,
  updatePhoto,
  type Photo,
} from './photos'

function photo(id: string, createdAt: number, over: Partial<Photo> = {}): Photo {
  return { id, src: `src-${id}`, x: 100, y: 100, width: 400, height: 300, author: '졸린 수달', createdAt, ...over }
}

describe('사진 문서', () => {
  it('붙인 사진을 읽는다(바이트가 아니라 서버 id만 남는다)', () => {
    const doc = new Y.Doc()
    addPhoto(doc, photo('a', 1))
    expect(readPhotos(doc)).toEqual([photo('a', 1)])
    expect(photosMap(doc).get('a')?.has('data')).toBe(false)
  })

  it('한 페이지에 보이는 사진은 넣은 순으로 한도까지', () => {
    const doc = new Y.Doc()
    // 동시에 붙여 한도를 넘었다
    for (const [id, t] of [['d', 4], ['b', 2], ['a', 1], ['c', 3]] as const) addPhoto(doc, photo(id, t))
    expect(readPhotos(doc).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(readPhotos(doc)).toHaveLength(PHOTO_LIMIT)
    expect(canAddPhoto(doc)).toBe(false)
    deletePhoto(doc, 'a')
    expect(readPhotos(doc).map((p) => p.id)).toEqual(['b', 'c', 'd'])
  })

  it('src가 없는 항목은 보이지 않는다', () => {
    const doc = new Y.Doc()
    photosMap(doc).set('x', new Y.Map())
    expect(readPhotos(doc)).toEqual([])
  })

  it('자리를 바꾼다', () => {
    const doc = new Y.Doc()
    addPhoto(doc, photo('a', 1))
    updatePhoto(doc, 'a', { x: 12.34, width: 200 })
    expect(readPhotos(doc)[0]).toMatchObject({ x: 12.3, width: 200, height: 300 })
  })

  it('사진만 있는 페이지는 빈 페이지가 아니다', () => {
    const doc = new Y.Doc()
    expect(isPageEmpty(doc)).toBe(true)
    addPhoto(doc, photo('a', 1))
    expect(isPageEmpty(doc)).toBe(false)
  })
})

describe('사진 크기·자리', () => {
  it('긴 변에 맞추고, 작으면 그대로', () => {
    expect(fitSide(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 })
    expect(fitSide(300, 600, 1024)).toEqual({ width: 300, height: 600 })
  })

  it('보이는 자리 가운데에 붙이고 장 밖으로 나가지 않는다', () => {
    expect(placePhoto(1200, 600, 800, 1000)).toEqual({ x: 500, y: 850, width: 600, height: 300 })
    const edge = placePhoto(1200, 600, PAGE_WIDTH, PAGE_HEIGHT)
    expect(edge.x + edge.width).toBe(PAGE_WIDTH)
    expect(edge.y + edge.height).toBe(PAGE_HEIGHT)
  })

  it('옮기면 장 안에 머문다', () => {
    const p = photo('a', 1)
    expect(dragResult('move', p, -500, 50)).toMatchObject({ x: 0, y: 150, width: 400, height: 300 })
  })

  it('키우면 비율을 지키고 장 밖으로, 너무 작게는 줄지 않는다', () => {
    const p = photo('a', 1)
    expect(dragResult('resize', p, 400, 0)).toMatchObject({ x: 100, y: 100, width: 800, height: 600 })
    expect(dragResult('resize', p, 10_000, 0).width).toBe(PAGE_WIDTH - 100)
    expect(dragResult('resize', p, -10_000, 0).height).toBe(PHOTO_MIN_SIDE)
  })

  it('사진 주소: 참여자와 운영자', () => {
    expect(photoUrl(photoBase('n1'), 'abc')).toBe('/api/notes/n1/photos/abc')
    expect(photoUrl(photoBase('n1', true), 'abc')).toBe('/api/admin/notes/n1/photos/abc')
  })
})
