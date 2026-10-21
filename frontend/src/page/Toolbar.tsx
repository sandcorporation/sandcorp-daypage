import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PopoverSideContext, ToolPopover } from '../components/ToolPopover'
import type { PopoverSide } from '../components/popoverPlacement'
import { dockAt, type ToolbarDock } from './toolbarDock'
import { BrushPicker } from './BrushPicker'
import { WidthPanel } from './WidthPanel'
import { ShapePicker } from './ShapePicker'
import { SHAPES, type ShapeKind } from './shapes'
import { InkControl } from './InkControl'
import { FontPicker } from './FontPicker'
import { BRUSHES, WIDTH_NAMES, type Brush, type ToolKind, type WidthLevel } from './tools'
import { PEN_ONLY_MODES, type PenOnlyMode } from './penOnly'

type Props = {
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  canUndo: boolean
  canRedo: boolean
  onTool: (tool: ToolKind) => void
  onInk: (color: string) => void
  onWidth: (level: WidthLevel) => void
  onUndo: () => void
  onRedo: () => void
  font: string
  onFont: (id: string) => void
  /** 글씨 도구이거나 글 상자를 편집 중일 때 글꼴 선택을 보인다 */
  showFont: boolean
  brush: Brush
  onBrush: (brush: Brush) => void
  shape: ShapeKind
  onShape: (shape: ShapeKind) => void
  pressure: boolean
  onPressure: (on: boolean) => void
  /** 펜 전용 모드. 없으면 설정을 보이지 않는다 */
  penOnly?: PenOnlyMode
  onPenOnly?: (mode: PenOnlyMode) => void
  /** 노트 색(#rrggbb). 기본 잉크 아래에 보인다 */
  noteColors: string[]
  onAddColor: (color: string) => Promise<void>
  onRemoveColor?: (color: string) => void
  /** 레이어 버튼으로 여는 레이어 패널 내용. 없으면 버튼을 보이지 않는다 */
  layerPanel?: ReactNode
  /** 직접 정한 굵기(px). 있으면 단계 대신 쓴다 */
  customWidth?: number | null
  /** 굵기를 px로 정했을 때. 없으면 직접 정하기를 보이지 않는다 */
  onCustomWidth?: (px: number) => void
  /** 집중 모드(머리글·칩을 숨기고 종이만). 없으면 버튼을 보이지 않는다 */
  focus?: boolean
  onFocus?: (on: boolean) => void
  /** 넓은 화면에서 도구 막대를 붙인 가장자리(휴대폰은 늘 위) */
  dock?: ToolbarDock
  /** 손잡이로 옮겼을 때. 없으면 손잡이를 보이지 않는다 */
  onDock?: (dock: ToolbarDock) => void
}

/** 도구 창은 도구 막대가 붙은 가장자리의 반대쪽으로 연다 */
const POPOVER_SIDE: Record<ToolbarDock, PopoverSide> = { left: 'right', right: 'left', top: 'below', bottom: 'above' }
const ARROW_DOCK: Record<string, ToolbarDock> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }

/**
 * 도구 막대 손잡이. 끌면 가장 가까운 가장자리를 미리 보이고, 놓으면 그곳에 붙인다. 화살표 키로도 옮긴다.
 */
