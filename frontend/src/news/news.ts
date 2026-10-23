/**
 * 새 소식(업데이트 내역). 사용자에게 보이는 변화가 있는 배포마다 맨 위에 한 덩어리를 더한다.
 * id는 한 번 정하면 바꾸지 않는다(본 기록이 id로 남는다).
 * date는 '10월 20일 오후'처럼 날짜와 시간대(오전·오후·밤). 같은 날 같은 시간대에 여럿이면 '오후 -1', '오후 -2'로 번호를 붙인다.
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
    id: '2026-10-23-select-mine',
    date: '10월 23일 오후',
    items: [
      {
        kind: 'new',
        title: '내가 그린 획만 고르기',
        text: '선택·이동 도구를 쓰다가 다른 사람의 획을 잘못 옮기는 일이 있었죠. 선택·이동 버튼을 다시 누르면 열리는 창에서 ‘내가 그린 획만 고르기’를 켜 두면, 남의 획은 눌러도·상자로 둘러도 고르지 않아요. 이 브라우저에만 기억해요. 건의해 주셔서 고마워요!',
      },
    ],
  },
  {
    id: '2026-10-23-book-pdf',
    date: '10월 23일 오전',
    items: [
      {
        kind: 'new',
        title: '책으로 저장',
        text: '기록 화면의 ‘책으로 저장 (PDF)’을 누르면 지난 페이지를 모두 날짜순으로 엮은 PDF 한 권을 내려받아요. 표지에는 노트 이름과 기간이, 장마다 아래에 날짜와 쪽수가 들어가요. 참여한 사람들만 가질 수 있는, 세상에 몇 권 없는 책이에요. 건의해 주셔서 고마워요!',
      },
    ],
  },
  {
    id: '2026-10-22-paint',
    date: '10월 22일 오전 -2',
    items: [
      {
        kind: 'new',
        title: '채색',
        text: '도구 막대에 채색 붓이 생겼어요. 색이 겹치면 물감처럼 섞이고(노랑+파랑=초록), 선 위에 칠해도 선과 종이 줄이 비쳐요. 불투명도·부드러운 가장자리·200px까지 넓은 붓.',
      },
      { kind: 'new', title: '도형 채움', text: '사각형·원·삼각형과 첫 점으로 닫은 곡선의 안을 채워요. 도형 창에서 없음·연하게·보통·진하게.' },
      { kind: 'new', title: '채색 팔레트·스포이트', text: '잉크 창에 파스텔·피부·자연색 12색과 최근 쓴 색이 보이고, 스포이트로 화면의 색을 집어 쓸 수 있어요.' },
      { kind: 'fix', text: '연필·크레용으로 겹쳐 칠할 때 결이 끊기던 것을 이어지게 했어요.' },
    ],
  },
  {
    id: '2026-10-22-seal-hour',
    date: '10월 22일 오전 -1',
    items: [
      {
        kind: 'new',
        title: '노트마다 새 페이지 시각',
        text: '노트를 만든 사람이 머리글의 ‘새 페이지 00:00’ 버튼으로 새 페이지가 열리는 시각을 정해요. 밤샘 모임은 새벽 4시로! 바꾸면 지금 페이지는 다음에 오는 그 시각에 기록으로 보관되고, 같은 날 다시 열리는 페이지는 ‘10월 21일 (2)’처럼 보여요.',
      },
    ],
  },
  {
    id: '2026-10-21-two-finger-drag',
    date: '10월 21일 오후 -2',
    items: [
      {
        kind: 'fix',
        text: '두 손가락으로 종이를 끌 때(위아래·사선 모두) 화면이 커졌다 작아졌다 울렁이던 문제를 고쳤어요. 이제 손가락을 분명히 벌리거나 오므릴 때만 확대·축소돼요.',
      },
      {
        kind: 'fix',
        title: '지우개',
        text: '지우개를 든 채 두 손가락으로 스크롤·핀치하면 첫 손가락이 닿은 자리의 선이 지워지던 문제를 고쳤어요. 지우개는 끄는 동안 지워질 선을 흐리게 보여 주고, 손을 뗄 때 한 번에 지워요.',
      },
      {
        kind: 'new',
        title: '지우개 크기',
        text: '지우개를 들면 굵기 버튼이 ‘지우개 크기’가 돼요. 작게·보통·크게 가운데 고르거나 px(지름)로 직접 정해요. 이 브라우저에 기억돼요.',
      },
      {
        kind: 'fix',
        title: '큰 노트',
        text: '획이 수천 개 쌓인 노트에서 획을 뗄 때마다 멈칫하고 지우개가 둔해지던 문제를 고쳤어요. 새 획은 그 획만 덧그리고, 지우개는 근처 획만 살펴요.',
      },
      {
        kind: 'new',
        title: '끌던 중 취소',
        text: '지우개로 지울 선을 고르던 중, 선택한 것을 옮기던 중, 선을 긋던 중에 Esc나 Ctrl+Z를 누르면 하던 것을 거둬요. 태블릿에서는 다른 손가락을 대면 취소돼요.',
      },
      {
        kind: 'fix',
        text: '두 손가락으로 스크롤·핀치할 때 첫 손가락이 글 상자에 닿으면 상자가 함께 끌려가던 문제를 고쳤어요.',
      },
    ],
  },
  {
    id: '2026-10-21-tablet',
    date: '10월 21일 오후 -1',
    items: [
      {
        kind: 'new',
        title: '두 손가락 핀치 확대',
        text: '두 손가락을 벌리고 오므려 그리는 자리를 키우고 줄여요. 확대·축소할 때 보던 자리가 그대로 있고, 종이만 움직여요.',
      },
      {
        kind: 'new',
        title: '펜 전용 모드',
        text: '펜슬·S펜을 쓰면 손가락은 스크롤만 해요. 손바닥이 닿아도 선이 생기지 않아요. 펜 창의 ‘손가락’에서 바꿀 수 있어요.',
      },
      {
        kind: 'new',
        title: '집중 모드',
        text: '도구 막대 맨 끝 버튼으로 머리글을 숨기고 종이를 화면 폭에 맞춰 크게 봐요. 되는 기기에서는 전체 화면까지. Esc로 나와요.',
      },
      {
        kind: 'new',
        title: '홈 화면에 추가',
        text: '아이패드·안드로이드에서 브라우저의 ‘홈 화면에 추가’를 누르면 주소창 없이 앱처럼 열려요.',
      },
      { kind: 'new', text: 'PC에서는 Ctrl+휠로 확대하고, Space를 누른 채 끌거나 가운데 버튼으로 종이를 옮겨요.' },
    ],
  },
  {
    id: '2026-10-21-pencil-copy',
    date: '10월 21일 오전',
    items: [
      {
        kind: 'fix',
        text: '아이패드에서 펜슬·손가락으로 그릴 때 ‘복사하기’ 메뉴가 떠서 선이 그어지지 않던 문제를 다시 고쳤어요. 건의해 주셔서 고마워요! 그래도 안 되면 꼭 다시 건의해 주세요.',
      },
    ],
  },
  {
    id: '2026-10-20-kick',
    date: '10월 20일 오후 -5',
    items: [
      {
        kind: 'new',
        title: '참여자 내보내기',
        text: '노트를 만든 사람은 위쪽 참여 인원을 눌러 참여자를 내보낼 수 있어요. 내보낸 사람은 다시 허용할 때까지 들어오지 못해요.',
      },
    ],
  },
  {
    id: '2026-10-20-erase-preview',
    date: '10월 20일 오후 -4',
    items: [
      {
        kind: 'new',
        title: '지워질 선 미리 보기',
        text: '지우개를 선 위에 올리면 누를 때 지워질 선이 흐려지고 빨간 테두리로 감싸져요. 점처럼 작은 선은 점선 동그라미로 보여요. 마우스·펜 태블릿에서 보여요.',
      },
    ],
  },
  {
    id: '2026-10-20-toolbar-tidy',
    date: '10월 20일 오후 -3',
    items: [
      {
        kind: 'new',
        title: '도구 막대 정리',
        text: '형광펜은 펜 버튼 안으로 옮겼어요. 펜을 한 번 더 누르면 펜 종류와 형광펜을 골라요. 굵기는 색 옆 버튼 하나로 모았어요.',
      },
    ],
  },
  {
    id: '2026-10-20-sizes',
    date: '10월 20일 오후 -2',
    items: [
      {
        kind: 'new',
        title: '굵기를 px로',
        text: '굵기 버튼을 누르면 1~80px 사이에서 밀대나 숫자로 굵기를 정할 수 있어요. 펜·형광펜·도형에 그대로 쓰여요.',
      },
      {
        kind: 'new',
        title: '글자 크기를 px로',
        text: '글 상자 서식 막대의 − / + 로 글자 크기를 2px씩 바꿔요. 작게·보통·크게도 그대로 있어요.',
      },
    ],
  },
  {
    id: '2026-10-20-toolbar-dock',
    date: '10월 20일 오후 -1',
    items: [
      {
        kind: 'new',
        title: '도구 막대 옮기기',
        text: '넓은 화면에서 도구 막대 맨 앞의 점 손잡이를 끌어 왼쪽·오른쪽·위·아래에 붙일 수 있어요. 고른 자리는 이 브라우저에 기억해요.',
      },
    ],
  },
  {
    id: '2026-10-20-paper-color',
    date: '10월 20일 오전 -2',
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
    date: '10월 20일 오전 -1',
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
    date: '10월 19일 오후 -2',
    items: [
      { kind: 'new', title: '기능 건의', text: '아래 왼쪽 말풍선 버튼으로 바라는 기능이나 불편한 점을 보내 주세요.' },
      { kind: 'fix', text: '아래쪽 표시들이 노트 끝을 가리지 않게 여백을 두었어요.' },
    ],
  },
  {
    id: '2026-10-19-zoom',
    date: '10월 19일 오후 -1',
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
