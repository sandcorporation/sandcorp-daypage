import { placeCursorLabel, type BoxRect } from './cursorLabel'
import type { Peer } from './types'

/** 같은 레이어에 있는 글 상자들의 자리(장 좌표). offset*은 부모의 scale 변환과 무관하다. */
function textBoxRects(): BoxRect[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.page-layer .textbox')).map((el) => ({
    id: el.dataset.boxId,
    x: el.offsetLeft,
    y: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }))
}

/** 다른 사람의 커서(장 좌표계 레이어 안에 그린다). 글 상자 위에서는 닉네임을 상자 바깥으로 민다. */
export function Cursors({ peers, scale }: { peers: Peer[]; scale: number }) {
  // 레이어가 scale만큼 줄어 있으므로 크기는 거꾸로 키워 화면에서 일정하게 보이게 한다.
  const inv = 1 / scale
  const others = peers.filter((p) => !p.isMe && p.cursor)
  const boxes = others.length ? textBoxRects() : []
  return (
    <>
      {others.map((p) => {
        const place = placeCursorLabel(p.cursor!, boxes, p.editingBoxId)
        return (
          <div key={p.clientId} aria-hidden="true">
            <div
              className="peer-cursor"
              style={{ left: p.cursor!.x, top: p.cursor!.y, transform: `scale(${inv})` }}
            >
              <svg width="20" height="20" viewBox="0 0 18 18">
                <path d="M2 2l13 5-6 2-2 6z" fill={p.color} stroke="#fff" strokeWidth="1" />
              </svg>
              {place.side === 'cursor' && <span style={{ background: p.color }}>{p.nickname}</span>}
            </div>
            {(place.side === 'right' || place.side === 'left') && (
              <span
                className="peer-cursor-label"
                style={{
                  left: place.x,
                  top: place.y,
                  background: p.color,
                  transform: `scale(${inv})${place.side === 'left' ? ' translateX(-100%)' : ''}`,
                }}
              >
                {p.nickname}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
