import { applyKnownLegalAction } from "./game";
import {
  Action,
  Card,
  COLORS,
  GameState,
  HAND_SIZE,
  RecentPlacement,
  RefillAction,
} from "./types";
import {
  BOARD_CHANNELS,
  CONTEXT_SIZE,
  encodeCandidatesV1AtDecisionBoundary,
  encodeBoard,
  encodeContext,
  TurnCandidate,
} from "./value";
import { canonicalizeValueTensors } from "./valueCanonicalization";

export const BOARD_COLUMNS_V1_CHANNELS = 1;
export const BOARD_COLUMNS_V1_HEIGHT = 7;
export const BOARD_COLUMNS_V1_WIDTH = 3;
export const BOARD_COLUMNS_V1_LEFT_MARGIN_CLASSES = 5;
export const BOARD_COLUMNS_V1_CONTEXT_SIZE =
  CONTEXT_SIZE - 2 * 12 + BOARD_COLUMNS_V1_LEFT_MARGIN_CLASSES;
export const REFILL80_RECENT_CARD_LIMIT = 18;
export const REFILL80_UNORDERED_CONTEXT_SIZE =
  BOARD_COLUMNS_V1_CONTEXT_SIZE + 5 + 28 + 32;
export const CARD_INFORMATION_CONTEXT_SIZE = BOARD_COLUMNS_V1_CONTEXT_SIZE + 84;

const SOURCE_BOARD_RECORD_SIZE = BOARD_CHANNELS * 7 * 7;
const COMPACT_BOARD_RECORD_SIZE =
  BOARD_COLUMNS_V1_CHANNELS * BOARD_COLUMNS_V1_HEIGHT * BOARD_COLUMNS_V1_WIDTH;

const sourceBoardIndex = (
  record: number,
  channel: number,
  y: number,
  x: number,
): number => record * SOURCE_BOARD_RECORD_SIZE + (channel * 7 + y) * 7 + x;

const compactBoardIndex = (
  record: number,
  y: number,
  x: number,
): number => record * COMPACT_BOARD_RECORD_SIZE + y * BOARD_COLUMNS_V1_WIDTH + x;

const compactContextIndex = (record: number, offset: number): number =>
  record * BOARD_COLUMNS_V1_CONTEXT_SIZE + offset;

