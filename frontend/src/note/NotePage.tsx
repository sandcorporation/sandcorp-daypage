import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import type { EraseFilter, EraserMode } from "../page/erase";
import * as Y from "yjs";
import { PageView, type PointerTool } from "../page/PageView";
import { TextLayer } from "../page/TextLayer";
import { PhotoControls, PhotoImages, type PhotoDrag } from "../page/PhotoLayer";
import { PhotoPanel } from "../page/PhotoPanel";
import { photoBase } from "../page/photos";
import { usePhotoPicker } from "../page/usePhotoPicker";
import { createTextBoxAt, removeLeftoverEmptyBoxes } from "../page/textbox";
import { primeKeyboard } from "../page/keyboardProxy";
import { updateTextBox } from "../page/doc";
import { fontOf } from "../page/fonts";
import { LayerPanel } from "../page/LayerPanel";
import { useLayerList } from "../page/useLayers";
import { loadHiddenLayers, saveHiddenLayers } from "./hiddenLayers";
import { Toolbar } from "../page/Toolbar";
import {
  INKS,
  eraserRadius,
  isKnownInk,
  pushRecentInk,
  strokeWidth,
  type Brush,
  type ToolKind,
  type WidthLevel,
} from "../page/tools";
import type { ShapeFill, ShapeKind } from "../page/shapes";
import { hasSelection, useEditTools } from "../page/useEditTools";
import { isTypingTarget, useUndo } from "../page/useUndo";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorScreen, MessageCard } from "../pages/ErrorScreen";
import { ConnectionPill } from "./ConnectionPill";
import { NewsButton } from "../news/NewsButton";
import { PaperButton } from "./PaperButton";
import { normalizePaper, type Paper } from "../page/paper";
import { fingerScrollsOnly, type PenOnlyMode } from "../page/penOnly";
import { SuggestButton, type SuggestionContext } from "../suggest/SuggestButton";
import { NoteHeader } from "./NoteHeader";
import { Cursors } from "./Cursors";
import { MemberLimitControl } from "./MemberLimitControl";
import { SealHourControl } from "./SealHourControl";
import { loadToolPrefs, saveToolPrefs } from "./toolPrefs";
import {
  loadToolbarDock,
  saveToolbarDock,
  type ToolbarDock,
} from "../page/toolbarDock";
import { stepZoom, ZoomControl, type Zoom } from "./ZoomControl";
import { ViewControl } from "./ViewControl";
import { RotateControl } from "./RotateControl";
import { VIEW_IDENTITY, mirrorView, rotateView, type ViewTransform } from "../page/viewTransform";
import {
  actionFor,
  comboOf,
  fetchKeymap,
  useKeymap,
} from "../page/shortcuts";
import { ShortcutsButton } from "./ShortcutsButton";
import { uniquePeople, usePresence } from "./usePresence";
import { useNewVersion } from "./useNewVersion";
import { useRealtime, type FatalReason } from "./useRealtime";
import type { NoteDetail } from "./types";
import "./note.css";

type Props = { initial: NoteDetail };