function DockGrip({ dock, onDock }: { dock: ToolbarDock; onDock: (dock: ToolbarDock) => void }) {
  const [target, setTarget] = useState<ToolbarDock | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const view = () => ({ width: window.innerWidth, height: window.innerHeight })
  return (
    <>
      <button
        type="button"
        className="toolbar-grip"
        aria-label="도구 막대 옮기기"
        title="끌어서 왼쪽·오른쪽·위·아래로 옮겨요 (화살표 키로도)"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          if (target === null && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return
          setTarget(dockAt({ x: e.clientX, y: e.clientY }, view()))
        }}
        onPointerUp={() => {
          if (target && target !== dock) onDock(target)
          start.current = null
          setTarget(null)
        }}
        onPointerCancel={() => {
          start.current = null
          setTarget(null)
        }}
        onKeyDown={(e) => {
          const next = ARROW_DOCK[e.key]
          if (!next) return
          e.preventDefault()
          onDock(next)
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {[4, 8, 12].flatMap((y) => [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
        </svg>
      </button>
      {target && createPortal(<div className="dock-preview" data-dock={target} aria-hidden="true" />, document.body)}
    </>
  )
}

const PEN_ICON = 'M4 18l1-4L15 4l3 3L8 17z'
const HIGHLIGHTER_ICON = 'M6 14l7-9 4 3-7 9H6zM4 19h14'

/** 형광펜은 따로 버튼을 두지 않고 펜 버튼 창 안에 둔다(펜 버튼이 지금 펜·형광펜을 보여 준다). */
const TOOLS: { kind: ToolKind; label: string; icon: string }[] = [
  { kind: 'pen', label: '펜', icon: PEN_ICON },
  { kind: 'shape', label: '도형', icon: '' },
  { kind: 'text', label: '글씨', icon: 'M5 5h12M11 5v13M8 18h6' },
  { kind: 'eraser', label: '지우개', icon: 'M8 18l-4-4 9-9 5 5-8 8zM8 18h10' },
  { kind: 'select', label: '선택·이동', icon: 'M5 4l12 6-5 1.5L10 17z' },
]

export function Toolbar(props: Props) {
  const { tool, ink, widthLevel, canUndo, canRedo, onTool, onInk, onWidth, onUndo, onRedo, font, onFont, showFont } = props
  const { brush, onBrush, pressure, onPressure, noteColors, onAddColor, onRemoveColor, layerPanel, shape, onShape } = props
  const [shapeOpen, setShapeOpen] = useState(false)
  const shapeRef = useRef<HTMLButtonElement>(null)
  const [widthOpen, setWidthOpen] = useState(false)
  const widthRef = useRef<HTMLButtonElement>(null)
  const customWidth = props.customWidth ?? null
  const onCustomWidth = props.onCustomWidth
  const widthName = customWidth === null ? WIDTH_NAMES[widthLevel] : `${customWidth}px`
  // 굵기 버튼의 줄 두께: 지금 굵기를 버튼 안에 들어가게 줄여 보인다
  const widthLine = customWidth === null ? 2 + widthLevel * 3 : Math.min(10, Math.max(1, Math.round(customWidth / 3)))
  const shapeInfo = SHAPES.find((s) => s.id === shape) ?? SHAPES[0]
  const [layersOpen, setLayersOpen] = useState(false)
  const layersRef = useRef<HTMLButtonElement>(null)
  const [brushOpen, setBrushOpen] = useState(false)
  const penRef = useRef<HTMLButtonElement>(null)
  const brushName = BRUSHES.find((b) => b.id === brush)?.name ?? BRUSHES[0].name
  // 펜 버튼이 다시 고를 펜 쪽 도구: 마지막으로 쓴 펜이나 형광펜
  const [lastPen, setLastPen] = useState<'pen' | 'highlighter'>(tool === 'highlighter' ? 'highlighter' : 'pen')
  if ((tool === 'pen' || tool === 'highlighter') && tool !== lastPen) setLastPen(tool)
  const penActive = tool === 'pen' || tool === 'highlighter'
  const penName = lastPen === 'highlighter' ? '형광펜' : brushName
  const dock = props.dock ?? 'left'
  return (
    <PopoverSideContext.Provider value={POPOVER_SIDE[dock]}>
    <nav aria-label="도구" className="toolbar" data-dock={dock}>
      {props.onDock && <DockGrip dock={dock} onDock={props.onDock} />}
      {TOOLS.map((t) =>
        t.kind === 'pen' ? (
          <div key={t.kind} className="tool-anchor">
            <button
              ref={penRef}
              type="button"
              className="tool-btn"
              aria-label={`펜 (${penName})`}
              title={`펜 (${penName}) · 다시 누르면 펜 종류·형광펜 · Shift+드래그로 직선`}
              aria-pressed={penActive}
              aria-haspopup="dialog"
              aria-expanded={brushOpen}
              onClick={() => (penActive ? setBrushOpen((v) => !v) : onTool(lastPen))}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path
                  d={lastPen === 'highlighter' ? HIGHLIGHTER_ICON : t.icon}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <span className="tool-corner" aria-hidden="true" />
            </button>
            {brushOpen && (
              <ToolPopover title="펜" anchor={penRef} onClose={() => setBrushOpen(false)}>
                <BrushPicker
                  brush={tool === 'highlighter' ? null : brush}
                  onBrush={(b) => {
                    onBrush(b)
                    if (tool !== 'pen') onTool('pen')
                    setBrushOpen(false)
                  }}
                >
                  <p className="tool-pop-caption brush-group">형광펜</p>
                  <button
                    type="button"
                    className="brush-option"
                    aria-pressed={tool === 'highlighter'}
                    aria-label="형광펜: 글씨 위에 반투명하게 칠해요"
                    onClick={() => {
                      onTool('highlighter')
                      setBrushOpen(false)
                    }}
                  >
                    <svg width="156" height="44" viewBox="0 0 156 44" aria-hidden="true">
                      <rect x="8" y="14" width="140" height="16" rx="3" fill="#F2C230" opacity="0.6" />
                    </svg>
                    <span className="brush-text">
                      <span className="brush-name">형광펜</span>
                      <span className="brush-desc">글씨 위에 반투명하게 칠해요</span>
                    </span>
                  </button>
                  <label className="pressure-toggle">
                    필압 따라 굵기 바꾸기
                    <input type="checkbox" checked={pressure} onChange={(e) => onPressure(e.target.checked)} />
                  </label>
                  <p className="tool-pop-caption">펜슬·태블릿은 누르는 세기로, 마우스·손가락은 쓰는 속도로 굵기가 바뀌어요.</p>
                  {props.onPenOnly && (
                    <div className="pen-only" role="radiogroup" aria-label="손가락">
                      <p className="tool-pop-caption pen-only-title">손가락</p>
                      <div className="pen-only-options">
                        {PEN_ONLY_MODES.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={(props.penOnly ?? 'auto') === m.id}
                            aria-label={`손가락 ${m.name}: ${m.desc}`}
                            className="pen-only-option"
                            onClick={() => props.onPenOnly?.(m.id)}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                      <p className="tool-pop-caption">
                        {PEN_ONLY_MODES.find((m) => m.id === (props.penOnly ?? 'auto'))?.desc}. 펜을 쥔 손바닥이 닿아도 선이 생기지
                        않아요.
                      </p>
                    </div>
                  )}
                </BrushPicker>
              </ToolPopover>
            )}
          </div>
        ) : t.kind === 'shape' ? (
          <div key={t.kind} className="tool-anchor">
            <button
              ref={shapeRef}
              type="button"
              className="tool-btn"
              aria-label={`도형 (${shapeInfo.name})`}
              title={`도형 (${shapeInfo.name}) · 다시 누르면 도형 종류`}
              aria-pressed={tool === 'shape'}
              aria-haspopup="dialog"
              aria-expanded={shapeOpen}
              onClick={() => (tool === 'shape' ? setShapeOpen((v) => !v) : onTool('shape'))}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d={shapeInfo.icon} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span className="tool-corner" aria-hidden="true" />
            </button>
            {shapeOpen && (
              <ToolPopover title="도형" anchor={shapeRef} onClose={() => setShapeOpen(false)}>
                <ShapePicker
                  shape={shape}
                  onShape={(s) => {
                    onShape(s)
                    setShapeOpen(false)
                  }}
                />
              </ToolPopover>
            )}
          </div>
        ) : (
        <button
          key={t.kind}
          type="button"
          className="tool-btn"
          aria-label={t.label}
          title={t.kind === 'highlighter' ? `${t.label} · Shift+드래그로 직선` : t.label}
          aria-pressed={tool === t.kind}
          onClick={() => onTool(t.kind)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <path d={t.icon} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
        ),
      )}
      {showFont && <FontPicker font={font} onFont={onFont} />}
      <div className="tool-sep" />
      {/* | 색 · 굵기 |: 색 버튼과 굵기 버튼을 나란히 두고 앞뒤 구분선으로 한 묶음 */}
      <InkControl ink={ink} onInk={onInk} noteColors={noteColors} onAddColor={onAddColor} onRemoveColor={onRemoveColor} />
      <div className="tool-anchor">
        <button
          ref={widthRef}
          type="button"
          className="swatch-btn width-btn"
          aria-label={`굵기: ${widthName}`}
          title={`굵기: ${widthName}`}
          aria-haspopup="dialog"
          aria-expanded={widthOpen}
          onClick={() => setWidthOpen((v) => !v)}
        >
          <span className="width-line" style={{ height: widthLine }} aria-hidden="true" />
          <span className="width-name">{widthName}</span>
          <span className="tool-corner" aria-hidden="true" />
        </button>
      </div>
      {widthOpen && (
        <ToolPopover title="굵기" anchor={widthRef} onClose={() => setWidthOpen(false)}>
          <WidthPanel
            widthLevel={widthLevel}
            customWidth={customWidth}
            onWidth={onWidth}
            onCustomWidth={onCustomWidth}
            onDone={() => setWidthOpen(false)}
          />
        </ToolPopover>
      )}
      <div className="tool-sep" />
      {layerPanel && (
        <div className="tool-anchor">
          <button
            ref={layersRef}
            type="button"
            className="tool-btn"
            aria-label="레이어"
            title="레이어"
            aria-haspopup="dialog"
            aria-expanded={layersOpen}
            aria-pressed={layersOpen}
            onClick={() => setLayersOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M11 3l8 4-8 4-8-4zM3 11l8 4 8-4M3 15l8 4 8-4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </button>
          {layersOpen && (
            <ToolPopover title="레이어" anchor={layersRef} align="bottom" onClose={() => setLayersOpen(false)}>
              {layerPanel}
            </ToolPopover>
          )}
        </div>
      )}
      <button type="button" className="tool-btn" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M7 5L3 9l4 4M3 9h9a5 5 0 010 10h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="tool-btn" aria-label="다시하기" title="다시하기 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M13 5l4 4-4 4M17 9H8a5 5 0 000 10h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {props.onFocus && (
        <button
          type="button"
          className="tool-btn"
          aria-label={props.focus ? '집중 모드 끝내기' : '집중 모드'}
          title={props.focus ? '집중 모드 끝내기 (Esc)' : '집중 모드: 머리글을 숨기고 종이만 크게'}
          aria-pressed={!!props.focus}
          onClick={() => props.onFocus?.(!props.focus)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            {props.focus ? (
              <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}
    </nav>
    </PopoverSideContext.Provider>
  )
}
