import { readFileSync } from "node:fs";

const MAX = 100000000;

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const scriptTag = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptTag) throw new Error("找不到 <script> 块");
const code = scriptTag[1];

/* ---------- 极简 DOM 桩，用来跑真实的页面脚本 ---------- */
function makeEl(tag) {
  return {
    tagName: tag, _listeners: {}, className: "", innerHTML: "",
    textContent: "", value: "", type: "", children: [],
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); },
    appendChild(c) { this.children.push(c); },
    select() {}, focus() {},
    fire(t, ev = {}) { (this._listeners[t] || []).forEach((f) => f(ev)); }
  };
}
const els = {
  num: makeEl("input"), form: makeEl("form"),
  examples: makeEl("div"), result: makeEl("section")
};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => []
};
const windowStub = {};

const tLoad = performance.now();
new Function("document", "window", "performance", code)(
  documentStub, windowStub, performance
);
const loadMs = performance.now() - tLoad;

const api = windowStub.primeFactor;
if (!api) throw new Error("window.primeFactor 未挂载");

console.log(`脚本加载 + 质数表预处理：${loadMs.toFixed(2)} ms`);
console.log(`MAX = ${api.MAX}：${api.MAX === MAX ? "✓" : "✗"}`);

/* ==========================================================================
 * 独立质数表：完整筛到 1 亿（100 MB 位图），完全不复用页面的算法
 * ========================================================================== */
const tSieve = performance.now();
const isPrime = new Uint8Array(MAX + 1).fill(1);
isPrime[0] = isPrime[1] = 0;
for (let i = 2; i * i <= MAX; i++) {
  if (isPrime[i]) for (let j = i * i; j <= MAX; j += i) isPrime[j] = 0;
}
let pi = 0;
for (let i = 2; i <= MAX; i++) pi += isPrime[i];
console.log(`独立筛表构建：${(performance.now() - tSieve).toFixed(0)} ms，` +
  `π(10⁸) = ${pi}${pi === 5761455 ? " ✓ 与已知值一致" : " ✗ 期望 5761455"}`);

/* ==========================================================================
 * 结构性验证：因子全是质数 + 乘起来等于原数 → 由唯一分解定理即为唯一正解
 * ========================================================================== */
let fails = 0;
function check(n) {
  const got = api.factorize(n);
  let prod = 1, prev = 0, ok = true;

  for (const [p, e] of got) {
    if (p <= prev) ok = false;
    if (!(Number.isInteger(e) && e >= 1)) ok = false;
    if (!isPrime[p]) ok = false;
    if (n % p !== 0) ok = false;
    prev = p;
    prod *= p ** e;
  }
  if (prod !== n) ok = false;

  const looksPrime = got.length === 1 && got[0][1] === 1;
  if (looksPrime !== !!isPrime[n]) ok = false;

  if (!ok) {
    fails++;
    if (fails <= 10) console.log(`✗ ${n} → ${JSON.stringify(got)}`);
  }
  return ok;
}

/* 1) 2 ~ 1,000,000 全量 */
const t1 = performance.now();
for (let n = 2; n <= 1000000; n++) check(n);
console.log(`全量验证 2~1,000,000：${fails === 0 ? "全部通过 ✓" : fails + " 处失败 ✗"}` +
  `（${(performance.now() - t1).toFixed(0)} ms）`);

/* 2) 1,000,000 ~ 1 亿 随机抽样 20 万个 */
let seed = 20261120;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const t2 = performance.now();
let sampleFail = 0;
for (let i = 0; i < 200000; i++) {
  const n = 1000000 + Math.floor(rand() * (MAX - 1000000));
  if (!check(n)) sampleFail++;
}
console.log(`随机抽样 200,000 个（1e6 ~ 1e8）：${sampleFail === 0 ? "全部通过 ✓" : sampleFail + " 处失败 ✗"}` +
  `（${(performance.now() - t2).toFixed(0)} ms）`);