export function NotePage({ initial }: Props) {
  const [note, setNote] = useState(initial);
  const [clockOffset] = useState(
    () => new Date(initial.serverNow).getTime() - Date.now(),
  );
  const [fatal, setFatal] = useState<FatalReason | null>(null);
  // 운영 조치로 끊겼을 때 서버가 알려 주는 사유(닫힌 까닭·정지 기간)
  const [blockedDetail, setBlockedDetail] = useState<string | null>(null);
  useEffect(() => {
    if (fatal !== "closed" && fatal !== "suspended" && fatal !== "kicked")
      return;
    api(`/api/notes/${note.id}`).catch((e) => {
      if (e instanceof ApiError && e.status === 403)
        setBlockedDetail(e.message);
    });
  }, [fatal, note.id]);
  const { toast, show } = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 도구 상태. 마지막으로 고른 값을 이 브라우저에 기억해 새로고침·재방문 때 되살린다.
  const [prefs] = useState(loadToolPrefs);
  const [dock, setDock] = useState<ToolbarDock>(loadToolbarDock);
  const moveToolbar = useCallback((next: ToolbarDock) => {
    setDock(next);
    saveToolbarDock(next);
  }, []);
  const [tool, setTool] = useState<ToolKind>(prefs.tool);
  const [chosenInk, setChosenInk] = useState<string>(prefs.ink);
  // 최근 쓴 색(최신이 앞). 잉크를 고를 때마다 앞에 넣는다
  const [recentInks, setRecentInks] = useState<string[]>(prefs.recentInks);
  const setInk = useCallback((color: string) => {
    setChosenInk(color);
    setRecentInks((r) => pushRecentInk(r, color));
  }, []);
  // 스포이트: 켜면 다음 한 번의 지면 터치가 그 자리 색을 집는다
  const [picking, setPicking] = useState(false);
  // 새 번들이 나와 있는지(useNewVersion). 페이지 교체 때 옛 코드로 새 응답을 읽다 죽지 않게 새로고침한다(GlitchTip #102)
  const newVersionRef = useRef(false);
  const [widthLevel, setWidthLevel] = useState<WidthLevel>(prefs.widthLevel);
  const [customWidth, setCustomWidth] = useState<number | null>(
    prefs.customWidth,
  );
  // 기본 굵기를 고르면 직접 정한 굵기는 쓰지 않는다
  const chooseWidth = useCallback((level: WidthLevel) => {
    setWidthLevel(level);
    setCustomWidth(null);
  }, []);
  const [eraserLevel, setEraserLevel] = useState<WidthLevel>(
    prefs.eraserLevel,
  );
  const [eraserWidth, setEraserWidth] = useState<number | null>(
    prefs.eraserWidth,
  );
  const chooseEraserLevel = useCallback((level: WidthLevel) => {
    setEraserLevel(level);
    setEraserWidth(null);
  }, []);
  const eraserR = eraserRadius(eraserLevel, eraserWidth);
  // 지우개 방식(범위·획·올가미)과 지울 대상 거르기(브라우저에 기억)
  const [eraserMode, setEraserMode] = useState<EraserMode>(prefs.eraserMode);
  const [eraseFilter, setEraseFilter] = useState<EraseFilter>(
    prefs.eraseFilter,
  );
  // 「이 장 모두 지우기」 확인 창에 보일 획 수(null이면 창을 닫았다)
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  // 채색 붓 설정(브라우저에 기억)
  const [paintLevel, setPaintLevel] = useState<WidthLevel>(prefs.paintLevel);
  const [paintWidth, setPaintWidth] = useState<number | null>(
    prefs.paintWidth,
  );
  const choosePaintLevel = useCallback((level: WidthLevel) => {
    setPaintLevel(level);
    setPaintWidth(null);
  }, []);
  const [paintOpacity, setPaintOpacity] = useState(prefs.paintOpacity);
  const [paintSoft, setPaintSoft] = useState(prefs.paintSoft);
  const paintPx = strokeWidth("paint", paintLevel, paintWidth);
  const [font, setFont] = useState<string>(prefs.font);
  const [brush, setBrush] = useState<Brush>(prefs.brush);
  const [pressureOn, setPressureOn] = useState(prefs.pressure);
  const [penOnly, setPenOnly] = useState<PenOnlyMode>(prefs.penOnly);
  // 화면 고정: 손가락·휠로 화면이 움직이지 않게. 기기마다 쓰는 법이 달라 브라우저에 기억한다.
  const [viewLock, setViewLock] = useState(prefs.viewLock);
  // 선택·이동이 내가 그린 획만 고르게(남의 획을 잘못 옮기지 않게). 브라우저에 기억한다.
  const [selectMine, setSelectMine] = useState(prefs.selectMine);
  // 선택·이동이 빈 곳에서 끌 때 상자 대신 올가미로 두르기. 브라우저에 기억한다.
  const [selectLasso, setSelectLasso] = useState(prefs.selectLasso);
  // 더해 고르기(터치에서 shift 대신). 잠깐 켜 쓰는 것이라 도구 설정에 남기지 않는다.
  const [selectAdd, setSelectAdd] = useState(false);
  // 집중 모드: 머리글·아래 칩을 숨기고 툴바만 종이 위에 띄운다. 되는 기기에서는 브라우저 전체 화면까지.
  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback((on: boolean) => {
    setFocus(on);
    const root = document.documentElement;
    if (on) {
      if (!document.fullscreenElement)
        root.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (!focus) return;
    // 브라우저 전체 화면을 먼저 나가면(Esc 등) 집중 모드도 끈다. 전체 화면이 아니었다면 Esc로 끈다.
    const onFull = () => {
      if (!document.fullscreenElement) setFocus(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]'))
        return;
      toggleFocus(false);
    };
    document.addEventListener("fullscreenchange", onFull);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFull);
      window.removeEventListener("keydown", onKey);
    };
  }, [focus, toggleFocus]);
  // 이번 방문에서 펜 입력을 본 적이 있는지. 자동 모드는 그때부터 손가락을 스크롤로만 쓰고 한 번 알린다.
  const [penSeen, setPenSeen] = useState(false);
  const onPenSeen = useCallback(() => {
    setPenSeen(true);
    if (penOnly === "auto")
      show(
        "펜이 감지돼 손가락은 화면만 옮겨요. 오른쪽 아래 손 버튼으로 바꿀 수 있어요.",
      );
  }, [penOnly, show]);
  const fingerMoves = fingerScrollsOnly(penOnly, penSeen);
  const chooseFingerMoves = useCallback(
    (on: boolean) => {
      setPenOnly(on ? "on" : "off");
      show(
        on
          ? "손가락은 화면을 옮겨요. 펜이나 마우스로는 그대로 그려요."
          : "손가락으로 그려요. 화면은 두 손가락으로 옮겨요.",
      );
    },
    [show],
  );
  const chooseViewLock = useCallback(
    (on: boolean) => {
      setViewLock(on);
      show(
        on
          ? "화면을 고정했어요. 확대·축소 버튼은 그대로 쓸 수 있어요."
          : "화면 고정을 풀었어요.",
      );
    },
    [show],
  );
  const [shape, setShape] = useState<ShapeKind>(prefs.shape);
  const [shapeFill, setShapeFill] = useState<ShapeFill>(prefs.shapeFill);
  // 고른 노트 색이 노트에서 빠졌으면 기본 잉크로 돌아간다.
  const ink = isKnownInk(chosenInk, note.colors) ? chosenInk : INKS[0].color;
  useEffect(
    () =>
      saveToolPrefs({
        tool,
        ink,
        widthLevel,
        customWidth,
        font,
        brush,
        shape,
        shapeFill,
        pressure: pressureOn,
        penOnly,
        viewLock,
        eraserLevel,
        eraserWidth,
        eraserMode,
        eraseFilter,
        paintLevel,
        paintWidth,
        paintOpacity,
        paintSoft,
        recentInks,
        selectMine,
        selectLasso,
      }),
    [
      tool,
      ink,
      widthLevel,
      customWidth,
      font,
      brush,
      shape,
      shapeFill,
      pressureOn,
      penOnly,
      viewLock,
      eraserLevel,
      eraserWidth,
      eraserMode,
      eraseFilter,
      paintLevel,
      paintWidth,
      paintOpacity,
      paintSoft,
      recentInks,
      selectMine,
      selectLasso,
    ],
  );
  const [scale, setScale] = useState(0.5);
  const [zoom, setZoom] = useState<Zoom>("fit");
  // 보기 돌리기·뒤집기: 이 탭의 메모리에만 둔다(서버·저장소·계정 설정에 넣지 않는다). 새로고침하면 원위치.
  const [view, setView] = useState<ViewTransform>(VIEW_IDENTITY);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusId(null), []);

  // 장(날짜)마다 새 문서. 자정 교체 때 날짜가 바뀌면 새 방으로 옮겨 간다.
  const doc = useMemo(() => new Y.Doc(), [note.page.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 내 변경에 붙이는 표식(되돌리기는 이것만 추적한다)
  const origin = useMemo(() => ({ local: true }), []);
  const history = useUndo(doc, origin);
  // 사진: 끄는 동안의 자리(놓을 때 한 번만 문서에 쓴다)
  const [photoDrag, setPhotoDrag] = useState<PhotoDrag | null>(null);
  // 사진 패널: 내 화면에서만 숨긴 사진(저장하지 않는다), 패널에서 올려 둔 사진
  const [hiddenPhotos, setHiddenPhotos] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [highlightPhoto, setHighlightPhoto] = useState<string | null>(null);
  const toggleHiddenPhoto = useCallback((id: string) => {
    setHiddenPhotos((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const photoPicker = usePhotoPicker({
    doc,
    noteId: note.id,
    author: note.me.nickname,
    origin,
    scale,
    view,
    // 붙이자마자 옮기거나 크기를 바꿀 수 있게 선택·이동 도구로
    onPlaced: () => setTool("select"),
    show,
  });
  // 도형 곡선을 찍는 중이면 되돌리기는 획 대신 마지막으로 찍은 점을 지운다.
  const curveControl = useRef<{ undoPoint: () => void } | null>(null);
  const [curvePoints, setCurvePoints] = useState(0);
  const undo = useCallback(() => {
    if (curvePoints > 0 && curveControl.current)
      curveControl.current.undoPoint();
    else history.undo();
  }, [curvePoints, history]);
  // 곡선 중에는 다시하기를 쉰다(되돌린 획이 곡선 위로 돌아오지 않게)
  const redo = useCallback(() => {
    if (curvePoints === 0) history.redo();
  }, [curvePoints, history]);

  // 두 손가락으로 톡: 되돌리기, 세 손가락: 다시하기(Procreate·GoodNotes 방식)
  const onFingerTap = useCallback(
    (fingers: number) => {
      if (fingers === 2) {
        if (history.canUndo || curvePoints > 0) undo();
        else show("되돌릴 것이 없어요.");
      } else if (fingers === 3) {
        if (history.canRedo && curvePoints === 0) redo();
        else show("다시 할 것이 없어요.");
      }
    },
    [history.canUndo, history.canRedo, curvePoints, undo, redo, show],
  );

  // 레이어: 지금 그리는 레이어는 연결마다 따로다. 고른 레이어가 사라지면 맨 위 레이어로.
  const layers = useLayerList(doc);
  const [chosenLayer, setChosenLayer] = useState<string | null>(null);
  // 레이어 탭에서 올리거나 고른 레이어를 화면에 표시한다. 고르면 잠깐(폰처럼 올릴 수 없을 때도 보이게).
  const [highlightLayer, setHighlightLayer] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  // 지금 마우스를 올려 둔 레이어(고른 뒤 잠깐 표시가 끝나도 올려 둔 동안은 계속 표시)
  const hoveredLayer = useRef<string | null>(null);
  const highlight = useCallback((id: string | null) => {
    hoveredLayer.current = id;
    window.clearTimeout(highlightTimer.current);
    setHighlightLayer(id);
  }, []);
  const pickLayer = useCallback((id: string) => {
    setChosenLayer(id);
    setHighlightLayer(id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(
      () => setHighlightLayer(hoveredLayer.current),
      1500,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);
  const currentLayer =
    layers.find((l) => l.id === chosenLayer)?.id ??
    layers[layers.length - 1].id;
  // 내 화면에서만 숨긴 레이어(이 브라우저에 노트·날짜별로 기억)
  const [hiddenState, setHiddenState] = useState(() => ({
    date: note.page.key,
    set: loadHiddenLayers(note.id, note.page.key),
  }));
  const hiddenLayers =
    hiddenState.date === note.page.key
      ? hiddenState.set
      : loadHiddenLayers(note.id, note.page.key);
  const toggleHidden = useCallback(
    (id: string) => {
      const next = new Set(hiddenLayers);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHiddenLayers(note.id, note.page.key, next);
      setHiddenState({ date: note.page.key, set: next });
    },
    [hiddenLayers, note.id, note.page.key],
  );
  const edit = useEditTools(
    doc,
    tool,
    origin,
    hiddenLayers,
    scale,
    currentLayer,
    eraserR,
    selectMine ? note.me.nickname : null,
    selectLasso,
    { additive: selectAdd, eraserMode, eraseFilter },
  );
  const askClear = useCallback(() => {
    const n = edit.clearTargets().length;
    if (n === 0) show("지울 획이 없어요.");
    else setConfirmClear(n);
  }, [edit, show]);
  const clearPage = useCallback(() => {
    setConfirmClear(null);
    // 앞의 작업과 합쳐지지 않게 끊고 한 단계로 지운다(되돌리기 한 번으로 되살아난다)
    history.stopCapturing();
    const n = edit.clearAll();
    history.stopCapturing();
    if (n > 0) show(`획 ${n}개를 지웠어요.`, { label: "되돌리기", onClick: undo });
  }, [edit, history, show, undo]);

  // 오늘 장이 아니라고 닫혔거나 자정이 지났을 때 서버의 오늘 날짜를 다시 확인한다.
  const reconnectRef = useRef<() => void>(() => {});
  const retryTimer = useRef<number | undefined>(undefined);
  const refreshToday = useCallback(async () => {
    window.clearTimeout(retryTimer.current);
    if (newVersionRef.current) {
      window.location.reload();
      return;
    }
    try {
      const fresh = await api<NoteDetail>(`/api/notes/${note.id}`);
      if (fresh.page.key !== note.page.key) setNote(fresh);
      // 날짜가 그대로면(시계 차이 등) 잠시 뒤 같은 장으로 다시 붙는다.
      else
        retryTimer.current = window.setTimeout(
          () => reconnectRef.current(),
          3000,
        );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404)
        return setFatal("notFound");
      // 네트워크 오류는 화면을 굳히지 않고 다시 시도한다.
      retryTimer.current = window.setTimeout(() => void refreshToday(), 5000);
    }
  }, [note.id, note.page.key]);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

  const setNoteColors = useCallback(
    (colors: string[]) => setNote((n) => ({ ...n, colors })),
    [],
  );
  const setNotePaper = useCallback(
    (raw: unknown) => setNote((n) => ({ ...n, paper: normalizePaper(raw) })),
    [],
  );
  const paper = normalizePaper(note.paper);
  // 종이 바꾸기: 화면은 바로 바꾸고 저장한다(실패하면 되돌린다). 다른 사람에게는 서버가 알린다.
  const changePaper = useCallback(
    async (change: Partial<Paper>) => {
      const before = note.paper;
      setNote((n) => ({
        ...n,
        paper: { ...normalizePaper(n.paper), ...change },
      }));
      try {
        const saved = await api<Paper>(`/api/notes/${note.id}/paper`, {
          method: "PATCH",
          body: JSON.stringify(change),
        });
        setNotePaper(saved);
      } catch {
        setNote((n) => ({ ...n, paper: before }));
        show("종이를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요.");
      }
    },
    [note.id, note.paper, setNotePaper, show],
  );
  // 주인이 봉인 시각을 바꿨다: 지금 장이면 봉인 예정 시각을 바꿔 카운트다운을 맞춘다(장이 바뀌면 page_rolled가 온다)
  const onNotePageChange = useCallback(
    (change: { key: string; dueAt: string; sealHour: number }) =>
      setNote((n) =>
        n.page.key === change.key
          ? { ...n, sealHour: change.sealHour, page: { ...n.page, dueAt: change.dueAt } }
          : { ...n, sealHour: change.sealHour },
      ),
    [],
  );
  const { provider, status, synced, queuePosition, reconnect } = useRealtime({
    noteId: note.id,
    pageKey: note.page.key,
    doc,
    onNotToday: refreshToday,
    onFatal: setFatal,
    onNoteColors: setNoteColors,
    onNotePaper: setNotePaper,
    onNotePage: onNotePageChange,
  });
  reconnectRef.current = reconnect;
  const rejoin = useCallback(() => {
    setFatal(null);
    reconnect();
  }, [reconnect]);
  const presence = usePresence(provider, note.me);
  const { setEditing } = presence;
  const newVersion = useNewVersion(status);
  newVersionRef.current = newVersion;

  // 들어와 동기화가 끝나면, 지난번에 비워 둔 채 나간 내 빈 상자를 정리한다.
  // 다른 탭에서 쓰고 있는 상자는 남기도록, 접속자 정보가 들어올 틈을 둔다.
  const editorsRef = useRef(presence.editors);
  editorsRef.current = presence.editors;
  useEffect(() => {
    if (!synced) return;
    const timer = window.setTimeout(
      () =>
        removeLeftoverEmptyBoxes(
          doc,
          note.me.nickname,
          new Set(editorsRef.current.keys()),
        ),
      1500,
    );
    return () => window.clearTimeout(timer);
  }, [synced, doc, note.me.nickname]);

  // 서버 알림을 놓쳐도 자정이 지나면 스스로 오늘 장을 다시 확인한다.
  useEffect(() => {
    const wait =
      new Date(note.page.dueAt).getTime() - (Date.now() + clockOffset) + 3000;
    const timer = window.setTimeout(refreshToday, Math.max(1000, wait));
    return () => window.clearTimeout(timer);
  }, [note.page.dueAt, clockOffset, refreshToday]);

  const onEditing = useCallback(
    (boxId: string | null) => {
      setEditingBoxId(boxId);
      setEditing(boxId);
    },
    [setEditing],
  );

  const chooseFont = useCallback(
    (id: string) => {
      setFont(id);
      // 편집 중인 상자가 있으면 그 상자에도 바로 적용한다(내 작업이라 되돌릴 수 있음).
      if (editingBoxId)
        updateTextBox(
          doc,
          editingBoxId,
          { font: id, fontSize: fontOf(id).size },
          origin,
        );
    },
    [doc, editingBoxId, origin],
  );

  const textTool = useMemo<PointerTool>(
    () => ({
      down(p, e) {
        // 휴대폰 키보드는 탭 처리 중에만 띄울 수 있다(앱 안 브라우저). 편집기는 다시 그린 뒤에 포커스를 받는다.
        if (e.pointerType !== "mouse") primeKeyboard(e.clientX, e.clientY);
        const id = createTextBoxAt(
          doc,
          p,
          { color: ink, author: note.me.nickname, font },
          origin,
        );
        setFocusId(id);
        return true;
      },
    }),
    [doc, ink, note.me.nickname, origin, font],
  );

  // 건의와 함께 보내는 화면 상태. 펜 전용 모드(손 버튼)·화면 고정처럼 켜 둔 줄 모르는 설정 때문에 '안 된다'는 건의를 가려내려고.
  const layerNow = layers.find((l) => l.id === currentLayer);
  const suggestionContext = (): SuggestionContext => ({
    tool,
    shape: tool === "shape" ? shape : null,
    fingerMoves,
    penOnly,
    penSeen,
    viewLock,
    zoom: String(zoom),
    scale: Math.round(scale * 100) / 100,
    focusMode: focus,
    dock,
    layer: layerNow?.name ?? null,
    layerLocked: layerNow?.locked ?? false,
    layerHidden: hiddenLayers.has(currentLayer),
    editingTextBox: editingBoxId !== null,
    connection: status,
    synced,
    pageKey: note.page.key,
  });

  // 단축키(page/shortcuts.ts). 사용자가 바꿀 수 있어 키를 직접 보지 않고 지금 단축키 표에서 동작을 찾는다.
  const keymap = useKeymap();
  // 계정에 둔 단축키를 받아 온다(그 전에는 이 브라우저의 사본)
  useEffect(() => {
    void fetchKeymap();
  }, []);
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.isComposing) return;
      const combo = comboOf(e);
      const action = combo && actionFor(keymap, combo);
      if (!action) return;
      // 누르고 있으면 되풀이되는 것은 되돌리기·다시 하기·확대·축소만
      if (e.repeat && !["undo", "redo", "zoomIn", "zoomOut"].includes(action))
        return;
      switch (action) {
        case "undo":
          undo();
          break;
        case "redo":
          redo();
          break;
        case "delete":
          // 고른 것이 없으면 키를 그대로 둔다
          if (!hasSelection(edit.selected)) return;
          edit.deleteSelected();
          break;
        case "zoomIn":
          setZoom(stepZoom(scale, 1));
          break;
        case "zoomOut":
          setZoom(stepZoom(scale, -1));
          break;
        case "zoomFit":
          setZoom("fit");
          break;
        case "focus":
          toggleFocus(!focus);
          break;
        case "rotateCw":
          setView((v) => rotateView(v, 1));
          break;
        case "rotateCcw":
          setView((v) => rotateView(v, -1));
          break;
        case "mirror":
          setView(mirrorView);
          break;
        case "viewReset":
          setView(VIEW_IDENTITY);
          break;
        case "eyedropper":
          setPicking(true);
          break;
        case "help":
          // 집중 모드에서는 단축키 버튼이 없다
          if (focus) return;
          setKeysOpen((v) => !v);
          break;
        default:
          setTool(action);
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keymap, undo, redo, edit, scale, focus, toggleFocus]);

  const rename = useCallback(
    async (name: string) => {
      const res = await api<{ name: string }>(`/api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setNote((n) => ({ ...n, name: res.name }));
    },
    [note.id],
  );

  const changeSealHour = useCallback(
    async (sealHour: number) => {
      try {
        const res = await api<{ sealHour: number; page: NoteDetail["page"] }>(
          `/api/notes/${note.id}`,
          { method: "PATCH", body: JSON.stringify({ sealHour }) },
        );
        setNote((n) => ({ ...n, sealHour: res.sealHour, page: res.page }));
        show(`새 페이지가 열리는 시각을 ${String(res.sealHour).padStart(2, "0")}:00로 바꿨어요`);
      } catch {
        show("시각을 바꾸지 못했어요. 잠시 뒤 다시 해 주세요.");
      }
    },
    [note.id, show],
  );
  const changeLimit = useCallback(
    async (memberLimit: number | null) => {
      try {
        const res = await api<{ memberLimit: number | null }>(
          `/api/notes/${note.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ memberLimit }),
          },
        );
        setNote((n) => ({ ...n, memberLimit: res.memberLimit }));
        show(
          res.memberLimit === null
            ? "정원을 무제한으로 바꿨어요"
            : `정원을 ${res.memberLimit}명으로 바꿨어요`,
        );
      } catch (e) {
        show(e instanceof ApiError ? e.message : "정원을 바꾸지 못했어요");
      }
    },
    [note.id, show],
  );

  const addColor = useCallback(
    async (color: string) => {
      try {
        const res = await api<{ colors: string[] }>(
          `/api/notes/${note.id}/colors`,
          {
            method: "POST",
            body: JSON.stringify({ color }),
          },
        );
        setNote((n) => ({ ...n, colors: res.colors }));
      } catch (e) {
        show(e instanceof ApiError ? e.message : "색을 더하지 못했어요");
        throw e;
      }
    },
    [note.id, show],
  );

  // 스포이트로 집은 색: 아는 색이면 바로, 아니면 노트 색으로 더한 뒤 잉크로
  const onPick = useCallback(
    (color: string) => {
      setPicking(false);
      if (isKnownInk(color, note.colors)) {
        setInk(color);
        show(`색을 집었어요 ${color}`);
        return;
      }
      void addColor(color).then(() => setInk(color));
    },
    [note.colors, addColor, setInk, show],
  );
  const removeColor = useCallback(
    async (color: string) => {
      try {
        const res = await api<{ colors: string[] }>(
          `/api/notes/${note.id}/colors/${color.slice(1)}`,
          { method: "DELETE" },
        );
        setNote((n) => ({ ...n, colors: res.colors }));
      } catch (e) {
        show(e instanceof ApiError ? e.message : "색을 빼지 못했어요");
      }
    },
    [note.id, show],
  );

  const deleteNote = useCallback(async () => {
    setDeleting(true);
    try {
      await api<void>(`/api/notes/${note.id}`, { method: "DELETE" });
      navigate("/");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
      show("노트를 지우지 못했어요");
    }
  }, [note.id, navigate, show]);

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(note.url);
      show("링크 복사됨");
    } catch {
      window.prompt("이 링크를 복사해 건네주세요", note.url);
    }
  }, [note.url, show]);

  if (fatal === "closed" || fatal === "suspended" || fatal === "kicked")
    return <ErrorScreen kind={fatal} detail={blockedDetail ?? undefined} />;
  if (fatal === "crowded") return <ErrorScreen kind="crowded" />;
  // 수용 인원이 가득 찼거나 자리 비움으로 나갔다: 사람이 누를 때만 새로 접속한다.
  if (fatal === "full" || fatal === "away")
    return <ErrorScreen kind={fatal} onAction={rejoin} />;
  if (fatal)
    return <ErrorScreen kind={fatal === "notFound" ? "missing" : "server"} />;
  if (queuePosition !== null)
    return (
      <MessageCard
        role="status"
        kicker="잠시만요!"
        title="사람이 많아 잠시 기다려 주세요"
        desc={
          <>
            지금 <strong>{queuePosition}번째</strong>예요. 차례가 오면 노트가
            저절로 열려요.
          </>
        }
      />
    );

  return (
    <div className="note-screen" data-focus={focus || undefined}>
      {/* 집중 모드에서는 머리글·아래 칩을 아예 그리지 않는다(툴바만 남는다) */}
      {!focus && (
        <NoteHeader
          note={note}
          page={note.page}
          clockOffset={clockOffset}
          peers={uniquePeople(presence.peers, note.me.nickname)}
          onRename={rename}
          onShare={share}
          settings={
            <>
              <PaperButton
                paper={paper}
                onChange={(c) => void changePaper(c)}
              />
              <MemberLimitControl
                noteId={note.id}
                memberCount={note.memberCount}
                memberLimit={note.memberLimit}
                editable={note.isOwner}
                onChange={changeLimit}
                onDelete={
                  note.isOwner ? () => setConfirmDelete(true) : undefined
                }
              />
              <SealHourControl
                sealHour={note.sealHour}
                editable={note.isOwner}
                onChange={changeSealHour}
              />
            </>
          }
        />
      )}
      <div className="note-body" data-dock={dock}>
        {photoPicker.input}
        <Toolbar
          dock={dock}
          onDock={moveToolbar}
          focus={focus}
          onFocus={toggleFocus}
          tool={tool}
          ink={ink}
          widthLevel={widthLevel}
          canUndo={history.canUndo || curvePoints > 0}
          canRedo={history.canRedo && curvePoints === 0}
          onTool={setTool}
          onInk={setInk}
          onWidth={chooseWidth}
          customWidth={customWidth}
          onCustomWidth={setCustomWidth}
          eraserLevel={eraserLevel}
          eraserWidth={eraserWidth}
          onEraserLevel={chooseEraserLevel}
          onEraserWidth={setEraserWidth}
          eraserMode={eraserMode}
          onEraserMode={setEraserMode}
          eraseFilter={eraseFilter}
          onEraseFilter={setEraseFilter}
          onClearPage={askClear}
          paintLevel={paintLevel}
          paintWidth={paintWidth}
          onPaintLevel={choosePaintLevel}
          onPaintWidth={setPaintWidth}
          paintOpacity={paintOpacity}
          onPaintOpacity={setPaintOpacity}
          paintSoft={paintSoft}
          onPaintSoft={setPaintSoft}
          onUndo={undo}
          onRedo={redo}
          font={font}
          onFont={chooseFont}
          showFont={tool === "text" || editingBoxId !== null}
          brush={brush}
          onBrush={setBrush}
          shape={shape}
          onShape={setShape}
          shapeFill={shapeFill}
          onShapeFill={setShapeFill}
          recentInks={recentInks}
          onEyedropper={() => setPicking(true)}
          pressure={pressureOn}
          onPressure={setPressureOn}
          penOnly={penOnly}
          onPenOnly={setPenOnly}
          selectMine={selectMine}
          onSelectMine={setSelectMine}
          selectLasso={selectLasso}
          onSelectLasso={setSelectLasso}
          noteColors={note.colors}
          onAddColor={addColor}
          onRemoveColor={(c) => void removeColor(c)}
          photoPanel={
            photoPicker.enabled ? (
              <PhotoPanel
                doc={doc}
                origin={origin}
                base={photoBase(note.id)}
                hidden={hiddenPhotos}
                onToggleHidden={toggleHiddenPhoto}
                onHighlight={setHighlightPhoto}
                onAdd={photoPicker.open}
                addBlocked={photoPicker.blocked}
              />
            ) : undefined
          }
          layerPanel={
            <LayerPanel
              doc={doc}
              origin={origin}
              current={currentLayer}
              onCurrent={pickLayer}
              onHighlight={highlight}
              hidden={hiddenLayers}
              onToggleHidden={toggleHidden}
            />
          }
        />
        <PageView
          doc={doc}
          paper={paper}
          tool={tool}
          ink={ink}
          widthLevel={widthLevel}
          customWidth={customWidth}
          brush={brush}
          shape={shape}
          shapeFill={shapeFill}
          picking={picking}
          onPick={onPick}
          eraserRadius={tool === "eraser" ? eraserR : undefined}
          paintWidth={paintPx}
          paintOpacity={paintOpacity}
          paintSoft={paintSoft}
          onCurveChange={setCurvePoints}
          curveControl={curveControl}
          pressureOn={pressureOn}
          fingerScrolls={fingerMoves}
          onPenSeen={onPenSeen}
          viewLocked={viewLock}
          onFingerTap={onFingerTap}
          layer={currentLayer}
          hiddenLayers={hiddenLayers}
          highlightLayer={highlightLayer}
          onDrawBlocked={(reason) =>
            show(
              reason === "locked"
                ? "잠긴 레이어에는 그릴 수 없어요. 레이어에서 잠금을 풀어 주세요."
                : "숨긴 레이어에는 그릴 수 없어요. 레이어에서 다시 보이게 해 주세요.",
            )
          }
          author={note.me.nickname}
          origin={origin}
          pointerTool={tool === "text" ? textTool : edit.pointerTool}
          penEraserTool={edit.eraserTool}
          onScale={setScale}
          zoom={zoom}
          view={view}
          onZoom={setZoom}
          onPointerMove={presence.setCursor}
          overlay={edit.overlay}
          editPreview={edit.live}
          onGestureStart={history.stopCapturing}
          underlay={
            <PhotoImages
              doc={doc}
              base={photoBase(note.id)}
              preview={photoDrag}
              hidden={hiddenPhotos}
              highlight={highlightPhoto}
            />
          }
        >
          <TextLayer
            doc={doc}
            tool={tool}
            scale={scale}
            readOnly={false}
            origin={origin}
            focusId={focusId}
            onFocusHandled={clearFocus}
            onEditing={onEditing}
            editors={presence.editors}
            me={note.me.nickname}
            noteColors={note.colors}
            selectedTexts={edit.selected.texts}
            editPreview={edit.live}
          />
          {tool === "select" && (
            <PhotoControls
              doc={doc}
              scale={scale}
              origin={origin}
              onPreview={setPhotoDrag}
              hidden={hiddenPhotos}
            />
          )}
          <Cursors peers={presence.peers} scale={scale} />
        </PageView>
      </div>
      {!focus && (
        <div className="status-corner">
          <ConnectionPill
            status={status}
            synced={synced}
            newVersion={newVersion}
          />
          <NewsButton />
          <SuggestButton noteId={note.id} context={suggestionContext} />
          <ShortcutsButton open={keysOpen} onOpen={setKeysOpen} />
        </div>
      )}
      <ViewControl
        fingerMoves={fingerMoves}
        onFingerMoves={chooseFingerMoves}
        locked={viewLock}
        onLocked={chooseViewLock}
        addSelect={tool === "select" ? selectAdd : undefined}
        onAddSelect={setSelectAdd}
      />
      <RotateControl
        view={view}
        keymap={keymap}
        onRotate={(dir) => setView((v) => rotateView(v, dir))}
        onMirror={() => setView(mirrorView)}
        onReset={() => setView(VIEW_IDENTITY)}
      />
      <ZoomControl scale={scale} zoom={zoom} onZoom={setZoom} />
      {confirmDelete && (
        <ConfirmDialog
          title={`‘${note.name}’을 지울까요?`}
          confirmLabel="삭제"
          busy={deleting}
          onConfirm={deleteNote}
          onCancel={() => setConfirmDelete(false)}
        >
          <p>
            오늘 페이지와 지난 기록까지 모두 바로 사라지고, 되돌릴 수 없어요.
          </p>
          {note.memberCount > 1 && (
            <p>
              함께 쓰던 참여자 {note.memberCount - 1}명도 더는 볼 수 없어요.
            </p>
          )}
        </ConfirmDialog>
      )}
      {confirmClear !== null && (
        <ConfirmDialog
          title="이 장의 획을 모두 지울까요?"
          confirmLabel="모두 지우기"
          onConfirm={clearPage}
          onCancel={() => setConfirmClear(null)}
        >
          <p>
            {eraseFilter === "pen"
              ? "펜 획"
              : eraseFilter === "highlighter"
                ? "형광펜 획"
                : "획"}{" "}
            {confirmClear}개를 지워요(지금 그리는 레이어만). 글 상자와 사진은
            그대로 둬요. 지운 뒤 되돌리기로 되살릴 수 있어요.
          </p>
        </ConfirmDialog>
      )}
      {toast}
    </div>
  );
}
