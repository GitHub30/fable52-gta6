# 処理フロー

ゲームの処理の流れを 4 つのフローチャートにまとめたものです。モジュールの役割は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。図は 2026-11-20 時点の main（00b175a）のコードから作成しています。

1. [起動と画面遷移](#1-起動と画面遷移)
2. [メインループ（1 フレーム）](#2-メインループ1-フレーム)
3. [死亡・逮捕・手配度・ミッション](#3-死亡逮捕手配度ミッション)
4. [地図データの生成（オフライン）](#4-地図データの生成オフライン)

## 1. 起動と画面遷移

地図と人物モデルを並列に読み込み、`Game` を作ってタイトル画面へ。状態は menu・playing・paused の 3 つだけで、タイトル画面の背景でも街の AI は動き続けます。

```mermaid
flowchart TD
  A["index.html を開く"] --> B["main.ts：読み込み中を表示"]
  B --> C{"loadWorld() と loadPeople() を並列で実行"}
  C -- "失敗" --> E["エラーを表示して終了"]
  C -- "成功" --> D["new Game()：街・車・歩行者・警察・HUD を生成"]
  D --> F["game.start()：requestAnimationFrame ループを開始"]
  F --> M["menu：タイトル画面"]
  M -- "ニューゲーム" --> N["セーブを消去"]
  M -- "つづきから" --> L["localStorage から読み込み"]
  N --> P["beginPlay()：音声初期化・全画面化"]
  L --> P
  P --> G["playing"]
  G -- "ESC / P、ポインターロック解除" --> Q["paused：ポーズ画面"]
  Q -- "再開" --> G
  Q -- "手動セーブ" --> S["Save.save()"]
  S --> Q
  Q -- "タイトルへ" --> R["location.reload()"]
  R --> A
```

対応ファイル: `src/main.ts`, `src/Game.ts`, `src/world/WorldData.ts`, `src/entities/People.ts`, `src/systems/Save.ts`

## 2. メインループ（1 フレーム）

`Game.frame(dt)` の中身です。`dt` は 0.05 秒で頭打ちにします。playing のときだけ `step()` がゲームを進め、menu では環境・交通・歩行者・カメラだけを動かします。`debugStep()` は同じ `frame()` を回すテスト用の入口です。

```mermaid
flowchart TD
  T["requestAnimationFrame"] --> F["frame(dt)：dt は 0.05 秒が上限"]
  F --> K{"ESC / P が押された？"}
  K -- "はい" --> PZ["ポーズ / 再開を切り替え"]
  K -- "いいえ" --> ST
  PZ --> ST{"state は？"}
  ST -- "menu" --> MN["背景だけ更新：環境・交通・車・歩行者・カメラ"]
  ST -- "paused" --> RD
  ST -- "playing" --> S1

  subgraph STEP["step(dt)"]
    S1["リスポーン待ちの処理"] --> S2["入力と行動：E 乗降 / F・クリック 攻撃・ミッション開始 / 武器 1〜4 / H・R・T・Y・O・M"]
    S2 --> S3["Traffic.update：AI がアクセルとハンドルを決める"]
    S3 --> S4["全 Vehicle.update：アーケード物理"]
    S4 --> S5["車同士の衝突 → ダメージ・炎上・爆発"]
    S5 --> S6["ヘリ・旅客機 / 環状線の列車 / 16式 / ロケット弾"]
    S6 --> S7["Player.update：徒歩の移動・衝突"]
    S7 --> S8["Pedestrians・Officers：歩行者と徒歩の警官"]
    S8 --> S9["Wanted.update：手配度"]
    S9 --> S10["Missions.update：ミッション・補給・収集"]
    S10 --> S11{"体力 0？"}
    S11 -- "はい" --> W["wasted()"]
    S11 -- "いいえ" --> S12["自然回復 / 60 秒ごとに自動セーブ"]
    W --> S12
    S12 --> S13["Environment：昼夜・天候 → Effects → CameraRig → Audio → HUD"]
  end

  MN --> RD
  S13 --> RD["Graphics.render：影・AO・ブルーム・適応解像度"]
  RD --> EF["Input.endFrame()"]
  EF --> T
```

対応ファイル: `src/Game.ts`, `src/ai/Traffic.ts`, `src/entities/Vehicle.ts`, `src/ai/Pedestrians.ts`, `src/ai/Officers.ts`, `src/core/Graphics.ts`

## 3. 死亡・逮捕・手配度・ミッション

犯罪で ★ が上がり、★ の数までパトカーが出動します（★4 以上で 16式）。止まったところをパトカーに囲まれて 2.6 秒たつと BUSTED です。警察の視界から「10 秒 + ★×4 秒」消え続けると手配が解除されます。WASTED と BUSTED はどちらもミッション失敗になり、所持金の一部を失って決まった場所から再出発します。

```mermaid
flowchart TD
  C["犯罪：車両強盗・暴行・ひき逃げ・警官への攻撃"] --> WL["手配度 ★ が上がる（最大 ★5）"]
  WL --> DP["★ の数までパトカーが出動（★4 以上で 16式）"]
  DP --> OF["★2 以上：警官が降車して追跡、★3 以上で発砲"]
  OF --> J{"プレイヤーの状況"}
  J -- "視界の外に 10 秒 + ★×4 秒" --> CL["手配解除 ★0"]
  J -- "停止中に囲まれて 2.6 秒" --> BU["BUSTED：所持金 -15%"]
  J -- "体力 0" --> WA["WASTED：所持金 -10%"]
  BU --> TD["takeDown()：ミッション失敗・車やヘリから降ろす・手配解除"]
  WA --> TD
  TD --> RS["4 秒後に再出発：BUSTED は警察署前、WASTED は病院前"]

  MS["ピンクの ◆ で F"] --> MI["ミッション開始：配達 / レース / 逃走 / タクシー / 木箱回収"]
  MI --> OB{"目標を達成？"}
  OB -- "goto：地点に到着" --> NX["次の目標へ"]
  OB -- "evade：警察を振り切る" --> NX
  NX --> OB
  OB -- "全目標クリア" --> RW["賞金を得て自動セーブ"]
  OB -- "M キー・時間切れ" --> FL["ミッション失敗"]
  TD -. "進行中なら" .-> FL
```

対応ファイル: `src/systems/Wanted.ts`, `src/systems/Missions.ts`, `src/ai/Officers.ts`, `src/Game.ts（takeDown / wasted / busted）`

## 4. 地図データの生成（オフライン）

ゲームは実行時に外部 API を呼びません。Python のツールが公開データを事前に変換して `public/` に焼き込み、ゲームはその静的ファイルを読むだけです。main への push で GitHub Pages に自動デプロイされます。

```mermaid
flowchart LR
  subgraph SRC["公開データ"]
    OSM["OpenStreetMap（Overpass API）"]
    GSI["国土地理院：航空写真 z18・5m 標高"]
    PH["参照写真：tools/people/*.webp"]
  end
  subgraph TOOLS["tools/（Python）"]
    FO["fetch_osaka.py"]
    FT["fetch_tracks.py"]
    FS["fetch_stores.py"]
    BP["build_people.py"]
  end
  subgraph PUB["public/"]
    MAP["osaka/map.json：道路・建物・公園"]
    DEM["osaka/dem.bin：4m 格子の標高"]
    IMG["osaka/ground.jpg・far.jpg"]
    TRK["環状線の線路データ"]
    STO["osaka/stores.json：チェーン店"]
    PPL["people/：スキンメッシュ・アトラス・マスク"]
  end
  subgraph RUN["実行時（src/）"]
    WD["WorldData.ts：読み込み・道路グラフ・標高補間"]
    CT["City.ts / Railway.ts / Stores.ts"]
    PE["People.ts → Character.ts"]
  end
  OSM --> FO
  GSI --> FO
  OSM --> FT
  OSM --> FS
  PH --> BP
  FO --> MAP
  FO --> DEM
  FO --> IMG
  FT --> TRK
  FS --> STO
  BP --> PPL
  MAP --> WD
  DEM --> WD
  IMG --> WD
  TRK --> WD
  STO --> CT
  WD --> CT
  PPL --> PE
  CT --> BUILD["vite build → dist/"]
  PE --> BUILD
  BUILD --> GH["GitHub Actions → GitHub Pages"]
```

対応ファイル: `tools/fetch_osaka.py`, `tools/fetch_tracks.py`, `tools/fetch_stores.py`, `tools/build_people.py`, `.github/workflows/pages.yml`
