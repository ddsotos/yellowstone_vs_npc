type TutorialProps = { onBack: () => void };

const tutorialImage = (name: string) => `${import.meta.env.BASE_URL}tutorial/${name}`;

function TutorialFigure({ name, alt, caption }: { name: string; alt: string; caption: string }) {
  return <figure className="tutorial-figure"><img src={tutorialImage(name)} alt={alt} /><figcaption>{caption}</figcaption></figure>;
}

export default function Tutorial({ onBack }: TutorialProps) {
  return (
    <main className="tutorial-page">
      <header className="tutorial-header"><div><p className="eyebrow">HOW TO PLAY</p><h1>Yellowstone Park 遊び方</h1><p className="tutorial-lead">動物カードをルールに沿って並べ、失点を減らしながら、最も少ない失点を目指します。</p></div><button type="button" className="primary tutorial-back" onClick={onBack}>ゲームに戻る</button></header>

      <section className="tutorial-section tutorial-hero"><div><p className="eyebrow">FIRST LOOK</p><h2>画面の見方</h2><p>上部には4人の失点、手札枚数、マイナスカード枚数、直前の行動が表示されます。中央が盤面、右側が現在のプレイヤーの操作エリアです。</p><p>この公開版は、あなた1人とCPU 3体で遊ぶ4人戦です。</p></div><TutorialFigure name="game-overview.png" alt="ゲーム画面の全体像" caption="ゲーム画面：スコア、盤面、手札と操作が一画面に表示されます。" /></section>

      <section className="tutorial-section"><p className="eyebrow">OBJECTIVE</p><h2>目的と準備</h2><div className="tutorial-grid"><article className="tutorial-rule"><span>1</span><div><h3>カードを配る</h3><p>各プレイヤーは手札6枚で開始し、残りのカードは山札になります。山札の最初のカードを盤面中央付近に置いて開始します。</p></div></article><article className="tutorial-rule"><span>2</span><div><h3>順番にプレイ</h3><p>自分の手番では、手札からカードを1枚または2枚、続けて盤面へ出します。</p></div></article><article className="tutorial-rule"><span>3</span><div><h3>失点を少なく</h3><p>新しい3×3枠の外に出たカードは失点カードになります。失点カード1枚が失点1点です。</p></div></article></div></section>

      <section className="tutorial-section tutorial-section-split"><div><p className="eyebrow">CARD PLACEMENT</p><h2>カードの置き方</h2><p>カードの数字は同じ数字の行に置きます。色は列を決め、同じ列には同じ色のカードだけを置きます。列の色が空になれば、その列は再び別の色に使えます。</p><p>カードを選ぶと置ける場所がハイライトされます。3×3枠設定がONなら枠は自動、OFFなら候補枠を自分で選べます。</p></div><TutorialFigure name="frame-selection.png" alt="3×3枠の候補を選んでいる盤面" caption="3×3枠設定OFF：候補枠を選ぶと、失点になるカードが盤面上で確認できます。" /></section>

      <section className="tutorial-section"><p className="eyebrow">THE 3×3 MATRIX</p><h2>3×3マトリクスと失点カード</h2><p>3×3マトリクスは、隣り合う3行×3列の9マスです。カードを置いたあと、盤面上のカードが枠の外にあれば、そのカードを自分の失点カードとして引き取ります。2枚出しでは、1枚目を置いた直後に枠外のカードを処理してから2枚目を置きます。</p><div className="tutorial-note"><strong>ポイント</strong><span>枠の選び方で残るカードと失点カードが変わります。盤面の「失点」表示を確認してから確定しましょう。</span></div></section>

      <section className="tutorial-section tutorial-section-split"><TutorialFigure name="action-summary.png" alt="プレイヤーの行動と直前の手番が表示されたゲーム画面" caption="行動の記録：各プレイヤーの直前のプレイ内容が上部に残ります。" /><div><p className="eyebrow">YOUR TURN</p><h2>1枚出し・2枚出し</h2><p>手札から1枚を選び、置き場所を選択します。1枚出しで手番を終える場合は「1枚で手番を終了」を選びます。この場合、手札が残っていれば補充できず、そのまま次のプレイヤーへ移ります。</p><p>2枚出しでは、1枚目を置いたあと、続けて2枚目を置きます。2枚出しを終えた場合は、手札が残っていても補充できます。補充するか、補充しないかを選びます。</p></div></section>

      <section className="tutorial-section tutorial-section-split"><div><p className="eyebrow">REFILL</p><h2>2枚出し後の補充</h2><p>4人戦では、2枚出しのあとに手札が1枚以上残っている場合、「山札から補充」または「補充しない」を選べます。1枚出しのあとには、この補充選択肢は出ません。</p><p>山札から補充を選ぶと、手札が6枚になるまで補充します。補充しない場合は、手札枚数を変えずに次のプレイヤーへ進みます。</p></div><TutorialFigure name="refill-options.png" alt="2枚出し後に山札から補充または補充しないを選ぶ画面" caption="2枚出し後の選択肢：山札から補充／補充しない。" /></section>

      <section className="tutorial-section tutorial-section-split"><TutorialFigure name="empty-hand-refill.png" alt="手札0枚のときの補充選択肢" caption="手札0枚の選択肢：山札またはマイナスカードから補充します。" /><div><p className="eyebrow">NO CARDS IN HAND</p><h2>手札が0枚になったとき</h2><p>1枚出しまたは2枚出しのあとに手札が0枚になった場合は、必ず補充します。選択肢は「山札から補充」と「マイナスから補充」です。</p><p>マイナスから補充を選ぶと、手元の失点カードをシャッフルし、最大6枚まで手札に戻します。失点カードが5枚以下の場合は、マイナスからではなく山札から6枚補充します。</p></div></section>

      <section className="tutorial-section tutorial-section-split"><div><p className="eyebrow">BONUSES</p><h2>8枚目と9枚目のボーナス</h2><p>3×3枠の8枚目のマスを埋めると、ボーナス1点を得ます。9枚目のマスを埋めると、ボーナス3点を得ます。2枚出しの1枚目で8枚目、2枚目で9枚目を埋めれば、合計4点のボーナスになります。</p><p>ボーナスは失点マーカーを0に近づけます。マーカーが0に到達したあとは、それ以上ボーナスを受け取れません。すでにカードがあるマスに重ねて置いた場合、そのマスを新たに埋めたことにはならないため、ボーナスは発生しません。</p></div><div className="tutorial-figures"><TutorialFigure name="bonus-8th.png" alt="3×3枠の8枚目を置いたゲーム画面" caption="8枚目：ボーナス1点の対象になる状態。" /><TutorialFigure name="bonus-9th.png" alt="3×3枠の9枚目を置いたゲーム画面" caption="9枚目：ボーナス3点の対象になる状態。" /></div></section>

      <section className="tutorial-section"><p className="eyebrow">SCORING</p><h2>山札切れ・得点計算・終了条件</h2><p>補充中に山札の最後のカードを引いたとき、その補充を途中で止めずに山札切れが発生します。手札が6枚まで戻らなくても、ただちに得点計算を行います。</p><p>得点計算では、各プレイヤーが持つ失点カードを数え、その枚数だけ失点マーカーを進めます。全員の失点カードをまとめてシャッフルし、新しい山札にします。プレイヤーの手札はそのまま残り、山札切れを起こしたプレイヤーは計算直後に補充を続けず、次のプレイヤーからゲームを再開します。</p><p>ゲームは、山札切れによる得点計算の結果、いずれかの失点マーカーが35以上に到達したときに終了します。最も失点が少ないプレイヤーが勝者で、同点の場合は同着です。</p></section>

      <section className="tutorial-section tutorial-scope"><p className="eyebrow">THIS VERSION</p><h2>この公開版について</h2><p>対局は4人戦に限定されています。オンライン対戦、ログイン、サーバーAPIは使わず、ブラウザだけで動作します。チュートリアルを閉じても、進行中のゲーム状態はそのまま保持されます。</p></section>
      <button type="button" className="primary tutorial-bottom-back" onClick={onBack}>ゲームに戻る</button>
    </main>
  );
}
