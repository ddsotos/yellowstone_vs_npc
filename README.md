# Yellowstone vs NPC

GitHub Pagesで動作する、Yellowstoneの人間1人＋CPU3体版です。ゲーム、候補手生成、公開カード情報の推論はブラウザ内で実行します。サーバー、API、SSE、ログイン、オンライン対戦は使用しません。

```powershell
npm install
npm run dev
npm test
npm run build
```

CPUは `Card information gated branch 350k public epoch002 pct100` のみを使用します。モデル本体とmetadataは `public/models/` から相対URLで読み込みます。ONNX Runtime Webは既存ブラウザ版と同じworker実装を使用します。

GitHub側でPagesのsourceを「GitHub Actions」に設定し、`main`へpushすると`.github/workflows/deploy-pages.yml`がbuildとdeployを行います。
