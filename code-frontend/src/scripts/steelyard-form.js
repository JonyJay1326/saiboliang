/* 天衡 · 悬日：只负责器物绘制；交互、力学与生命周期由 steelyard.js 持有。 */
export const CORE_R = .105;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function line(ctx, points, color, width = 1) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function polygon(ctx, points, fill, stroke, width = 1) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function glow(ctx, x, y, radius, color, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color},${alpha})`);
  gradient.addColorStop(.3, `rgba(${color},${alpha * .35})`);
  gradient.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
}

// 流光沿器表折线行进；不跨折角抄近路，也不从尾端跳线回起点。
function circuit(ctx, points, phase, power, unit, moving) {
  line(ctx, points, `rgba(77,202,176,${.22 + power * .2})`, unit * .7);
  if (!moving) return;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i-1] + Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]));
  const length = lengths[lengths.length-1];
  if (!length) return;
  const pointAt = fraction => {
    const distance = clamp(fraction, 0, 1) * length;
    let i = 1;
    while (i < lengths.length-1 && lengths[i] < distance) i++;
    const mix = (distance-lengths[i-1]) / (lengths[i]-lengths[i-1] || 1);
    return [points[i-1][0]+(points[i][0]-points[i-1][0])*mix, points[i-1][1]+(points[i][1]-points[i-1][1])*mix];
  };
  const head = ((phase % 1) + 1) % 1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const a = head - i * .014, b = a - .014;
    if (a <= 0) break;
    const alpha = (1-i/16) ** 2 * (.45+power*.45);
    const segment = [pointAt(Math.max(0,b)),pointAt(a)];
    line(ctx,segment,`rgba(53,214,180,${alpha*.2})`,unit*4);
    line(ctx,segment,`rgba(157,255,224,${alpha})`,unit*1.15);
  }
  const headPoint=pointAt(head);
  glow(ctx,headPoint[0],headPoint[1],unit*5,'80,242,201',.26+power*.18);
  ctx.fillStyle='#e0fff1';ctx.beginPath();ctx.arc(headPoint[0],headPoint[1],unit*(.85+power*.4),0,TAU);ctx.fill();
  ctx.restore();
}

export function drawBeam(engine, ctx, geometry) {
  const { fx, fy, armL, armR } = geometry, R = engine.R;
  const unit = R / 230;
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(engine.ang); ctx.lineJoin = 'round';
  const outline = [[-armL-R*.045,-R*.065],[-armL+R*.04,-R*.025],[-R*.11,-R*.038],
    [0,-R*.06],[R*.12,-R*.036],[armR-R*.035,-R*.017],[armR+R*.045,-R*.05],
    [armR+R*.023,R*.02],[R*.10,R*.032],[0,R*.048],[-R*.13,R*.03],[-armL-R*.025,R*.01]];
  // 下沿向右下挤出，顶面受光、侧面压暗，给细梁真正的厚度。
  const lower = outline.slice(7), dx=R*.012, dy=R*.018;
  const side=ctx.createLinearGradient(0,R*.02,0,R*.067);
  side.addColorStop(0,'#564b32');side.addColorStop(.35,'#222a26');side.addColorStop(1,'#0a1217');
  polygon(ctx,[...lower,...lower.map(([x,y])=>[x+dx,y+dy]).reverse()],side,'#534e37',unit*.7);
  line(ctx,lower.map(([x,y])=>[x+dx,y+dy]),'#7a704d',unit*.6);
  for(let i=0;i<lower.length;i++) {
    const [x,y]=lower[i];
    line(ctx,[[x,y],[x+dx,y+dy]],'#9c8656',unit*.65);
  }
  polygon(ctx,[outline[6],outline[7],[outline[7][0]+dx,outline[7][1]+dy],[outline[6][0]+dx,outline[6][1]+dy]],'#26302b','#746440',unit*.7);
  const metal = ctx.createLinearGradient(0, -R * .06, 0, R * .048);
  metal.addColorStop(0,'#d5bb83');metal.addColorStop(.19,'#766643');
  metal.addColorStop(.25,'#353a31');metal.addColorStop(.55,'#172524');
  metal.addColorStop(.83,'#28342c');metal.addColorStop(1,'#8b7448');
  const slots=[];
  for(let i=0;i<3;i++) {
    const x=R*.20+(armR-R*.28)*i/3, width=(armR-R*.28)/3-R*.035;
    if(width>R*.025) slots.push([[x,-R*.022],[x+width,-R*.018],[x+width-R*.008,-R*.008],[x+R*.008,-R*.008]]);
  }
  function facePath() {
    ctx.beginPath();
    for(const points of [outline,...slots]) {
      points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
    }
  }
  facePath();ctx.fillStyle=metal;ctx.fill('evenodd');
  ctx.strokeStyle='#a28c5c';ctx.lineWidth=unit*.75;ctx.stroke();
  for(const slot of slots) {
    line(ctx,[slot[0],slot[1]],'#080f14',unit*1.5);
    line(ctx,[slot[3],slot[2]],'#b29a62',unit*.6);
  }
  ctx.save();facePath();ctx.clip('evenodd');
  polygon(ctx,[...outline.slice(0,7),...outline.slice(0,7).map(([x,y])=>[x+R*.004,y+R*.006]).reverse()],'#bba06a',null);
  line(ctx,[[-armL,-R*.025],[-R*.12,-R*.034],[0,-R*.054],[R*.12,-R*.033],[armR,-R*.016]],'#dfca97',unit*.7);
  line(ctx,[[-armL,R*.009],[-R*.13,R*.023],[0,R*.041],[R*.10,R*.025],[armR,R*.014]],'#ac8c52',unit*.7);
  // 梁的错金节片与雷纹是结构细节，不在器物外叠装饰面板。
  for (let i=0;i<9;i++) {
    const x = -armL + (armL+armR)*(i+.5)/9;
    if (Math.abs(x)<R*.1) continue;
    const half = R*(.024-Math.abs(x/R)*.009);
    line(ctx,[[x,-half],[x+R*.012,-half+R*.005],[x+R*.012,half]],'#d0b37a',unit*.85);
    line(ctx,[[x+R*.021,-half],[x+R*.021,half]],'#554b36',unit*.6);
  }
  for(let i=0;i<4;i++) {
    const x=-armL+R*(.07+i*.09), y=-R*.008;
    line(ctx,[[x,y],[x+R*.046,y],[x+R*.046,y+R*.02],[x+R*.018,y+R*.02],[x+R*.018,y+R*.01],[x+R*.034,y+R*.01]],'#ae9158',unit*.65);
  }
  const moving=engine.live&&engine.motion;
  const power=clamp((engine.charge||0)+engine.lockT*.45,0,1);
  const clock=moving?engine.clock:0;
  const path=[[-armL+R*.025,R*.003],[-R*.15,R*.003],[-R*.105,-R*.017],[R*.10,-R*.017],[R*.15,R*.003],[armR-R*.03,R*.003]];
  line(ctx,path.map(([x,y])=>[x,y+unit*1.5]),'rgba(176,151,97,.45)',unit*3.5);
  line(ctx,path,'#080f14',unit*4);
  line(ctx,path,'#173b35',unit*1.8);
  circuit(ctx,path,clock*.24,power,unit,moving);
  for(let i=0;i<4;i++) {
    const x=-armL+R*(.07+i*.09), y=-R*.008;
    const engraving=[[x,y],[x+R*.046,y],[x+R*.046,y+R*.02],[x+R*.018,y+R*.02],[x+R*.018,y+R*.01],[x+R*.034,y+R*.01]];
    line(ctx,engraving,'#0a1416',unit*2.4);
    circuit(ctx,engraving,clock*.30-i*.18,power,unit,moving);
  }
  // 切市扫描与悬停唤醒都借用已有时间线，光带只照亮梁的切面。
  const sweep=engine.scan<1?engine.scan:engine.hs;
  if(moving&&sweep>=0&&sweep<1) {
    const scanX=-armL+(armL+armR)*sweep;
    ctx.save();ctx.globalCompositeOperation='lighter';
    const highlight=ctx.createLinearGradient(scanX-R*.09,0,scanX+R*.02,0);
    highlight.addColorStop(0,'rgba(68,237,198,0)');highlight.addColorStop(.82,'rgba(92,255,212,.22)');highlight.addColorStop(1,'rgba(214,255,238,0)');
    ctx.fillStyle=highlight;ctx.fillRect(scanX-R*.09,-R*.017,R*.11,R*.034);ctx.restore();
  }
  const awake = engine.hot === 'bob' || engine.dragKind === 'bob';
  line(ctx,[[R*.09,R*.018],[armR-R*.025,R*.01]],awake?'#8bf7de':'#2b8677',unit*.7);
  ctx.restore();
  for (const x of [-armL-R*.014, armR+R*.018]) {
    polygon(ctx,[[x-R*.014,-R*.043],[x+R*.015,-R*.035],[x+R*.009,R*.013],[x-R*.01,R*.016]],'#9d7d45','#ead29a',unit*.7);
    line(ctx,[[x,-R*.03],[x,R*.005]],'#151e1d',unit);
  }
  ctx.restore();
}

export function drawPivot(engine, ctx, geometry) {
  const { fx, fy } = geometry, R=engine.R, unit=R/230;
  const y=fy-R*.14, r=R*.087;
  ctx.save(); ctx.lineWidth=unit; ctx.lineCap='round';
  line(ctx,[[fx,0],[fx,y-r]],'#bba477',unit*.8);
  line(ctx,[[fx+unit*2,0],[fx+unit*2,y-r]],'rgba(81,176,158,.22)',unit*.65);
  const bronze=ctx.createLinearGradient(fx-r,y-r,fx+r,y+r);
  bronze.addColorStop(0,'#f2dcab'); bronze.addColorStop(.25,'#9c844d'); bronze.addColorStop(.55,'#30372d'); bronze.addColorStop(1,'#bba16a');
  ctx.beginPath();ctx.arc(fx,y,r,0,TAU);ctx.arc(fx,y,r*.65,0,TAU,true);
  ctx.fillStyle=bronze;ctx.fill('evenodd');ctx.strokeStyle='#b09b66';ctx.stroke();
  ctx.beginPath();ctx.arc(fx,y,r*.62,Math.PI*.95,Math.PI*1.95);ctx.strokeStyle='#62cbb6';ctx.lineWidth=unit*.9;ctx.stroke();
  for (let i=0;i<12;i++) {
    const a=i/12*TAU;
    line(ctx,[[fx+Math.cos(a)*r*.78,y+Math.sin(a)*r*.78],[fx+Math.cos(a)*r*.95,y+Math.sin(a)*r*.95]],i%3===0?'#f9e0a3':'#6e613d',unit*.7);
  }
  polygon(ctx,[[fx,y+r*.82],[fx+R*.025,fy-R*.013],[fx,fy+R*.05],[fx-R*.025,fy-R*.013]],bronze,'#c2aa70',unit*.8);
  polygon(ctx,[[fx,fy-R*.033],[fx+R*.01,fy-R*.004],[fx,fy+R*.024],[fx-R*.01,fy-R*.004]],'#88dcca',null);
  polygon(ctx,[[fx,y-r-R*.032],[fx+R*.018,y-r],[fx,y-r+R*.011],[fx-R*.018,y-r]],'#bc9c5d','#eed6a1',unit*.7);
  const phase=engine.live&&engine.motion?engine.clock*.18:0;
  const orbit=[];
  for(let i=0;i<=48;i++){const a=i/48*TAU;orbit.push([fx+Math.cos(a)*r*.63,y+Math.sin(a)*r*.63]);}
  circuit(ctx,orbit,phase,engine.charge||0,unit,engine.live&&engine.motion);
  ctx.restore();
}

export function drawWeight(engine, ctx, geometry) {
  const { cxp, cyp, wx, wy }=geometry, R=engine.R, unit=R/230;
  const length=R*.065, ps=engine.ps, x=cxp+Math.sin(ps)*length, y=cyp+Math.cos(ps)*length;
  const wide=R*.082, tall=R*.185, offset=R*.02;
  engine.bobPt={x,y:y+offset+tall*.5,rx:wide*1.4,ry:tall*.72,hx:wx,hy:wy,hr:R*.10};
  ctx.save();ctx.translate(x,y);ctx.rotate(ps);ctx.lineJoin='miter';
  line(ctx,[[0,-length],[0,offset]],'#c9b684',unit);
  const active=engine.hot==='bob'||engine.dragKind==='bob';
  const moving=engine.live&&engine.motion;
  const power=moving?clamp((engine.charge||0)*.65+engine.lockT*.8+engine.coreFlash*.4,0,1):0;
  const gap=R*(.021+power*.013);
  const metal=ctx.createLinearGradient(-wide,0,wide,0);
  metal.addColorStop(0,'#252e29');metal.addColorStop(.35,'#8b754a');metal.addColorStop(.49,'#d8be83');metal.addColorStop(.52,'#4c503d');metal.addColorStop(1,'#182525');
  polygon(ctx,[[-wide*.65,offset],[0,offset-wide*.32],[wide*.65,offset],[wide*.92,offset+tall*.43],[-wide*.92,offset+tall*.43]],metal,'#bdab7c',unit*.8);
  const base=offset+tall*.43+gap;
  polygon(ctx,[[-wide*.92,base],[wide*.92,base],[wide*.68,offset+tall],[0,offset+tall+wide*.25],[-wide*.68,offset+tall]],metal,'#b69a61',unit*.8);
  // 金属护甲的亮面与暗侧面包住独立能量芯，缝隙保留负空间。
  polygon(ctx,[[-wide*.65,offset],[-wide*.92,offset+tall*.43],[-wide*.53,offset+tall*.40],[-wide*.32,offset+tall*.045]],'#303c34','#938557',unit*.6);
  polygon(ctx,[[wide*.65,offset],[wide*.92,offset+tall*.43],[wide*.58,offset+tall*.40],[wide*.38,offset+tall*.05]],'#111f24','#85734a',unit*.6);
  polygon(ctx,[[-wide*.92,base],[-wide*.53,base+tall*.025],[-wide*.38,offset+tall*.95],[-wide*.68,offset+tall]],'#a58b55','#cfb77a',unit*.6);
  polygon(ctx,[[wide*.92,base],[wide*.53,base+tall*.025],[wide*.38,offset+tall*.95],[wide*.68,offset+tall]],'#15252a','#665d3d',unit*.6);
  const core=ctx.createLinearGradient(-wide*.48,0,wide*.48,0);
  core.addColorStop(0,'#1a5a51');core.addColorStop(.45,'#b6ffe0');core.addColorStop(.6,'#6ad9b5');core.addColorStop(1,'#19433e');
  polygon(ctx,[[-wide*.48,base-gap+unit], [wide*.48,base-gap+unit],[wide*.36,base-unit],[-wide*.36,base-unit]],core,null);
  for(const side of [-1,1]) {
    line(ctx,[[side*wide*.73,base-gap+unit],[side*wide*.73,base-unit]],'#455c4d',unit*1.7);
    line(ctx,[[side*wide*.5,offset+tall*.08],[side*wide*.70,offset+tall*.32]],'#ddc68b',unit*.8);
  }
  ctx.save();ctx.globalCompositeOperation='lighter';
  glow(ctx,0,base-gap*.5,wide*1.6,'70,223,190',.18+power*.25);
  line(ctx,[[-wide*.82,base-gap*.48],[wide*.82,base-gap*.48]],'#91ffe0',unit*1.1);
  ctx.restore();
  line(ctx,[[0,offset+R*.01],[0,offset+tall*.36]],'#f2dbaa',unit*.8);
  line(ctx,[[0,base+R*.012],[0,offset+tall*.94]],'#f2dbaa',unit*.8);
  // 权印以镂空方孔和阶梯刻线区别于旧版钟形秤砣。
  polygon(ctx,[[-wide*.22,offset+tall*.13],[wide*.22,offset+tall*.13],[wide*.22,offset+tall*.31],[-wide*.22,offset+tall*.31]],'#101b1c','#b99e64',unit*.7);
  for (let side of [-1,1]) {
    const engraving=[[side*wide*.64,base+tall*.09],[side*wide*.34,base+tall*.09],[side*wide*.34,base+tall*.25],[side*wide*.1,base+tall*.25]];
    line(ctx,engraving,'#08161a',unit*2.8);
    circuit(ctx,engraving,moving?engine.clock*.32+side*.2:0,power,unit,moving);
  }
  line(ctx,[[-wide*.56,offset+tall*.91],[0,offset+tall+wide*.13],[wide*.56,offset+tall*.91]],'#d9c38b',unit*1.1);
  if(active) {
    line(ctx,[[-wide*.65,offset],[-wide*.92,offset+tall*.43]],'#8cddc6',unit*1.4);
    line(ctx,[[wide*.92,base],[wide*.68,offset+tall],[0,offset+tall+wide*.25]],'#8cddc6',unit*1.1);
  }
  ctx.restore();
}

function ringPoint(ring, a) {
  const x=Math.cos(a)*ring.r, y=Math.sin(a)*ring.r;
  const y1=y*Math.cos(ring.tilt), z=y*Math.sin(ring.tilt);
  return {x:x*Math.cos(ring.rot)-y1*Math.sin(ring.rot), y:x*Math.sin(ring.rot)+y1*Math.cos(ring.rot), z};
}

export function drawVessel(engine, ctx, t, pxp, pyp, hook) {
  const R=engine.R, unit=R/230, r=R*CORE_R;
  const x=engine.coreInit?engine.coreX:pxp, y=engine.coreInit?engine.coreY:pyp+R*.039-r;
  const dim=clamp(engine.coreDim,0,1), flash=engine.coreFlash;
  const moving=engine.live&&engine.motion;
  const time=moving?t:0;
  const power=clamp((engine.charge||0)+flash*.65,0,1);
  const pressure=clamp(engine.cageK,0,1.15), breathe=moving?Math.sin(time*.8)*.012:0;
  const scale=(.87+.13*pressure)*(1-engine.poke*.035);
  const drift=engine.cagePh*.10;
  const rings=[
    {r:r*1.80*scale,tilt:1.11,rot:-.28+drift*.22,phase:0},
    {r:r*1.70*scale,tilt:.72,rot:1.10-drift*.28,phase:2.2},
    {r:r*1.60*scale,tilt:1.17,rot:2.17+drift*.20,phase:4.1}
  ];
  engine.panPt={x,y,rx:r*2,ry:r*1.85};
  ctx.save();ctx.lineCap='round';
  // 三条悬丝落在同一环的实际节点，随环倾转而移动。
  for(let i=0;i<3;i++) {
    const point=ringPoint(rings[0],i/3*TAU-Math.PI/2);
    line(ctx,[[hook.x,hook.y],[x+point.x,y+point.y]],i===1?'rgba(210,188,137,.64)':'rgba(168,152,112,.4)',unit*.8);
    ctx.fillStyle='#d1b878';ctx.beginPath();ctx.arc(x+point.x,y+point.y,unit*1.7,0,TAU);ctx.fill();
  }
  ctx.translate(x,y);
  function cage(front) {
    for(const ring of rings) {
      for(let j=0;j<96;j++) {
        const a=j/96*TAU, p=ringPoint(ring,a), next=ringPoint(ring,a+TAU/96);
        if((p.z>=0)!==front) continue;
        const sheen=.42+.42*(.5+.5*Math.sin(a-.8));
        line(ctx,[[p.x,p.y],[next.x,next.y]],`rgba(192,161,99,${front?sheen:.28})`,unit*(front?2.15:1.25));
        if(front) line(ctx,[[p.x,p.y-unit*.6],[next.x,next.y-unit*.6]],'rgba(255,228,172,.65)',unit*.55);
        if(j%8===0) {
          const inner=ringPoint({...ring,r:ring.r-r*.06},a);
          line(ctx,[[p.x,p.y],[inner.x,inner.y]],front?'#e4c88e':'#655b41',unit*.7);
        }
        if(engine.live) {
          const phase=engine.holoPh*(ring.phase===2.2?-1.5:1.8)+ring.phase;
          const gap=((a-phase)%TAU+TAU)%TAU;
          if(gap<.78) {
            const alpha=(1-gap/.78)**2*(1-dim*.5);
            line(ctx,[[p.x,p.y],[next.x,next.y]],`rgba(57,227,185,${alpha*.24})`,unit*4.5);
            line(ctx,[[p.x,p.y],[next.x,next.y]],`rgba(174,255,226,${alpha})`,unit*1.4);
          }
        }
      }
    }
  }
  cage(false);
  ctx.save();ctx.globalCompositeOperation='lighter';
  glow(ctx,0,0,r*1.6,'255,181,74',.09+flash*.11+power*.05);
  ctx.restore();
  const shell=ctx.createRadialGradient(-r*.30,-r*.34,r*.02,0,0,r*1.03);
  shell.addColorStop(0,'#847445');shell.addColorStop(.2,'#354839');shell.addColorStop(.49,'#132b2a');shell.addColorStop(.77,'#102323');shell.addColorStop(1,'#081819');
  ctx.save();ctx.rotate(engine.coreRot);ctx.scale(1+breathe,clamp(engine.coreSq,.9,1.08));
  ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fillStyle=shell;ctx.fill();
  ctx.strokeStyle='rgba(116,233,202,.72)';ctx.lineWidth=unit*.8;ctx.stroke();
  ctx.save();ctx.clip();
  // 光核由等面积球面节点构成，经纬在背面自然隐去，保留球体而不是平面光斑。
  const spin=time*.26;
  for(let i=0;i<220;i++) {
    const lat=1-2*(i+.5)/220, radial=Math.sqrt(1-lat*lat), angle=i*2.399963229728653+spin;
    const sx=Math.cos(angle)*radial, sz=Math.sin(angle)*radial;
    if(sz<0) continue;
    const px=sx*r*.97, py=lat*r*.97;
    ctx.fillStyle=`rgba(149,237,197,${(.12+sz*.35)*(1-dim*.7)})`;
    ctx.fillRect(px,py,unit*(i%7===0?1.4:.7),unit*(i%7===0?1.4:.7));
  }
  // 球内的扭转光丝逐点计算明暗，形成暗壳、环流、亮芯三层。
  ctx.globalCompositeOperation='lighter';
  for(let strand=0;strand<4;strand++) {
    let prev=null;
    for(let i=0;i<=56;i++) {
      const u=i/56, a=u*TAU*1.25+strand*1.57+spin*(strand%2?-1:1);
      const reach=r*(.20+.65*Math.sin(u*Math.PI));
      const point=[Math.cos(a)*reach,Math.sin(a)*reach*.64+Math.sin(a*1.5+strand)*r*.15];
      if(prev) {
        const front=.3+.7*(.5+.5*Math.sin(a));
        const strength=front*(1-dim*.76)*(.5+power*.4);
        line(ctx,[prev,point],`rgba(255,198,94,${strength*.24})`,unit*3);
        line(ctx,[prev,point],`rgba(255,228,150,${strength})`,unit*.8);
      }
      prev=point;
    }
  }
  glow(ctx,-r*.08,-r*.06,r*.38,'255,217,121',(.55+flash*.4)*(1-dim*.8));
  glow(ctx,-r*.08,-r*.06,r*.12,'255,252,224',.92*(1-dim*.7));
  ctx.fillStyle=`rgba(255,255,235,${.86*(1-dim*.7)})`;ctx.beginPath();ctx.arc(-r*.08,-r*.06,r*.038,0,TAU);ctx.fill();
  ctx.restore();ctx.restore();
  if(moving) {
    ctx.save();ctx.globalCompositeOperation='lighter';
    // 能量由核传向笼结点，电弧始终局限在核与环之间。
    for(let i=0;i<3;i++) {
      const a=time*.28+i*TAU/3, tip=ringPoint(rings[i],a);
      const startAngle=Math.atan2(tip.y,tip.x), start=[Math.cos(startAngle)*r,Math.sin(startAngle)*r];
      const pulse=(.5+.5*Math.sin(time*2.1+i*2))**4;
      const strength=(.12+power*.48)*pulse*(1-dim*.6);
      const dx=tip.x-start[0],dy=tip.y-start[1];
      const arc=[];
      for(let j=0;j<=6;j++) {
        const mix=j/6, bend=Math.sin(Math.PI*mix)*Math.sin(j*2.5+time*5+i)*r*.10;
        arc.push([start[0]+dx*mix-bend*Math.sin(startAngle),start[1]+dy*mix+bend*Math.cos(startAngle)]);
      }
      line(ctx,arc,`rgba(79,224,183,${strength*.25})`,unit*3);
      line(ctx,arc,`rgba(175,255,222,${strength})`,unit*.8);
    }
    ctx.restore();
  }
  cage(true);
  // 青铜弧片是环笼的加强筋；留出大面积负空间，不恢复平盘。
  for(let i=0;i<3;i++) {
    const a=.35+i*TAU/3, ring=rings[1];
    const pts=[];
    for(let k=0;k<=12;k++){const p=ringPoint(ring,a+k/12*.36);pts.push([p.x,p.y]);}
    line(ctx,pts,'#7d724e',unit*4.5);line(ctx,pts,'#e2c38b',unit*.8);
    const node=ringPoint(ring,a+.18);
    ctx.fillStyle='#82d7bb';ctx.beginPath();ctx.arc(node.x,node.y,unit*1.2,0,TAU);ctx.fill();
  }
  if(flash>.02&&!engine.reduced) {
    ctx.save();ctx.globalAlpha=flash*.45;ctx.strokeStyle='#c4f6d9';ctx.lineWidth=unit*.7;
    ctx.beginPath();ctx.ellipse(0,0,r*(1.7+(1-flash)*.5),r*.7,-.3,0,TAU);ctx.stroke();ctx.restore();
  }
  ctx.restore();
}
