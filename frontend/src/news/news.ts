/**
 * 새 소식(업데이트 내역). 사용자에게 보이는 변화가 있는 배포마다 맨 위에 한 덩어리를 더한다.
 * id는 한 번 정하면 바꾸지 않는다(본 기록이 id로 남는다).
 */
export type NewsKind = 'new' | 'fix' | 'start'

export type NewsItem = {
  kind: NewsKind
  /** 굵게 보일 앞부분(기능 이름) */
  title?: string
  text: string
}

export type NewsEntry = {
  id: string
  /** 보이는 날짜(묶음 제목) */
  date: string
  items: NewsItem[]
}

export const KIND_LABEL: Record<NewsKind, string> = { new: '새 기능', fix: '고침', start: '시작' }

/** 최신이 위 */
export const NEWS: NewsEntry[] = [
  {
    id: '2026-10-20-paper-color',
    date: '10월 20일 오후',
    items: [
      {
        kind: 'new',
        title: '종이 색 직접 고르기',
        text: '‘종이’ 창의 종이 색에서 + 를 누르면 원하는 색을 만들 수 있어요. 줄과 여백 선 색은 고른 색에 맞춰 정해져요.',
      },
      { kind: 'fix', text: '어두운 칠판 종이는 뺐어요.' },
    ],
  },
  {
    id: '2026-10-20-paper',
    date: '10월 20일',
    items: [
      {
        kind: 'new',
        title: '종이 고르기',
        text: '위쪽 ‘종이’ 버튼으로 줄 노트·모눈·점·무지, 왼쪽 여백 선, 종이 색(흰색·미색·연회색)을 골라요. 함께 쓰는 모두의 화면이 같이 바뀌어요.',
      },
    ],
  },
  {
    id: '2026-10-19-eraser',
    date: '10월 19일 밤',
    items: [
      { kind: 'new', title: '지우개 동그라미', text: '지우개가 지울 자리를 동그라미로 보여 줘요. 판타블렛처럼 커서가 없어도 보여요. (건의해 주셔서 고마워요!)' },
      { kind: 'fix', title: '레이어별로 지우기', text: '지우개는 지금 그리는 레이어의 그림만 지워요. 다른 레이어 그림은 그대로 남아요. (건의해 주셔서 고마워요!)' },
    ],
  },
  {
    id: '2026-10-19-suggest',
    date: '10월 19일 저녁',
    items: [
      { kind: 'new', title: '기능 건의', text: '아래 왼쪽 말풍선 버튼으로 바라는 기능이나 불편한 점을 보내 주세요.' },
      { kind: 'fix', text: '아래쪽 표시들이 노트 끝을 가리지 않게 여백을 두었어요.' },
    ],
  },
  {
    id: '2026-10-19-zoom',
    date: '10월 19일',
    items: [{ kind: 'new', title: '150%·200% 확대', text: '작은 글씨나 그림을 더 크게 보며 그릴 수 있어요. 오른쪽 아래 + 버튼으로요.' }],
  },
  {
    id: '2026-10-17-connection',
    date: '10월 17일',
    items: [
      { kind: 'fix', text: '혼자 쓰고 있으면 30초마다 ‘연결이 끊겼어요’가 깜박이던 문제' },
      { kind: 'fix', text: '나간 사람이 계속 접속 중으로 보이던 문제' },
    ],
  },
  {
    id: '2026-10-16-shapes',
    date: '10월 16일 저녁',
    items: [
      { kind: 'new', title: '도형 도구', text: '사각형·원·삼각형·화살표, 점을 찍어 잇는 곡선까지. 고른 펜과 색으로 그려져요.' },
      { kind: 'new', title: 'Shift를 누른 채 그으면 직선', text: '밑줄은 수평으로 맞춰 줘요.' },
      { kind: 'new', text: '새 버전이 나오면 아래 왼쪽에서 새로고침을 알려 드려요.' },
      { kind: 'fix', text: '휴대폰에서 도구가 가려지던 문제, 위쪽 머리글을 한 줄로 줄였어요.' },
      { kind: 'fix', text: '비워 둔 채 나간 글 상자가 계속 남던 문제' },
    ],
  },
  {
    id: '2026-10-16-open',
    date: '10월 16일 · Daypage를 열었어요',
    items: [
      { kind: 'start', text: '링크 하나로 함께 그리고 쓰는 하루 노트. 자정마다 새 페이지가 열리고 지난 페이지는 기록에 남아요.' },
      { kind: 'start', text: '펜 다섯 가지(볼펜·만년필·연필·붓펜·크레용), 노트만의 색, 글 상자 서식' },
      { kind: 'start', text: '레이어 — 스티커처럼 잡아 옮기고, 키우고, 돌려요.' },
    ],
  },
]

const KEY = 'daypage:news-seen'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 마지막으로 본 소식 id(이 브라우저). 없거나 읽을 수 없으면 null. */
export function loadSeen(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

/** 창을 열면 맨 위 소식까지 본 것으로 둔다. */
export function markSeen(entries: NewsEntry[] = NEWS, storage: StorageLike | null = defaultStorage()): void {
  if (!entries[0]) return
  try {
    storage?.setItem(KEY, entries[0].id)
  } catch {
    // 시크릿 창 등: 이번 방문 동안만 기억한다
  }
}

/**
 * 처음 보는 소식 id들. 마지막으로 본 것보다 위에 있는 것들이다.
 * 한 번도 안 봤거나(처음 온 사람) 본 것이 목록에 없으면 맨 위 하나만 새것으로 친다.
 */
export function unreadIds(entries: NewsEntry[], seen: string | null): string[] {
  const at = seen === null ? -1 : entries.findIndex((e) => e.id === seen)
  if (at < 0) return entries.slice(0, 1).map((e) => e.id)
  return entries.slice(0, at).map((e) => e.id)
}
