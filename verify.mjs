// 実ブラウザで index.html を実際に遊び、盤面の遷移が
// solver.mjs と同じ規則になっているかを1手ずつ照合する。
// 依存なしの CDP。ポートとプロファイルは実行ごとに変える。

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9000 + (process.pid % 900);
const PROFILE = mkdtempSync(join(tmpdir(), 'mogura-'));
const URL = 'file://' + join(process.cwd(), 'index.html');

const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-sandbox', '--disable-gpu', URL,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect(){
  for (let i = 0; i < 60; i++){
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(x => x.json());
      const page = r.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP に繋がらない');
}

const ws = new WebSocket(await connect());
await new Promise(r => ws.onopen = r);
let seq = 0; const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params){
  const id = ++seq;
  return new Promise(r => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expr){
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}

await send('Runtime.enable');
await sleep(600);

// --- solver と同じ規則(独立実装) -----------------------------------
const N = 4;
function neighbor(i, dir){
  const x = i % N, y = (i / N) | 0;
  const nx = x + [0, 1, 0, -1][dir], ny = y + [-1, 0, 1, 0][dir];
  return (nx < 0 || nx >= N || ny < 0 || ny >= N) ? -1 : ny * N + nx;
}
function expect(cells, i, dir){
  const out = cells.slice();
  if (!cells[i]) return out;
  const j = neighbor(i, dir);
  if (j < 0) return out;                       // 盤外 → 空振り
  out[i] = false;
  if (cells[j]) out[j] = false; else out[j] = true;
  return out;
}

const fail = [];
const geom = await evaluate('({OX:40,OY:90,PITCH:70,HOLE_R:26})');
// canvas は画面中央に置かれているので、viewport 座標へ直す
const rect = await evaluate(`(r => ({l:r.left,t:r.top,sx:r.width/cv.width,sy:r.height/cv.height}))(cv.getBoundingClientRect())`);
const cxy = i => [rect.l + (geom.OX + (i % 4) * geom.PITCH + geom.HOLE_R) * rect.sx,
                  rect.t + (geom.OY + ((i / 4) | 0) * geom.PITCH + geom.HOLE_R) * rect.sy];

// 実クリック(マウスイベント)で、クリック位置と飛ぶ向きの対応も同時に見る
async function clickAt(x, y){
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
}

let moves = 0, moveN = 0, bounceN = 0, popN = 0;
for (let trial = 0; trial < 200; trial++){
  // ランダムな盤面を置いて spawn を止める
  const list = [...Array(16).keys()].filter(() => Math.random() < 0.35);
  await evaluate(`(__game.set(${JSON.stringify(list)}), __game.freeze(), 1)`);
  const before = await evaluate('__game.cells');

  const i = (Math.random() * 16) | 0;
  const dir = (Math.random() * 4) | 0;
  // 「クリック点から見て反対側へ飛ぶ」ので、dir の逆側の縁を叩く
  const [hx, hy] = cxy(i);
  const off = 16;
  const px = hx - [0, 1, 0, -1][dir] * off, py = hy - [-1, 0, 1, 0][dir] * off;

  await clickAt(px, py);
  await sleep(260);                             // 着地を待つ
  const after = await evaluate('__game.cells');
  const want = expect(before, i, dir);

  if (JSON.stringify(after) !== JSON.stringify(want)){
    fail.push({ i, dir, before, after, want });
  }
  if (before[i]){
    moves++;
    const j = neighbor(i, dir);
    if (j < 0) bounceN++; else if (before[j]) popN++; else moveN++;
  }
}

console.log(`実クリック ${200} 回中、モグラに当たった手 ${moves} 回`);
console.log(`  移動 ${moveN} / 衝突消滅 ${popN} / 壁で空振り ${bounceN}`);
console.log(fail.length ? `不一致 ${fail.length} 件:\n` + JSON.stringify(fail.slice(0, 3), null, 1)
                        : '盤面遷移は solver の規則と全手で一致');

// --- 成功条件3: 放置すると埋まって終わるか --------------------------
await evaluate('(__game.set([]), 1)');
await evaluate('window.__t0 = performance.now()');
let filled = false;
for (let i = 0; i < 120; i++){
  await sleep(500);
  if (await evaluate('__game.over')){ filled = true; break; }
}
const secs = await evaluate('(performance.now() - window.__t0) / 1000');
console.log(filled ? `放置 ${secs.toFixed(1)}s で全16穴が埋まり「終了」` : '放置しても埋まらなかった');

// --- 成功条件2: 2手で狙って消せるか(実クリックで再現) ------------
// 穴0と穴2にモグラ → 0を右へ → 1を右へ で衝突(solver が出した具体例)
await evaluate('(__game.set([0,2]), __game.freeze(), 1)');
{
  const [x0, y0] = cxy(0); await clickAt(x0 - 16, y0); await sleep(260);
  const mid = await evaluate('__game.cells');
  const [x1, y1] = cxy(1); await clickAt(x1 - 16, y1); await sleep(400);
  const end = await evaluate('__game.cells');
  const ok = mid[1] && !mid[0] && end.every(c => !c);
  console.log(ok ? '2手の狙い撃ち: 穴0を右へ→穴1を右へ で2匹とも消えた'
                 : `2手の狙い撃ちに失敗 mid=${mid} end=${end}`);
}

ws.close(); chrome.kill();
process.exit(fail.length ? 1 : 0);
