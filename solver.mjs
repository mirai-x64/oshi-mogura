// 盤面(spawn を止めた静的な状態)を全探索し、
// 「2匹をぶつけて消す操作が偶然でなく狙って再現できる」を厳密に確かめる。
//
// 状態は 16bit のビットマスク。手は (穴 16 × 向き 4) = 64 通り。
// 状態空間は 65536 しかないので、全状態について
// 「モグラが1組でも減るまでの最短手数」を後ろ向き BFS で求められる。

const N = 4;

function neighbor(i, dir){
  const x = i % N, y = (i / N) | 0;
  const nx = x + [0, 1, 0, -1][dir], ny = y + [-1, 0, 1, 0][dir];
  if (nx < 0 || nx >= N || ny < 0 || ny >= N) return -1;
  return ny * N + nx;
}

// 手を適用した後の状態。効果のない手は null。
function apply(s, i, dir){
  if (!(s >> i & 1)) return null;          // モグラがいない
  const j = neighbor(i, dir);
  if (j < 0) return null;                  // 盤外 → 空振り(状態は不変)
  if (s >> j & 1) return s & ~(1 << i) & ~(1 << j);  // 衝突: 2匹とも消える
  return (s & ~(1 << i)) | (1 << j);       // 移動
}

const popcount = s => { let c = 0; while (s) { s &= s - 1; c++; } return c; };

// dist[s] = s から「モグラが2匹減った状態」に至る最短手数
const SIZE = 1 << (N * N);
const dist = new Int8Array(SIZE).fill(-1);
const queue = [];

// 遷移の逆引きが面倒なので、素直に前向き BFS を全始点から一度に回す。
// ゴール = 「その手で衝突が起きる状態」。まず衝突を1手で起こせる状態を距離1にする。
for (let s = 0; s < SIZE; s++){
  let hit = false;
  for (let i = 0; i < 16 && !hit; i++)
    for (let dir = 0; dir < 4; dir++){
      const t = apply(s, i, dir);
      if (t !== null && popcount(t) < popcount(s)) { hit = true; break; }
    }
  if (hit) { dist[s] = 1; queue.push(s); }
}

// 距離 d の状態へ 1 手で行ける状態は距離 d+1
// 前向き遷移 s -> t なので、逆辺を張るために遷移表を作る
const preds = Array.from({ length: SIZE }, () => null);
for (let s = 0; s < SIZE; s++){
  for (let i = 0; i < 16; i++)
    for (let dir = 0; dir < 4; dir++){
      const t = apply(s, i, dir);
      if (t === null || t === s || popcount(t) < popcount(s)) continue;
      (preds[t] ??= []).push(s);
    }
}

for (let h = 0; h < queue.length; h++){
  const t = queue[h];
  for (const s of preds[t] ?? []){
    if (dist[s] === -1){ dist[s] = dist[t] + 1; queue.push(s); }
  }
}

// --- 結果 -------------------------------------------------------------
const byCount = new Map();
for (let s = 0; s < SIZE; s++){
  const n = popcount(s);
  if (n < 2) continue;                       // 2匹未満は原理的に消せない
  const e = byCount.get(n) ?? { total: 0, unreach: 0, max: 0, hist: {} };
  e.total++;
  if (dist[s] === -1) e.unreach++;
  else { e.max = Math.max(e.max, dist[s]); e.hist[dist[s]] = (e.hist[dist[s]] ?? 0) + 1; }
  byCount.set(n, e);
}

console.log('モグラ数  盤面数  消せない  最短手数の最大  分布');
let worstAll = 0, unreachAll = 0;
for (const n of [...byCount.keys()].sort((a, b) => a - b)){
  const e = byCount.get(n);
  worstAll = Math.max(worstAll, e.max);
  unreachAll += e.unreach;
  const hist = Object.entries(e.hist).map(([k, v]) => `${k}手:${v}`).join(' ');
  console.log(`${String(n).padStart(6)}  ${String(e.total).padStart(6)}  ${String(e.unreach).padStart(8)}  ${String(e.max).padStart(14)}  ${hist}`);
}
console.log(`\nモグラ2匹以上のあらゆる盤面で消せない盤面: ${unreachAll}`);
console.log(`最悪ケースでも ${worstAll} 手で1組消える`);

// 成功条件2「空の穴へ寄せる → 隣から押し込む の2手」が
// 実際に存在するかを、2匹だけの盤面で具体例として出す
for (let s = 0; s < SIZE; s++){
  if (popcount(s) !== 2 || dist[s] !== 2) continue;
  const holes = [...Array(16).keys()].filter(i => s >> i & 1);
  outer:
  for (let i = 0; i < 16; i++) for (let d1 = 0; d1 < 4; d1++){
    const m = apply(s, i, d1);
    if (m === null || m === s || dist[m] !== 1) continue;
    for (let k = 0; k < 16; k++) for (let d2 = 0; d2 < 4; d2++){
      if (popcount(apply(m, k, d2) ?? m) < 2){
        const nm = ['上', '右', '下', '左'];
        console.log(`\n2手の具体例: モグラ ${holes.join(',')} → 穴${i}を${nm[d1]}へ → 穴${k}を${nm[d2]}へ で衝突`);
        break outer;
      }
    }
  }
  break;
}
