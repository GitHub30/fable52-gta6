import { Game } from './Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
game.start();
// exposed for debugging and automated browser checks
(window as any).__game = game;