/* 3) 刻意构造的边界与陷阱用例 */
const tricky = [
  99999989,       // 1 亿以内最大的质数
  100000000,      // 10⁸ = 2⁸ × 5⁸
  99999999,       // 3² × 11 × 73 × 101 × 137
  67108864,       // 2²⁶（最大指数）
  99980001,       // 9999²
  8388608,        // 2²³
  9699690,        // 2×3×5×7×11×13×17×19，8 个不同质因数
  9797 * 9797,
  9973 * 10007,   // 两个 ~10⁴ 质数相乘，刚好卡在试除边界
  99991 * 997,    // 一大一小
  2
];

let trickyFail = 0;
for (const n of tricky) {
  if (!check(n)) trickyFail++;
  console.log(`  ${String(n).padStart(9)} = ${api.formatFactors(api.factorize(n))}`);
}
console.log(`边界用例：${trickyFail === 0 ? "全部通过 ✓" : trickyFail + " 处失败 ✗"}`);

if (fails > 0) console.log(`\n⚠ 结构性验证共 ${fails} 处失败`);

/* ==========================================================================
 * 与独立的朴素试除参考实现比对
 * ========================================================================== */
function factorRef(n) {
  const out = []; let r = n;
  for (let p = 2; p * p <= r; p++) {
    if (r % p === 0) { let e = 0; while (r % p === 0) { r /= p; e++; } out.push([p, e]); }
  }
  if (r > 1) out.push([r, 1]);
  return out;
}
let refFails = 0, refCount = 0;
const cmp = (n) => {
  refCount++;
  if (JSON.stringify(api.factorize(n)) !== JSON.stringify(factorRef(n))) {
    if (refFails++ < 5) console.log(`  ✗ ${n} 与参考实现不一致`);
  }
};
for (let n = 2; n <= 100000; n++) cmp(n);
for (let i = 0; i < 3000; i++) cmp(100000 + Math.floor(rand() * (MAX - 100000)));
console.log(`参考实现比对（${refCount} 个数）：${refFails === 0 ? "全部一致 ✓" : refFails + " 处不一致 ✗"}`);

/* ==========================================================================
 * 性能：最坏情况（大质数，要扫完整张表）
 * ========================================================================== */
const worst = [99999989, 99999931, 99999787, 100000000];
for (const n of worst) {
  const t = performance.now();
  const reps = 2000;
  for (let i = 0; i < reps; i++) api.factorize(n);
  console.log(`  ${n} 平均每次 ${((performance.now() - t) / reps * 1000).toFixed(1)} µs`);
}

/* ==========================================================================
 * 界面渲染与输入校验
 * ========================================================================== */
function submit(value) {
  els.num.value = value;
  els.result.innerHTML = "";
  els.result.className = "";
  els.form.fire("submit", { preventDefault() {} });
  return els.result.innerHTML;
}

const uiCases = [
  ["360", ["合 数", "2³ × 3² × 5", "约数个数 24"], true],
  ["97", ["质数"], true],
  ["99999989", ["质数"], true],
  ["100000000", ["2⁸ × 5⁸"], true],
  ["1", ["既非质数"], true],
  [" 0360 ", ["360"], true],
  ["", ["请先输入"], false],
  ["abc", ["只能输入数字"], false],
  ["3.5", ["只能输入数字"], false],
  ["-5", ["只能输入数字"], false],
  ["0", ["正整数"], false],
  ["100000001", ["超出范围"], false]
];
let uiFail = 0;
for (const [input, needles, shouldPass] of uiCases) {
  const out = submit(input);
  for (const needle of needles) {
    if (!out.includes(needle)) {
      uiFail++;
      console.log(`✗ 输入 "${input}" 缺少 "${needle}" → ${out.replace(/<[^>]+>/g, " ").slice(0, 80)}`);
    }
  }
  if (!shouldPass && !out.includes("error")) { uiFail++; console.log(`✗ 输入 "${input}" 应报错`); }
}
console.log(`界面/校验用例：${uiFail === 0 ? "全部通过 ✓" : uiFail + " 处失败 ✗"}`);

