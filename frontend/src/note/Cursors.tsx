import type { Peer } from './types'

/** 다른 사람의 커서(장 좌표계 레이어 안에 그린다). */
export function Cursors({ peers, scale }: { peers: Peer[]; scale: number }) {
  // 레이어가 scale만큼 줄어 있으므로 꼬리표 크기는 거꾸로 키워 화면에서 일정하게 보이게 한다.
  const inv = 1 / scale
  return (
    <>
      {peers
        .filter((p) => !p.isMe && p.cursor)
        .map((p) => (
          <div
            key={p.clientId}
            className="peer-cursor"
            style={{ left: p.cursor!.x, top: p.cursor!.y, transform: `scale(${inv})` }}
            aria-hidden="true"
          >
            <svg width="20" height="20" viewBox="0 0 18 18">
              <path d="M2 2l13 5-6 2-2 6z" fill={p.color} stroke="#fff" strokeWidth="1" />
            </svg>
            <span style={{ background: p.color }}>{p.nickname}</span>
          </div>
        ))}
    </>
  )
}
