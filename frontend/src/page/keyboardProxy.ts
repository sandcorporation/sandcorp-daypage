/**
 * 휴대폰 키보드를 탭하는 그 순간에 미리 띄워 두는 보이지 않는 입력 칸.
 *
 * 카카오톡 같은 앱 안 브라우저(iOS WKWebView 등)는 사용자 터치 이벤트 처리 중에 받은 포커스에만
 * 키보드를 띄운다. 글 상자는 탭으로 만든 뒤 다시 그려지고 나서야(useEffect) 편집기에 포커스를 주므로
 * 그때는 이미 터치 이벤트가 끝나 키보드가 뜨지 않았다. 그래서 탭 처리 중에 이 칸에 먼저 포커스를 줘
 * 키보드를 띄우고, 편집기가 준비되면 포커스를 넘긴다(편집 칸끼리 옮기면 키보드는 그대로 남는다).
 */
let proxy: HTMLInputElement | null = null

export function primeKeyboard(clientX: number, clientY: number): void {
  if (!proxy || !proxy.isConnected) {
    proxy = document.createElement('input')
    proxy.type = 'text'
    proxy.setAttribute('aria-hidden', 'true')
    proxy.tabIndex = -1
    proxy.className = 'keyboard-proxy'
    // 16px 미만이면 iOS가 화면을 확대한다. 탭한 자리에 두어야 키보드가 뜰 때 엉뚱한 곳으로 스크롤하지 않는다.
    Object.assign(proxy.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      padding: '0',
      border: '0',
      opacity: '0',
      fontSize: '16px',
      pointerEvents: 'none',
    })
    document.body.appendChild(proxy)
  }
  proxy.style.left = `${Math.max(0, clientX)}px`
  proxy.style.top = `${Math.max(0, clientY)}px`
  proxy.focus({ preventScroll: true })
}