/* ==========================================================================
 * 质数结果必须只有"质数"两个字
 * ========================================================================== */
let strictFail = 0;
for (const n of [2, 7, 97, 999983, 99999989]) {
  const out = submit(String(n));
  const text = out.replace(/<[^>]+>/g, "").trim();
  if (text !== "质数") { strictFail++; console.log(`✗ ${n} 卡片文字「${text}」`); }
  if (out.includes("约数个数") || out.includes("用时")) {
    strictFail++; console.log(`✗ ${n} 仍带小字`);
  }
}
console.log(`质数仅输出"质数"两字：${strictFail === 0 ? "全部通过 ✓" : strictFail + " 处失败 ✗"}`);

/* ==========================================================================
 * 猜一猜模块
 * ========================================================================== */
const q = api.quiz;
const quizEl = els.quiz;
const truthOf = (n) => {
  const f = api.factorize(n);
  return f.length === 1 && f[0][1] === 1 ? "prime" : "composite";
};

let qFail = 0;
const qLog = (m) => { if (qFail++ < 10) console.log("  ✗ " + m); };

/* 候选池 = 4950 个奇数 - 990 个 5 的倍数 = 3960 个 */
{
  const expect = 4950 - 990;
  console.log(`候选池大小：${q.poolSize}（期望 ${expect}）${q.poolSize === expect ? " ✓" : " ✗"}`);
  if (q.poolSize !== expect) qLog(`候选池大小不对`);
}

/* 1) 出题规则：奇数、100~10000、不是 5 的倍数、同组不重复、题数正确 */
for (const size of [10, 20]) {
  const before = qFail;
  for (let s = 0; s < 200; s++) {
    q.start(size);
    const st = q.state();
    if (st.total !== size) qLog(`题数标记 ${st.total} 不等于 ${size}`);
    if (st.numbers.length !== size) qLog(`第 ${s} 组题量 ${st.numbers.length} 不等于 ${size}`);
    const seen = new Set();
    for (const n of st.numbers) {
      if (n % 2 === 0) qLog(`第 ${s} 组出现偶数 ${n}`);
      if (n % 5 === 0) qLog(`第 ${s} 组出现 5 的倍数 ${n}`);
      if (n < 100 || n > 10000) qLog(`第 ${s} 组出现越界数字 ${n}`);
      if (seen.has(n)) qLog(`第 ${s} 组出现重复数字 ${n}`);
      seen.add(n);
    }
  }
  const d = qFail - before;
  console.log(`出题规则（200 组 × ${size} 题）：${d === 0 ? "全部通过 ✓" : d + " 处失败 ✗"}`);
}

/* 1.5) 3 的倍数占比：原来是 1/3，现在应降到 1/9 */
{
  const before = qFail;

  if (Math.abs(q.threeShare - 1 / 9) > 1e-9) qLog(`目标占比 ${q.threeShare} 不是 1/9`);
  if (Math.abs(q.threeWeight - 0.25) > 1e-9) qLog(`权重 ${q.threeWeight} 不是 0.25`);

  let total = 0;
  let mult3 = 0;
  const SETS = 10000;
  for (let s = 0; s < SETS; s++) {
    q.start(10);
    for (const n of q.state().numbers) {
      total++;
      if (n % 3 === 0) mult3++;
    }
  }
  const share = mult3 / total;
  const expect = 1 / 9;
  const beforeShare = 1 / 3;

  console.log(`3 的倍数占比：实测 ${(share * 100).toFixed(2)}%  |  降权前 ${(beforeShare * 100).toFixed(2)}%  |  目标 ${(expect * 100).toFixed(2)}%`);
  // 10 万个样本，标准差约 0.001，±0.005 已是 5σ 以上
  if (Math.abs(share - expect) > 0.005) qLog(`占比 ${share.toFixed(4)} 偏离目标 1/9 超过 0.005`);
  if (share > 0.20) qLog(`占比 ${share.toFixed(4)} 看起来仍是旧概率（1/3 附近）`);

  const d = qFail - before;
  console.log(`3 的倍数占比（${SETS} 组 × 10 题，共 ${total} 个样本）：${d === 0 ? "全部通过 ✓" : d + " 处失败 ✗"}`);
}