export const boardColumnsFromCanonicalV1Tensors = (
  sourceBoard: Float32Array,
  sourceContext: Float32Array,
): { board: Float32Array; context: Float32Array } => {
  if (sourceBoard.length % SOURCE_BOARD_RECORD_SIZE !== 0) {
    throw new Error(`board_columns_v1 board size mismatch: ${sourceBoard.length}`);
  }
  const records = sourceBoard.length / SOURCE_BOARD_RECORD_SIZE;
  if (sourceContext.length !== records * CONTEXT_SIZE) {
    throw new Error(
      `board_columns_v1 context size mismatch: ${sourceContext.length}`,
    );
  }

  const board = new Float32Array(records * COMPACT_BOARD_RECORD_SIZE);
  const context = new Float32Array(records * BOARD_COLUMNS_V1_CONTEXT_SIZE);
  const keptContext = CONTEXT_SIZE - 2 * 12;
  for (let record = 0; record < records; record += 1) {
    context.set(
      sourceContext.slice(
        record * CONTEXT_SIZE,
        record * CONTEXT_SIZE + keptContext,
      ),
      record * BOARD_COLUMNS_V1_CONTEXT_SIZE,
    );

    let left = 7;
    let right = -1;
    for (let x = 0; x < 7; x += 1) {
      let count = 0;
      for (let y = 0; y < 7; y += 1) {
        count += sourceBoard[sourceBoardIndex(record, 28, y, x)];
      }
      if (count > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    if (right < left) throw new Error("board_columns_v1 cannot encode an empty board");
    const width = right - left + 1;
    if (width > BOARD_COLUMNS_V1_WIDTH) {
      throw new Error(`board_columns_v1 occupied width exceeds 3: ${width}`);
    }
    if (left < 0 || left >= BOARD_COLUMNS_V1_LEFT_MARGIN_CLASSES) {
      throw new Error(`board_columns_v1 left margin out of range: ${left}`);
    }
    for (let y = 0; y < BOARD_COLUMNS_V1_HEIGHT; y += 1) {
      for (let x = 0; x < width; x += 1) {
        board[compactBoardIndex(record, y, x)] =
          sourceBoard[sourceBoardIndex(record, 28, y, left + x)];
      }
    }
    context[
      compactContextIndex(
        record,
        BOARD_COLUMNS_V1_CONTEXT_SIZE -
          BOARD_COLUMNS_V1_LEFT_MARGIN_CLASSES +
          left,
      )
    ] = 1;
  }
  return { board, context };
};

export const encodeCandidatesBoardColumnsV1 = (
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  _history: RecentPlacement[] = [],
): { board: Float32Array; context: Float32Array } => {
  const canonical = encodeCandidatesV1AtDecisionBoundary(
    candidates,
    viewer,
    turnStart,
  );
  return boardColumnsFromCanonicalV1Tensors(canonical.board, canonical.context);
};

const cardInformationState = (
  turnStart: GameState,
  actions: readonly Action[],
  proxyTwoCardNoRefillAsOneCard = false,
): GameState => {
  let state = turnStart;
  const shouldProxy =
    proxyTwoCardNoRefillAsOneCard &&
    actions.filter((action) => action.type === "place").length === 2 &&
    actions.some(
      (action) => action.type === "refill" && action.source === "none",
    );
  for (const action of actions) {
    // Training records stop at placement-immediate, including one-card turns.
    if (action.type === "refill" || action.type === "end_turn") {
      return shouldProxy
        ? { ...state, phase: "play", cardsPlayedThisTurn: 1 }
        : state;
    }
    state = applyKnownLegalAction(state, action);
  }
  return shouldProxy
    ? { ...state, phase: "play", cardsPlayedThisTurn: 1 }
    : state;
};

const cardTypeIndex = (card: Card): number =>
  COLORS.indexOf(card.color) * 7 + card.rankIndex;

const cardTypeCounts = (cards: readonly Card[]): number[] => {
  const counts = Array.from({ length: 28 }, () => 0);
  cards.forEach((card) => {
    counts[cardTypeIndex(card)] += 1;
  });
  return counts;
};

const boardCards = (state: GameState): Card[] =>
  Object.values(state.board).flat();

const normalizedCardInformation = (
  state: GameState,
  viewer: number,
  mode: "complete" | "negative_public" | "public",
): number[] => {
  const own = cardTypeCounts(state.players[viewer].hand);
  const board = cardTypeCounts(boardCards(state));
  const negative = cardTypeCounts(
    state.players.flatMap((player) => player.negativeCards),
  );
  const opponentSize = state.players.reduce(
    (sum, player, index) => sum + (index === viewer ? 0 : player.hand.length),
    0,
  );
  let deck: number[];
  let opponent: number[];
  if (mode === "complete") {
    deck = cardTypeCounts(state.deck);
    opponent = cardTypeCounts(
      state.players.flatMap((player, index) =>
        index === viewer ? [] : player.hand,
      ),
    );
  } else if (mode === "negative_public") {
    const denominator = state.deck.length + opponentSize;
    deck = Array.from({ length: 28 }, (_, index) => {
      const remaining = Math.max(
        0,
        2 - own[index] - board[index] - negative[index],
      );
      return denominator ? (remaining * state.deck.length) / denominator : 0;
    });
    opponent = Array.from({ length: 28 }, (_, index) => {
      const remaining = Math.max(
        0,
        2 - own[index] - board[index] - negative[index],
      );
      return denominator ? (remaining * opponentSize) / denominator : 0;
    });
  } else {
    // Public belief: negative-card identities remain hidden; only zone sizes
    // are used to distribute the remaining card-type mass.
    const negativeSize = state.players.reduce(
      (sum, player) => sum + player.negativeCards.length,
      0,
    );
    const denominator = state.deck.length + negativeSize + opponentSize;
    const remainingByType = Array.from({ length: 28 }, (_, index) =>
      Math.max(0, 2 - own[index] - board[index]),
    );
    deck = remainingByType.map((remaining) =>
      denominator ? (remaining * state.deck.length) / denominator : 0,
    );
    const negativeExpected = remainingByType.map((remaining) =>
      denominator ? (remaining * negativeSize) / denominator : 0,
    );
    opponent = remainingByType.map((remaining) =>
      denominator ? (remaining * opponentSize) / denominator : 0,
    );
    return [
      ...deck,
      ...negativeExpected.map((value, index) => value + board[index]),
      ...opponent,
    ].map((value) => value / 2);
  }
  return [
    ...deck,
    ...negative.map((value, index) => value + board[index]),
    ...opponent,
  ].map((value) => value / 2);
};

export const encodeCandidatesBoardColumnsV1CardInformation = (
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  mode: "complete" | "negative_public" | "public",
  proxyTwoCardNoRefillAsOneCard = false,
  publicInformation?: readonly (readonly number[])[],
): { board: Float32Array; context: Float32Array } => {
  const sourceBoard = new Float32Array(
    candidates.length * BOARD_CHANNELS * 7 * 7,
  );
  const sourceContext = new Float32Array(candidates.length * CONTEXT_SIZE);
  candidates.forEach((candidate, index) => {
    const state = cardInformationState(
      turnStart,
      candidate.actions,
      proxyTwoCardNoRefillAsOneCard,
    );
    sourceBoard.set(encodeBoard(state), index * BOARD_CHANNELS * 7 * 7);
    sourceContext.set(
      encodeContext(state, viewer, candidate.history),
      index * CONTEXT_SIZE,
    );
  });
  const canonical = canonicalizeValueTensors(sourceBoard, sourceContext);
  const compact = boardColumnsFromCanonicalV1Tensors(
    canonical.board,
    canonical.context,
  );
  const context = new Float32Array(
    candidates.length * CARD_INFORMATION_CONTEXT_SIZE,
  );
  candidates.forEach((candidate, index) => {
    const state = cardInformationState(
      turnStart,
      candidate.actions,
      proxyTwoCardNoRefillAsOneCard,
    );
    const offset = index * CARD_INFORMATION_CONTEXT_SIZE;
    context.set(
      compact.context.slice(
        index * BOARD_COLUMNS_V1_CONTEXT_SIZE,
        (index + 1) * BOARD_COLUMNS_V1_CONTEXT_SIZE,
      ),
      offset,
    );
    context.set(
      publicInformation?.[index] ??
        normalizedCardInformation(state, viewer, mode),
      offset + BOARD_COLUMNS_V1_CONTEXT_SIZE,
    );
  });
  return { board: compact.board, context };
};

const refillSourceIndex = (source: RefillAction["source"] | "no_pending"): number =>
  ["no_pending", "none", "deck", "negative_cards"].indexOf(source);

const refillCount = (state: GameState, source: RefillAction["source"]): number => {
  if (source === "none") return 0;
  const player = state.players[state.currentPlayerIndex];
  const needed = Math.max(0, HAND_SIZE - player.hand.length);
  if (source === "deck") return Math.min(needed, state.deck.length);
  return Math.min(needed, player.negativeCards.length);
};

const appendPlacementHistory = (
  history: RecentPlacement[],
  before: GameState,
  after: GameState,
  action: Extract<Action, { type: "place" }>,
): RecentPlacement[] => {
  const playerIndex = before.currentPlayerIndex;
  const card = before.players[playerIndex].hand[action.handIndex];
  return [...history, {
    playerIndex,
    card,
    scoreDelta: before.players[playerIndex].lossScore - after.players[playerIndex].lossScore,
    negativeCardDelta:
      after.players[playerIndex].negativeCards.length -
      before.players[playerIndex].negativeCards.length,
  }].slice(-REFILL80_RECENT_CARD_LIMIT);
};

const stateBeforeRefill = (
  turnStart: GameState,
  actions: readonly Action[],
  history: readonly RecentPlacement[],
) => {
  let state = turnStart;
  let nextHistory = [...history].slice(-REFILL80_RECENT_CARD_LIMIT);
  for (const action of actions) {
    if (action.type === "refill") {
      return {
        state,
        history: nextHistory,
        refillSource: action.source,
        refillCount: refillCount(state, action.source),
      };
    }
    const after = applyKnownLegalAction(state, action);
    if (action.type === "place") nextHistory = appendPlacementHistory(nextHistory, state, after, action);
    state = after;
  }
  return { state, history: nextHistory, refillSource: "no_pending" as const, refillCount: 0 };
};

const isTwoCardNoRefillCandidate = (candidate: TurnCandidate): boolean =>
  candidate.actions.filter((action) => action.type === "place").length === 2 &&
  candidate.actions.some(
    (action) => action.type === "refill" && action.source === "none",
  );

export const encodeCandidatesBoardColumnsV1Refill80Unordered = (
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  history: RecentPlacement[] = [],
  proxyTwoCardNoRefillAsOneCard = false,
): { board: Float32Array; context: Float32Array } => {
  const handSize = turnStart.players[turnStart.currentPlayerIndex].hand.length;
  const records = candidates.map((candidate) => {
    const record = stateBeforeRefill(turnStart, candidate.actions, history);
    if (
      proxyTwoCardNoRefillAsOneCard &&
      isTwoCardNoRefillCandidate(candidate)
    ) {
      record.state = {
        ...record.state,
        phase: "play",
        cardsPlayedThisTurn: 1,
      };
    }
    return record;
  });
  const sourceBoard = new Float32Array(candidates.length * BOARD_CHANNELS * 7 * 7);
  const sourceContext = new Float32Array(candidates.length * CONTEXT_SIZE);
  records.forEach((record, index) => {
    sourceBoard.set(encodeBoard(record.state), index * BOARD_CHANNELS * 7 * 7);
    sourceContext.set(
      encodeContext(record.state, viewer, record.history),
      index * CONTEXT_SIZE,
    );
  });
  const canonical = canonicalizeValueTensors(sourceBoard, sourceContext);
  const compact = boardColumnsFromCanonicalV1Tensors(canonical.board, canonical.context);
  const context = new Float32Array(candidates.length * REFILL80_UNORDERED_CONTEXT_SIZE);
  records.forEach((record, index) => {
    const base = index * REFILL80_UNORDERED_CONTEXT_SIZE;
    context.set(
      compact.context.slice(
        index * BOARD_COLUMNS_V1_CONTEXT_SIZE,
        (index + 1) * BOARD_COLUMNS_V1_CONTEXT_SIZE,
      ),
      base,
    );
    const source = refillSourceIndex(record.refillSource);
    if (source < 0) throw new Error(`unknown refill source: ${record.refillSource}`);
    let offset = base + BOARD_COLUMNS_V1_CONTEXT_SIZE;
    context[offset + source] = 1;
    context[offset + 4] = record.refillCount / 6;
    offset += 5;
    record.state.players[viewer].negativeCards.forEach((card) => {
      context[offset + COLORS.indexOf(card.color) * 7 + card.rankIndex] += 0.5;
    });
    offset += 28;
    record.history.slice(-REFILL80_RECENT_CARD_LIMIT).forEach((placement) => {
      context[offset + COLORS.indexOf(placement.card.color) * 7 + placement.card.rankIndex] +=
        1 / REFILL80_RECENT_CARD_LIMIT;
      context[offset + 28 + ((placement.playerIndex - viewer + 4) % 4)] +=
        1 / REFILL80_RECENT_CARD_LIMIT;
    });
  });
  return { board: compact.board, context };
};

