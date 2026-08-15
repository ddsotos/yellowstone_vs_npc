import metadata from "../public/models/registry.json";

export const MODEL_ID = "card-information-gated-branch-350k-public-epoch002-pct100" as const;
export const MODEL_LABEL = "Card information gated branch 350k public epoch002 pct100";

export const verifyModelContract = (): void => {
  const entry = metadata.models.length === 1 ? metadata.models[0] : undefined;
  if (!entry || entry.id !== MODEL_ID || entry.modelPath !== `models/${MODEL_ID}.onnx`) {
    throw new Error("公開モデルmetadataが指定モデルと一致しません。");
  }
  if (entry.valueSchema !== "yellowstone.value.card_information.v1" ||
      entry.inputCanonicalization !== "fast_lr_ud_color_v1_card_information_branch" ||
      entry.historySemantics !== "none" || entry.contextSize !== 146) {
    throw new Error("公開モデルの入力契約を検証できません。");
  }
};