/* 2) 判定与反馈：答对 ✓、答错 ✗、合数附分解式 */
const before2 = qFail;
for (const size of [10, 20]) {
  for (let s = 0; s < 50; s++) {
    q.start(size);
    for (let i = 0; i < size; i++) {
      const st = q.state();
      const n = st.numbers[st.index];
      const truth = truthOf(n);
      const shouldBeRight = (s + i) % 2 === 0;
      const guess = shouldBeRight ? truth : (truth === "prime" ? "composite" : "prime");

      q.answer(guess);
      const out = quizEl.innerHTML;
      const text = out.replace(/<[^>]+>/g, " ");

      if (!out.includes(String(n))) qLog(`题目 ${n} 未显示`);
      if (shouldBeRight && !out.includes("答对了")) qLog(`答对 ${n} 却显示错误反馈`);
      if (!shouldBeRight && !out.includes("答错了")) qLog(`答错 ${n} 却显示正确反馈`);
      if (shouldBeRight && !out.includes("✓")) qLog(`答对 ${n} 缺少对号`);
      if (!shouldBeRight && !out.includes("✗")) qLog(`答错 ${n} 缺少错号`);

      if (truth === "prime") {
        if (!text.includes("质数")) qLog(`质数 ${n} 未说明`);
      } else {
        const fmt = api.formatFactors(api.factorize(n));
        if (!text.includes(fmt)) qLog(`合数 ${n} 未给出分解式 ${fmt}`);
      }
      q.next();
    }
  }
}
const d2 = qFail - before2;
console.log(`答题反馈（100 组全程）：${d2 === 0 ? "全部通过 ✓" : d2 + " 处失败 ✗"}`);

/* 3) 结算正确率：10 题与 20 题各若干情形 */
const before3 = qFail;
const plans = [
  [10, [[10, 100], [8, 80], [5, 50], [0, 0], [9, 90]]],
  [20, [[20, 100], [16, 80], [10, 50], [0, 0], [19, 95], [13, 65]]]
];
for (const [size, cases] of plans) {
  for (const [rightCount, expectPct] of cases) {
    q.start(size);
    for (let i = 0; i < size; i++) {
      const st = q.state();
      const truth = truthOf(st.numbers[st.index]);
      const wantRight = i < rightCount;
      q.answer(wantRight ? truth : (truth === "prime" ? "composite" : "prime"));
      q.next();
    }
    if (!quizEl.innerHTML.includes("本组完成")) qLog(`${size} 题库答完未显示结算`);
    if (!quizEl.innerHTML.includes(expectPct + "<span>%")) qLog(`${size} 题答对 ${rightCount}，正确率不是 ${expectPct}%`);
    const text = quizEl.innerHTML.replace(/<[^>]+>/g, " ");
    if (!text.includes(`答对 ${rightCount} 题`)) qLog(`${size} 题结算文案答对数不对（应为 ${rightCount}）`);
  }
}
const d3 = qFail - before3;
console.log(`结算正确率（10/20 题共 11 种情形）：${d3 === 0 ? "全部通过 ✓" : d3 + " 处失败 ✗"}`);

/* 4) 切换题数后重新开始 */
{
  const before = qFail;
  q.start(20);
  const a = q.state();
  if (a.total !== 20 || a.numbers.length !== 20) qLog("切换到 20 题失败");
  q.start(10);
  const b = q.state();
  if (b.total !== 10 || b.numbers.length !== 10) qLog("切换回 10 题失败");
  if (b.index !== 0 || b.correct !== 0 || b.results.length !== 0) qLog("切换题数后状态未重置");
  const d = qFail - before;
  console.log(`题数切换 10 与 20：${d === 0 ? "全部通过 ✓" : d + " 处失败 ✗"}`);
}

console.log(`\n猜一猜模块总计：${qFail === 0 ? "全部通过 ✓" : qFail + " 处失败 ✗"}`);