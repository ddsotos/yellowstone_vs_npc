import { useEffect } from "react";
import StaticApp from "./StaticApp";

const replacements: Array<[string, string]> = [
  ["遊び方", "How to play"], ["AIに任せるを停止", "Stop AI autoplay"], ["AIに任せる", "Let AI play"], ["リセット", "Reset"], ["CPU 3体", "3 CPUs"],
  ["あなた", "You"], ["失点", "Penalty"], ["手札", "Hand"], ["マイナス", "Penalty cards"], ["あなたの手", "Your hand"], ["CPUの手番です", "CPU turn"], ["AIが考えています…", "AI is thinking…"], ["AIが対局を進行中です…", "AI is playing…"],
  ["3×3枠を自動設定", "Auto-set 3×3 frame"], ["勝率計算", "Win-rate calculation"], ["AI上位3候補", "Top 3 AI candidates"], ["候補を選ぶと盤面と失点表示をプレビューします。", "Select a candidate to preview the board and penalties."], ["表示中の手でプレイ", "Play this move"], ["自分の手を選び直す", "Choose my move again"], ["1枚で手番を終了", "End turn with one card"],
  ["山札から補充", "Draw from deck"], ["補充しない", "Draw no cards"], ["マイナスから補充", "Draw from penalties"], ["ゲーム終了", "Game over"], ["もう一度遊ぶ", "Play again"], ["直近なし / 受取失点0枚", "No recent move / 0 penalties received"], ["山札", "Deck"], ["決算", "Scoring"], ["補充方法", "Refill method"], ["ボーナス", "Bonus"], ["同じカード", "Same cards"], ["失点カード", "Penalty cards"],
];

function translate(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    let value = node.nodeValue ?? "";
    replacements.slice().sort((left, right) => right[0].length - left[0].length).forEach(([from, to]) => { value = value.split(from).join(to); });
    if (value !== node.nodeValue) node.nodeValue = value;
  });
  document.querySelectorAll(".card-color").forEach((element) => {
    const colors: Record<string, string> = { "青": "Blue", "赤": "Red", "緑": "Green", "黄": "Yellow" };
    const translated = colors[element.textContent?.trim() ?? ""];
    if (translated) element.textContent = translated;
  });
  document.querySelectorAll(".last-turn").forEach((element) => {
    let value = element.textContent ?? "";
    if (value.includes("直近")) value = value.replace("直近 なし / 受取Penalty 0枚", "No recent action / Penalty received: 0 cards");
    value = value.replace("直近 ", "Recent: ").replaceAll("青", "Blue").replaceAll("赤", "Red").replaceAll("緑", "Green").replaceAll("黄", "Yellow").replaceAll("・", ", ").replace(" / 受取Penalty ", " / Penalty received: ").replaceAll("枚", " cards");
    value = value.replace(/Penalty received: (\d+) cards/, (_match, count: string) => `Penalty received: ${count} ${count === "1" ? "card" : "cards"}`);
    if (value !== element.textContent) element.textContent = value;
  });
}

export default function EnglishApp() {
  useEffect(() => {
    const apply = () => translate(document.getElementById("root") ?? document.body);
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return <StaticApp />;
}
