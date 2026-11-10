import { Game } from './Game';
import { loadWorld } from './world/WorldData';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
ui.innerHTML = '<div class="loading">大阪・天王寺を読み込み中…</div>';

loadWorld()
  .then((data) => {
    ui.innerHTML = '';
    const game = new Game(canvas, ui, data);
    game.start();
    // exposed for debugging and automated browser checks
    (window as any).__game = game;
  })
  .catch((err) => {
    ui.innerHTML = '<div class="loading">マップデータを読み込めませんでした: ' + String(err) + '</div>';
  });
