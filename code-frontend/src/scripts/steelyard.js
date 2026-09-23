/* 粮市页头 · 杆秤图腾（无形之物：光核）
   依据：frontend-spec.md §4.6（粮市页头带）；试作出处
   cache-tools/design-lab/dianjiang-liangshi-totems-v1.html（本机对照，不发布）——
   乙案「杆秤 · 称量」＋ 盘内容「光核 · 束缚」，2026-09-22 用户拍板落 /plans 页头右侧。

   纪律（§10.1 / §10.2 / §11.1）：
   ① canvas 只画形状、零数据，aria-hidden；砣位 / 刻度不映射任何套餐字段；
   ② 强度只从 CSS 变量读（--totem-motion），皮肤档只改变量、不改 DOM；
   ③ prefers-reduced-motion、离屏、切后台一律不跑循环（只画一帧静止等价物）；
   ④ DPR 上限 1.5；窄屏（画布被 CSS 关掉）直接不启动；
   ⑤ 只绑已有交互：东市 / 西市切换 = 载荷换手感位（扫描 → 重新锁定），不新增状态位；
   ⑥ 指针交互只认鼠标（pointerType !== 'touch'）：拖秤砣 / 拽秤盘 / 点载荷 / 连点复位，
      全部只活在画布里，指针事件绑在 canvas 上、release() 一并解绑。

   皮肤档 × 动效（2026-09-22 用户拍板）：
   赛博档（--totem-motion: 1）= 整台器物常动 + 环上流光；
   朴素档（--totem-motion: 0）= **器物本体仍是静止单帧，只有环上的光在走**
   （量环 / 浑仪双环的流光；帧率收一半，别为一道光常烧 60fps）。
   做法：朴素档里只推流光相位（holoPh）不推时钟（clock）——一切 t 驱动的本体细节
   都停在原地，读 t 的只有「光」；静止等价物（reduced-motion / 停循环）则不画流光的头尾。 */

