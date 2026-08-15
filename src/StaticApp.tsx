import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiTimeoutError,
  evaluateAllModels,
  ModelAnalysis,
  selectBestTurn,
  warmAi,
} from "./ai/client";
import { Board } from "./components/Board";
import { Hand } from "./components/Hand";
import {
  applyKnownLegalAction,
  createInitialState,
  framePositions,
  legalActions,
  refillActions,
} from "./game/game";
import { chooseHeuristicAction, placementSortKey } from "./game/bot";
import {
  Action,
  GameState,
  PlaceCardAction,
  RecentPlacement,
  RefillAction,
  positionKey,
} from "./game/types";
import {
  applyActionTrackingHistory,
  completeHumanCandidate,
  enumerateTurnCandidates,
  TurnEvaluation,
} from "./game/value";
import {
  createV2Tracking,
  observeV2Action,
  replayV2Actions,
  V2TrackingState,
} from "./game/v2Tracking";
import { MODEL_ID, MODEL_LABEL, verifyModelContract } from "./modelContract";

const newGame = (): GameState => {
  const state = createInitialState(4);
  return { ...state, currentPlayerIndex: state.randomState % 4 };
};

const comparePlacement = (state: GameState, left: PlaceCardAction, right: PlaceCardAction): number => {
  const a = placementSortKey(state, left);
  const b = placementSortKey(state, right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

const handBeforeRefill = (start: GameState, actions: Action[]): typeof start.players[number]["hand"] => {
  const hand = [...start.players[start.currentPlayerIndex].hand];
  actions.forEach((action) => {
    if (action.type === "place") hand.splice(action.handIndex, 1);
  });
  return hand;
};

const planText = (actions: Action[]): string => actions.map((action) => {
  if (action.type === "place") return `カード${action.handIndex + 1} → (${action.position.x + 1},${action.position.y + 1})`;
  if (action.type === "end_turn") return "手番終了";
  return action.source === "deck" ? "山札から補充" : action.source === "negative_cards" ? "マイナスから補充" : "補充なし";
}).join(" → ");

export default function StaticApp() {
  const [state, setState] = useState<GameState>(() => newGame());
  const [history, setHistory] = useState<RecentPlacement[]>([]);
  const [tracking, setTracking] = useState<V2TrackingState>(() => createV2Tracking(4));
  const [pendingState, setPendingState] = useState<GameState | null>(null);
  const [pendingActions, setPendingActions] = useState<PlaceCardAction[]>([]);
  const [selectedHand, setSelectedHand] = useState<number | null>(null);
  const [frameChoices, setFrameChoices] = useState<PlaceCardAction[]>([]);
  const [selectedFrameAction, setSelectedFrameAction] = useState<PlaceCardAction | null>(null);
  const [plannedRefill, setPlannedRefill] = useState<RefillAction | null>(null);
  const [comparison, setComparison] = useState<ModelAnalysis[] | null>(null);
  const [preview, setPreview] = useState<"own" | "ai-0" | "ai-1" | "ai-2">("own");
  const [autoPlay, setAutoPlay] = useState(false);
  const [manualFrameSelection, setManualFrameSelection] = useState(false);
  const [winRateEnabled, setWinRateEnabled] = useState(true);
  const [message, setMessage] = useState("読み込み中…");
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);

  const pending = pendingState ?? state;
  const isHumanTurn = !autoPlay && state.currentPlayerIndex === 0 && state.phase !== "game_over";
  const human = state.players[0];
  const selectedActions = selectedHand === null ? [] : legalActions(pending).filter(
    (action): action is PlaceCardAction => action.type === "place" && action.handIndex === selectedHand,
  );
  const legalPositionKeys = new Set(selectedActions.map((action) => positionKey(action.position)));
  const frameAnchorKeys = new Set(frameChoices.map((action) => positionKey({ x: action.frame.x + 2, y: action.frame.y + 2 })));

  const resetTurnUi = useCallback(() => {
    setPendingState(null);
    setPendingActions([]);
    setSelectedHand(null);
    setFrameChoices([]);
    setSelectedFrameAction(null);
    setPlannedRefill(null);
    setComparison(null);
    setPreview("own");
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    running.current = false;
    setThinking(false);
    setError(null);
    const next = newGame();
    setState(next);
    setHistory([]);
    setTracking(createV2Tracking(4));
    resetTurnUi();
    setMessage("新しいゲームを開始しました。");
  }, [resetTurnUi]);

  useEffect(() => {
    try {
      verifyModelContract();
      warmAi(MODEL_ID);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (state.phase === "game_over" || running.current || error || (!autoPlay && state.currentPlayerIndex === 0)) return;
    running.current = true;
    const token = generation.current;
    let nextState = state;
    let nextHistory = history;
    let nextTracking = tracking;
    setThinking(true);
    setMessage(autoPlay ? "AIが対局を進行中です…" : `NPC ${state.currentPlayerIndex} が考えています…`);
    const run = async () => {
      try {
        while (
          token === generation.current &&
          nextState.phase !== "game_over" &&
          (autoPlay || nextState.currentPlayerIndex !== 0)
        ) {
          const player = nextState.currentPlayerIndex;
          if (nextState.phase === "play" && nextState.cardsPlayedThisTurn === 0 && legalActions(nextState).some((action) => action.type === "place")) {
            const candidates = enumerateTurnCandidates(nextState, nextHistory);
            const best = await selectBestTurn(candidates, player, nextState, nextTracking, nextHistory, MODEL_ID);
            nextTracking = replayV2Actions(nextState, best.candidate.actions, nextTracking).tracking;
            nextState = best.candidate.state;
            nextHistory = best.candidate.history;
          } else {
            const action = chooseHeuristicAction(nextState);
            if (!action) throw new Error("CPUが合法手を選べませんでした。");
            const applied = applyActionTrackingHistory(nextState, action, nextHistory);
            nextTracking = observeV2Action(nextTracking, nextState, action, applied.state);
            nextState = applied.state;
            nextHistory = applied.history;
          }
        }
        if (token !== generation.current) return;
        setState(nextState);
        setHistory(nextHistory);
        setTracking(nextTracking);
        setMessage("");
      } catch (cause) {
        if (token !== generation.current) return;
        setError(cause instanceof AiTimeoutError ? "AI推論がタイムアウトしました。" : `AI推論に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        if (token === generation.current) {
          running.current = false;
          setThinking(false);
        }
      }
    };
    void run();
  }, [state, history, tracking, autoPlay, error]);

  const commitPlacement = (action: PlaceCardAction) => {
    const nextPendingState = applyKnownLegalAction(pending, action);
    setPendingState(nextPendingState);
    setPendingActions((actions) => [...actions, action]);
    setSelectedHand(null);
    setFrameChoices([]);
    setSelectedFrameAction(null);
    setPlannedRefill(null);
    setComparison(null);
  };

  const choosePosition = (x: number, y: number) => {
    const choices = selectedActions.filter((action) => action.position.x === x && action.position.y === y);
    const best = [...choices].sort((left, right) => comparePlacement(pending, left, right))[0];
    if (!best) return;
    if (!manualFrameSelection) {
      commitPlacement(best);
      return;
    }
    setFrameChoices(choices);
    setSelectedFrameAction(best);
  };

  const chooseFrameAnchor = (x: number, y: number) => {
    const action = frameChoices.find((choice) => choice.frame.x + 2 === x && choice.frame.y + 2 === y);
    if (action) setSelectedFrameAction(action);
  };

  const applyActualAction = (action: Action) => {
    const applied = applyActionTrackingHistory(state, action, history);
    setState(applied.state);
    setHistory(applied.history);
    setTracking(observeV2Action(tracking, state, action, applied.state));
    resetTurnUi();
  };

  const plannedRefillState = pending.phase === "refill"
    ? pending
    : pendingActions.length === 1 && legalActions(pending).some((action) => action.type === "end_turn")
      ? applyKnownLegalAction(pending, { type: "end_turn" })
      : null;
  const plannedRefillOptions = plannedRefillState ? refillActions(plannedRefillState) : [];
  const canCompletePendingMove = pendingActions.length > 0 && (!plannedRefillState || Boolean(plannedRefill));

  const compare = async (refillOverride: RefillAction | null = plannedRefill) => {
    const ownCandidate = completeHumanCandidate(state, pendingActions, history, refillOverride);
    if (!ownCandidate) return;
    setThinking(true);
    setMessage("AI上位候補を計算しています…");
    try {
      const models = await evaluateAllModels(
        enumerateTurnCandidates(state, history),
        ownCandidate,
        0,
        state,
        tracking,
        history,
        [MODEL_ID],
      );
      setComparison(models);
      setPreview("own");
      setMessage("");
    } catch (cause) {
      setMessage(`勝率計算に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setThinking(false);
    }
  };

  const commitCandidate = (evaluation?: TurnEvaluation, refillOverride: RefillAction | null = plannedRefill) => {
    const candidate = evaluation?.candidate ?? completeHumanCandidate(state, pendingActions, history, refillOverride);
    if (!candidate) return;
    setTracking(replayV2Actions(state, candidate.actions, tracking).tracking);
    setHistory(candidate.history);
    setState(candidate.state);
    resetTurnUi();
  };

  const completeMove = () => {
    if (!canCompletePendingMove) return;
    if (winRateEnabled) void compare();
    else commitCandidate();
  };

  const choosePlannedRefill = (action: RefillAction) => {
    setPlannedRefill(action);
  };

  useEffect(() => {
    if (!plannedRefill || !pendingActions.length || comparison || thinking) return;
    if (winRateEnabled) void compare(plannedRefill);
    else commitCandidate(undefined, plannedRefill);
  }, [plannedRefill]);

  const humanRefills = isHumanTurn && state.phase === "refill" ? refillActions(state) : [];
  const previewModel = comparison?.find((model) => model.spec.id === MODEL_ID);
  const shownEvaluation = preview === "own" ? previewModel?.own : previewModel?.top[Number(preview.slice(3))];
  const placementPreviewBoard = selectedFrameAction
    ? { ...pending.board, [positionKey(selectedFrameAction.position)]: [...(pending.board[positionKey(selectedFrameAction.position)] ?? []), pending.players[pending.currentPlayerIndex].hand[selectedFrameAction.handIndex]] }
    : pending.board;
  const shownBoard = shownEvaluation?.candidate.state.board ?? placementPreviewBoard;
  const shownPlacements = (shownEvaluation?.candidate.actions ?? (selectedFrameAction ? [...pendingActions, selectedFrameAction] : pendingActions)).filter((action): action is PlaceCardAction => action.type === "place");
  const shownFrame = selectedFrameAction?.frame ?? shownPlacements.at(-1)?.frame;
  const penaltyPositionKeys = selectedFrameAction
    ? new Set(Object.keys(placementPreviewBoard).filter((key) => !framePositions(selectedFrameAction.frame).map(positionKey).includes(key)))
    : new Set<string>();
  const penaltyCardCount = [...penaltyPositionKeys].reduce((total, key) => total + (placementPreviewBoard[key]?.length ?? 0), 0);
  const shownHand = shownEvaluation ? handBeforeRefill(state, shownEvaluation.candidate.actions) : pending.players[0].hand;

  return (
    <main className={`game-page${comparison ? " is-comparing-page" : ""}`}>
      <header className="game-header">
        <div><p className="eyebrow">4 PLAYER GAME</p><h1>Yellowstone park</h1></div>
        <div className="header-actions">
          <span>CPU 3体</span><span>{MODEL_LABEL}</span>
          <button type="button" className="text-button" onClick={() => setAutoPlay((value) => !value)}>{autoPlay ? "AIに任せるを停止" : "AIに任せる"}</button>
          <button type="button" className="text-button" onClick={reset}>リセット</button>
        </div>
      </header>
      <section className="score-strip">{state.players.map((player, index) => <article key={index} className={state.currentPlayerIndex === index ? "active-player" : ""}><strong>{index === 0 ? "あなた" : `NPC ${index}`}</strong><span>失点 {player.lossScore}</span><span>手札 {player.hand.length}</span><span>マイナス {player.negativeCards.length}</span></article>)}</section>
      {message && <p className="notice">{message}</p>}
      {error && <section className="notice model-error"><strong>モデルエラー</strong><p>{error}</p><button type="button" className="primary" onClick={reset}>リセットして再試行</button></section>}
      {state.phase === "game_over" ? <section className="game-over"><p className="eyebrow">GAME OVER</p><h2>{state.winners.includes(0) ? "あなたの勝利です" : `NPC ${state.winners.join(", ")} の勝利です`}</h2><button type="button" className="primary" onClick={reset}>もう一度遊ぶ</button><button type="button" onClick={reset}>リセット</button></section> : <div className={`game-layout${comparison ? " is-comparing" : ""}`}>
        <section className="board-panel"><Board board={shownBoard} legalPositionKeys={comparison || frameChoices.length || !isHumanTurn ? new Set() : legalPositionKeys} frameAnchorKeys={comparison ? new Set() : frameAnchorKeys} penaltyPositionKeys={penaltyPositionKeys} previewActions={shownPlacements} previewFrame={shownFrame} onPositionClick={choosePosition} onFrameAnchorClick={chooseFrameAnchor} /></section>
        <aside className="control-panel">
          {!isHumanTurn && <div className="turn-status"><span className={thinking ? "spinner" : ""} />{autoPlay ? "AIが対局を進行中です" : "CPUの手番です"}</div>}
          {!isHumanTurn && <section><div className="section-title"><h2>あなたの手札</h2><span>{human.hand.length}枚</span></div><Hand cards={human.hand} selectedIndex={null} disabled onSelect={() => undefined} /></section>}
          {isHumanTurn && humanRefills.length > 0 && <section><h2>手札を補充</h2><p>補充方法を選んでください。</p>{humanRefills.map((action) => <button type="button" key={action.source} onClick={() => applyActualAction(action)}>{action.source === "deck" ? "山札から補充" : action.source === "negative_cards" ? "マイナスカードから補充" : "補充しない"}</button>)}</section>}
          {isHumanTurn && !humanRefills.length && <section><div className="section-title"><h2>あなたの手</h2><span>{pendingActions.length}/2枚</span></div><div className="frame-mode"><span>3×3枠を自動設定</span><button type="button" className={manualFrameSelection ? "selected" : ""} aria-pressed={manualFrameSelection} onClick={() => { setManualFrameSelection((value) => !value); setFrameChoices([]); setSelectedFrameAction(null); }}>{manualFrameSelection ? "OFF" : "ON"}</button></div><Hand cards={shownHand} selectedIndex={selectedHand} disabled={Boolean(comparison) || thinking || frameChoices.length > 0} onSelect={(index) => { setSelectedHand(index); setFrameChoices([]); setSelectedFrameAction(null); }} />
            <div className="frame-mode win-rate-toggle"><span>勝率計算</span><button type="button" className={winRateEnabled ? "selected" : ""} aria-pressed={winRateEnabled} onClick={() => { setWinRateEnabled((value) => !value); setComparison(null); }}>{winRateEnabled ? "ON" : "OFF"}</button></div>
            {comparison && <section className="comparison comparison-under-hand"><div className="comparison-heading"><h2>AI上位3候補</h2><span>候補を選ぶと盤面と失点表示をプレビューします。</span></div><div className="comparison-cards comparison-cards-vertical"><button type="button" className={preview === "own" ? "selected" : ""} onClick={() => setPreview("own")}><span>あなたの手</span><strong>{previewModel?.own ? `${(previewModel.own.probability * 100).toFixed(1)}%` : "-"}</strong><small>{previewModel?.own && planText(previewModel.own.candidate.actions)}</small></button>{previewModel?.top.slice(0, 3).map((value, index) => <button type="button" key={index} className={preview === `ai-${index}` ? "selected" : ""} onClick={() => setPreview(`ai-${index}` as "ai-0" | "ai-1" | "ai-2")}><span>AI {index + 1}位</span><strong>{(value.probability * 100).toFixed(1)}%</strong><small>{planText(value.candidate.actions)}</small></button>)}</div></section>}
            {selectedHand !== null && !frameChoices.length && <p className="hint">盤面の置き場所を選んでください。</p>}{frameChoices.length > 0 && <div className="frame-picker"><strong>3×3枠を選択</strong><p>{selectedFrameAction ? `枠外のカード ${penaltyCardCount}枚が失点カードになります。盤面のハイライトを確認してください。` : "盤面上の枠候補を選んでください。"}</p><button type="button" className="primary" onClick={() => selectedFrameAction && commitPlacement(selectedFrameAction)} disabled={!selectedFrameAction}>OK</button></div>}{plannedRefillOptions.length > 0 && pendingActions.length > 0 && <section className="planned-refill"><h2>補充方法</h2>{plannedRefillOptions.map((action) => <button type="button" key={action.source} className={plannedRefill?.source === action.source ? "selected" : ""} onClick={() => setPlannedRefill(action)}>{action.source === "deck" ? "山札から補充" : action.source === "negative_cards" ? "マイナスから補充" : "補充しない"}</button>)}</section>}{canCompletePendingMove && !comparison && <button type="button" className="primary" onClick={completeMove} disabled={thinking}>{pendingActions.length === 1 ? "1枚で手番を終了" : "この2枚でプレイ"}</button>}{comparison && previewModel?.own && <button type="button" className="primary" onClick={() => commitCandidate(preview === "own" ? previewModel.own : previewModel.top[Number(preview.slice(3))])}>表示中の手でプレイ</button>}{pendingActions.length > 0 && <button type="button" onClick={resetTurnUi}>自分の手を選び直す</button>}</section>}
        </aside>
      </div>}
      <footer>山札 {state.deck.length}枚・決算 {state.settlementCount}回</footer>
    </main>
  );
}
