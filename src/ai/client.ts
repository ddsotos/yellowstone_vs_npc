import {
  candidateGroupSignature,
  candidateRefillDecision,
  playedCardsSignature,
  TurnCandidate,
  TurnEvaluation,
} from "../game/value";
import { GameState, RecentPlacement } from "../game/types";
import {
  encodeCandidatesBoardColumnsV1,
  encodeCandidatesBoardColumnsV1CardInformation,
  encodeCandidatesBoardColumnsV1Refill80Unordered,
} from "../game/valueBoardColumns";
import { V2TrackingState } from "../game/v2Tracking";
import { chooseHeuristicAction } from "../game/bot";
import { applyKnownLegalAction } from "../game/game";
import {
  candidatePublicInformation,
  createPublicCardBelief,
} from "../game/cardInformation";

const TIMEOUT_MS = 30_000;
let worker: Worker | null = null;
let requestId = 0;

export type ModelId =
  | "card-information-gated-branch-350k-public-epoch002-pct100";
export const HEURISTIC_MODEL_ID = "heuristic-always-greedy" as const;
export type CpuModelId = ModelId | typeof HEURISTIC_MODEL_ID;
export const HEURISTIC_MODEL_LABEL = "Heuristic (always greedy)";
export type ScoreKind = "probability" | "delta";
type EncoderKind =
  | "board_columns_v1"
  | "board_columns_v1_refill80_unordered"
  | "board_columns_v1_card_information_complete"
  | "board_columns_v1_card_information_negative_public"
  | "board_columns_v1_card_information_public";

export interface ModelSpec {
  id: ModelId;
  label: string;
  boardChannels: number;
  boardSize?: number;
  boardHeight?: number;
  boardWidth?: number;
  contextSize: number;
  scoreKind: ScoreKind;
  outputTransform: "sigmoid" | "identity" | "softmax_player0";
  encoder: EncoderKind;
  grouping: "cards" | "cards_refill";
  modelPath?: string;
  valueRefillChoice?: boolean;
  proxyTwoCardNoRefillAsOneCard?: boolean;
  deckExhaustionWinnerOverride?: boolean;
}

export const MODEL_SPECS: readonly ModelSpec[] = [
  {
    id: "card-information-gated-branch-350k-public-epoch002-pct100",
    label: "Card information gated branch 350k public epoch002 pct100",
    boardChannels: 1,
    boardHeight: 7,
    boardWidth: 3,
    contextSize: 146,
    scoreKind: "probability",
    outputTransform: "sigmoid",
    encoder: "board_columns_v1_card_information_public",
    grouping: "cards",
    valueRefillChoice: false,
    proxyTwoCardNoRefillAsOneCard: false,
    deckExhaustionWinnerOverride: false,
  },
] as const;

export const PLAYABLE_MODEL_SPECS = MODEL_SPECS;

export interface ModelAnalysis {
  spec: ModelSpec;
  status: "ok" | "error";
  own?: TurnEvaluation;
  top: TurnEvaluation[];
  all: TurnEvaluation[];
  error?: string;
}

const createWorker = (): Worker =>
  new Worker(`${import.meta.env.BASE_URL}ai-worker.js`);

export class AiTimeoutError extends Error {}

const modelUrl = (spec: ModelSpec): string =>
  new URL(
    `${import.meta.env.BASE_URL}${spec.modelPath ?? `models/${spec.id}.onnx`}`,
    window.location.href,
  ).href;

const activeWorker = (): Worker => {
  worker ??= createWorker();
  return worker;
};

const isNoRefillCandidate = (candidate: TurnCandidate): boolean =>
  candidate.actions.some(
    (action) => action.type === "refill" && action.source === "none",
  );

const isTwoCardNoRefillCandidate = (candidate: TurnCandidate): boolean =>
  candidate.actions.filter((action) => action.type === "place").length === 2 &&
  isNoRefillCandidate(candidate);

const isCardInformationBranch = (spec: ModelSpec): boolean =>
  spec.encoder === "board_columns_v1_card_information_complete" ||
  spec.encoder === "board_columns_v1_card_information_negative_public" ||
  spec.encoder === "board_columns_v1_card_information_public";

const isTerminalDeckRefillCandidate = (candidate: TurnCandidate): boolean =>
  candidate.state.phase === "game_over" &&
  candidate.actions.some(
    (action) => action.type === "refill" && action.source === "deck",
  );

const refillSourceBeforeCandidate = (
  turnStart: GameState,
  candidate: TurnCandidate,
): string | null => {
  const refillIndex = candidate.actions.findIndex(
    (action) => action.type === "refill",
  );
  if (refillIndex < 0) return null;
  let state = turnStart;
  for (const action of candidate.actions.slice(0, refillIndex)) {
    state = applyKnownLegalAction(state, action);
  }
  const heuristic = chooseHeuristicAction(state);
  return heuristic?.type === "refill" ? heuristic.source : null;
};

