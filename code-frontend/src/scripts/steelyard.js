import { CORE_R, drawBeam, drawPivot, drawWeight, drawVessel } from "./steelyard-form.js";

/* 粮市页头 · 天衡「悬日」（2026-09-29 造型重构）
   依据：frontend-spec.md §4.6（粮市页头带）。保留原杆秤交互与力学，
   造型由 steelyard-form.js 绘制：错金衡梁 / 玉璧悬枢 / 悬日环笼 / 分体权印。

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
   （环笼上的流光；帧率收一半，别为一道光常烧 60fps）。
   做法：朴素档里只推流光相位（holoPh）不推时钟（clock）——一切 t 驱动的本体细节
   都停在原地，读 t 的只有「光」；静止等价物（reduced-motion / 停循环）则不画流光的头尾。 */

var TAU = Math.PI * 2;
var CYAN = '#3fd9c0';
var MARK0 = .20, MARKN = 13, MARKSTEP = .05, A_DOM = .25, A_OVS = .75;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

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
  this.sparks = [];
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
  this.charge = 0;
  this.poke = 0; this.hs = -1;
  this.bobPt = null; this.panPt = null;
}
Steelyard.prototype.name = '粮市·杆秤';

Steelyard.prototype.resize = function (w, h) {
  this.W = w; this.H = h;
  /* 画框沿用三页统一尺寸；放大本体，给环笼下缘和摆动各留一段余量。 */
  this.R = Math.min(w * .48, h * .94);
  this.cx = w * .55;
  this.beamY = h * .88 - this.R * .54;
  this.coreInit = false;
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
  var R = this.R;
  this.cagePh += d * .55;
  this.holoPh += d * (.16 + (this.ptr.on ? .44 : 0));      /* 鼠标在器物上：全息层转快一点 */
  if (this.mat > 0) this.mat = Math.max(0, this.mat - d / 1.15);
  this.coreFlash = Math.max(0, this.coreFlash - d * 1.6);

  { /* 光核：核的惯性 + 笼的开合（无形之物靠形变 + 惯性 + 束缚读「重」） */
    var rcr = R * CORE_R;
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
Steelyard.prototype.paint = function (dt, t) {
  var ctx = this.ctx, w = this.W, h = this.H;
  if (!ctx || !w) return;
  var R = this.R, cx = this.cx, d = dt / 1000, i;
  /* 本帧「活着」吗：循环在跑且不是 reduced-motion。朴素档（!motion）也 live ——
     器物本体照样是静止单帧（dt = 0），但环上的流光要画、要走。 */
  this.live = this.running && !this.reduced;
  var chargeTarget = this.hot || this.dragKind ? 1 : 0;
  this.charge = dt > 0 ? this.charge + (chargeTarget - this.charge) * (1 - Math.exp(-d * 6)) : chargeTarget;
  ctx.clearRect(0, 0, w, h);

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
  var wx = fx + armR * ca * this.arm, wy = fy + armR * sa * this.arm;
  var hbF = beamHalf(R, 0);
  var hbW = beamHalf(R, this.arm * armR / beamLen);
  var cxp = wx - ux * hbW, cyp = wy - uy * hbW;             /* 砣绳挂点（杆下沿） */

  drawBeam(this, ctx, this.beam);
  drawPivot(this, ctx, this.beam);

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
     衡梁刻星是古器本体，青色全息层是「量」的那一半：只读、不写回、无数字。 */
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
  /* 投影刻度：与衡梁刻星一一对应，随砣点亮；扫描经过时额外一闪 */
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

  drawWeight(this, ctx, { cxp: cxp, cyp: cyp, wx: wx, wy: wy });

  /* 悬日：环笼本身承重，三股悬丝直接挂到环上。 */
  var po = this.pan;
  var pxp = lx + Math.sin(po) * R * .42, pyp = ly + Math.cos(po) * R * .42;
  var hky = ly + hbF * 1.5 + R * .020;
  ctx.strokeStyle = 'rgba(240,205,120,.85)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(lx, ly + hbF * 1.5, R * .020, 0, TAU); ctx.stroke();
  if (dt > 0) this.stepLoad(d, t, pxp, pyp);
  drawVessel(this, ctx, t, pxp, pyp, { x: lx, y: hky });

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
  this.charge = fin(this.charge, 0);
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
    try { canvas.setPointerCapture(pid); } catch (err) { console.warn('杆秤指针捕获失败，使用窗口松手兜底：', err); }
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
  if (!canvas.offsetWidth || !canvas.offsetHeight) {
    host.dataset.totem = 'off';
    return { release() {} };
  }

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
  /* 首帧已绘出：让页面收掉图腾区的 CSS 加载态（site.css「图腾区加载态」） */
  host.dataset.totem = 'ready';

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
