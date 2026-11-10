import { City } from '../world/City';

export interface HudState {
  money: number;
  health: number;
  wanted: number;
  wantedFlash: boolean;
  clock: string;
  weather: string;
  district: string;
  speedKmh: number | null;
  carHealth: number;
  carName: string;
  objective: string | null;
  timer: number | null;
  fps: number;
  weapon: string;
  aim: boolean;
}
export interface Blip {
  x: number;
  z: number;
  color: string;
  shape: 'dot' | 'square' | 'diamond';
  size?: number;
  clampEdge?: boolean;
}

const CONTROLS: [string, string][] = [
  ['W A S D', '移動 / アクセル・ブレーキ・ハンドル'],
  ['マウス', 'カメラ操作'],
  ['Shift', '走る'],
  ['Space', 'ジャンプ / ハンドブレーキ'],
  ['E', '車に乗る・降りる'],
  ['F / 左クリック', 'ミッション開始・攻撃'],
  ['1 / 2 / 3 / 4', '素手 / ピストル / AK-47 / ロケット'],
  ['ヘリ: Space / Shift', '上昇 / 下降（W A S D で飛行）'],
  ['H', 'クラクション'],
  ['R', 'ラジオ ON/OFF'],
  ['M', 'ミッション中止'],
  ['T / Y', '時間を進める / 天候切替'],
  ['ESC / P', '一時停止・操作確認'],
];

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Hud {
  private money = el('div', 'money');
  private stars = el('div', 'stars');
  private clock = el('div', 'clock');
  private fps = el('div', 'fps');
  private weapon = el('div', 'clock');
  private cross = el('div', 'cross hidden');
  private map = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private healthBar = el('div', 'bar', '<div></div>');
  private district = el('div', 'district');
  private br = el('div', 'hud-br hidden');
  private speed = el('div', 'speed');
  private carName = el('div', 'carname');
  private carBar = el('div', 'bar', '<div></div>');
  private objective = el('div', 'objective hidden');
  private prompt = el('div', 'prompt hidden');
  private notes = el('div', 'notes');
  private bannerHost = el('div');
  private overlay = el('div', 'overlay hidden');
  private fade = el('div', 'fade');
  private hudRoot = el('div');
  private last: Partial<HudState> = {};
  private mapImg = document.createElement('canvas');
  private promptText: string | null = null;

  constructor(root: HTMLElement, private city: City) {
    const tr = el('div', 'hud-tr');
    tr.append(this.money, this.stars, this.clock, this.weapon);
    const bl = el('div', 'hud-bl');
    this.map.className = 'minimap';
    this.map.width = this.map.height = 200;
    this.ctx = this.map.getContext('2d')!;
    bl.append(this.map, this.healthBar, this.district);
    this.br.append(this.speed, this.carName, this.carBar);
    this.hudRoot.append(this.cross, this.fps, tr, bl, this.br, this.objective, this.prompt, this.notes, this.bannerHost);
    root.append(this.fade, this.hudRoot, this.overlay);
    this.stars.innerHTML = '<span>★</span>'.repeat(5);
    // minimap base: the aerial photo with the road network drawn over it
    const d = city.data, mw = 1024, mh = Math.round((1024 * d.hz) / d.hx), k = mw / (2 * d.hx);
    this.mapImg.width = mw;
    this.mapImg.height = mh;
    const mc = this.mapImg.getContext('2d')!;
    mc.drawImage(d.ground, 0, 0, mw, mh);
    mc.fillStyle = 'rgba(18,22,30,0.38)';
    mc.fillRect(0, 0, mw, mh);
    mc.lineCap = mc.lineJoin = 'round';
    for (const pass of [0, 1])
      for (const e of d.edges) {
        if (e.k > 5 || (pass === 0) !== e.k > 2) continue;
        mc.strokeStyle = e.k <= 2 ? 'rgba(255,255,255,0.92)' : 'rgba(225,228,232,0.55)';
        mc.lineWidth = Math.max(1.4, e.w * k * (e.k <= 2 ? 1 : 0.8));
        mc.beginPath();
        for (let i = 0; i < e.pts.length; i += 2) mc[i ? 'lineTo' : 'moveTo']((e.pts[i] + d.hx) * k, (e.pts[i + 1] + d.hz) * k);
        mc.stroke();
      }
  }

  setVisible(v: boolean) {
    this.hudRoot.classList.toggle('hidden', !v);
  }

  update(s: HudState) {
    const L = this.last;
    if (L.money !== s.money) this.money.textContent = '$' + Math.floor(s.money).toLocaleString('en-US');
    if (L.wanted !== s.wanted) {
      const kids = this.stars.children;
      for (let i = 0; i < 5; i++) kids[i].className = i < s.wanted ? 'on' : '';
    }
    if (L.wantedFlash !== s.wantedFlash) this.stars.classList.toggle('flash', s.wantedFlash);
    if (L.clock !== s.clock || L.weather !== s.weather) this.clock.textContent = `${s.clock}  ·  ${s.weather}`;
    if (L.health !== s.health) {
      (this.healthBar.firstChild as HTMLElement).style.width = Math.max(0, s.health) + '%';
      this.healthBar.classList.toggle('low', s.health < 30);
    }
    if (L.district !== s.district) this.district.textContent = s.district;
    const inCar = s.speedKmh !== null;
    if ((L.speedKmh !== null && L.speedKmh !== undefined) !== inCar) this.br.classList.toggle('hidden', !inCar);
    if (inCar) {
      if (L.speedKmh !== s.speedKmh) this.speed.innerHTML = `${s.speedKmh}<small>km/h</small>`;
      if (L.carName !== s.carName) this.carName.textContent = s.carName;
      if (L.carHealth !== s.carHealth) (this.carBar.firstChild as HTMLElement).style.width = Math.max(0, s.carHealth) + '%';
    }
    if (L.objective !== s.objective || L.timer !== s.timer) {
      this.objective.classList.toggle('hidden', !s.objective);
      if (s.objective) {
        const t = s.timer;
        const timer = t === null ? '' : `<span class="timer ${t < 15 ? 'low' : ''}">${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</span>`;
        this.objective.innerHTML = s.objective + timer;
      }
    }
    if (L.weapon !== s.weapon) this.weapon.textContent = s.weapon;
    if (L.aim !== s.aim) this.cross.classList.toggle('hidden', !s.aim);
    if (L.fps !== s.fps) this.fps.textContent = s.fps + ' FPS';
    this.last = { ...s };
  }

  setPrompt(key: string | null, text = '') {
    const t = key ? key + '|' + text : null;
    if (t === this.promptText) return;
    this.promptText = t;
    this.prompt.classList.toggle('hidden', !key);
    if (key) this.prompt.innerHTML = `<b>${key}</b>${text}`;
  }

  notify(text: string, kind: '' | 'warn' | 'good' = '') {
    const n = el('div', 'note ' + kind, text);
    this.notes.prepend(n);
    while (this.notes.children.length > 5) this.notes.lastChild!.remove();
    setTimeout(() => n.remove(), 5200);
  }

  banner(title: string, sub: string, color: string, ms = 3200) {
    this.bannerHost.innerHTML = '';
    const b = el('div', 'banner', `<h1 style="color:${color}">${title}</h1><p>${sub}</p>`);
    this.bannerHost.append(b);
    setTimeout(() => b.remove(), ms);
  }

  setFade(on: boolean) {
    this.fade.classList.toggle('on', on);
  }

  private controlsHtml() {
    return (
      '<div class="keys">' + CONTROLS.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('') + '</div>' +
      '<div class="credits">地図データ © OpenStreetMap contributors ／ 航空写真・標高: 国土地理院（地理院タイル）</div>'
    );
  }
  private button(label: string, alt: boolean, fn: () => void) {
    const b = el('button', 'btn' + (alt ? ' alt' : ''), label) as HTMLButtonElement;
    b.onclick = fn;
    return b;
  }

  showMenu(hasSave: boolean, onNew: () => void, onContinue: () => void) {
    const card = el('div', 'card', `<h1 class="title">VELA BAY</h1><div class="subtitle">OSAKA ・ 通天閣 / 天王寺</div>`);
    if (hasSave) card.append(this.button('つづきから', false, onContinue));
    card.append(this.button('ニューゲーム', hasSave, onNew));
    card.insertAdjacentHTML('beforeend', this.controlsHtml());
    this.overlay.innerHTML = '';
    this.overlay.append(card);
    this.overlay.classList.remove('hidden');
  }
  showPause(onResume: () => void, onSave: () => void, onNew: () => void, stats: string) {
    const card = el('div', 'card', `<h1 class="title" style="font-size:44px">PAUSE</h1><div class="subtitle">${stats}</div>`);
    card.append(this.button('再開', false, onResume), this.button('セーブ', true, onSave), this.button('ニューゲーム（最初から）', true, onNew));
    card.insertAdjacentHTML('beforeend', this.controlsHtml());
    this.overlay.innerHTML = '';
    this.overlay.append(card);
    this.overlay.classList.remove('hidden');
  }
  hideOverlay() {
    this.overlay.classList.add('hidden');
  }
  get overlayOpen() {
    return !this.overlay.classList.contains('hidden');
  }

  /** Rotating minimap: camera-forward is up. */
  drawMinimap(px: number, pz: number, heading: number, camYaw: number, blips: Blip[], zoom: number) {
    const ctx = this.ctx, S = 200, c = S / 2;
    const scale = zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(c, c);
    ctx.rotate(camYaw);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);
    const { hx: mapHx, hz: mapHz } = this.city.data;
    ctx.drawImage(this.mapImg, -mapHx, -mapHz, mapHx * 2, mapHz * 2);
    // blips are drawn in screen space so their size and shape stay constant
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
    for (const b of blips) {
      const dx = (b.x - px) * scale, dz = (b.z - pz) * scale;
      let x = dx * cs - dz * sn, y = dx * sn + dz * cs;
      const d = Math.hypot(x, y), max = c - 8;
      if (d > max) {
        if (!b.clampEdge) continue;
        x *= max / d;
        y *= max / d;
      }
      const r = b.size ?? 5;
      ctx.fillStyle = b.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (b.shape === 'dot') ctx.arc(c + x, c + y, r, 0, 6.3);
      else if (b.shape === 'square') ctx.rect(c + x - r, c + y - r, r * 2, r * 2);
      else {
        ctx.moveTo(c + x, c + y - r - 2);
        ctx.lineTo(c + x + r, c + y);
        ctx.lineTo(c + x, c + y + r + 2);
        ctx.lineTo(c + x - r, c + y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    // player arrow
    const hx = Math.sin(heading), hz = Math.cos(heading);
    const ax = hx * cs - hz * sn, ay = hx * sn + hz * cs;
    ctx.translate(c, c);
    ctx.rotate(Math.atan2(ay, ax) + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // north marker
    const nx = -sn * (c - 10) * -1, ny = -cs * (c - 10);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c + nx, c + ny);
  }
}
