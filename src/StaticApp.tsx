import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiTimeoutError, selectBestTurn, warmAi } from "./ai/client";
import { Board } from "./components/Board";
import { Hand } from "./components/Hand";
import {
  applyKnownLegalAction, createInitialState, framesContaining, legalActions,
  legalPositionsForCard, refillActions,
} from "./game/game";
import { chooseHeuristicAction } from "./game/bot";
import {
  Action, GameState, PlaceCardAction, RecentPlacement, positionKey,
} from "./game/types";
import {
  applyActionTrackingHistory, enumerateTurnCandidates, TurnEvaluation,
} from "./game/value";
import { createV2Tracking, observeV2Action, replayV2Actions, V2TrackingState } from "./game/v2Tracking";
import { MODEL_ID, MODEL_LABEL, verifyModelContract } from "./modelContract";

const newGame = (): GameState => {
  const state = createInitialState(4);
  return { ...state, currentPlayerIndex: state.randomState % 4 };
};

const applyTracked = (state: GameState, action: Action, history: RecentPlacement[], tracking: V2TrackingState) => {
  const applied = applyActionTrackingHistory(state, action, history);
  return { state: applied.state, history: applied.history, tracking: observeV2Action(tracking, state, action, applied.state) };
};

export default function StaticApp() {
  const [state, setState] = useState<GameState>(() => newGame());
  const [history, setHistory] = useState<RecentPlacement[]>([]);
  const [tracking, setTracking] = useState<V2TrackingState>(() => createV2Tracking(4));
  const [selectedHand, setSelectedHand] = useState<number | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number } | null>(null);
  const [message, setMessage] = useState("読み込み中…");
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const humanTurn = state.currentPlayerIndex === 0 && state.phase !== "game_over";

  const resetUi = useCallback(() => { setSelectedHand(null); setSelectedPosition(null); }, []);
  const reset = useCallback(() => {
    generation.current += 1; running.current = false; setThinking(false); setError(null);
    const next = newGame(); setState(next); setHistory([]); setTracking(createV2Tracking(4)); resetUi();
    setMessage("新しいゲームを開始しました。");
  }, [resetUi]);

  useEffect(() => {
    try { verifyModelContract(); warmAi(MODEL_ID); setMessage("ゲーム開始"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);

  useEffect(() => {
    if (humanTurn || state.phase === "game_over" || running.current || error) return;
    running.current = true;
    const token = generation.current;
    const initial = state;
    let nextState = state; let nextHistory = history; let nextTracking = tracking;
    setThinking(true); setMessage(`NPC ${state.currentPlayerIndex} が考えています…`);
    const run = async () => {
      try {
        while (token === generation.current && nextState.phase !== "game_over" && nextState.currentPlayerIndex !== 0) {
          const player = nextState.currentPlayerIndex;
          if (nextState.phase === "play" && nextState.cardsPlayedThisTurn === 0 && legalActions(nextState).some((a) => a.type === "place")) {
            const candidates = enumerateTurnCandidates(nextState, nextHistory);
            const best: TurnEvaluation = await selectBestTurn(candidates, player, nextState, nextTracking, nextHistory, MODEL_ID);
            const replayed = replayV2Actions(nextState, best.candidate.actions, nextTracking);
            nextState = best.candidate.state; nextHistory = best.candidate.history; nextTracking = replayed.tracking;
          } else {
            const action = chooseHeuristicAction(nextState);
            if (!action) throw new Error("CPUが合法手を選べませんでした。");
            const applied = applyTracked(nextState, action, nextHistory, nextTracking);
            nextState = applied.state; nextHistory = applied.history; nextTracking = applied.tracking;
          }
        }
        if (token !== generation.current) return;
        setState(nextState); setHistory(nextHistory); setTracking(nextTracking); setMessage("");
      } catch (cause) {
        if (token !== generation.current) return;
        setError(cause instanceof AiTimeoutError ? "AI推論がタイムアウトしました。もう一度リセットしてください。" : `AI推論に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
        setState(initial);
      } finally { if (token === generation.current) { running.current = false; setThinking(false); } }
    };
    void run();
  }, [state, history, tracking, humanTurn, error]);

  const human = state.players[0];
  const selectedCard = selectedHand === null ? null : human.hand[selectedHand];
  const legalPositionKeys = useMemo(() => selectedCard ? new Set(legalPositionsForCard(state.board, selectedCard).map(positionKey)) : new Set<string>(), [state.board, selectedCard]);
  const frameAnchorKeys = useMemo(() => {
    if (!selectedPosition) return new Set<string>();
    return new Set(framesContaining(selectedPosition).map(positionKey));
  }, [selectedPosition]);

  const choosePosition = (x: number, y: number) => { if (selectedHand !== null && legalPositionKeys.has(positionKey({ x, y }))) setSelectedPosition({ x, y }); };
  const chooseFrame = (x: number, y: number) => {
    if (selectedHand === null || !selectedPosition || !frameAnchorKeys.has(positionKey({ x, y }))) return;
    const action: PlaceCardAction = { type: "place", handIndex: selectedHand, position: selectedPosition, frame: { x, y } };
    if (!legalActions(state).some((candidate) => candidate.type === "place" && candidate.handIndex === action.handIndex && candidate.position.x === x && candidate.position.y === y && candidate.frame.x === x && candidate.frame.y === y)) {
      const valid = legalActions(state).find((candidate): candidate is PlaceCardAction => candidate.type === "place" && candidate.handIndex === action.handIndex && positionKey(candidate.position) === positionKey(action.position) && positionKey(candidate.frame) === positionKey(action.frame));
      if (!valid) return;
    }
    const applied = applyTracked(state, action, history, tracking);
    setState(applied.state); setHistory(applied.history); setTracking(applied.tracking); resetUi();
  };
  const act = (action: Action) => { const applied = applyTracked(state, action, history, tracking); setState(applied.state); setHistory(applied.history); setTracking(applied.tracking); resetUi(); };
  const endTurn = () => { if (legalActions(state).some((a) => a.type === "end_turn")) act({ type: "end_turn" }); };
  const refill = (source: "deck" | "negative_cards" | "none") => { if (refillActions(state).some((a) => a.source === source)) act({ type: "refill", source }); };

  return <main className="game-page">
    <header className="game-header"><div><p className="eyebrow">4 PLAYER GAME</p><h1>Yellowstone park</h1></div><div className="header-actions"><span>CPU 3体</span><span>{MODEL_LABEL}</span><button type="button" className="text-button" onClick={reset}>リセット</button></div></header>
    <section className="score-strip">{state.players.map((player, index) => <article key={index} className={state.currentPlayerIndex === index ? "active-player" : ""}><strong>{index === 0 ? "あなた" : `NPC ${index}`}</strong><span>失点 {player.lossScore}</span><span>手札 {player.hand.length}</span><span>マイナス {player.negativeCards.length}</span></article>)}</section>
    {message && <p className="notice">{message}</p>}{error && <section className="notice model-error"><strong>モデルエラー</strong><p>{error}</p><button type="button" className="primary" onClick={reset}>リセットして再試行</button></section>}
    {state.phase === "game_over" ? <section className="game-over"><p className="eyebrow">GAME OVER</p><h2>{state.winners.includes(0) ? "あなたの勝利です" : `NPC ${state.winners.join(", ")} の勝利です`}</h2><button type="button" className="primary" onClick={reset}>もう一度遊ぶ</button><button type="button" onClick={reset}>リセット</button></section> : <div className="game-layout"><section className="board-panel"><Board board={state.board} legalPositionKeys={humanTurn && !selectedPosition ? legalPositionKeys : new Set()} frameAnchorKeys={humanTurn && selectedPosition ? frameAnchorKeys : new Set()} onPositionClick={choosePosition} onFrameAnchorClick={chooseFrame} /></section><aside className="control-panel"><section><div className="section-title"><h2>あなたの手札</h2><span>{human.hand.length}枚</span></div><Hand cards={human.hand} selectedIndex={humanTurn ? selectedHand : null} disabled={!humanTurn || selectedPosition !== null} onSelect={(index) => { setSelectedHand(index); setSelectedPosition(null); }} /></section>{humanTurn && selectedHand !== null && <p className="notice">カードを置く位置、続いて3×3フレームを選んでください。</p>}{humanTurn && state.cardsPlayedThisTurn === 1 && <button type="button" className="primary" onClick={endTurn}>1枚で手番終了</button>}{humanTurn && state.phase === "refill" && refillActions(state).map((action) => <button type="button" key={action.source} onClick={() => refill(action.source)}>補充: {action.source === "deck" ? "山札" : action.source === "negative_cards" ? "マイナスカード" : "なし"}</button>)}{!humanTurn && <div className="turn-status"><span className={thinking ? "spinner" : ""} />CPUの手番です</div>}</aside></div>}
  </main>;
}