const candidatesWithHeuristicRefillAndEndgame = (
  candidates: TurnCandidate[],
  turnStart: GameState,
): TurnCandidate[] => {
  const byPlayedCards = new Map<string, TurnCandidate[]>();
  candidates.forEach((candidate) => {
    const key = playedCardsSignature(turnStart, candidate.actions);
    byPlayedCards.set(key, [...(byPlayedCards.get(key) ?? []), candidate]);
  });
  const selected: TurnCandidate[] = [];
  byPlayedCards.forEach((group) => {
    const terminal = group.filter(isTerminalDeckRefillCandidate);
    const ordinary = group.filter(
      (candidate) =>
        !isTerminalDeckRefillCandidate(candidate) &&
        (!candidate.actions.some((action) => action.type === "refill") ||
          refillSourceBeforeCandidate(turnStart, candidate) ===
            candidateRefillDecision(candidate.actions)),
    );
    selected.push(...ordinary);
    selected.push(...terminal);
  });
  return selected;
};

export const candidatesForModel = (
  spec: ModelSpec,
  candidates: TurnCandidate[],
  turnStart: GameState,
): TurnCandidate[] => {
  const refillCandidates = isCardInformationBranch(spec) && !spec.valueRefillChoice
    ? candidatesWithHeuristicRefillAndEndgame(candidates, turnStart)
    : candidates;
  return spec.proxyTwoCardNoRefillAsOneCard && !spec.valueRefillChoice
      ? refillCandidates.filter(
          (candidate) =>
            !isNoRefillCandidate(candidate) ||
            isTwoCardNoRefillCandidate(candidate),
        )
      : refillCandidates;
};

const tensorsFor = (
  spec: ModelSpec,
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[],
) => {
  if (spec.encoder === "board_columns_v1") {
    return encodeCandidatesBoardColumnsV1(candidates, viewer, turnStart, history);
  }
  if (spec.encoder === "board_columns_v1_refill80_unordered") {
    return encodeCandidatesBoardColumnsV1Refill80Unordered(
      candidates,
      viewer,
      turnStart,
      history,
      Boolean(spec.proxyTwoCardNoRefillAsOneCard),
    );
  }
  if (spec.encoder === "board_columns_v1_card_information_complete") {
    return encodeCandidatesBoardColumnsV1CardInformation(
      candidates,
      viewer,
      turnStart,
      "complete",
      Boolean(spec.proxyTwoCardNoRefillAsOneCard),
    );
  }
  if (spec.encoder === "board_columns_v1_card_information_negative_public") {
    return encodeCandidatesBoardColumnsV1CardInformation(
      candidates,
      viewer,
      turnStart,
      "negative_public",
      Boolean(spec.proxyTwoCardNoRefillAsOneCard),
    );
  }
  if (spec.encoder === "board_columns_v1_card_information_public") {
    const belief = tracking.cardInformationBeliefs?.[viewer] ??
      createPublicCardBelief(turnStart, viewer);
    return encodeCandidatesBoardColumnsV1CardInformation(
      candidates,
      viewer,
      turnStart,
      "public",
      Boolean(spec.proxyTwoCardNoRefillAsOneCard),
      candidates.map((candidate) =>
        candidatePublicInformation(
          belief,
          turnStart,
          candidate.actions,
        ),
      ),
    );
  }
  throw new Error(`unsupported encoder: ${spec.encoder}`);
};

const infer = async (
  spec: ModelSpec,
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[],
): Promise<TurnEvaluation[]> => {
  if (!candidates.length) return [];
  const active = activeWorker();
  const id = ++requestId;
  const { board, context } = tensorsFor(
    spec,
    candidates,
    viewer,
    turnStart,
    tracking,
    history,
  );
  return new Promise<TurnEvaluation[]>((resolve, reject) => {
    const cleanup = () => active.removeEventListener("message", onMessage);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new AiTimeoutError(`${spec.label} inference exceeded 30 seconds`));
    }, TIMEOUT_MS);
    const onMessage = (
      event: MessageEvent<{ id: number; scores?: ArrayBuffer; error?: string }>,
    ) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      cleanup();
      if (event.data.error || !event.data.scores) {
        reject(new Error(event.data.error ?? `${spec.label} inference failed`));
        return;
      }
      const scores = new Float32Array(event.data.scores);
      resolve(
        candidates.map((candidate, index) => ({
          candidate,
          probability: scores[index],
        })),
      );
    };
    active.addEventListener("message", onMessage);
    active.postMessage(
      {
        type: "infer",
        id,
        modelUrl: modelUrl(spec),
        count: candidates.length,
        boardChannels: spec.boardChannels,
        boardSize: spec.boardSize ?? 7,
        boardHeight: spec.boardHeight ?? spec.boardSize ?? 7,
        boardWidth: spec.boardWidth ?? spec.boardSize ?? 7,
        contextSize: spec.contextSize,
        outputTransform: spec.outputTransform,
        board: board.buffer,
        context: context.buffer,
      },
      [board.buffer, context.buffer],
    );
  });
};

