import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import * as Y from "yjs";
import { PageView, type PointerTool } from "../page/PageView";
import { TextLayer } from "../page/TextLayer";
import { createTextBoxAt, removeLeftoverEmptyBoxes } from "../page/textbox";
import { updateTextBox } from "../page/doc";
import { fontOf } from "../page/fonts";
import { LayerPanel } from "../page/LayerPanel";
import { useLayers } from "../page/useLayers";
import { loadHiddenLayers, saveHiddenLayers } from "./hiddenLayers";
import { Toolbar } from "../page/Toolbar";
import {
  INKS,
  eraserRadius,
  strokeWidth,
  type Brush,
  type ToolKind,
  type WidthLevel,
} from "../page/tools";
import type { ShapeKind } from "../page/shapes";
import { useEditTools } from "../page/useEditTools";
import { isTypingTarget, useUndo } from "../page/useUndo";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorScreen, MessageCard } from "../pages/ErrorScreen";
import { ConnectionPill } from "./ConnectionPill";
import { NewsButton } from "../news/NewsButton";
import { PaperButton } from "./PaperButton";
import { normalizePaper, type Paper } from "../page/paper";
import { fingerScrollsOnly, type PenOnlyMode } from "../page/penOnly";
import { SuggestButton } from "../suggest/SuggestButton";
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
import { ZoomControl, type Zoom } from "./ZoomControl";
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
  const [chosenInk, setInk] = useState<string>(prefs.ink);
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
        "펜이 감지돼 손가락은 스크롤만 해요. 펜 창의 ‘손가락’에서 바꿀 수 있어요.",
      );
  }, [penOnly, show]);
  const [shape, setShape] = useState<ShapeKind>(prefs.shape);
  // 고른 노트 색이 노트에서 빠졌으면 기본 잉크로 돌아간다.
  const ink =
    INKS.some((i) => i.color === chosenInk) ||
    note.colors.includes(chosenInk.toLowerCase())
      ? chosenInk
      : INKS[0].color;
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
        pressure: pressureOn,
        penOnly,
        eraserLevel,
        eraserWidth,
        paintLevel,
        paintWidth,
        paintOpacity,
        paintSoft,
      }),
    [
      tool,
      ink,
      widthLevel,
      customWidth,
      font,
      brush,
      shape,
      pressureOn,
      penOnly,
      eraserLevel,
      eraserWidth,
      paintLevel,
      paintWidth,
      paintOpacity,
      paintSoft,
    ],
  );
  const [scale, setScale] = useState(0.5);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusId(null), []);

  // 장(날짜)마다 새 문서. 자정 교체 때 날짜가 바뀌면 새 방으로 옮겨 간다.
  const doc = useMemo(() => new Y.Doc(), [note.page.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 내 변경에 붙이는 표식(되돌리기는 이것만 추적한다)
  const origin = useMemo(() => ({ local: true }), []);
  const history = useUndo(doc, origin);
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

  // 레이어: 지금 그리는 레이어는 연결마다 따로다. 고른 레이어가 사라지면 맨 위 레이어로.
  const { layers } = useLayers(doc);
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
  );

  // 오늘 장이 아니라고 닫혔거나 자정이 지났을 때 서버의 오늘 날짜를 다시 확인한다.
  const reconnectRef = useRef<() => void>(() => {});
  const retryTimer = useRef<number | undefined>(undefined);
  const refreshToday = useCallback(async () => {
    window.clearTimeout(retryTimer.current);
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
      down(p) {
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        edit.selected.length
      ) {
        e.preventDefault();
        edit.deleteSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, edit]);

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
          pressure={pressureOn}
          onPressure={setPressureOn}
          penOnly={penOnly}
          onPenOnly={setPenOnly}
          noteColors={note.colors}
          onAddColor={addColor}
          onRemoveColor={(c) => void removeColor(c)}
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
          eraserRadius={tool === "eraser" ? eraserR : undefined}
          paintWidth={paintPx}
          paintOpacity={paintOpacity}
          paintSoft={paintSoft}
          onCurveChange={setCurvePoints}
          curveControl={curveControl}
          pressureOn={pressureOn}
          fingerScrolls={fingerScrollsOnly(penOnly, penSeen)}
          onPenSeen={onPenSeen}
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
          onScale={setScale}
          zoom={zoom}
          onZoom={setZoom}
          onPointerMove={presence.setCursor}
          overlay={edit.overlay}
          overlayVersion={edit.overlayVersion}
          preview={edit.preview}
          eraseTargets={edit.eraseTargets}
          onGestureStart={history.stopCapturing}
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
          />
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
          <SuggestButton noteId={note.id} />
        </div>
      )}
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
      {toast}
    </div>
  );
}
