import { applyKnownLegalAction } from "./game";
import { Action, Card, COLORS, GameState } from "./types";

const CARD_TYPE_COUNT = 28;
const COPIES_PER_TYPE = 2;

export interface PublicCardBelief {
  viewer: number;
  deck: number[];
  negative: number[];
  opponent: number[];
}

const cardTypeIndex = (card: Card): number =>
  COLORS.indexOf(card.color) * 7 + card.rankIndex;

const cardTypeCounts = (cards: readonly Card[]): number[] => {
  const result = Array.from({ length: CARD_TYPE_COUNT }, () => 0);
  cards.forEach((card) => {
    result[cardTypeIndex(card)] += 1;
  });
  return result;
};

const boardCards = (state: GameState): Card[] =>
  Object.values(state.board).flat();

const add = (left: readonly number[], right: readonly number[]): number[] =>
  left.map((value, index) => value + right[index]);

const subtract = (
  left: readonly number[],
  right: readonly number[],
): number[] => left.map((value, index) => value - right[index]);

const scale = (values: readonly number[], factor: number): number[] =>
  values.map((value) => value * factor);

const partitionBySizes = (
  remaining: readonly number[],
  deckSize: number,
  negativeSize: number,
  opponentSize: number,
): [number[], number[], number[]] => {
  const values = remaining.map((value) => Math.max(0, value));
  const total = deckSize + negativeSize + opponentSize;
  if (total <= 0) {
    const zeros = Array.from({ length: CARD_TYPE_COUNT }, () => 0);
    return [[...zeros], [...zeros], [...zeros]];
  }
  return [
    scale(values, deckSize / total),
    scale(values, negativeSize / total),
    scale(values, opponentSize / total),
  ];
};

export const createPublicCardBelief = (
  state: GameState,
  viewer: number,
): PublicCardBelief => {
  const own = cardTypeCounts(state.players[viewer].hand);
  const board = cardTypeCounts(boardCards(state));
  const remaining = own.map(
    (value, index) => COPIES_PER_TYPE - value - board[index],
  );
  const opponentSize = state.players.reduce(
    (sum, player, index) => sum + (index === viewer ? 0 : player.hand.length),
    0,
  );
  const [deck, negative, opponent] = partitionBySizes(
    remaining,
    state.deck.length,
    0,
    opponentSize,
  );
  return { viewer, deck, negative, opponent };
};

export const createPublicCardBeliefs = (
  state: GameState,
): PublicCardBelief[] =>
  state.players.map((_, viewer) => createPublicCardBelief(state, viewer));

export const clonePublicCardBelief = (
  belief: PublicCardBelief,
): PublicCardBelief => ({
  viewer: belief.viewer,
  deck: [...belief.deck],
  negative: [...belief.negative],
  opponent: [...belief.opponent],
});

const updateUnknownDraw = (
  values: readonly number[],
  deckSize: number,
  drawCount: number,
): number[] =>
  deckSize ? scale(values, (deckSize - drawCount) / deckSize) :
    Array.from({ length: CARD_TYPE_COUNT }, () => 0);

const observePlace = (
  belief: PublicCardBelief,
  before: GameState,
  action: Extract<Action, { type: "place" }>,
  after: GameState,
): void => {
  const card = before.players[before.currentPlayerIndex].hand[action.handIndex];
  const boardBefore = cardTypeCounts(boardCards(before));
  const boardAfter = cardTypeCounts(boardCards(after));
  const movedToNegative = boardBefore.map((value, index) =>
    Math.max(0, value - boardAfter[index]),
  );
  if (after.settlementCount > before.settlementCount) {
    movedToNegative[cardTypeIndex(card)] += 1;
  }
  belief.negative = add(belief.negative, movedToNegative);

  if (before.currentPlayerIndex !== belief.viewer) {
    const remaining = [...belief.opponent];
    const index = cardTypeIndex(card);
    remaining[index] = Math.max(0, remaining[index] - 1);
    const opponentSizeAfter = after.players.reduce(
      (sum, player, playerIndex) =>
        sum + (playerIndex === belief.viewer ? 0 : player.hand.length),
      0,
    );
    const total = remaining.reduce((sum, value) => sum + value, 0);
    belief.opponent = opponentSizeAfter > 0 && total > 0
      ? scale(remaining, opponentSizeAfter / total)
      : Array.from({ length: CARD_TYPE_COUNT }, () => 0);
  }
};

