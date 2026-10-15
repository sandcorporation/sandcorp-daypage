import { PAGE_WIDTH, type Point } from '../page/geometry'
import type { Rect } from '../page/hit'

const GAP = 8
/** 꼬리표가 오른쪽에 들어갈 자리(장 좌표, 대략). 모자라면 왼쪽으로 민다. */
const LABEL_ROOM = 140

export type LabelPlace = { x: number; y: number; side: 'cursor' | 'right' | 'left' | 'hidden' }
export type BoxRect = Rect & { id?: string }

/**
 * 다른 사람 커서의 닉네임 꼬리표 자리. 커서가 글 상자 위에 있으면 글을 가리지 않게
 * 상자 바깥(오른쪽, 자리가 없으면 왼쪽)으로 밀어낸다. 화살표는 커서 자리에 그대로 둔다.
 */
export function placeCursorLabel(cursor: Point, boxes: BoxRect[], editingBoxId?: string | null): LabelPlace {
  const over = boxes.find(
    (b) => cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height,
  )
  if (!over) return { x: cursor.x, y: cursor.y, side: 'cursor' }
  // 자기가 이어 쓰는 상자 위라면 '○○ 이어 쓰는 중'이 이미 닉네임을 보여 준다.
  if (editingBoxId && over.id === editingBoxId) return { x: cursor.x, y: cursor.y, side: 'hidden' }
  const right = over.x + over.width + GAP
  if (right + LABEL_ROOM <= PAGE_WIDTH) return { x: right, y: cursor.y, side: 'right' }
  return { x: over.x - GAP, y: cursor.y, side: 'left' }
}