const deckExhaustionWinnerProbability = (
  candidate: TurnCandidate,
  viewer: number,
): number | null => {
  const usesDeckRefill = candidate.actions.some(
    (action) => action.type === "refill" && action.source === "deck",
  );
  if (!usesDeckRefill || candidate.state.phase !== "game_over") return null;
  const winners = candidate.state.winners;
  if (!winners.length) return null;
  return winners.includes(viewer) ? 1 / winners.length : 0;
};

const inferWithPolicyOverrides = async (
  spec: ModelSpec,
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[],
): Promise<TurnEvaluation[]> => {
  if (!spec.deckExhaustionWinnerOverride) {
    return infer(spec, candidates, viewer, turnStart, tracking, history);
  }
  const exact = new Map<TurnCandidate, number>();
  const modelCandidates: TurnCandidate[] = [];
  candidates.forEach((candidate) => {
    const probability = deckExhaustionWinnerProbability(candidate, viewer);
    if (probability === null) modelCandidates.push(candidate);
    else exact.set(candidate, probability);
  });
  const modelEvaluations = await infer(
    spec,
    modelCandidates,
    viewer,
    turnStart,
    tracking,
    history,
  );
  let modelIndex = 0;
  return candidates.map((candidate) => {
    const probability = exact.get(candidate);
    if (probability !== undefined) return { candidate, probability };
    return modelEvaluations[modelIndex++];
  });
};

const topFor = (
  spec: ModelSpec,
  turnStart: GameState,
  evaluations: TurnEvaluation[],
  limit = 3,
): TurnEvaluation[] => {
  const groups = new Map<string, TurnEvaluation>();
  evaluations.forEach((evaluation) => {
    const signature =
      spec.grouping === "cards_refill"
        ? candidateGroupSignature(turnStart, evaluation.candidate.actions)
        : playedCardsSignature(turnStart, evaluation.candidate.actions);
    const previous = groups.get(signature);
    if (!previous || evaluation.probability > previous.probability) {
      groups.set(signature, evaluation);
    }
  });
  return [...groups.entries()]
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        right.probability - left.probability ||
        leftKey.localeCompare(rightKey),
    )
    .slice(0, limit)
    .map(([, evaluation]) => evaluation);
};

export const evaluateAllModels = async (
  candidates: TurnCandidate[],
  ownCandidate: TurnCandidate,
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[],
  modelIds: readonly ModelId[] = MODEL_SPECS.map((spec) => spec.id),
): Promise<ModelAnalysis[]> => {
  const results: ModelAnalysis[] = [];
  for (const spec of MODEL_SPECS.filter((value) => modelIds.includes(value.id))) {
    try {
      const evaluatedCandidates = [
        ...candidatesForModel(spec, candidates, turnStart),
        ownCandidate,
      ];
      const evaluations = await inferWithPolicyOverrides(
          spec,
          evaluatedCandidates,
          viewer,
          turnStart,
          tracking,
          history,
        );
      const own = evaluations.at(-1);
      if (!own) throw new Error("own move could not be evaluated");
      const all = evaluations.slice(0, -1);
      results.push({
        spec,
        status: "ok",
        own,
        top: topFor(spec, turnStart, all),
        all,
      });
    } catch (error) {
      results.push({
        spec,
        status: "error",
        top: [],
        all: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};

const DEFAULT_PLAY_MODEL = MODEL_SPECS[0];
export const warmAi = (modelId: ModelId = DEFAULT_PLAY_MODEL.id): void => {
  const active = activeWorker();
  const spec = MODEL_SPECS.find((value) => value.id === modelId) ?? DEFAULT_PLAY_MODEL;
  active.postMessage({
    type: "init",
    id: ++requestId,
    modelUrl: modelUrl(spec),
  });
};

export const evaluateCandidates = (
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[] = [],
  modelId: ModelId = DEFAULT_PLAY_MODEL.id,
): Promise<TurnEvaluation[]> =>
  (() => {
    const spec = MODEL_SPECS.find((value) => value.id === modelId) ?? DEFAULT_PLAY_MODEL;
    return inferWithPolicyOverrides(
      spec,
      candidatesForModel(spec, candidates, turnStart),
      viewer,
      turnStart,
      tracking,
      history,
    );
  })();

export const selectBestTurn = async (
  candidates: TurnCandidate[],
  viewer: number,
  turnStart: GameState,
  tracking: V2TrackingState,
  history: RecentPlacement[] = [],
  modelId: ModelId = DEFAULT_PLAY_MODEL.id,
): Promise<TurnEvaluation> => {
  const evaluations = await evaluateCandidates(
    candidates,
    viewer,
    turnStart,
    tracking,
    history,
    modelId,
  );
  if (!evaluations.length) throw new Error("no candidate moves can be evaluated");
  return evaluations.reduce((best, current) =>
    current.probability > best.probability ? current : best,
  );
};