const removeKnownFromDeck = (
  belief: PublicCardBelief,
  drawn: readonly number[],
  deckSizeAfter: number,
): void => {
  const remaining = belief.deck.map((value, index) =>
    Math.max(0, value - drawn[index]),
  );
  const total = remaining.reduce((sum, value) => sum + value, 0);
  belief.deck = deckSizeAfter > 0 && total > 0
    ? scale(remaining, deckSizeAfter / total)
    : Array.from({ length: CARD_TYPE_COUNT }, () => 0);
};

const observeRefill = (
  belief: PublicCardBelief,
  before: GameState,
  action: Extract<Action, { type: "refill" }>,
  after: GameState,
): void => {
  const actor = before.currentPlayerIndex;
  const negativeBeforeSettlement = [...belief.negative];
  const handBefore = before.players[actor].hand;
  const handAfter = after.players[actor].hand;
  const drawCount = Math.max(0, handAfter.length - handBefore.length);
  if (action.source === "deck" && drawCount) {
    if (actor === belief.viewer) {
      const drawn = subtract(
        cardTypeCounts(handAfter),
        cardTypeCounts(handBefore),
      );
      removeKnownFromDeck(belief, drawn, after.deck.length);
    } else {
      const retained = updateUnknownDraw(
        belief.deck,
        before.deck.length,
        drawCount,
      );
      const drawn = subtract(belief.deck, retained);
      belief.deck = retained;
      belief.opponent = add(belief.opponent, drawn);
    }
  } else if (action.source === "negative_cards" && drawCount) {
    const total = belief.negative.reduce((sum, value) => sum + value, 0);
    const factor = total
      ? Math.max(0, Math.min(1, (total - drawCount) / total))
      : 0;
    const retained = scale(belief.negative, factor);
    const drawn = subtract(belief.negative, retained);
    belief.negative = retained;
    if (actor !== belief.viewer) {
      belief.opponent = add(belief.opponent, drawn);
    }
  }
  if (after.settlementCount > before.settlementCount) {
    belief.deck = negativeBeforeSettlement;
    belief.negative = Array.from({ length: CARD_TYPE_COUNT }, () => 0);
  }
};

export const observePublicCardBeliefs = (
  beliefs: readonly PublicCardBelief[],
  before: GameState,
  action: Action,
  after: GameState,
): PublicCardBelief[] =>
  beliefs.map((source) => {
    const belief = clonePublicCardBelief(source);
    if (action.type === "place") observePlace(belief, before, action, after);
    if (action.type === "refill") observeRefill(belief, before, action, after);
    return belief;
  });

export const publicInformationFromBelief = (
  belief: PublicCardBelief,
  state: GameState,
): number[] => {
  const board = cardTypeCounts(boardCards(state));
  return [
    ...belief.deck,
    ...belief.negative.map((value, index) => value + board[index]),
    ...belief.opponent,
  ].map((value) => value / COPIES_PER_TYPE);
};

export const candidatePublicInformation = (
  source: PublicCardBelief,
  turnStart: GameState,
  actions: readonly Action[],
): number[] => {
  let belief = clonePublicCardBelief(source);
  let state = turnStart;
  for (const action of actions) {
    if (action.type === "end_turn" || action.type === "refill") break;
    const after = applyKnownLegalAction(state, action);
    [belief] = observePublicCardBeliefs([belief], state, action, after);
    state = after;
  }
  return publicInformationFromBelief(belief, state);
};