var TAU = Math.PI * 2;
var GOLD = '#e8b73a', GOLD_DEEP = '#9a6b14', CYAN = '#3fd9c0', VERM = '#c8342a', PAPER = '#f5ecd8';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
/* 两角最短角距（0..π）：流光相位是累计量、不归一，不能直接相减 */
function angGap(a, b) {
  var d = (a - b) % TAU;
  if (d < -Math.PI) d += TAU; else if (d > Math.PI) d -= TAU;
  return Math.abs(d);
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* Catmull-Rom 平滑：从当前点续画，不 moveTo（闭合轮廓用 seam lineTo 再接它） */
function smooth(ctx, pts) {
  var n = pts.length;
  if (!n) return;
  ctx.lineTo(pts[0][0], pts[0][1]);
  for (var i = 0; i < n - 1; i++) {
    var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
}

function toScreen(pts, S, ox, oy) {
  var out = [];
  for (var i = 0; i < pts.length; i++) out.push([ox + pts[i][0] * S, oy + pts[i][1] * S]);
  return out;
}

/* 渐变带：沿折线两侧等宽偏移，做成可填充的锥形带（尾缨 / 虎尾 / 流束都用它） */
function ribbon(center, w0, w1) {
  var left = [], right = [], n = center.length;
  for (var i = 0; i < n; i++) {
    var p = center[i], prev = center[i - 1] || p, next = center[i + 1] || p;
    var dx = next[0] - prev[0], dy = next[1] - prev[1];
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var t = n > 1 ? i / (n - 1) : 0;
    var w = (w0 + (w1 - w0) * t) / 2;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  return left.concat(right.reverse());
}

/* 环上流光：一条会散的尾巴沿椭圆环走，按「可见窗口」裁段——环走到核后的那半段
   交给后段那一遍去画，光就自然被核挡住（遮挡即纵深，不必真做深度）。
   相位是累计值、不归一，所以先把每段抬到窗口附近再求交。tailLen 为负 = 逆行。 */
function ringFlow(ctx, cx, cy, a, b, rot, lo, hi, head, tailLen, segs, rgb, aMax, lwMax, k0) {
  for (var i = 0; i < segs; i++) {
    var q0 = i / segs, q1 = (i + 1) / segs, k = 1 - q1;
    var s = head - tailLen * q1, e = head - tailLen * q0;
    if (s > e) { var sw = s; s = e; e = sw; }
    var base = Math.floor((s - lo) / TAU) * TAU;
    s -= base; e -= base;
    if (e <= lo || s >= hi) continue;
    if (s < lo) s = lo;
    if (e > hi) e = hi;
    ctx.strokeStyle = 'rgba(' + rgb + ',' + (Math.pow(k, 1.9) * aMax * k0) + ')';
    ctx.lineWidth = .7 + lwMax * Math.pow(k, 1.4);
    ctx.beginPath(); ctx.ellipse(cx, cy, a, b, rot, s, e); ctx.stroke();
  }
}
/* 流光头：椭圆上的一枚白热点 + 一团光晕（同样只在窗口内出现 = 走到核后就被核挡住） */
function ringHead(ctx, cx, cy, a, b, rot, head, lo, hi, rgb, al, r, k0) {
  var th = head - Math.floor((head - lo) / TAU) * TAU;
  if (th < lo || th > hi) return;
  var ct = Math.cos(th), st = Math.sin(th);
  var x = cx + ct * a * Math.cos(rot) - st * b * Math.sin(rot);
  var y = cy + ct * a * Math.sin(rot) + st * b * Math.cos(rot);
  var g = ctx.createRadialGradient(x, y, 0, x, y, r * 5.5);
  g.addColorStop(0, 'rgba(' + rgb + ',' + (.55 * al * k0) + ')');
  g.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 5.5, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(246,255,252,' + (.85 * al * k0) + ')';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/* 尘埃层已撤（2026-09-22 用户反馈「称现在的背景没有融入站点」）：
   原有一层径向光晕（aura）+ 一版器物位内的飘尘，都是画布自己带的背景——
   光晕在画布四边被裁成一道肉眼可见的浅边，飘尘又被框在器物位矩形里（站点已有全站星尘
   .bg-motes 铺满整页），器物位那块因此看起来像另一张底。撤掉这两层后画布只剩器物本身的
   光（杆 / 盘 / 砣各自的内发光）与交互屑，透过画布看到的就是站点背景，无边界可言。 */


var MARK0 = .20, MARKN = 13, MARKSTEP = .05, A_DOM = .25, A_OVS = .75;

function beamHalf(R, uu) {
  return R * (.0072 + .0165 * Math.pow(Math.max(0, 1 - Math.abs(uu) / .72), 1.35));
}


function Steelyard(canvas, opts) {
  this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.motion = !!(opts && opts.motion);
  this.clock = 0; this.running = false; this.visible = false; this.reduced = false; this.frame = 0;
  this.ang = 0; this.angV = 0;
  this.arm = A_DOM; this.armV = 0; this.armT = A_DOM; this.load = A_DOM;
  this.sway = 0; this.swayV = 0;
  this.pan = 0; this.panV = 0;
  this.ps = 0; this.psV = 0;
  this.trail = 0;
  this.scan = 1;                       /* 全息扫描：切市扫一道 */
  this.locked = true; this.lockOn = false; this.lockT = 0;   /* 初始即「已锁定在东市位」 */
  this.lit = new Float32Array(MARKN);
  this.kern = []; this.sparks = [];
  this.mat = 0; this.live = false; this.lightAcc = 0;
  this.coreDim = 0; this.coreFlash = 0; this.coreInit = false;
  this.coreX = 0; this.coreY = 0; this.coreVX = 0; this.coreVY = 0; this.coreSq = 1; this.coreRot = 0;
  this.cageK = 1; this.cageV = 0;
  this.cagePh = 0; this.holoPh = 0;
  /* 鼠标交互：本市的基准位 + 拖拽偏移（全部只活在画布里，读写零数据） */
  this.baseArm = A_DOM; this.panK = 0; this.bobPull = 0;
  this.dragKind = null; this.handArm = null;
  this.ptr = { x: 0, y: 0, on: false };
  this.hot = null;                                            /* 悬停在哪个可抓物件上（bob / pan） */
  this.poke = 0; this.hs = -1;
  this.bobPt = null; this.panPt = null;
}
Steelyard.prototype.name = '粮市·杆秤';

Steelyard.prototype.resize = function (w, h) {
  this.W = w; this.H = h;
  /* 生产器物位定标（lab 的 .73 是整条页头带的中心，器物位里要自己居中、按位尺寸定标）
     —— bbox 中心 ≈ cx − .10R，取 .55w 让「盘侧悬出 + 砣侧到头」在器物位里左右相抵。
     2026-09-22 用户反馈「称可以整体放大一点，画布内下面空了很多」：器物位是 2:1 的框，
     本体只有 1.44R 宽（含盘侧悬出 1.77R）、0.62R 高，所以尺寸由宽度定（R = .47w，杆两头
     各留约一成边，h*.80 兜住极扁的窗），竖向把**盘底钉在器物位下沿一成二高处**
     （beamY = .88h − .51R，.51R = 杆轴到盘底），多出来的高度全给提绳：
     器物不再缩在框顶、底下留一大片死白。 */
  this.R = Math.min(w * .49, h * .80);
  this.cx = w * .55;
  this.beamY = h * .88 - this.R * .51;   /* 秤杆轴心（提绳下端）；盘底 = beamY + .51R */
  this.seedKernels();
  this.coreInit = false;
};
Steelyard.prototype.seedKernels = function () {
  this.kern = [];
  for (var i = 0; i < 20; i++) {
    this.kern.push({
      u: -0.90 + (i / 19) * 1.80 + rnd(-.028, .028),
      y: rnd(.002, .016), s: rnd(.62, 1.12), a: rnd(-.45, .45), hi: Math.random() < .45
    });
  }
};
Steelyard.prototype.reactLoad = function () {
  /* 换一批：笼先收拢把核压暗，再逐环张开回亮 */
  this.coreDim = 1; this.cageK = 0; this.cageV = 0;
};
/* 点载荷 = 捏一下：笼绷一记（只改画布内的瞬时量，零数据） */
Steelyard.prototype.pokeLoad = function () {
  var R = this.R;
  this.poke = 1;
  if (!R) return;
  this.coreFlash = Math.max(this.coreFlash, .85);
};
/* 双击复位：砣回本市的「手感位」、盘回零、载荷静定，再扫一道光（不保存任何状态） */
Steelyard.prototype.resetHands = function () {
  this.panK = 0; this.bobPull = 0; this.handArm = null; this.dragKind = null;
  this.arm = this.baseArm; this.armT = this.baseArm; this.load = this.baseArm; this.armV = 0;
  this.pan = 0; this.panV = 0; this.poke = 0;
  this.hs = 0;
  this.coreInit = false;
};
Steelyard.prototype.stepLoad = function (d, t, pxp, pyp) {
  var R = this.R, i;
  this.cagePh += d * .55;
  this.holoPh += d * (.16 + (this.ptr.on ? .44 : 0));      /* 鼠标在器物上：全息层转快一点 */
  if (this.mat > 0) this.mat = Math.max(0, this.mat - d / 1.15);
  this.coreFlash = Math.max(0, this.coreFlash - d * 1.6);

  { /* 光核：核的惯性 + 笼的开合（无形之物靠形变 + 惯性 + 束缚读「重」） */
    var rcr = R * .072;
    var ktx = pxp + Math.sin(t * .83 + 1.2) * R * .0035;
    if (this.ptr.on) ktx += clamp((this.ptr.x - pxp) * .05, -R * .032, R * .032);   /* 悬停：核朝光标偏（笼跟着反倾） */
    var kty = pyp + R * .039 - rcr;
    if (!this.coreInit) { this.coreX = ktx; this.coreY = kty; this.coreVX = 0; this.coreVY = 0; this.coreInit = true; }
    this.coreVX += ((ktx - this.coreX) * 46 - this.coreVX * 7.6) * d;
    this.coreVY += ((kty - this.coreY) * 46 - this.coreVY * 7.6) * d;
    this.coreX += this.coreVX * d; this.coreY += this.coreVY * d;
    this.coreSq += (clamp(1 - this.coreVY * .0034, .855, 1.10) - this.coreSq) * Math.min(1, d * 9);
    this.coreRot += (this.coreVX * .0016 - this.coreRot) * Math.min(1, d * 4);
    var wasDim = this.coreDim;
    this.coreDim = Math.max(0, this.coreDim - d * .85);
    if (wasDim > .02 && this.coreDim <= .02) this.coreFlash = 1;
    /* 笼：换料/切市先收拢（光被压暗），再逐环张开回稳 —— 带一点过冲 */
    this.cageV += ((1 - this.cageK) * 42 - this.cageV * 6.8) * d;
    this.cageK += this.cageV * d;
  }
};
Steelyard.prototype.drawCore = function (ctx, t, pxp, pyp) {
  var R = this.R, i, a;
  var rcr = R * .072;
  var ccy0 = pyp + R * .039 - rcr;
  var ccx = this.coreInit ? this.coreX : pxp;
  var ccy = this.coreInit ? this.coreY : ccy0;
  var dim = clamp(this.coreDim, 0, 1);
  var lit = clamp(.22 + .78 * (1 - dim) + .07 * Math.sin(t * 1.6), 0, 1.1);
  var sqy = clamp(this.coreSq || 1, .84, 1.12), sqx = 1 + (1 - sqy) * .55;
  var cy0 = pyp + R * .039;
  var ck = clamp(this.cageK == null ? 1 : this.cageK, 0, 1.15);
  var pk = clamp(this.poke, 0, 1);                           /* 点载荷：笼绷一下 */
  var rk = (.70 + .30 * ck) * (1 - pk * .09);                 /* 笼的开合：收拢（贴着核）→ 张开（陀螺仪） */
  var tilt = clamp(-this.coreVX * .0018, -.28, .28);         /* 核在笼里荡，笼反向微倾（惯性稳定） */
  var cageA = .42 + dim * .40;

  /* 落座暗影（光也要压在盘上）+ 深核光晕 */
  ctx.beginPath();
  ctx.ellipse(ccx, cy0 + R * .004, rcr * 1.05, rcr * .30, 0, 0, TAU);
  ctx.fillStyle = 'rgba(20,11,2,.42)'; ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var gl = ctx.createRadialGradient(ccx, ccy, rcr * .1, ccx, ccy, rcr * 3.4);
  gl.addColorStop(0, 'rgba(255,232,168,' + (.24 * lit) + ')');
  gl.addColorStop(.42, 'rgba(232,183,58,' + (.10 * lit) + ')');
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(ccx, ccy, rcr * 3.4, 0, TAU); ctx.fill();
  /* 接触光：光在盘上摊开一小片（会摊 = 有重量；边缘三小块是流出去的光） */
  var spg = ctx.createRadialGradient(ccx, cy0, 0, ccx, cy0, rcr * 1.9);
  spg.addColorStop(0, 'rgba(255,236,182,' + (.20 + .22 * lit) + ')');
  spg.addColorStop(.55, 'rgba(232,183,58,' + (.10 * lit) + ')');
  spg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spg;
  ctx.beginPath(); ctx.ellipse(ccx, cy0, rcr * 1.9, rcr * .54, 0, 0, TAU); ctx.fill();
  for (i = 0; i < 3; i++) {
    var sa = -.95 + i * .95 + Math.sin(t * .5 + i * 2.1) * .14;
    ctx.globalAlpha = (.26 + .26 * lit) * (.55 + .45 * Math.sin(t * .8 + i * 2.3));
    ctx.fillStyle = '#ffe6ac';
    ctx.beginPath();
    ctx.ellipse(ccx + Math.cos(sa) * rcr * 1.42, cy0 + rcr * .10, rcr * .34, rcr * .075, sa * .55, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  /* 量环 · 流光：13 齿是静的刻度，光沿环流——头亮尾散，扫过哪枚齿哪枚齿亮起
     （与杆上「游标过刻星点亮」同一套语言：光读刻度、不读值；齿不再自己转）。
     主青流顺行、副金流逆行，一交一错，环才是「活的」而不只是「转的」；
     两道流的相位都取自 holoPh —— 鼠标移入器物时全息层转快，环上的光也跟着走快
     （沿用已有的唤醒手感，不新增状态位、不新增数据）。
     静止单帧（朴素档的器物本体 / reduced-motion）里不画头尾：环回到一枚均匀点亮的量环，
     免得流光冻在半路，看着像一颗定住的高光；但朴素档的**光**照走（flowOn 与 still 分开）。 */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(ccx, cy0);
  ctx.scale(1, .42);
  var hr = rcr * 1.90;
  var still = !this.live || !this.motion;    /* 本体静止（t 驱动的细节都停住） */
  var flowOn = this.live;                    /* 流光要不要画（朴素档只走光，也算 live） */
  var flowA = this.holoPh * 3.2;             /* 主青流相位（顺行） */
  var flowB = -this.holoPh * 1.75 + 2.2;     /* 副金流相位（逆行） */
  var fdim = 1 - dim * .55;                  /* 换料 / 切市：光流跟着一滞 */
  /* 轨：内外两道细线夹出刻度带，齿落在带里（一圈游标尺，不再是孤零零一个圆） */
  ctx.strokeStyle = 'rgba(63,217,192,.13)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, hr, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(63,217,192,.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, hr + R * .012, 0, TAU); ctx.stroke();
  /* 齿：底光很淡，流头扫到时按角距提亮（青流为主、金流补一记） */
  for (i = 0; i < 13; i++) {
    a = (i / 13) * TAU;
    var gT = 0;
    if (flowOn) {
      var gA = Math.exp(-Math.pow(angGap(a, flowA) / .32, 2));
      var gB = Math.exp(-Math.pow(angGap(a, flowB) / .26, 2));
      gT = gA + gB * .55;
    }
    var tl = still ? .30 : .15 + .11 * Math.sin(t * 1.9 + i * 1.3);
    ctx.strokeStyle = 'rgba(63,217,192,' + clamp(tl + gT * .80 * fdim, 0, 1) + ')';
    ctx.lineWidth = 1.15 + gT * .95;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * hr, Math.sin(a) * hr);
    ctx.lineTo(Math.cos(a) * (hr + R * .012), Math.sin(a) * (hr + R * .012));
    ctx.stroke();
  }
  if (flowOn) {
    /* 主青流：头端一枚白热点 + 一团光晕，身后拖一条约四成环长的散尾 */
    var TAIL = TAU * .40, SEG = 22;
    for (i = 0; i < SEG; i++) {
      var q1 = i / SEG, q2 = (i + 1) / SEG, kk = 1 - q2;
      ctx.strokeStyle = 'rgba(126,240,220,' + (Math.pow(kk, 2.1) * .40 * fdim) + ')';
      ctx.lineWidth = .8 + 2.6 * Math.pow(kk, 1.5);
      ctx.beginPath(); ctx.arc(0, 0, hr, flowA - TAIL * q2, flowA - TAIL * q1); ctx.stroke();
    }
    var hx1 = Math.cos(flowA) * hr, hy1 = Math.sin(flowA) * hr;
    var gl1 = ctx.createRadialGradient(hx1, hy1, 0, hx1, hy1, rcr * .60);
    gl1.addColorStop(0, 'rgba(238,255,250,' + (.50 * fdim) + ')');
    gl1.addColorStop(.34, 'rgba(126,240,220,' + (.20 * fdim) + ')');
    gl1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl1;
    ctx.beginPath(); ctx.arc(hx1, hy1, rcr * .60, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(248,255,252,' + (.88 * fdim) + ')';
    ctx.beginPath(); ctx.arc(hx1, hy1, rcr * .052, 0, TAU); ctx.fill();
    /* 副金流：短、细、逆着走（尾落在 + 角侧），只在两流交错处亮一下 */
    var TAIL2 = TAU * .16, SEG2 = 10;
    for (i = 0; i < SEG2; i++) {
      var r1 = i / SEG2, r2 = (i + 1) / SEG2, k2 = 1 - r2;
      ctx.strokeStyle = 'rgba(255,214,124,' + (Math.pow(k2, 2.4) * .20 * fdim) + ')';
      ctx.lineWidth = .7 + 1.4 * k2;
      ctx.beginPath(); ctx.arc(0, 0, hr, flowB + TAIL2 * r1, flowB + TAIL2 * r2); ctx.stroke();
    }
    var hx2 = Math.cos(flowB) * hr, hy2 = Math.sin(flowB) * hr;
    ctx.fillStyle = 'rgba(255,232,168,' + (.46 * fdim) + ')';
    ctx.beginPath(); ctx.arc(hx2, hy2, rcr * .034, 0, TAU); ctx.fill();
  }
  ctx.restore();

  /* 核外柔光（大气层）＋ 大 bloom＋ 浑仪三环笼的后半（被核遮住 = 核在笼内） */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var gl = ctx.createRadialGradient(ccx, ccy, rcr * .1, ccx, ccy, rcr * 3.6);
  gl.addColorStop(0, 'rgba(255,236,186,' + (.28 * lit) + ')');
  gl.addColorStop(.34, 'rgba(232,183,58,' + (.12 * lit) + ')');
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(ccx, ccy, rcr * 3.6, 0, TAU); ctx.fill();
  /* 笼的两道环（后段）+ 环上流光（后段这一遍也把「光走到核后」那半段接过去画） */
  var rotH = tilt + this.cagePh * .18, rotV = -.18 + this.cagePh * .20 + tilt * .5;
  var aH = rcr * 1.95 * rk, bH = rcr * 1.05 * rk, aV = rcr * 1.05 * rk, bV = rcr * 1.85 * rk;
  var headH = this.holoPh * 2.0 + .6;        /* 两道环各走各的光 */
  var headV = -this.holoPh * 1.7 + 2.4;
  ctx.strokeStyle = 'rgba(126,240,220,' + (cageA * .74) + ')'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aH, bH, rotH, Math.PI, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(63,217,192,' + (cageA * .82) + ')'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aV, bV, rotV, Math.PI * 1.06, TAU + .28); ctx.stroke();
  if (flowOn) {
    ringFlow(ctx, ccx, ccy, aH, bH, rotH, Math.PI, TAU, headH, .40, 10, '126,240,220', .52, 2.1, fdim);
    ringFlow(ctx, ccx, ccy, aV, bV, rotV, Math.PI * 1.06, TAU + .28, headV, -.30, 10, '158,248,230', .46, 1.9, fdim);
    ringHead(ctx, ccx, ccy, aH, bH, rotH, headH, Math.PI, TAU, '186,252,236', 1, 1.5, fdim);
    ringHead(ctx, ccx, ccy, aV, bV, rotV, headV, Math.PI * 1.06, TAU + .28, '200,255,244', 1, 1.3, fdim);
  }
  ctx.restore();

  /* 核体：一团被笼住的光（轮廓微起伏 = 不是硬球）＋ 白热芯 ＋ 内部对流 ＋ 核面刻度带 */
  ctx.save();
  ctx.translate(ccx, ccy);
  ctx.scale(sqx, sqy);
  var corePath = function () {
    ctx.beginPath();
    for (var q = 0; q <= 40; q++) {
      var th = (q / 40) * TAU;
      var rr = rcr * (1 + .026 * Math.sin(3 * th + t * .7) + .014 * Math.sin(5 * th - t * .5));
      var px = Math.cos(th) * rr, py = Math.sin(th) * rr;
      if (q === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  corePath();
  /* 壳：半透的琥珀光壳（不是实心球 —— 内里看得见在转，才不像一颗珠子） */
  var bgr = ctx.createRadialGradient(-rcr * .22, -rcr * .26, rcr * .04, 0, 0, rcr * 1.08);
  bgr.addColorStop(0, 'rgba(255,254,246,' + clamp(.44 + .42 * lit, 0, .94) + ')');
  bgr.addColorStop(.30, 'rgba(255,214,124,' + clamp(.40 + .34 * lit, 0, .88) + ')');
  bgr.addColorStop(.72, 'rgba(196,116,24,' + clamp(.44 + .28 * lit, 0, .82) + ')');
  bgr.addColorStop(1, 'rgba(56,26,4,' + clamp(.60 + .20 * lit, 0, .86) + ')');
  ctx.fillStyle = bgr; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(this.coreRot);
  for (i = 0; i < 2; i++) {
    var ex = Math.sin(t * (.42 + i * .17) + i * 2.3) * rcr * .40;
    var ey = Math.cos(t * (.33 + i * .13) + i * 1.1) * rcr * .34;
    var eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, rcr * .64);
    eg.addColorStop(0, 'rgba(255,248,220,' + (.20 * lit) + ')');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(ex, ey, rcr * .64, 0, TAU); ctx.fill();
  }
  /* 内里漩涡：两道盘旋的光（核心在转 —— 这是「光」，不是球） */
  for (i = 0; i < 2; i++) {
    var ph2 = t * (.55 + i * .26) + i * 2.1;
    ctx.beginPath();
    for (var q2 = 0; q2 <= 20; q2++) {
      var u2 = q2 / 20, ang = ph2 + u2 * 3.6, rr2 = rcr * (.20 + .78 * u2);
      var vx2 = Math.cos(ang) * rr2, vy2 = Math.sin(ang) * rr2 * .58;
      if (q2 === 0) ctx.moveTo(vx2, vy2); else ctx.lineTo(vx2, vy2);
    }
    ctx.strokeStyle = 'rgba(255,242,204,' + (.07 + .09 * lit + .05 * i) + ')';
    ctx.lineWidth = 1.4 - i * .3;
    ctx.stroke();
  }
  /* 芯：白热的一小点 */
  var hg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, rcr * .46);
  hg2.addColorStop(0, 'rgba(255,255,252,' + (.55 + .40 * lit) + ')');
  hg2.addColorStop(1, 'rgba(255,246,214,0)');
  ctx.fillStyle = hg2;
  ctx.beginPath(); ctx.arc(0, 0, rcr * .46, 0, TAU); ctx.fill();
  /* 核面刻度带：带上一枚游标光点在走（与杆上游标爪同构——杆上读刻度、核上读刻度） */
  var ba = -.34 + this.coreRot * .6;
  ctx.save();
  ctx.rotate(ba);
  ctx.strokeStyle = 'rgba(255,240,196,.20)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, 0, rcr * .92, rcr * .32, 0, 0, TAU); ctx.stroke();
  for (i = 0; i < 6; i++) {
    var ta = (i / 6) * TAU;
    ctx.strokeStyle = 'rgba(255,246,214,.26)'; ctx.lineWidth = .9;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ta) * rcr * .84, Math.sin(ta) * rcr * .29);
    ctx.lineTo(Math.cos(ta) * rcr * 1.0, Math.sin(ta) * rcr * .35);
    ctx.stroke();
  }
  var ra = t * .55;
  ctx.fillStyle = 'rgba(255,236,180,.20)';
  ctx.beginPath(); ctx.arc(Math.cos(ra) * rcr * .92, Math.sin(ra) * rcr * .32, 4.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,232,.85)';
  ctx.beginPath(); ctx.arc(Math.cos(ra) * rcr * .92, Math.sin(ra) * rcr * .32, 1.5, 0, TAU); ctx.fill();
  ctx.restore();
  /* 高光点：密光才有镜面 */
  ctx.fillStyle = 'rgba(255,255,252,' + (.16 + .14 * lit) + ')';
  ctx.beginPath(); ctx.ellipse(-rcr * .32, -rcr * .38, rcr * .19, rcr * .12, -.5, 0, TAU); ctx.fill();
  ctx.restore();
  /* 菲涅尔边：白热芯外那一圈最亮的边 */
  corePath();
  ctx.strokeStyle = 'rgba(255,250,232,' + (.40 + .32 * lit) + ')'; ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  /* 赤道逃逸光丝：笼的赤道最松，光从两侧漏出去、正好被环截断（束缚的叙事；笼越紧丝越短越亮） */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var ra2 = aH, rb2 = bH;                                      /* 环的极径随方向变：丝只到环为止 */
  for (i = 0; i < 4; i++) {
    var fa = (i < 2 ? 1 : -1) * (.10 + (i % 2) * .17) + (i < 2 ? 0 : Math.PI);
    var cf = Math.cos(fa), sf = Math.sin(fa);
    var rr3 = ra2 * rb2 / Math.sqrt(Math.pow(rb2 * cf, 2) + Math.pow(ra2 * sf, 2));
    var fl = .30 + .70 * Math.max(0, Math.sin(t * 1.7 + (i < 2 ? 0 : Math.PI)));
    var l3 = Math.max(rcr * .92, rr3 * (.62 + .38 * fl));
    var bx = cf * rcr * .86, by = sf * rcr * .86;
    var tx2 = cf * l3, ty2 = sf * l3;
    var mx2 = cf * (rcr * .86 + l3) * .5, my2 = sf * (rcr * .86 + l3) * .5;
    var nxs = -sf, nys = cf;
    ctx.globalAlpha = (.22 + .42 * fl) * (1 - .30 * ck) * (1 + pk * .9);
    ctx.fillStyle = '#fff3d2';
    ctx.beginPath();
    ctx.moveTo(bx * sqx, by * sqy);
    ctx.quadraticCurveTo((mx2 + nxs * rcr * .12) * sqx, (my2 + nys * rcr * .12) * sqy, tx2 * sqx, ty2 * sqy);
    ctx.quadraticCurveTo((mx2 - nxs * rcr * .12) * sqx, (my2 - nys * rcr * .12) * sqy, bx * sqx, by * sqy);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = (.30 + .50 * fl) * (1 - .30 * ck) * (1 + pk * .9);
    ctx.fillStyle = '#fff8e6';
    ctx.beginPath(); ctx.arc(tx2 * sqx, ty2 * sqy, rcr * .04, 0, TAU); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  /* 浑仪三环笼的前半（压过核体，给一层纵深）＋ 左右冷边一线青 */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  /* 环（前段）：一遍宽软光 + 一遍亮芯线（1x 下也看得见笼） */
  ctx.strokeStyle = 'rgba(63,217,192,' + (cageA * .20) + ')'; ctx.lineWidth = 3.8;
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aH, bH, rotH, 0, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aV, bV, rotV, .28, Math.PI * 1.06); ctx.stroke();
  ctx.strokeStyle = 'rgba(158,248,230,' + Math.min(1, cageA * 1.06) + ')'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aH, bH, rotH, 0, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(ccx, ccy, aV, bV, rotV, .28, Math.PI * 1.06); ctx.stroke();
  /* 环上流光（前段）：与后段同一相位 —— 是同一道光，只是换了一侧画（前段更亮一档） */
  if (flowOn) {
    ringFlow(ctx, ccx, ccy, aH, bH, rotH, 0, Math.PI, headH, .40, 10, '126,240,220', .62, 2.2, fdim);
    ringFlow(ctx, ccx, ccy, aV, bV, rotV, .28, Math.PI * 1.06, headV, -.30, 10, '158,248,230', .55, 2.0, fdim);
    ringHead(ctx, ccx, ccy, aH, bH, rotH, headH, 0, Math.PI, '186,252,236', 1, 1.6, fdim);
    ringHead(ctx, ccx, ccy, aV, bV, rotV, headV, .28, Math.PI * 1.06, '200,255,244', 1, 1.4, fdim);
  }
  /* 环的交点：两环真的「交」在一处，结构才立得住（数值找最近点对，20×20 采样） */
  var eH = [], eV = [];
  for (i = 0; i < 20; i++) {
    var th3 = (i / 20) * TAU, c3 = Math.cos(th3), s3 = Math.sin(th3);
    eH.push([ccx + c3 * aH * Math.cos(rotH) - s3 * bH * Math.sin(rotH), ccy + c3 * aH * Math.sin(rotH) + s3 * bH * Math.cos(rotH)]);
    eV.push([ccx + c3 * aV * Math.cos(rotV) - s3 * bV * Math.sin(rotV), ccy + c3 * aV * Math.sin(rotV) + s3 * bV * Math.cos(rotV)]);
  }
  var nodes = [];
  for (i = 0; i < eH.length && nodes.length < 4; i++) {
    for (var j = 0; j < eV.length; j++) {
      var dd = Math.hypot(eH[i][0] - eV[j][0], eH[i][1] - eV[j][1]);
      if (dd > 3.2) continue;
      var nx0 = (eH[i][0] + eV[j][0]) / 2, ny0 = (eH[i][1] + eV[j][1]) / 2, seen = false;
      for (var k2 = 0; k2 < nodes.length; k2++) if (Math.hypot(nodes[k2][0] - nx0, nodes[k2][1] - ny0) < 8) seen = true;
      if (!seen) { nodes.push([nx0, ny0]); break; }
    }
  }
  for (i = 0; i < nodes.length; i++) {
    ctx.fillStyle = 'rgba(150,246,226,' + (.55 + .30 * lit) + ')';
    ctx.beginPath(); ctx.arc(nodes[i][0], nodes[i][1], rcr * .075, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(126,240,220,.16)';
    ctx.beginPath(); ctx.arc(nodes[i][0], nodes[i][1], rcr * .20, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(63,217,192,' + (.20 + .18 * lit) + ')'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(ccx, ccy, rcr * sqx, rcr * sqy, 0, Math.PI * .96, Math.PI * 1.48); ctx.stroke();
  ctx.restore();

  /* 重凝：环形扩散一次 */
  if (this.mat > 0 || this.coreFlash > .02) {
    var fa = Math.max(this.mat * .30, this.coreFlash * .40);
    var fr = rcr * (1.5 + (1 - Math.max(this.mat, this.coreFlash)) * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fa;
    ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(ccx, ccy, fr, fr * .62, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
};
Steelyard.prototype.paint = function (dt, t) {
  var ctx = this.ctx, w = this.W, h = this.H;
  if (!ctx || !w) return;
  var R = this.R, cx = this.cx, d = dt / 1000, i, q;
  /* 本帧「活着」吗：循环在跑且不是 reduced-motion。朴素档（!motion）也 live ——
     器物本体照样是静止单帧（dt = 0），但环上的流光要画、要走。 */
  this.live = this.running && !this.reduced;
  ctx.clearRect(0, 0, w, h);

  if (!this.kern.length) this.seedKernels();

  /* ---------- 载荷与目标位：本市的基准位 + 拖秤盘偏移（拖盘 = 加压，砣自己去追新的平衡位） ---------- */
  this.load = this.baseArm + this.panK;
  if (this.dragKind !== 'bob') this.armT = this.baseArm + this.panK;

  /* ---------- 力学 ---------- */
  if (dt > 0) {
    /* 游砣：拖的时候跟手（略滞后 = 有质量）；不拖时手推式弹簧（略欠阻尼，到位回稳一下） */
    if (this.dragKind === 'bob' && this.handArm != null) {
      var b0 = this.arm;
      this.arm += (this.handArm - this.arm) * Math.min(1, d * 24);
      this.armV = (this.arm - b0) / Math.max(d, .0001);
    } else {
      var dArm = this.armT - this.arm;
      this.armV += (dArm * 34 - this.armV * 9.2) * d;
      this.arm += this.armV * d;
      if (Math.abs(dArm) < .004 && Math.abs(this.armV) < .012) {
        this.arm = this.armT; this.armV *= .55;
        if (this.lockOn) { this.lockOn = false; this.locked = true; this.lockT = 1; }
      }
    }
    /* 移入唤醒扫一道标定光；点载荷 = 一次「捏」（各案自己演） */
    if (this.hs >= 0) { this.hs += d / .85; if (this.hs > 1.12) this.hs = -1; }
    this.poke = Math.max(0, this.poke - d / .55);
    /* 全息层计时：扫描扫完、锁定环扩散 */
    if (this.scan < 1) this.scan = Math.min(1, this.scan + d / .85);
    if (this.lockT > 0) this.lockT = Math.max(0, this.lockT - d / .95);

    /* 秤杆：力矩（砣位 − 载荷）→ 倾角；弹簧阻尼 + 干摩擦（摆小了就收住） */
    var tau = (this.arm - this.load) * 3.4 + this.bobPull * 3.0;   /* 砣侧手感压力（竖拖砣）也进力矩 */
    this.angV += (tau - this.ang * 13 - this.angV * 3 - this.armV * .010) * d;
    if (Math.abs(tau - this.ang * 13) < .020 && Math.abs(this.angV) < .032) this.angV *= .88;
    this.ang += this.angV * d;
    this.ang = clamp(this.ang, -.17, .17);

    /* 秤盘钟摆：被杆甩到 + 空气微扰 */
    this.panV += (-this.pan * 20 - this.panV * 2.7 + this.angV * .30 + Math.sin(t * .61 + 3.1) * .16) * d;
    this.pan += this.panV * d;
    this.pan = clamp(this.pan, -.24, .24);

    /* 砣绳小摆：滞后于杆 */
    this.psV += (-this.ps * 17 - this.psV * 2.1 + this.angV * .22 + Math.sin(t * .53 + 1.1) * .11 + Math.sin(t * 1.27) * .05) * d;
    this.ps += this.psV * d;
    this.ps = clamp(this.ps, -.09, .09);

    /* 整架绕吊点微摆：杆动的反冲 + 空气 */
    this.swayV += (-this.sway * 2.3 - this.swayV * .55 - this.angV * .045 + Math.sin(t * .37) * .016) * d;
    this.sway += this.swayV * d;
    this.sway = clamp(this.sway, -.055, .055);

    /* 砣尾迹强度：跟手速 */
    this.trail += (clamp(Math.abs(this.armV) * R * .45, 0, R * .30) - this.trail) * Math.min(1, d * 6);

    /* 星点：连续光场（随砣走）+ 指数余辉，不再逐颗跳变 */
    for (i = 0; i < MARKN; i++) {
      var gm = Math.exp(-Math.pow((this.arm - (MARK0 + i * MARKSTEP)) / .045, 2));
      this.lit[i] = Math.max(this.lit[i] * Math.exp(-d * 1.15), gm);
    }
  } else {
    /* 静止单帧：光停在砣位；切市=立刻锁定（无扫描过程） */
    for (i = 0; i < MARKN; i++) {
      this.lit[i] = Math.pow(Math.exp(-Math.pow((this.arm - (MARK0 + i * MARKSTEP)) / .045, 2)), 1.5);
    }
    if (this.lockOn) { this.lockOn = false; this.locked = true; this.lockT = 1; }
    this.scan = 1;
    this.trail = 0;
    /* 静止单帧：盘内载荷也停在稳定相位（核归位不复位、液不漏不注、缕不解绕） */
    this.mat = 0; this.coreDim = 0; this.coreInit = false; this.coreSq = 1;
    this.cageK = 1; this.cageV = 0;
    this.poke = 0; this.hs = -1;
    /* 静止单帧也解一次静平衡：鼠标拖到哪，杆就停在与载荷相抵的那个角 */
    this.ang = clamp(((this.arm - this.load) * 3.4 + this.bobPull * 3.0) / 13, -.17, .17);
  }

  /* ---------- 骨架几何 ---------- */
  var beamLen = R * 1.44, armL = beamLen * .38, armR = beamLen * .62;
  /* 悬点：绳至少 .98R；器物位偏方（本体比 R 需要的竖向余量还矮）时绳子按「绳头缩进上沿外」
     加长，保证吊点永远在画布之上——绳头不会露在框里，构图只跟 beamY 走、不随比例变 */
  var fy0 = this.beamY, ropeL = Math.max(R * .98, fy0 + R * .04);
  var ax = cx - R * .10, ay = fy0 - ropeL;
  var fx = ax + Math.sin(this.sway) * ropeL, fy = ay + Math.cos(this.sway) * ropeL;
  var ca = Math.cos(this.ang), sa = Math.sin(this.ang);
  this.beam = { fx: fx, fy: fy, ca: ca, sa: sa, armR: armR, armL: armL };   /* 给鼠标：把手投影回杆轴（不要叫 frame：Stage 的帧句柄在用） */
  var ux = sa, uy = -ca;                                    /* 杆的上法向 */
  var lx = fx - armL * ca, ly = fy - armL * sa;             /* 盘侧杆端 */
  var rx = fx + armR * ca, ry = fy + armR * sa;             /* 砣侧杆端 */
  var wx = fx + armR * ca * this.arm, wy = fy + armR * sa * this.arm;
  var hbF = beamHalf(R, 0), loopR = Math.max(hbF * 2.2, R * .030);
  var hbW = beamHalf(R, this.arm * armR / beamLen);
  var cxp = wx - ux * hbW, cyp = wy - uy * hbW;             /* 砣绳挂点（杆下沿） */

  /* ---------- 提绳：双股，从页头带上沿垂下 ---------- */
  var ny = fy - loopR * 1.27;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(232,183,58,.18)'; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(fx, ny); ctx.stroke();
  ctx.strokeStyle = 'rgba(240,205,120,.60)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(ax + .9, ay); ctx.lineTo(fx + .9, ny); ctx.stroke();
  ctx.strokeStyle = 'rgba(148,96,26,.55)'; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(ax - .9, ay); ctx.lineTo(fx - .9, ny); ctx.stroke();
  ctx.restore();

  /* ---------- 秤杆：锥形木杆（提纽处最粗，两端收细） ---------- */
  var NL = 11, topP = [], botP = [];
  for (i = 0; i < NL; i++) {
    var f = i / (NL - 1);
    var ecx = lx + (rx - lx) * f, ecy = ly + (ry - ly) * f;
    var hh = beamHalf(R, f - .38);
    topP.push([ecx + ux * hh, ecy + uy * hh]);
    botP.push([ecx - ux * hh, ecy - uy * hh]);
  }
  ctx.beginPath(); ctx.arc(lx, ly, beamHalf(R, -.38), 0, TAU);
  ctx.fillStyle = 'rgba(156,104,36,.95)'; ctx.fill();
  ctx.beginPath(); ctx.arc(rx, ry, beamHalf(R, .62), 0, TAU);
  ctx.fillStyle = 'rgba(150,100,34,.95)'; ctx.fill();
  var wg = ctx.createLinearGradient(fx + ux * R * .05, fy + uy * R * .05, fx - ux * R * .05, fy - uy * R * .05);
  wg.addColorStop(0, 'rgba(255,236,182,.80)');
  wg.addColorStop(.26, 'rgba(228,178,88,.96)');
  wg.addColorStop(.60, 'rgba(158,106,34,.96)');
  wg.addColorStop(1, 'rgba(70,42,12,.94)');
  ctx.save();
  ctx.shadowColor = 'rgba(232,183,58,.42)'; ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.moveTo(topP[0][0], topP[0][1]);
  for (i = 1; i < NL; i++) ctx.lineTo(topP[i][0], topP[i][1]);
  for (i = NL - 1; i >= 0; i--) ctx.lineTo(botP[i][0], botP[i][1]);
  ctx.closePath();
  ctx.fillStyle = wg; ctx.fill();
  ctx.restore();
  /* 上下沿 + 木纹（跟着锥度收） */
  ctx.strokeStyle = 'rgba(255,240,200,.45)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(topP[0][0], topP[0][1]);
  for (i = 1; i < NL; i++) ctx.lineTo(topP[i][0], topP[i][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(38,22,6,.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(botP[0][0], botP[0][1]);
  for (i = 1; i < NL; i++) ctx.lineTo(botP[i][0], botP[i][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(92,56,14,.30)'; ctx.lineWidth = .8;
  for (var gr = 0; gr < 2; gr++) {
    var gt = gr ? .70 : .38;
    ctx.beginPath();
    for (i = 0; i < NL; i++) {
      var gx = topP[i][0] + (botP[i][0] - topP[i][0]) * gt;
      var gy = topP[i][1] + (botP[i][1] - topP[i][1]) * gt;
      if (i === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
    }
    ctx.stroke();
  }

  /* ---------- 提纽：绳环绕杆 + 绳结（绳压过杆面） ---------- */
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(26,14,4,.38)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx - loopR * .92, fy + R * .003); ctx.lineTo(fx + loopR * .92, fy + R * .003);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(238,198,112,.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fx - loopR, fy + R * .010);
  ctx.bezierCurveTo(fx - loopR * 1.18, fy - loopR * 1.7, fx + loopR * 1.18, fy - loopR * 1.7, fx + loopR, fy + R * .010);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(fx, ny + 1, R * .0095, 0, TAU);
  ctx.fillStyle = 'rgba(242,208,126,.9)'; ctx.fill();
  ctx.restore();

  /* ---------- 刻星：未亮是墨星（真秤的星记），点亮成暖光星心 ---------- */
  for (i = 0; i < MARKN; i++) {
    var kt = MARK0 + i * MARKSTEP;
    var mx = fx + armR * ca * kt, my = fy + armR * sa * kt;
    var lv = this.lit[i], big = (i % 4 === 0);
    var rr = (big ? R * .0118 : R * .0062) * (1 + lv * .30);
    ctx.beginPath(); ctx.arc(mx, my, rr, 0, TAU);
    ctx.fillStyle = 'rgba(56,30,6,' + (.72 * (1 - lv * .9)) + ')'; ctx.fill();
    if (lv > .02) {
      ctx.beginPath(); ctx.arc(mx, my, rr * (.46 + lv * .54), 0, TAU);
      ctx.fillStyle = 'rgba(255,230,160,' + (lv * .95) + ')'; ctx.fill();
    }
    if (lv > .10) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var hg = ctx.createRadialGradient(mx, my, 0, mx, my, R * .055);
      hg.addColorStop(0, 'rgba(255,232,168,' + (lv * .48) + ')');
      hg.addColorStop(1, 'rgba(255,232,168,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(mx, my, R * .055, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  for (i = 0; i < MARKN - 1; i++) {
    var lg = Math.max(this.lit[i], this.lit[i + 1]);
    var st = MARK0 + (i + .5) * MARKSTEP;
    ctx.fillStyle = 'rgba(52,28,6,' + (.30 + lg * .45) + ')';
    ctx.beginPath();
    ctx.arc(fx + armR * ca * st, fy + armR * sa * st, R * .0026, 0, TAU);
    ctx.fill();
  }

  /* ---------- 赛博测量层：全息游标尺（轨 + 投影刻度 + 游标爪 + 数据包 + 锁定 + 扫描） ----------
     木杆墨星是古器本体，青色全息层是「量」的那一半：只读、不写回、无数字。 */
  var RAIL = R * .086;
  var rlx = fx + ux * RAIL, rly = fy + uy * RAIL;                       /* 轨起点（提纽正上方） */
  var rwx = wx + ux * RAIL, rwy = wy + uy * RAIL;                       /* 游标爪（随砣走） */
  var rEx = fx + armR * ca * (MARK0 + (MARKN - 1) * MARKSTEP) + ux * RAIL;
  var rEy = fy + armR * sa * (MARK0 + (MARKN - 1) * MARKSTEP) + uy * RAIL;
  var scS = this.scan < 1 ? (-armL / armR + (this.armT + armL / armR) * easeOut(this.scan)) : -99;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  /* 轨：虚线流光 */
  ctx.setLineDash([4, 8]);
  ctx.lineDashOffset = -t * 18;
  ctx.strokeStyle = 'rgba(63,217,192,.26)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rlx, rly); ctx.lineTo(rEx, rEy); ctx.stroke();
  ctx.setLineDash([]);
  /* 投影刻度：与木杆墨星一一对应，随砣点亮；扫描经过时额外一闪 */
  for (i = 0; i < MARKN; i++) {
    var pt = MARK0 + i * MARKSTEP;
    var qx = fx + armR * ca * pt + ux * RAIL, qy = fy + armR * sa * pt + uy * RAIL;
    var ql = (i % 4 === 0 ? R * .026 : R * .015);
    var lv2 = this.lit[i];
    if (scS > -50) lv2 = Math.max(lv2, Math.exp(-Math.pow((scS - pt) / .022, 2)) * .85);
    ctx.strokeStyle = 'rgba(63,217,192,' + (.19 + lv2 * .58) + ')';
    ctx.lineWidth = 1 + lv2 * .7;
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx + ux * ql, qy + uy * ql); ctx.stroke();
  }
  /* 数据包：从提纽流向游标爪（读一遍，不落库） */
  for (i = 0; i < 2; i++) {
    var tp = (t * .28 + i * .5) % 1;
    var pkx = rlx + (rwx - rlx) * tp, pky = rly + (rwy - rly) * tp;
    var pkf = Math.sin(tp * Math.PI);
    ctx.globalAlpha = pkf * .22;
    ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(pkx - ca * R * .05, pky - sa * R * .05); ctx.lineTo(pkx, pky); ctx.stroke();
    ctx.globalAlpha = pkf * .85;
    ctx.fillStyle = CYAN;
    ctx.beginPath(); ctx.arc(pkx, pky, 1.4, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  /* 游标爪：跨轨的十字（砣到哪，读到哪） */
  ctx.strokeStyle = 'rgba(63,217,192,.52)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(rwx - ux * R * .034, rwy - uy * R * .034);
  ctx.lineTo(rwx + ux * R * .014, rwy + uy * R * .014);
  ctx.moveTo(rwx - ca * R * .016, rwy - sa * R * .016);
  ctx.lineTo(rwx + ca * R * .016, rwy + sa * R * .016);
  ctx.stroke();
  /* 锁定：括号常亮（轻微呼吸）+ 扩散环一次性 */
  if (this.locked || this.lockT > .02) {
    var lsz = R * .036 * (.72 + this.lockT * .28);
    var ox = fx + armR * ca * this.armT + ux * RAIL;
    var oy = fy + armR * sa * this.armT + uy * RAIL;
    var lbr = this.locked ? (.46 + .12 * Math.sin(t * 2.1)) : 0;
    ctx.globalAlpha = Math.max(lbr, this.lockT * .9);
    ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ox - lsz, oy - lsz * .45); ctx.lineTo(ox - lsz, oy - lsz); ctx.lineTo(ox - lsz * .45, oy - lsz);
    ctx.moveTo(ox + lsz, oy - lsz * .45); ctx.lineTo(ox + lsz, oy - lsz); ctx.lineTo(ox + lsz * .45, oy - lsz);
    ctx.stroke();
    if (this.lockT > .02) {
      ctx.globalAlpha = this.lockT * .40;
      ctx.beginPath(); ctx.arc(ox, oy, lsz * (1 + (1 - this.lockT) * 2.6), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  /* 扫描：切市时沿杆扫一道（扫过处刻度闪一下，像现场标定） */
  if (scS > -50) {
    var scX = fx + armR * ca * scS, scY = fy + armR * sa * scS;
    var scA = Math.sin(clamp(this.scan, 0, 1) * Math.PI);
    var sg = ctx.createLinearGradient(scX - ux * R * .05, scY - uy * R * .05, scX + ux * R * .13, scY + uy * R * .13);
    sg.addColorStop(0, 'rgba(63,217,192,0)');
    sg.addColorStop(.42, 'rgba(63,217,192,' + (.40 * scA) + ')');
    sg.addColorStop(1, 'rgba(63,217,192,0)');
    ctx.strokeStyle = sg; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(scX - ux * R * .05, scY - uy * R * .05);
    ctx.lineTo(scX + ux * R * .13, scY + uy * R * .13);
    ctx.stroke();
  }
  /* 移入唤醒：从盘侧扫到砣位（一次，青色比标定光淡；与切市的标定光同形不同色） */
  if (this.hs >= 0) {
    var hsU = clamp(this.hs, 0, 1);
    var hS = -armL / armR + (this.arm + armL / armR) * easeOut(hsU);
    var hX = fx + armR * ca * hS, hY = fy + armR * sa * hS;
    var hA = Math.sin(hsU * Math.PI) * .52;
    var hgd = ctx.createLinearGradient(hX - ux * R * .04, hY - uy * R * .04, hX + ux * R * .11, hY + uy * R * .11);
    hgd.addColorStop(0, 'rgba(126,240,220,0)');
    hgd.addColorStop(.42, 'rgba(126,240,220,' + hA + ')');
    hgd.addColorStop(1, 'rgba(126,240,220,0)');
    ctx.strokeStyle = hgd; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hX - ux * R * .04, hY - uy * R * .04);
    ctx.lineTo(hX + ux * R * .11, hY + uy * R * .11);
    ctx.stroke();
  }
  ctx.restore();

  /* ---------- 游砣 · 尾迹（沿杆拖，跟手速） ---------- */
  var ps = this.ps, pcs = Math.sin(ps), pcc = Math.cos(ps);
  if (this.trail > R * .012) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var tlx = wx - ca * this.trail, tly = wy - sa * this.trail;
    var hx1 = wx + ca * R * .014, hy1 = wy + sa * R * .014;
    var tlw = ctx.createLinearGradient(tlx, tly, wx, wy);
    tlw.addColorStop(0, 'rgba(232,183,58,0)');
    tlw.addColorStop(1, 'rgba(255,228,158,.40)');
    ctx.fillStyle = tlw;
    ctx.beginPath();
    ctx.moveTo(tlx, tly);
    ctx.lineTo(hx1 + ux * R * .028, hy1 + uy * R * .028);
    ctx.lineTo(hx1 - ux * R * .028, hy1 - uy * R * .028);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- 游砣：砣绳 + 提梁 + 钟形砣体（肩台 / 弦纹 / 分面 / 铸记 / 底沿） ---------- */
  var cordL = R * .055;
  var rgx = cxp + pcs * cordL, rgy = cyp + pcc * cordL;
  ctx.strokeStyle = 'rgba(240,205,120,.55)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(cxp + .8, cyp); ctx.lineTo(rgx + .8, rgy); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,98,26,.60)'; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(cxp - .8, cyp); ctx.lineTo(rgx - .8, rgy); ctx.stroke();

  var bw = R * .056, bh = R * .116, by = R * .034;
  /* 鼠标命中区：砣体是一颗挂在绳下的「钟」，命中要落在看得见的那块上（另给挂点一个小圈） */
  this.bobPt = { x: rgx, y: rgy + by + bh * .52, rx: bw * 2.1, ry: bh * .78, hx: wx, hy: wy, hr: R * .10 };

  ctx.save();
  ctx.translate(rgx, rgy);
  ctx.rotate(ps);

  /* 提梁：两条立柱 + 顶上弧（拱形提手，两端落在肩台上） */
  ctx.strokeStyle = 'rgba(255,238,190,.82)'; ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(-bw * .30, by + R * .004);
  ctx.lineTo(-bw * .30, by - R * .020);
  ctx.quadraticCurveTo(0, by - R * .046, bw * .30, by - R * .020);
  ctx.lineTo(bw * .30, by + R * .004);
  ctx.stroke();
  /* 肩台：提梁落在肩上那一道短横 */
  ctx.strokeStyle = 'rgba(255,228,156,.50)'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(-bw * .44, by + R * .002); ctx.lineTo(bw * .44, by + R * .002); ctx.stroke();

  /* 砣顶面：一枚扁椭圆（顶面受光 → 砣才是个立体的钟，不是剪影） */
  ctx.beginPath();
  ctx.ellipse(0, by, bw * .46, bw * .15, 0, 0, TAU);
  var tg = ctx.createLinearGradient(0, by - bw * .15, 0, by + bw * .15);
  tg.addColorStop(0, 'rgba(255,238,190,.55)');
  tg.addColorStop(.5, 'rgba(196,138,50,.75)');
  tg.addColorStop(1, 'rgba(96,54,14,.85)');
  ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,196,.50)'; ctx.lineWidth = .9; ctx.stroke();

  /* 砣体：钟形（坐得住），金属柱面左受光 */
  ctx.beginPath();
  ctx.moveTo(-bw * .44, by);
  ctx.bezierCurveTo(-bw * 1.02, by + bh * .20, -bw * 1.12, by + bh * .62, -bw * .98, by + bh * .94);
  ctx.quadraticCurveTo(0, by + bh * 1.10, bw * .98, by + bh * .94);
  ctx.bezierCurveTo(bw * 1.12, by + bh * .62, bw * 1.02, by + bh * .20, bw * .44, by);
  ctx.quadraticCurveTo(0, by - bh * .10, -bw * .44, by);
  ctx.closePath();
  var bg = ctx.createLinearGradient(-bw * 1.06, 0, bw * 1.06, 0);
  bg.addColorStop(0, 'rgba(56,30,8,.96)');
  bg.addColorStop(.20, 'rgba(142,86,24,.96)');
  bg.addColorStop(.38, 'rgba(226,176,84,.97)');
  bg.addColorStop(.52, 'rgba(252,226,158,.97)');
  bg.addColorStop(.70, 'rgba(184,122,38,.96)');
  bg.addColorStop(.88, 'rgba(90,50,12,.95)');
  bg.addColorStop(1, 'rgba(40,20,6,.96)');
  ctx.save();
  ctx.shadowColor = 'rgba(232,183,58,.45)'; ctx.shadowBlur = 8;
  ctx.fillStyle = bg; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,238,190,.72)'; ctx.lineWidth = 1.05; ctx.stroke();

  /* 砣体里的细节（裁在体里画） */
  ctx.save();
  ctx.clip();
  /* 铸记：肩下一枚方形回纹小印（不写字，只表「铸过」） */
  rrect(ctx, -bw * .17, by + bh * .26, bw * .34, bh * .20, 1);
  ctx.strokeStyle = 'rgba(52,28,6,.44)'; ctx.lineWidth = 1; ctx.stroke();
  rrect(ctx, -bw * .17 + .7, by + bh * .26 + .7, bw * .34, bh * .20, 1);
  ctx.strokeStyle = 'rgba(255,242,204,.24)'; ctx.stroke();
  /* 两道弦纹（箍）：亮暗配对、弧短一点（免得读成一张脸） */
  var hoops = [[.50, .54], [.70, .78]];
  for (i = 0; i < hoops.length; i++) {
    var hy2 = by + bh * hoops[i][0], hw2 = bw * hoops[i][1];
    ctx.strokeStyle = 'rgba(48,26,6,.40)'; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.ellipse(0, hy2, hw2, hw2 * .16, 0, Math.PI * .14, Math.PI * .86); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,242,200,.20)'; ctx.lineWidth = .85;
    ctx.beginPath(); ctx.ellipse(0, hy2 + .8, hw2 * .96, hw2 * .15, 0, Math.PI * .18, Math.PI * .82); ctx.stroke();
  }
  /* 底沿：宽座 + 底面一线光（砣能「坐」得住） */
  ctx.strokeStyle = 'rgba(44,22,6,.50)'; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(-bw * .88, by + bh * .86); ctx.quadraticCurveTo(0, by + bh * 1.03, bw * .88, by + bh * .86); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,236,182,.32)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(-bw * .72, by + bh * 1.02); ctx.quadraticCurveTo(0, by + bh * 1.12, bw * .72, by + bh * 1.02); ctx.stroke();
  /* 高光：左上一枚镜面 + 右侧一道环境反光带 */
  ctx.beginPath();
  ctx.ellipse(-bw * .34, by + bh * .30, bw * .14, bh * .18, -.12, 0, TAU);
  ctx.fillStyle = 'rgba(255,250,228,.30)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,248,220,.16)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(bw * .72, by + bh * .26); ctx.quadraticCurveTo(bw * .86, by + bh * .56, bw * .66, by + bh * .84);
  ctx.stroke();
  ctx.restore();

  /* 冷边光：左上一线青（与铜盘 / 光核同一套打光） */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(63,217,192,.30)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-bw * .46, by + bh * .02);
  ctx.bezierCurveTo(-bw * 1.02, by + bh * .20, -bw * 1.12, by + bh * .62, -bw * .98, by + bh * .90);
  ctx.stroke();
  ctx.restore();

  /* 悬停：整颗砣亮一圈（告诉用户「这颗能拖」） */
  if (this.hot === 'bob') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,238,190,.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-bw * .44, by);
    ctx.bezierCurveTo(-bw * 1.02, by + bh * .20, -bw * 1.12, by + bh * .62, -bw * .98, by + bh * .94);
    ctx.quadraticCurveTo(0, by + bh * 1.10, bw * .98, by + bh * .94);
    ctx.bezierCurveTo(bw * 1.12, by + bh * .62, bw * 1.02, by + bh * .20, bw * .44, by);
    ctx.quadraticCurveTo(0, by - bh * .10, -bw * .44, by);
    ctx.stroke();
    var hg3 = ctx.createRadialGradient(0, by + bh * .5, bw * .2, 0, by + bh * .5, bw * 3.4);
    hg3.addColorStop(0, 'rgba(255,232,168,.16)');
    hg3.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg3;
    ctx.beginPath(); ctx.arc(0, by + bh * .5, bw * 3.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  /* ---------- 秤盘：盘钩 + 三股绳 + 铜盘 + 盘中谷堆 ---------- */
  var po = this.pan;
  var pxp = lx + Math.sin(po) * R * .42, pyp = ly + Math.cos(po) * R * .42;
  this.panPt = { x: pxp, y: pyp, rx: R * .28, ry: R * .12 };   /* 鼠标命中区：拖秤盘 / 点载荷 */
  var hky = ly + hbF * 1.5 + R * .020;
  ctx.strokeStyle = 'rgba(240,205,120,.85)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(lx, ly + hbF * 1.5, R * .020, 0, TAU); ctx.stroke();
  /* 后两股绳（在盘后面） */
  ctx.strokeStyle = 'rgba(232,183,58,.32)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx, hky); ctx.lineTo(pxp - R * .185, pyp + R * .004);
  ctx.moveTo(lx, hky); ctx.lineTo(pxp + R * .185, pyp + R * .004);
  ctx.stroke();
  /* 盘：暗底 + 铜盘面 + 前口高光 + 盘内暗底 */
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .006, R * .215, R * .066, 0, 0, TAU);
  ctx.fillStyle = 'rgba(52,30,8,.85)'; ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(232,183,58,.35)'; ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .020, R * .225, R * .070, 0, 0, TAU);
  var pg = ctx.createLinearGradient(0, pyp - R * .05, 0, pyp + R * .092);
  pg.addColorStop(0, 'rgba(250,226,164,.74)');
  pg.addColorStop(.42, 'rgba(198,144,54,.80)');
  pg.addColorStop(1, 'rgba(82,48,12,.86)');
  ctx.fillStyle = pg; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(250,224,152,.85)'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .020, R * .225, R * .070, 0, Math.PI * .12, Math.PI * .88);
  ctx.strokeStyle = 'rgba(255,246,212,.50)'; ctx.lineWidth = 1; ctx.stroke();
  /* 冷边光：铜盘左上一线青（暖金主光 + 冷青轮廓 = 赛博打光） */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .020, R * .225, R * .070, 0, Math.PI * .96, Math.PI * 1.46);
  ctx.strokeStyle = 'rgba(63,217,192,.40)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = 'rgba(63,217,192,.07)'; ctx.lineWidth = 3.2; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .027, R * .190, R * .056, 0, Math.PI * 1.0, Math.PI * 1.42);
  ctx.strokeStyle = 'rgba(63,217,192,.16)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  /* 悬停在盘上：盘沿亮一圈（可抓：往下拽 = 加压） */
  if (this.hot === 'pan') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,238,190,.40)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(pxp, pyp + R * .020, R * .233, R * .074, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(pxp, pyp + R * .027, R * .196, R * .056, 0, 0, TAU);
  var ig = ctx.createRadialGradient(pxp, pyp + R * .010, R * .02, pxp, pyp + R * .032, R * .20);
  ig.addColorStop(0, 'rgba(104,64,18,.52)');
  ig.addColorStop(1, 'rgba(22,12,4,.55)');
  ctx.fillStyle = ig; ctx.fill();
  /* 前股绳（压过盘口，做出前后层次） */
  ctx.strokeStyle = 'rgba(240,205,120,.62)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(lx, hky); ctx.lineTo(pxp, pyp - R * .030); ctx.stroke();
  /* 盘内载荷 · 光核（无形之物靠形变 + 惯性 + 束缚读「重」） */
  if (dt > 0) this.stepLoad(d, t, pxp, pyp);
  this.drawCore(ctx, t, pxp, pyp);

  /* ---------- 屑：摩擦 / 急摆 / 盘晃时起 ---------- */
  if (dt > 0) {
    if (this.trail > R * .05 && Math.random() < .45) {
      this.sparks.push({ x: cxp, y: cyp, vx: -ca * rnd(10, 34) + rnd(-6, 6), vy: -sa * rnd(10, 34) + rnd(-14, -2), life: rnd(.25, .6), max: .6, r: rnd(.4, 1.2), c: Math.random() < .3 ? CYAN : '#ffe08a' });
    }
    if (Math.abs(this.angV) > .09 && Math.random() < .20) {
      this.sparks.push({ x: wx + rnd(-R * .03, R * .03), y: wy, vx: rnd(-40, 40), vy: rnd(-48, -8), life: rnd(.3, .7), max: .7, r: rnd(.5, 1.5), c: Math.random() < .4 ? CYAN : '#ffe08a' });
    }
    if (Math.abs(this.panV) > .30 && Math.random() < .16) {
      this.sparks.push({ x: pxp + rnd(-R * .17, R * .17), y: pyp - R * .012, vx: rnd(-24, 24), vy: rnd(-42, -12), life: rnd(.35, .8), max: .8, r: rnd(.4, 1.2), c: '#ffe08a' });
    }
    if (this.sparks.length > 80) this.sparks.splice(0, this.sparks.length - 80);
    for (i = this.sparks.length - 1; i >= 0; i--) {
      var sk0 = this.sparks[i];
      sk0.life -= d; sk0.vy += 60 * d;
      sk0.x += sk0.vx * d; sk0.y += sk0.vy * d;
      if (sk0.life <= 0) this.sparks.splice(i, 1);
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (i = 0; i < this.sparks.length; i++) {
    var sk = this.sparks[i], al = clamp(sk.life / sk.max, 0, 1);
    ctx.globalAlpha = al * .8; ctx.fillStyle = sk.c;
    ctx.beginPath(); ctx.arc(sk.x, sk.y, sk.r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
};


/* ================= 生命周期：尺寸 / 帧循环 / 指针 / 已有交互 ================= */

Steelyard.prototype.setSize = function () {
  const cv = this.canvas;
  const w = Math.max(1, Math.round(cv.clientWidth));
  const h = Math.max(1, Math.round(cv.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  if (w === this.W && h === this.H && dpr === this.dpr) return;
  this.dpr = dpr;
  this.canvas.width = Math.round(w * dpr);
  this.canvas.height = Math.round(h * dpr);
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.resize(w, h);
  this.safePaint(0, this.clock);
};

Steelyard.prototype.step = function (now) {
  if (!this.running) return;
  const dt = clamp(now - this.last, 4, 48);
  this.last = now;
  if (!this.motion) {
    /* 朴素档：器物本体是静止单帧 —— 只推流光相位（holoPh），不推时钟（clock），
       于是所有读 t 的本体细节（核里漩涡 / 盘口光点 / 轮廓起伏…）都停在原地，
       动的只有环上那道光。帧率收一半：光走得慢，30fps 就够，别为一道光常烧 60fps。 */
    this.holoPh += (dt / 1000) * (.16 + (this.ptr.on ? .44 : 0));
    this.lightAcc = (this.lightAcc || 0) + dt;
    /* 拖拽时按满帧率补（手上的东西不能卡在 30fps），其余时候 30fps 足够 */
    if (this.lightAcc < 33 && !this.dragKind) { this.frame = requestAnimationFrame(this.step.bind(this)); return; }
    this.lightAcc = 0;
  } else {
    this.clock += dt / 1000;
  }
  this.safePaint(this.motion ? dt : 0, this.clock);
  this.frame = requestAnimationFrame(this.step.bind(this));
};

/* 状态自愈：任何一个状态变量变成非有限值（NaN / Infinity）时回到安全默认值。
   一个 NaN 顺着 gradient / 路径传下去，轻则某件东西从此不画，重则整帧抛错 —— 都在这里截住。 */
Steelyard.prototype.sanitize = function () {
  const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const base = fin(this.baseArm, A_DOM);
  this.baseArm = base;
  this.arm = fin(this.arm, base);
  this.armT = fin(this.armT, base);
  this.load = fin(this.load, base);
  this.ang = fin(this.ang, 0); this.angV = fin(this.angV, 0);
  this.pan = fin(this.pan, 0); this.panV = fin(this.panV, 0);
  this.ps = fin(this.ps, 0); this.psV = fin(this.psV, 0);
  this.sway = fin(this.sway, 0); this.swayV = fin(this.swayV, 0);
  this.trail = fin(this.trail, 0);
  this.panK = fin(this.panK, 0);
  this.bobPull = fin(this.bobPull, 0);
  this.handArm = this.handArm == null ? null : fin(this.handArm, null);
  this.clock = fin(this.clock, 0);
  this.mat = fin(this.mat, 0); this.poke = fin(this.poke, 0); this.hs = fin(this.hs, -1);
  this.coreDim = fin(this.coreDim, 0); this.coreFlash = fin(this.coreFlash, 0);
  this.coreX = fin(this.coreX, 0); this.coreY = fin(this.coreY, 0);
  this.coreVX = fin(this.coreVX, 0); this.coreVY = fin(this.coreVY, 0);
  this.coreSq = fin(this.coreSq, 1); this.coreRot = fin(this.coreRot, 0);
  this.cageK = fin(this.cageK, 1); this.cageV = fin(this.cageV, 0);
  this.cagePh = fin(this.cagePh, 0); this.holoPh = fin(this.holoPh, 0);
  this.lockT = fin(this.lockT, 0); this.scan = fin(this.scan, 1);
  this.ptr.x = fin(this.ptr.x, 0); this.ptr.y = fin(this.ptr.y, 0);
};

/* 把上一帧好画面贴回去（画布绝不空着） */
Steelyard.prototype.blitBuf = function () {
  if (!this.bufCtx || !this.buf.width) return;
  const ctx = this.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.drawImage(this.buf, 0, 0);
  ctx.restore();
};

/* 一帧画布不落地：绘制失败不许把图腾「画没」，也不许把画面冻死——
   回退上一帧好画面 + 退避 0.8s 后自动重试（状态类故障经 sanitize 下一帧就能自己恢复）；
   警告最多打 3 条，不刷屏；循环始终活着，所以拖拽 / 点击不会因此失联。 */
Steelyard.prototype.safePaint = function (dt, t) {
  const cv = this.canvas;
  this.sanitize();
  if (this.failT != null && t - this.failT < 0.8) { this.blitBuf(); return; }
  try {
    this.paint(dt, t);
    if (!this.buf) this.buf = document.createElement('canvas');
    if (this.buf.width !== cv.width || this.buf.height !== cv.height) {
      this.buf.width = cv.width; this.buf.height = cv.height;
      this.bufCtx = this.buf.getContext('2d');
      this.bufT = -9;
    }
    if (t - (this.bufT || -9) > 0.5 || dt === 0) {   /* 好帧快照（限频，别每帧都拷贝整张画布） */
      this.bufCtx.clearRect(0, 0, this.buf.width, this.buf.height);
      this.bufCtx.drawImage(cv, 0, 0);
      this.bufT = t;
    }
    this.failT = null;
  } catch (err) {
    this.failT = t;
    this.fails = (this.fails || 0) + 1;
    if (this.fails <= 3) console.warn('杆秤图腾：本帧绘制失败，已回退上一帧好画面（不会消失，0.8s 后自动重试）。', err);
    this.blitBuf();
  }
};

Steelyard.prototype.start = function () {
  if (this.reduced || !this.visible || this.running) return;
  this.running = true;
  this.last = performance.now();
  this.frame = requestAnimationFrame(this.step.bind(this));
};

Steelyard.prototype.stop = function () {
  if (this.frame) cancelAnimationFrame(this.frame);
  this.frame = 0;
  if (!this.running) return;
  this.running = false;
  this.clock += 0.001;
  this.safePaint(0, this.clock);   /* 停时补一帧静止等价物 */
};

Steelyard.prototype.repaint = function () {
  if (!this.running) this.safePaint(0, this.clock);
};

/* 器物本体这一档是不是「静止单帧」：朴素档（!motion）或循环没在跑（reduced-motion / 停循环）。
   这些档位里没有力学积分 —— 拖拽与切市都当场解算（与朴素档一贯的手感一致），不是补帧动画。 */
Steelyard.prototype.bodyStatic = function () {
  return !this.motion || !this.running;
};

/* 市值手感位：东市 / 西市（只换砣位与扫描，不读任何数据） */
Steelyard.prototype.setMarket = function (name) {
  const next = name === 'overseas' ? A_OVS : A_DOM;
  if (next === this.baseArm) return;
  this.baseArm = next;
  this.bobPull = 0;
  this.armT = next;
  this.load = next;
  this.locked = false;
  this.lockOn = true;
  this.scan = 0;
  this.mat = 1;
  this.reactLoad();
  /* 本体静止档 = 直接锁定：砣当场落到新星位，杆解一次静平衡，不演扫描 */
  if (this.bodyStatic()) {
    this.arm = next;
    this.armV = 0;
    this.ang = clamp((this.arm - this.load) * .2615, -.17, .17);
    this.scan = 1;
    this.locked = true;
    this.lockOn = false;
    this.lockT = 1;
  }
  this.repaint();
};

/* 指针：只认鼠标。拖秤砣 / 拽秤盘 / 点载荷 / 连点两下复位 */
function attachPointer(engine, canvas) {
  let dragging = false;
  let kind = null;
  let moved = 0;
  let lastTap = 0;
  let sawButtons = false;
  const start = { x: 0, y: 0 };
  let pid = null;

  const loc = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (engine.W / Math.max(1, r.width)), y: (e.clientY - r.top) * (engine.H / Math.max(1, r.height)) };
  };
  const DEBUG = /(^|[?&])totem-debug(=|&|$)/.test(location.search);   /* /plans/?totem-debug：把拖拽全程打进控制台（本机排查用：加 ?totem-debug 即开，注释里别写正则转义，模板字符串会吃掉） */
  const dbg = (...a) => { if (DEBUG) console.info('[杆秤]', ...a); };
  /* 命中：砣体椭圆 + 杆上挂点 + **秤杆本体**（抓杆 = 拨砣，跟真秤一样，靶子也大得多）+ 秤盘 */
  const hit = (p) => {
    const b = engine.bobPt;
    const q = engine.panPt;
    const fr = engine.beam;
    if (b) {
      const dx = (p.x - b.x) / b.rx;
      const dy = (p.y - b.y) / b.ry;
      if (dx * dx + dy * dy < 1) return 'bob';
      if (b.hx != null && Math.hypot(p.x - b.hx, p.y - b.hy) < b.hr) return 'bob';
    }
    if (fr && Number.isFinite(fr.armR) && fr.armR > 0) {
      const dx2 = p.x - fr.fx, dy2 = p.y - fr.fy;
      const u = (dx2 * fr.ca + dy2 * fr.sa) / fr.armR;
      if (u > -fr.armL / fr.armR - .04 && u < 1.04) {
        const off = Math.abs(-dx2 * fr.sa + dy2 * fr.ca);   /* 到杆轴的垂距 */
        if (off < Math.max(engine.R * .038, engine.R * .020 * Math.min(3, 1 + Math.abs(u) * 6))) return 'bob';
      }
    }
    if (q && Math.abs(p.x - q.x) < q.rx && Math.abs(p.y - q.y) < q.ry) return 'pan';
    return null;
  };

  const onDown = (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') { dbg('pointerdown 忽略', e.pointerType, 'button=' + e.button); return; }
    const p = loc(e);
    const k = hit(p);
    dbg('pointerdown', e.pointerType, '命中=' + (k || '无'), 'p=(' + Math.round(p.x) + ',' + Math.round(p.y) + ')', 'arm=' + engine.arm.toFixed(3));
    if (!k) return;
    dragging = true; kind = k; moved = 0; pid = e.pointerId;
    sawButtons = !!(e.buttons > 0);
    start.x = p.x; start.y = p.y;
    engine.dragKind = k;
    if (k === 'bob') engine.handArm = engine.arm;
    try { canvas.setPointerCapture(pid); } catch (err) { /* 忽略 */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    if (dragging) {
      /* 按钮已经在画布外松开（收不到 pointerup 的那一瞬）：这里补一次收尾。
         只在本次拖拽里确实见过 buttons>0 才敢这么判 —— 少数驱动/触控板会把 buttons 一直报 0。 */
      if (e.buttons > 0) sawButtons = true;
      else if (sawButtons) { dbg('拖拽中断：buttons=0（按钮已在别处松开）'); finish(null, false); return; }
    }
    const p = loc(e);
    engine.ptr.x = p.x; engine.ptr.y = p.y; engine.ptr.on = true;
    if (dragging) {
      moved += Math.abs(p.x - start.x) + Math.abs(p.y - start.y);
      if (kind === 'bob') {
        const fr = engine.beam;
        if (fr && Number.isFinite(fr.armR) && fr.armR > 0) {
          const u = ((p.x - fr.fx) * fr.ca + (p.y - fr.fy) * fr.sa) / fr.armR;
          engine.handArm = clamp(u, MARK0 - .06, MARK0 + (MARKN - 1) * MARKSTEP + .06);
          /* 竖向：往下拽 = 压砣侧（杆向砣侧沉、盘侧抬），往上托 = 提砣侧；松手归零 */
          engine.bobPull = clamp((p.y - start.y) / (engine.R * 1.1), -.32, .45);
          if (engine.bodyStatic()) { engine.arm = engine.handArm; engine.armV = 0; }
        }
      } else {
        engine.panK = clamp((p.y - start.y) / (engine.R * .9), -.22, .58);
        if (engine.bodyStatic()) engine.arm = clamp(engine.baseArm + engine.panK, 0, 1.2);
      }
    } else {
      engine.hot = hit(p);
      canvas.style.cursor = engine.hot ? 'grab' : '';
    }
    engine.repaint();
  };

  /* 结束一次拖拽：松手在画布外 / 指针捕获丢失 / 按钮已在别处松开，都要走得回来——
     否则会卡在拖拽态（砣一直跟着鼠标、不回位），看着就是「拖不动了」 */
  const finish = (e, tapped) => {
    if (!dragging) return;
    const wasKind = kind;
    const wasMoved = moved;
    dbg('drag end', wasKind, 'moved=' + Math.round(wasMoved), 'tapped=' + !!tapped, 'arm=' + engine.arm.toFixed(3), 'pull=' + engine.bobPull.toFixed(2));
    dragging = false; kind = null; pid = null;
    engine.dragKind = null; engine.handArm = null; engine.bobPull = 0;
    if (wasKind === 'pan') engine.panK = 0;                       /* 松手：载荷回零，砣自己回位 */
    if (tapped && wasMoved <= 6) {
      /* 几乎没动 = 点载荷；连点两下（360ms 内）= 复位（不依赖 dblclick，指针捕获下更稳） */
      const now = performance.now();
      if (now - lastTap < 360) { lastTap = 0; engine.resetHands(); }
      else { lastTap = now; engine.pokeLoad(); }
    }
    if (e) {
      engine.hot = hit(loc(e));
      canvas.style.cursor = engine.hot ? 'grab' : '';
    }
    engine.repaint();
  };

  const onUp = (e) => {
    if (!dragging) return;
    if (pid != null && e && e.pointerId != null && e.pointerId !== pid) return;
    finish(e, true);
  };
  const onCancel = () => finish(null, false);
  const onLost = () => finish(null, false);   /* 指针捕获丢失：别卡在拖拽态 */
  const onLeave = () => {
    engine.hot = null;
    if (dragging) return;
    engine.ptr.on = false;
    engine.repaint();
  };
  const onEnter = () => {
    if (engine.hs < 0) engine.hs = 0;   /* 移入器物：唤醒扫一道光 */
    engine.repaint();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onLost);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerenter', onEnter);
  window.addEventListener('pointerup', onUp, true);   /* 捕获丢了也兜住：窗口级补一次收尾 */

  return function detach() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('lostpointercapture', onLost);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerenter', onEnter);
    window.removeEventListener('pointerup', onUp, true);
    canvas.style.cursor = '';
  };
}

export function mount() {
  const host = document.querySelector('[data-steelyard]');
  const canvas = host?.querySelector('[data-steelyard-canvas]');
  if (!host || !canvas?.getContext) return { release() {} };
  /* 画布被 CSS 关掉（窄屏）时不起引擎——可见性由 CSS 决定 */
  if (!canvas.offsetWidth || !canvas.offsetHeight) return { release() {} };

  const style = getComputedStyle(host);
  const motion = style.getPropertyValue('--totem-motion').trim() !== '0';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const engine = new Steelyard(canvas, { motion });
  /* 三器切换流光的落点（2026-09-23）：秤砣「换市后」的新位置（armT 为目标位，含换市滑移），
     每帧取一次——切市瞬间锚点就落在新星位上，砣滑过去后仍是同一处。单位 CSS px。 */
  canvas.__bobAnchor = function () {
    const point = engine.bobPt, beam = engine.beam;
    if (!point || !beam) return null;
    const travel = (engine.armT - engine.arm) * beam.armR;
    return { x: point.x + travel * beam.ca, y: point.y + travel * beam.sa };
  };
  engine.reduced = reduced.matches;
  engine.visible = true;
  engine.setSize();
  engine.safePaint(0, 0);

  const detachPointer = attachPointer(engine, canvas);

  /* 东市 / 西市切换 = 换手感位（只监听已有按钮，不加 DOM、不加状态位） */
  const onToggle = (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-toggle-value]') : null;
    if (!btn || !btn.closest('[data-toggle]')) return;
    engine.setMarket(btn.getAttribute('data-toggle-value'));
  };
  document.addEventListener('click', onToggle);

  const ro = new ResizeObserver(() => {
    engine.setSize();
    engine.safePaint(0, engine.clock);
  });
  ro.observe(canvas);

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      engine.visible = entries[0].isIntersecting;
      if (engine.visible) engine.start();
      else engine.stop();
    }, { threshold: 0.02 });
    io.observe(canvas);
  }

  const onVisibility = () => (document.hidden ? engine.stop() : engine.visible && engine.start());
  const onReduced = () => {
    engine.reduced = reduced.matches;
    engine.stop();
    if (!reduced.matches) engine.start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener?.('change', onReduced);

  /* 循环两档都跑（朴素档只走光、本体静止单帧；见文件头「皮肤档 × 动效」）；
     reduced-motion 才退回单帧。 */
  if (!reduced.matches) engine.start();
  else engine.safePaint(0, 0);

  return {
    release() {
      engine.stop();
      ro.disconnect();
      io?.disconnect();
      detachPointer();
      document.removeEventListener('click', onToggle);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener?.('change', onReduced);
      engine.running = false;
    },
  };
}
