type TutorialProps = {
  onBack: () => void;
};

const tutorialImage = (name: string) => `${import.meta.env.BASE_URL}tutorial/${name}`;

function TutorialFigure({ name, alt, caption }: { name: string; alt: string; caption: string }) {
  return (
    <figure className="tutorial-figure">
      <img src={tutorialImage(name)} alt={alt} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function Tutorial({ onBack }: TutorialProps) {
  return (
    <main className="tutorial-page">
      <header className="tutorial-header">
        <div>
          <p className="eyebrow">HOW TO PLAY</p>
          <h1>Yellowstone Park 遊び方</h1>
          <p className="tutorial-lead">動物カードをルールに沿って並べ、失点を減らしながら、最も高い得点を目指します。</p>
        </div>
        <button type="button" className="primary tutorial-back" onClick={onBack}>ゲームに戻る</button>
      </header>

      <section className="tutorial-section tutorial-hero">
        <div>
          <p className="eyebrow">FIRST LOOK</p>
          <h2>画面の見方</h2>
          <p>上部には4人の失点、手札枚数、マイナスカード枚数、直前の行動が表示されます。中央が盤面、右側が現在のプレイヤーの操作エリアです。</p>
          <p>この公開版は、あなた1人とCPU 3体で遊ぶ4人戦です。CPUは同じ公開情報限定のモデルを使います。</p>
        </div>
        <TutorialFigure name="game-overview.png" alt="ゲーム画面の全体像" caption="ゲーム画面：スコア、盤面、手札と操作が一画面に表示されます。" />
      </section>

      <section className="tutorial-section">
        <p className="eyebrow">OBJECTIVE</p>
        <h2>目的と準備</h2>
        <div className="tutorial-grid">
          <article className="tutorial-rule"><span>1</span><div><h3>カードを配る</h3><p>各プレイヤーは手札を持ち、残りのカードは山札になります。場には動物カードを置くための盤面があります。</p></div></article>
          <article className="tutorial-rule"><span>2</span><div><h3>順番にプレイ</h3><p>自分の手番では、手札からカードを1枚または2枚出します。出したカードは必ず盤面のルールに従って置きます。</p></div></article>
          <article className="tutorial-rule"><span>3</span><div><h3>失点を少なく</h3><p>置けなかったカードや盤面から押し出されたカードは失点カードになります。ゲーム終了時の失点が少ないほど有利です。</p></div></article>
        </div>
      </section>

      <section className="tutorial-section tutorial-section-split">
        <div>
          <p className="eyebrow">CARD PLACEMENT</p>
          <h2>カードの置き方</h2>
          <p>カードには動物の種類、色、数字があります。横方向の行では数字が昇順、縦方向の列では同じ色になるようにカードをつなげます。</p>
          <p>カードを選ぶと置ける場所がハイライトされます。3×3枠設定がONのときは、置いたカードを含む3×3の枠が自動で決まります。OFFにすると候補枠を自分で選べます。</p>
        </div>
        <TutorialFigure name="frame-selection.png" alt="3×3枠の候補を選んでいる盤面" caption="3×3枠設定OFF：候補枠を選ぶと、失点になるカードが盤面上で確認できます。" />
      </section>

      <section className="tutorial-section">
        <p className="eyebrow">THE 3×3 MATRIX</p>
        <h2>3×3マトリクスと失点カード</h2>
        <p>新しい3×3枠を選ぶと、その枠に含まれない既存カードは盤面から押し出され、失点カードになります。枠を選ぶ前に盤面のハイライトを確認しましょう。</p>
        <div className="tutorial-note"><strong>ポイント</strong><span>同じ場所でも、枠の選び方によって残るカードと失点カードが変わります。失点カードの増加表示は候補手の比較にも反映されます。</span></div>
      </section>

      <section className="tutorial-section tutorial-section-split">
        <TutorialFigure name="action-summary.png" alt="プレイヤーの行動と直前の手番が表示されたゲーム画面" caption="行動の記録：各プレイヤーの直前のプレイ内容が上部に残ります。" />
        <div>
          <p className="eyebrow">YOUR TURN</p>
          <h2>1枚出し・2枚出し</h2>
          <p>手札から1枚を選び、置き場所を選択します。1枚で手番を終えることも、条件を満たせば続けて2枚目を出すこともできます。</p>
          <p>2枚出しでは、同じ手番の2枚が同じ行・列のルールを満たす必要があります。候補手一覧では、あなたが選べる手とAIの上位候補を確認できます。</p>
        </div>
      </section>

      <section className="tutorial-section">
        <p className="eyebrow">REFILL</p>
        <h2>手番の終了と補充</h2>
        <p>プレイを終えたら、山札から補充するか、補充しないかを選びます。手札がなくなった場合は、マイナスカードから補充する選択肢も表示されます。</p>
        <p>補充の選択が確定すると、次のプレイヤーへ手番が移ります。CPUの手番では同じ流れが自動的に進みます。</p>
      </section>

      <section className="tutorial-section">
        <p className="eyebrow">SCORING</p>
        <h2>ボーナスと勝敗</h2>
        <p>行や列を完成させるとボーナスを得られます。完成した行・列の数や、残った失点カードをもとに最終得点が決まります。</p>
        <p>山札がなくなるなど、終了条件を満たすと結果画面になります。勝者を確認したら「もう一度遊ぶ」で新しい対局を開始できます。</p>
      </section>

      <section className="tutorial-section tutorial-scope">
        <p className="eyebrow">THIS VERSION</p>
        <h2>この公開版について</h2>
        <p>対局は4人戦に限定されています。オンライン対戦、ログイン、サーバーAPIは使わず、ブラウザだけで動作します。チュートリアルを閉じても、進行中のゲーム状態はそのまま保持されます。</p>
      </section>

      <button type="button" className="primary tutorial-bottom-back" onClick={onBack}>ゲームに戻る</button>
    </main>
  );
}
