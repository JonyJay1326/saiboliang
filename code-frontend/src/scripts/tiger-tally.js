// 点将台页头 · 电磁虎符（frontend-spec.md §4.5）。
// 试作来源：cache-tools/design-lab/electromagnetic-tiger（2026-09-22 用户拍板：完整落 /models 页头右侧）。
// 纪律：画布纯装饰（aria-hidden、零数据、不映射榜单字段）；画布透明、不自带底色；
// 皮肤只走 CSS 变量 --totem-motion（朴素档 = 静止单帧，交互时才短暂补帧），JS 只读变量、不判档；
// prefers-reduced-motion 同静止单帧；窄屏由 CSS 关掉画布（无布局盒即不起引擎）。
// 交互（2026-09-22 反馈二轮）：点器物本体 / 切综合榜 · 编程榜 = 拆解与收合一次；
// 拖动旋转、双击复位。（反馈十五轮 2026-09-22：点模型卡 / 点卯簿行不再触发整段合璧流程；
// 手动收合到位的一瞬补一击——闪光 + 后坐抖动 + 粒子爆炸 + 余辉，约 2.6s；地面光圈已撤。
// 反馈十六轮：离合动作本身 +0.6s（速率 9 → 3.3，约 0.34s → 0.94s），视角回收同步。）
// 引擎是独立 chunk，由 Base.astro 的虎符加载器空闲取件。
const VIEW = { yaw: -0.38, pitch: 0.1 };
/* 离合动作速率（2026-09-22 反馈十六轮：动作本身 +0.6s）——到 95.5% 分离量的时间
   ≈ ln(1/.045)/速率，9 → 3.3 即约 0.34s → 0.94s；视角「收合 = 恢复」共用同一时长，
   拖动 / 双击复位仍走 9（手感不变）。 */
const SPLIT_RATE = 3.3;

export function mount() {
  const host = document.querySelector('[data-tiger-tally]');
  const canvas = host?.querySelector('[data-tiger-canvas]');
  if (!host || !canvas?.getContext) return { release() {} };
  if (!canvas.offsetWidth || !canvas.offsetHeight) {
    host.dataset.totem = 'off';
    return { release() {} };
  }

  const motion = getComputedStyle(host).getPropertyValue('--totem-motion').trim() === '1';
  let engine = null;
  try {
    engine = createExhibit(canvas, {
      motion,
      /* 起不来或显卡连接断了：把器物位整个撤掉，不留空位 */
      onLost() {
        host.dataset.tiger = 'unavailable';
      },
    });
  } catch (error) {
    host.dataset.tiger = 'unavailable';
    host.dataset.totem = 'off';
    console.warn('虎符图腾未能启用：', error);
    return { release() {} };
  }
  canvas.dataset.renderer = 'webgl2';
  /* 首帧已绘出：让页面收掉图腾区的 CSS 加载态（site.css「图腾区加载态」） */
  host.dataset.totem = 'ready';

  /* 页面联动（2026-09-22 用户定）：
     ① 切综合榜 / 编程榜 = 拆解与收合**一次**（不带整段合符流程；顺带给了键盘可达的入口）；
     ② 点器物本体（画布内命中测试）= 拆解与收合一次（手动按钮已撤）；
     ③ 点模型卡 / 点卯簿行**不再触发任何动效**（2026-09-22 反馈十五轮，用户撤销该入口）。 */
  const onPageClick = (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    if (el.closest('[data-toggle] [data-toggle-value]')) engine.toggle();
  };
  document.addEventListener('click', onPageClick);
  return {
    release() {
      document.removeEventListener('click', onPageClick);
      engine.destroy();
      engine = null;
    },
  };
}

export default mount;

function createExhibit(canvas, options) {
  /* alpha: true + pre-multiplied 输出 = 器物直接叠在页面上（无自带底色，2026-09-22 用户反馈） */
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('浏览器未能启用 WebGL 2。');

  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const vec = {
    sub: (a,b) => a.map((v,i) => v-b[i]),
    cross: (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
    dot: (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0),
    norm: a => { const l=Math.hypot(...a)||1; return a.map(v=>v/l); },
  };
  const identity = () => new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const mult = (a,b) => {
    const r=new Float32Array(16);
    for(let c=0;c<4;c++) for(let row=0;row<4;row++) for(let k=0;k<4;k++) r[c*4+row]+=a[k*4+row]*b[c*4+k];
    return r;
  };
  const translate = (x,y,z) => { const m=identity(); m[12]=x;m[13]=y;m[14]=z;return m; };
  const rotation = (x,y,z) => {
    const sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
    return mult(mult(new Float32Array([cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,0,1]),new Float32Array([cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1])),new Float32Array([1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1]));
  };
  const perspective = (fov,aspect,near,far) => {
    const f=1/Math.tan(fov/2),d=1/(near-far);
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*d,-1,0,0,2*far*near*d,0]);
  };
  const lookAt = (eye,at) => {
    const z=vec.norm(vec.sub(eye,at)),x=vec.norm(vec.cross([0,1,0],z)),y=vec.cross(z,x);
    return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-vec.dot(x,eye),-vec.dot(y,eye),-vec.dot(z,eye),1]);
  };

  const shaders=[];
  const programs=[];
  const buffers=[];
  const textures=[];
  const vaos=[];
  const framebuffers=[];
  const renderbuffers=[];
  function program(vertex,fragment) {
    const p=gl.createProgram();
    for(const [type,src] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p,s); shaders.push(s);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    programs.push(p);
    return {p, loc:new Map()};
  }
  function uniform(p,name,value) {
    if(!p.loc.has(name)) p.loc.set(name,gl.getUniformLocation(p.p,name));
    const loc=p.loc.get(name);
    if(typeof value==='number') gl.uniform1f(loc,value);
    else if(value.length===16) gl.uniformMatrix4fv(loc,false,value);
    else if(value.length===3) gl.uniform3fv(loc,value);
    else if(value.length===2) gl.uniform2fv(loc,value);
  }
  function sampler(p,name,index,texture) {
    if(!p.loc.has(name)) p.loc.set(name,gl.getUniformLocation(p.p,name));
    gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(p.loc.get(name),index);
  }

  const meshProgram=program(`#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 aUv;
    uniform mat4 uModel,uView,uProjection;
    out vec3 vWorld,vNormal,vLocal;
    out vec2 vUv;
    void main(){vec4 w=uModel*vec4(aPosition,1.);vWorld=w.xyz;vLocal=aPosition;vNormal=mat3(uModel)*aNormal;vUv=aUv;gl_Position=uProjection*uView*w;}
  `,`#version 300 es
    precision highp float;
    in vec3 vWorld,vNormal,vLocal;
    in vec2 vUv;
    uniform sampler2D uSurface;
    uniform vec3 uEye;
    uniform vec3 uHoverPoint;
    uniform mat4 uModel;
    uniform float uTime,uEnergy,uMaterial,uFlash,uScan,uHover,uHoverTime,uCharge,uAfterglow,uSplit,uHalf;
    out vec4 outColor;
    float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    float noise(vec3 p){
      vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    vec3 env(vec3 r,float rough){
      float ceiling=pow(max(r.y,0.),2.);
      float key=pow(max(dot(r,normalize(vec3(-.5,.9,1.))),0.),mix(55.,9.,rough));
      float strip=pow(max(1.-abs(r.x+.36),0.),mix(100.,18.,rough))*smoothstep(-.4,.4,r.y);
      float side=pow(max(dot(r,normalize(vec3(1.,.5,-.5))),0.),45.);
      return vec3(.16,.19,.20)*ceiling+vec3(1.45,1.18,.84)*key+vec3(.75,.91,.94)*strip+vec3(.12,.55,.48)*side;
    }
    vec3 light(vec3 N,vec3 V,vec3 L,vec3 color,vec3 base,float rough){
      vec3 H=normalize(V+L);float ndl=max(dot(N,L),0.),ndh=max(dot(N,H),0.),ndv=max(dot(N,V),.001);
      float a=rough*rough;float a2=a*a;float d=a2/(3.14159*pow(ndh*ndh*(a2-1.)+1.,2.));
      float k=pow(rough+1.,2.)/8.;float g=(ndv/(ndv*(1.-k)+k))*(ndl/(ndl*(1.-k)+k));
      vec3 f=base+(1.-base)*pow(1.-max(dot(H,V),0.),5.);
      return (base*.2+d*g*f/max(4.*ndv*ndl,.001))*color*ndl;
    }
    /* 电弧 / 悬停的点光：近处放电照亮金属，走同一套 BRDF（2026-09-22 反馈十一轮，移植自试作） */
    vec3 electricLight(vec3 position,vec3 N,vec3 V,vec3 base,float rough,float intensity){
      vec3 delta=(uModel*vec4(position,1.)).xyz-vWorld;
      float distance2=dot(delta,delta);
      return light(N,V,delta*inversesqrt(max(distance2,.0001)),vec3(.12,1.25,.92)*intensity/(1.+distance2*5.),base,rough);
    }
    void main(){
      vec3 N=normalize(vNormal);vec3 V=normalize(uEye-vWorld);
      vec4 tex=texture(uSurface,vUv);
      float grain=hash(floor(vLocal*780.));
      float mottling=noise(vLocal*5.5)*.65+noise(vLocal*23.)*.35;
      float patina=smoothstep(.46,.72,mottling);
      float wear=smoothstep(.34,.69,noise(vLocal*12.+3.));
      float rough=.46+patina*.17+grain*.025;
      vec3 base=mix(vec3(.075,.053,.029),vec3(.030,.057,.042),patina*.62);
      base*=.88+grain*.15+wear*.22;
      if(uMaterial<.5){
        float dx=texture(uSurface,vUv+vec2(.0006,0.)).r-texture(uSurface,vUv-vec2(.0006,0.)).r;
        float dy=texture(uSurface,vUv+vec2(0.,.001)).r-texture(uSurface,vUv-vec2(0.,.001)).r;
        vec3 qx=dFdx(vWorld),qy=dFdy(vWorld);
        vec2 ux=dFdx(vUv),uy=dFdy(vUv);
        vec3 tx=cross(qy,N)*ux.x+cross(N,qx)*uy.x;
        vec3 ty=cross(qy,N)*ux.y+cross(N,qx)*uy.y;
        float inv=inversesqrt(max(max(dot(tx,tx),dot(ty,ty)),.00000001));
        N=normalize(N-(tx*dx+ty*dy)*inv*.6);
        base=mix(base*.35,base,smoothstep(.12,.45,tex.r));
        base=mix(base,vec3(.43,.27,.10)*(.72+wear*.28),tex.b*.78);
        rough=mix(rough,.30+patina*.12,tex.b);
      } else if(uMaterial<1.5){base=vec3(.40,.25,.09)*(.8+wear*.2);rough=.32;}
      else if(uMaterial<2.5){base=vec3(.018,.065,.047);rough=.26;}
      else {base=vec3(.055,.049,.036);rough=.50;}
      vec3 R=reflect(-V,N);
      vec3 color=base*.16+env(R,rough)*mix(base,vec3(.65),pow(1.-max(dot(N,V),0.),4.))*.8;
      color+=light(N,V,normalize(vec3(-3.,5.,4.)),vec3(2.2,1.97,1.65),base,rough);
      color+=light(N,V,normalize(vec3(3.,1.5,-2.)),vec3(.24,1.05,.95),base,rough);
      color+=light(N,V,normalize(vec3(.2,-1.,3.)),vec3(.15,.22,.2),base,rough);
      color*=mix(.74,1.,smoothstep(-.5,.1,vLocal.y));
      float scan=exp(-pow((vLocal.x-uScan)*3.,2.));
      float energy=uEnergy*(.62+.12*sin(uTime*2.+vLocal.x*3.))+scan*uEnergy*.5;
      /* 四个磁锁触点近旁放电：按蓄势 / 余辉强度照亮周围金属（带脉冲闪烁） */
      if(uSplit>.02 || uAfterglow>.001){
        for(int i=0;i<4;i++){
          float x=-1.45+float(i)*.9;
          float pulse=.6+.4*pow(.5+.5*sin(uTime*7.-float(i)*1.7),4.);
          color+=electricLight(vec3(x,.12,-.18),N,V,base,rough,(uSplit*(.6+uCharge)+uAfterglow)*pulse*5.);
        }
      }
      if(uMaterial<.5) color+=tex.g*vec3(.08,.93,.72)*energy*3.2;
      if(uMaterial<.5 && abs(vLocal.z)<.003){
        vec2 p=vLocal.xy;float circuits=0.,contacts=0.;
        float endPhase=uHalf<0.?1.5:0.;
        for(int i=0;i<4;i++){
          vec2 q=p-vec2(-1.45+float(i)*.9,.12);float r=length(q);
          float phase=fract(endPhase-uTime*.72+float(i)*.271);
          float charge=exp(-pow((phase-.5)*12.,2.));
          circuits+=(exp(-abs(r-.14)*150.)+exp(-abs(r-.21)*170.)*.35)*(.55+charge*.8);
          contacts+=exp(-r*r*1900.)*(.6+charge*2.)+exp(-r*r*130.)*charge*.22;
        }
        float trace=exp(-abs(p.y-.12)*160.)*step(abs(p.x),1.55);
        color=mix(color,vec3(.025,.031,.026),.6)+vec3(.12,1.1,.82)*(circuits+trace*.38)*energy;
        color+=vec3(.55,1.5,1.15)*contacts*energy;
      }
      if(uMaterial>1.5&&uMaterial<2.5) color+=vec3(.15,1.3,1.05)*energy*1.7;
      /* 悬停通电（2026-09-22 反馈十轮，移植自试作）：命中点 proximity + 沿身扫掠 + 纹路流动 + 边缘 */
      if(uHover>.001){
        float proximity=exp(-dot((vLocal-uHoverPoint)*vec3(1.,1.3,.8),(vLocal-uHoverPoint)*vec3(1.,1.3,.8))*3.2);
        float sweepX=mod(uHoverTime*2.5,6.4)-3.2;
        float sweep=exp(-pow((vLocal.x-sweepX)*5.5,2.));
        float flow=pow(.5+.5*sin(vLocal.x*14.+vLocal.y*9.-uHoverTime*8.),8.);
        float rim=pow(1.-max(dot(N,V),0.),3.);
        if(uMaterial<.5){
          float engraving=max(tex.g,tex.b*.65);
          color+=uHover*vec3(.06,1.3,1.05)*engraving*(.28+proximity*1.65+sweep*3.4+flow*.7);
          color+=uHover*vec3(.025,.32,.29)*(proximity*.17+sweep*(.12+rim*.65));
        } else if(uMaterial>1.5&&uMaterial<2.5){
          color+=uHover*vec3(.12,1.4,1.12)*(.22+sweep*.8);
        }
        /* 传导：命中点与扫掠带各当一盏点光，照到周围金属上（不只自发光） */
        vec3 contact=uHoverPoint+vec3(0.,.08,.24);
        color+=electricLight(contact,N,V,base,rough,uHover*(1.3+proximity)*3.);
        color+=electricLight(vec3(sweepX,.3,.88),N,V,base,rough,uHover*4.);
      }
      color+=vec3(.12,.7,.55)*uFlash*pow(1.-max(dot(N,V),0.),3.);
      outColor=vec4(color,1.);
    }
  `);
  const fullscreen=`#version 300 es
    precision highp float;out vec2 vUv;
    void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}
  `;
  /* 自带背景（暗底 + 光晕 + 光柱 + 噪点）已撤：画布透明，器物落在页面自己的底上 */
  const floorProgram=program(`#version 300 es
    precision highp float;layout(location=0) in vec3 aPosition;uniform mat4 uView,uProjection;out vec3 vPosition;
    void main(){vPosition=aPosition;gl_Position=uProjection*uView*vec4(aPosition,1.);}
  `,`#version 300 es
    /* 接地软影（2026-09-22 反馈十五轮：地面电磁环按用户要求撤掉——静止与冲击都不再出光圈） */
    precision highp float;in vec3 vPosition;out vec4 outColor;uniform float uCenter;
    void main(){vec2 p=vPosition.xz-vec2(uCenter,0.);
      float shadow=exp(-dot(p*vec2(.26,.67),p*vec2(.26,.67))*2.);
      float d=length(p*vec2(.66,1.));
      float glow=exp(-pow(d-2.5,2.)*8.);
      vec3 color=vec3(.02,.032,.027)*glow;
      outColor=vec4(color,clamp(shadow*.52+glow*.03,0.,.9));}
  `);
  const lineProgram=program(`#version 300 es
    precision highp float;layout(location=0) in vec3 aPosition;uniform mat4 uView,uProjection;void main(){gl_Position=uProjection*uView*vec4(aPosition,1.);}
  `,`#version 300 es
    precision highp float;uniform vec3 uColor;uniform float uOpacity;out vec4 outColor;void main(){outColor=vec4(uColor,uOpacity);}
  `);
  const arcProgram=program(`#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aTangent;
    layout(location=2) in vec4 aRibbon;
    uniform mat4 uView,uProjection;
    uniform vec2 uResolution;
    out vec2 vUv;out float vStrength,vSeed;
    void main(){
      vec4 p=uProjection*uView*vec4(aPosition,1.);
      vec4 q=uProjection*uView*vec4(aPosition+aTangent,1.);
      vec2 direction=(q.xy/q.w-p.xy/p.w)*uResolution;
      direction/=max(length(direction),.0001);
      vec2 normal=vec2(-direction.y,direction.x);
      float radius=mix(3.,7.,aRibbon.z)*min(uResolution.y/720.,1.8);
      p.xy+=normal*aRibbon.x*radius*2./uResolution*p.w;
      gl_Position=p;vUv=aRibbon.xy;vStrength=aRibbon.z;vSeed=aRibbon.w;
    }
  `,`#version 300 es
    precision highp float;
    in vec2 vUv;in float vStrength,vSeed;
    uniform float uTime,uOpacity,uCharge;
    out vec4 outColor;
    void main(){
      float across=abs(vUv.x);
      float core=exp(-across*across*140.);
      float sheath=exp(-across*across*15.);
      float halo=exp(-across*across*4.)*(1.-smoothstep(.65,1.,across));
      float travel=fract(vUv.y*1.5-uTime*.72+vSeed);
      float pulse=exp(-pow((travel-.5)*12.,2.));
      float flutter=.88+.12*sin(uTime*17.+vSeed*29.+vUv.y*13.);
      float ends=exp(-vUv.y*28.)+exp(-(1.-vUv.y)*28.);
      vec3 color=vec3(.63,1.,.88)*core*(1.5+pulse*2.3)
        +vec3(.045,.8,.53)*sheath*(.55+pulse*.7)
        +vec3(.015,.32,.22)*halo*(.35+ends);
      color+=vec3(.48,.95,.8)*core*uCharge*2.2;
      outColor=vec4(color,clamp(uOpacity*vStrength*mix(flutter,1.,uCharge),0.,1.));
    }
  `);
  const blurProgram=program(fullscreen,`#version 300 es
    precision highp float;in vec2 vUv;uniform sampler2D uTexture;uniform vec2 uDirection;uniform float uThreshold;out vec4 outColor;
    /* 阈值只削 RGB；alpha 直接透传（画布透明后，泛光是靠 alpha 叠到页面上的） */
    vec4 sampleAt(vec2 p){vec4 c=texture(uTexture,p);return vec4(max(c.rgb-vec3(uThreshold),0.),c.a);}
    void main(){vec4 c=sampleAt(vUv)*.227027;c+=(sampleAt(vUv+uDirection*1.384615)+sampleAt(vUv-uDirection*1.384615))*.316216;c+=(sampleAt(vUv+uDirection*3.230769)+sampleAt(vUv-uDirection*3.230769))*.07027;outColor=c;}
  `);
  const composite=program(fullscreen,`#version 300 es
    precision highp float;in vec2 vUv;uniform sampler2D uScene,uBloom;uniform float uFlash;out vec4 outColor;
    vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
    /* 画布 pre-multiplied：锐化后的 RGB 乘 alpha 输出。
       alpha 取「场景覆盖」与「泛光亮度」的较大者——器身外的一圈辉光靠亮度拿到 alpha，
       在页面上表现为「加了一点光」，而不是一块底色。 */
    void main(){vec4 s=texture(uScene,vUv);vec4 b=texture(uBloom,vUv);
      vec3 c=s.rgb+b.rgb*.72;c+=vec3(.03,.11,.08)*uFlash*.2;
      c=aces(c*1.22);c=pow(c,vec3(1./2.2));
      float a=clamp(max(s.a,max(max(b.r,b.g),b.b)),0.,1.);
      outColor=vec4(c*a,a);}
  `);

  /* 取景用的真实网格采样点（每件器物约 220 个顶点）：取景按**实际网格**算，不靠代理体。
     `noFit` 给地面那种大平板用（±18 的接影面不该参与取景）。 */
  const FIT_POINTS=[];
  function mesh(vertices,noFit=false){
    const vao=gl.createVertexArray(),buffer=gl.createBuffer();vaos.push(vao);buffers.push(buffer);
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [loc,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);}
    const total=vertices.length/8;
    if(!noFit){
      const stride=Math.max(1,Math.floor(total/220));
      for(let v=0;v<total;v+=stride)FIT_POINTS.push([vertices[v*8],vertices[v*8+1],vertices[v*8+2]]);
    }
    return {vao,count:total};
  }
  const uv=p=>[(p[0]+3.5)/6.5,(1.6-p[1])/3.1];
  function tube(points,radius=.016,sides=6,raw=false){
    const data=[];
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];const axis=vec.norm(vec.sub(b,a));
      const up=Math.abs(axis[2])>.9?[0,1,0]:[0,0,1];const u=vec.norm(vec.cross(axis,up)),v=vec.cross(axis,u);
      const at=(p,t)=>p.map((n,k)=>n+radius*(u[k]*Math.cos(t)+v[k]*Math.sin(t)));
      const vertex=(p,angle)=>data.push(...p,...u.map((n,k)=>n*Math.cos(angle)+v[k]*Math.sin(angle)),...uv(p));
      for(let j=0;j<sides;j++){
        const t=j/sides*TAU,s=(j+1)/sides*TAU;
        const p=at(a,t),q=at(a,s),r=at(b,s),s2=at(b,t);
        vertex(p,t);vertex(q,s);vertex(r,s);vertex(p,t);vertex(r,s);vertex(s2,t);
      }
    }
    return raw?data:mesh(data);
  }
  function ellipsoid(center,scale,segments=24,rings=12){
    const data=[];
    const at=(t,p)=>[center[0]+Math.cos(t)*Math.sin(p)*scale[0],center[1]+Math.cos(p)*scale[1],center[2]+Math.sin(t)*Math.sin(p)*scale[2]];
    const normal=p=>vec.norm(p.map((v,i)=>(v-center[i])/(scale[i]*scale[i])));
    const tri=(a,b,c)=>{for(const p of [a,b,c])data.push(...p,...normal(p),...uv(p));};
    for(let i=0;i<segments;i++) for(let j=0;j<rings;j++){
      const a=at(i/segments*TAU,j/rings*Math.PI),b=at((i+1)/segments*TAU,j/rings*Math.PI),c=at((i+1)/segments*TAU,(j+1)/rings*Math.PI),d=at(i/segments*TAU,(j+1)/rings*Math.PI);
      tri(a,b,c);tri(a,c,d);
    }return mesh(data);
  }

  // Engraving channels are packed separately from the relief height and gold inlay.
  function surfaceTexture(){
    const size=[2048,1024];
    const layers=Array.from({length:3},()=>{const c=document.createElement('canvas');[c.width,c.height]=size;return c;});
    const [height,energy,gold]=layers.map(c=>c.getContext('2d'));
    height.fillStyle='#999';height.fillRect(0,0,...size);
    for(const c of [energy,gold]){c.fillStyle='#000';c.fillRect(0,0,...size);}
    for(const c of [height,energy,gold]){c.setTransform(size[0]/6.5,0,0,-size[1]/3.1,3.5*size[0]/6.5,1.6*size[1]/3.1);c.lineCap='round';c.lineJoin='round';}
    function stroke(draw,width=.015,electric=false){
      for(const [c,w,color] of [[height,width*2.4,'#272727'],[height,width,'#b8b8b8'],[gold,width*.6,'#bbb'],[energy,width*.30,electric?'#ddd':'#030303']]){
        c.beginPath();draw(c);c.lineWidth=w;c.strokeStyle=color;c.stroke();
      }
    }
    const line=points=>c=>{c.moveTo(...points[0]);points.slice(1).forEach(p=>c.lineTo(...p));};
    const curved=points=>c=>{c.moveTo(...points[0]);c.bezierCurveTo(...points[1],...points[2],...points[3]);};
    // Broad hooked stripes follow the shoulder, spine and haunches.
    const stripes=[
      [[-1.83,.65],[-1.66,.38],[-1.24,.08],[-1.45,-.13]],
      [[-1.41,.75],[-1.24,.46],[-.95,.32],[-1.03,.08]],
      [[-.84,.67],[-.71,.41],[-.45,.28],[-.52,.01]],
      [[-.25,.71],[-.13,.51],[.1,.36],[.02,.11]],
      [[.29,.75],[.46,.48],[.67,.37],[.6,.05]],
      [[.82,.71],[.96,.54],[.88,.31],[1.03,.08]],
      [[-.77,-.35],[-.69,-.16],[-.42,-.03]],
      [[-.15,-.37],[.02,-.2],[.29,-.07]],
      [[-1.93,-.48],[-1.71,-.40],[-1.53,-.23]],
      [[1.10,-.42],[1.3,-.46],[1.27,-.7]],
    ];
    stripes.forEach((p,i)=>{
      if(p.length===4){
        stroke(curved(p),i<6?.036:.022,i%2===0);
        const parallel=p.map(([x,y])=>[x+.065,y+.015]);
        stroke(curved(parallel),.007,false);
      } else stroke(line(p),.022,i%2===0);
    });
    // Cloud-scroll relief, taken as a new decorative motif rather than a historical inscription.
    for(const [x,y,r] of [[-1.82,-.04,.24],[1.20,.42,.25],[-.3,.10,.115]]){
      stroke(c=>{for(let i=0;i<=65;i++){const t=i/65*TAU*1.55,rr=r*(1-i/80);const a=[x+Math.cos(t)*rr,y+Math.sin(t)*rr];i?c.lineTo(...a):c.moveTo(...a);}},.018,true);
    }
    // Eye and forehead ornament register to the sculpted eye socket.
    stroke(curved([[1.57,.93],[1.72,.95],[1.83,.83],[1.98,.83]]),.026,true);
    stroke(curved([[1.66,.75],[1.72,.64],[1.91,.63],[2.04,.74]]),.02);
    stroke(curved([[1.63,.54],[1.46,.24],[1.79,.14],[1.85,.39]]),.023,true);
    stroke(curved([[1.67,.5],[1.60,.29],[1.77,.24],[1.79,.37]]),.006);
    for(let i=0;i<3;i++)stroke(curved([[2.0,.53-i*.07],[2.1,.58-i*.085],[2.23,.59-i*.085],[2.33,.55-i*.08]]),.009);
    for(let i=0;i<3;i++)stroke(line([[1.47,.91-i*.085],[1.65,.92-i*.085]]),.013);
    stroke(line([[1.55,1.0],[1.58,.68]]),.017);
    for(const x of [-1.99,-1.80,-1.61,1.0,1.2,1.4])stroke(line([[x,-.93],[x+.02,-.83]]),.017);
    // Fine repeating thunder-pattern band on the lower body.
    for(let i=0;i<15;i++){
      const x=-1.1+i*.13,y=-.28+Math.sin(i*.28)*.025;
      stroke(line([[x,y],[x,y+.08],[x+.07,y+.08],[x+.07,y+.025],[x+.025,y+.025]]),.005,i%3===0);
    }
    // Compact panels leave broad bronze surfaces between the principal inlays.
    for(let row=0;row<3;row++)for(let i=0;i<5;i++){
      const x=-1.18+i*.12,y=-.11+row*.095;
      stroke(line([[x,y],[x+.073,y],[x+.073,y+.053],[x+.029,y+.053],[x+.029,y+.023]]),.003);
    }
    stroke(line([[-1.24,-.16],[-.55,-.16],[-.55,.18]]),.005);
    stroke(line([[-1.27,-.19],[-.52,-.19],[-.52,.21]]),.003);
    /* 贴合面铭文不在这里画字：走「字体图片化」（引擎不挂 webfont，AGENTS.md §6）——
       字图由 cache-tools/render-tiger-inscription.py 用喜鹊古字典体预渲染，
       运行时染色盖进高度层与金错层，见下方 INSCRIPTION 一段。 */
    // Short uneven cuts give the casting a restrained, non-repeating wear pattern.
    for(let i=0;i<180;i++){
      const rand=n=>{const v=Math.sin(n*127.1+42.7)*43758.5453;return v-Math.floor(v);};
      const x=-2.8+rand(i*4)*5.15,y=-.9+rand(i*4+1)*2.;
      height.strokeStyle='#858585';height.lineWidth=.0015+rand(i*4+2)*.002;
      height.beginPath();height.moveTo(x,y);height.lineTo(x+.006+rand(i*4+3)*.038,y+.006);height.stroke();
    }
    for(let i=0;i<42;i++){
      const a=i/42*TAU,x=-1.7+Math.cos(a)*.36,y=.02+Math.sin(a)*.36;
      stroke(line([[x,y],[x+Math.cos(a)*.035,y+Math.sin(a)*.035]]),.005,i%5===0);
    }
    const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    /* 三层打包成一张 RGBA（r=高度 / g=电能 / b=金错）上传；铭文贴图后要重传一次，故抽成函数 */
    const upload=()=>{
    const all=layers.map(c=>c.getContext('2d').getImageData(0,0,...size).data);
      const packed=new Uint8Array(size[0]*size[1]*4);
      for(let i=0;i<packed.length;i+=4){packed[i]=all[0][i];packed[i+1]=all[1][i];packed[i+2]=all[2][i];packed[i+3]=255;}
      gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,...size,0,gl.RGBA,gl.UNSIGNED_BYTE,packed);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
    upload();
    /* 铭文：字图（喜鹊古字典体，图片产出物，授权内）盖在贴合面中线附近；
       取不到字图就不刻，器物照常。高度层染暗色（浅刻）、金错层染亮色（错金）。 */
    /* 位置与字号（2026-09-22 反馈十一轮）：原来在身中 x .055 / y -.10，放大后压到雷纹细带与虎斑。
       按贴合面（SDF z=0 截面）做空位搜索：字号 .2 时左半身无空处，收到 .16 后
       左上方 x -.30 / y .34（上背）整块干净，故左移上移并定字高 .16。 */
    const INSCRIPTION={src:'/font-images/tiger-inscription.png',height:.16,x:-.30,y:.34};
    const glyph=new Image();
    glyph.onload=()=>{
      if(destroyed)return;
      const w=INSCRIPTION.height*glyph.naturalWidth/Math.max(1,glyph.naturalHeight);
      for(const [c,color] of [[height,'#414141'],[gold,'#737373']]){
        const tinted=document.createElement('canvas');
        tinted.width=glyph.naturalWidth;tinted.height=glyph.naturalHeight;
        const g=tinted.getContext('2d');
        g.drawImage(glyph,0,0);
        g.globalCompositeOperation='source-in';
        g.fillStyle=color;g.fillRect(0,0,tinted.width,tinted.height);
        c.save();c.translate(INSCRIPTION.x,INSCRIPTION.y);c.scale(1,-1);
        c.drawImage(tinted,-w/2,-INSCRIPTION.height/2,w,INSCRIPTION.height);
        c.restore();
      }
      upload();
      render();
    };
    glyph.src=INSCRIPTION.src;
    return t;
  }
  // Smooth implicit modelling keeps the body volumetric, including the shoulders,
  // crouched haunches and rounded ears. The z=0 cut is the mating face of each tally.
  const smoothMin=(a,b,k)=>{const h=clamp(.5+.5*(b-a)/k);return mix(b,a,h)-k*h*(1-h);};
  function ellipsoidDistance(x,y,z,c,r){
    x-=c[0];y-=c[1];z-=c[2];
    const k0=Math.hypot(x/r[0],y/r[1],z/r[2]);
    const k1=Math.hypot(x/(r[0]*r[0]),y/(r[1]*r[1]),z/(r[2]*r[2]));
    return k1>1e-8?k0*(k0-1)/k1:-Math.min(...r);
  }
  function roundedBoxDistance(x,y,z,c,r,bevel){
    const q=[Math.abs(x-c[0])-r[0],Math.abs(y-c[1])-r[1],Math.abs(z-c[2])-r[2]];
    return Math.hypot(...q.map(v=>Math.max(v,0)))+Math.min(Math.max(...q),0)-bevel;
  }
  const anatomy=[
    [[-.48,.03,0],[1.57,.46,.46],.14],
    [[-1.55,-.02,0],[.59,.57,.56],.13],
    [[.79,.09,0],[.54,.58,.57],.16],
    [[1.21,.40,0],[.48,.58,.50],.15],
    [[1.69,.41,.35],[.30,.29,.23],.065],
    [[1.69,.41,-.35],[.30,.29,.23],.065],
    [[1.98,.48,0],[.25,.20,.44],.045],
    [[1.94,.27,0],[.29,.12,.36],.05],
    [[1.29,1.01,.34],[.19,.15,.105],.025],
    [[1.29,1.01,-.34],[.19,.15,.105],.025],
    [[1.06,-.44,.40],[.22,.35,.235],.1],
    [[1.06,-.44,-.40],[.22,.35,.235],.1],
    [[1.32,-.76,.40],[.42,.16,.29],.06],
    [[1.32,-.76,-.40],[.42,.16,.29],.06],
    [[-1.78,-.45,.39],[.24,.32,.23],.075],
    [[-1.78,-.45,-.39],[.24,.32,.23],.075],
    [[-1.42,-.75,.44],[.46,.15,.26],.06],
    [[-1.42,-.75,-.44],[.46,.15,.26],.06],
  ];
  const tailPoints=[];
  for(let i=0;i<=22;i++){
    const t=i/22;
    tailPoints.push([-1.98-.70*t,.23+.73*t+.1*Math.sin(t*Math.PI),0]);
  }
  for(let i=1;i<=35;i++){
    const a=i/35*Math.PI*1.65,r=.29*(1-i/75);
    tailPoints.push([-2.68-r*Math.sin(a),.67+r*Math.cos(a),0]);
  }
  function animalSdf(x,y,z){
    let d=10;
    for(const [c,r,k] of anatomy)d=smoothMin(d,ellipsoidDistance(x,y,z,c,r),k);
    const skull=roundedBoxDistance(x,y,z,[1.62,.65,0],[.255,.22,.31],.175);
    d=smoothMin(d,skull,.11);
    for(let i=0;i<tailPoints.length-1;i+=2){
      const a=tailPoints[i],b=tailPoints[Math.min(i+2,tailPoints.length-1)];
      const vx=b[0]-a[0],vy=b[1]-a[1],vz=b[2]-a[2];
      const t=clamp(((x-a[0])*vx+(y-a[1])*vy+(z-a[2])*vz)/(vx*vx+vy*vy+vz*vz));
      const radius=.098-i/tailPoints.length*.028;
      d=smoothMin(d,Math.hypot(x-a[0]-vx*t,y-a[1]-vy*t,z-a[2]-vz*t)-radius,.08);
    }
    const mouth=Math.max(Math.abs(x-2.14)-.30,Math.abs(y-.335)-.022,Math.abs(z)-.55);
    d=Math.max(d,-mouth);
    for(const side of [-1,1]){
      const socket=ellipsoidDistance(x,y,z,[1.84,.76,side*.458],[.14,.059,.077]);
      d=Math.max(d,-socket);
      const ear=ellipsoidDistance(x,y,z,[1.28,1.035,side*.438],[.100,.075,.042]);
      d=Math.max(d,-ear);
      for(const toe of [.28,.45]){
        const groove=ellipsoidDistance(x,y,z,[1.67,-.72,side*toe],[.17,.12,.015]);
        d=Math.max(d,-groove);
      }
    }
    return Math.max(d,-z);
  }
  function sculpt(){
    const nx=112,ny=49,nz=21,min=[-3.07,-1.03,-.012],max=[2.52,1.39,.80];
    const coords=[],values=[];
    const index=(x,y,z)=>(z*(ny+1)+y)*(nx+1)+x;
    for(let z=0;z<=nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
      const p=[mix(min[0],max[0],x/nx),mix(min[1],max[1],y/ny),mix(min[2],max[2],z/nz)];
      coords.push(p);values.push(animalSdf(...p));
    }
    const vertices=[],cache=new Map();
    const edge=(a,b)=>{
      const key=a<b?`${a}:${b}`:`${b}:${a}`;
      if(cache.has(key))return cache.get(key);
      const t=values[a]/(values[a]-values[b]);const p=coords[a].map((v,j)=>mix(v,coords[b][j],t));
      const e=.0008;
      const n=vec.norm([animalSdf(p[0]+e,p[1],p[2])-animalSdf(p[0]-e,p[1],p[2]),animalSdf(p[0],p[1]+e,p[2])-animalSdf(p[0],p[1]-e,p[2]),animalSdf(p[0],p[1],p[2]+e)-animalSdf(p[0],p[1],p[2]-e)]);
      const v=[...p,...n,...uv(p)];cache.set(key,v);return v;
    };
    const tri=(a,b,c)=>vertices.push(...a,...b,...c);
    const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const cube=[index(x,y,z),index(x+1,y,z),index(x+1,y+1,z),index(x,y+1,z),index(x,y,z+1),index(x+1,y,z+1),index(x+1,y+1,z+1),index(x,y+1,z+1)];
      if(cube.every(i=>values[i]>0)||cube.every(i=>values[i]<0))continue;
      for(const ids of tetra){
        const t=ids.map(i=>cube[i]),inside=t.filter(i=>values[i]<0),outside=t.filter(i=>values[i]>=0);
        if(inside.length===1)tri(...outside.map(i=>edge(inside[0],i)));
        else if(inside.length===3)tri(...inside.map(i=>edge(outside[0],i)));
        else if(inside.length===2){const a=edge(inside[0],outside[0]),b=edge(inside[0],outside[1]),c=edge(inside[1],outside[0]),d=edge(inside[1],outside[1]);tri(a,b,c);tri(b,d,c);}
      }
    }
    return mesh(vertices);
  }
  const surface=surfaceTexture();
  const body=sculpt();
  function seamContour(){
    const vertices=[],segments=[];
    const nx=180,ny=85;
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([i,j])=>[-3.1+i*5.65/nx,-1.02+j*2.5/ny,.012]);
      const distances=corners.map(p=>animalSdf(...p));
      const hits=[];
      for(let i=0;i<4;i++){
        const j=(i+1)%4;
        if((distances[i]<0)===(distances[j]<0))continue;
        const t=distances[i]/(distances[i]-distances[j]);
        hits.push(corners[i].map((v,k)=>k===2?.003:mix(v,corners[j][k],t)));
      }
      if(hits.length===2){segments.push(hits);vertices.push(...tube(hits,.011,5,true));}
    }
    return {mesh:mesh(vertices),segments};
  }
  const seamGeometry=seamContour();
  const eye=ellipsoid([1.848,.762,.483],[.073,.017,.024],12,6);
  const nose=ellipsoid([2.215,.537,0],[.053,.070,.22],16,8);
  const pin=ellipsoid([0,.05,-.025],[.065,.065,.10],12,6);
  const parts=[[body,0],[seamGeometry.mesh,2],[eye,2],[nose,3],[pin,1]];
  for(const x of [-1.05,1.68])for(const z of [.26,.43,.58])parts.push([ellipsoid([x,-.785,z],[.084,.026,.032],10,6),1]);
  parts.push([tube([[1.64,.88,.429],[1.76,.851,.476],[1.91,.817,.450]],.029,10),1]);
  parts.push([ellipsoid([2.075,.348,.31],[.03,.063,.025],10,6),1]);
  // Metal collars sit in shallow channels; cyan is confined to the mating seam.
  for(const x of [-1.46,.82]){
    const ring=[];
    for(let i=0;i<=40;i++){const a=i/40*Math.PI;ring.push([x,.04+Math.cos(a)*.48,Math.sin(a)*.48]);}
    parts.push([tube(ring,.009,8),1]);
  }

  const floor=mesh([-18,-1.45,-18,0,1,0,0,0,18,-1.45,-18,0,1,0,1,0,18,-1.45,18,0,1,0,1,1,-18,-1.45,-18,0,1,0,0,0,18,-1.45,18,0,1,0,1,1,-18,-1.45,18,0,1,0,0,1],true);
  const lineVao=gl.createVertexArray(),lineBuffer=gl.createBuffer();vaos.push(lineVao);buffers.push(lineBuffer);
  gl.bindVertexArray(lineVao);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
  const arcVao=gl.createVertexArray(),arcBuffer=gl.createBuffer();vaos.push(arcVao);buffers.push(arcBuffer);
  gl.bindVertexArray(arcVao);gl.bindBuffer(gl.ARRAY_BUFFER,arcBuffer);
  for(const [slot,size,offset] of [[0,3,0],[1,3,12],[2,4,24]]){
    gl.enableVertexAttribArray(slot);gl.vertexAttribPointer(slot,size,gl.FLOAT,false,40,offset);
  }
  // Fixed-capacity strips avoid allocating new GPU storage for every discharge.
  const arcData=new Float32Array(60000);
  gl.bufferData(gl.ARRAY_BUFFER,arcData.byteLength,gl.DYNAMIC_DRAW);

  const hasFloat=!!gl.getExtension('EXT_color_buffer_float');
  const targets=[];
  function target(depth=false){
    const fbo=gl.createFramebuffer(),texture=gl.createTexture(),db=depth?gl.createRenderbuffer():null;
    framebuffers.push(fbo);textures.push(texture);if(db)renderbuffers.push(db);
    const t={fbo,texture,db};targets.push(t);return t;
  }
  const sceneTarget=target(true),bloomA=target(),bloomB=target();
  function resizeTarget(t,w,h){
    gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,hasFloat?gl.RGBA16F:gl.RGBA,w,h,0,gl.RGBA,hasFloat?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
    if(t.db){gl.bindRenderbuffer(gl.RENDERBUFFER,t.db);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,t.db);}
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('浏览器无法创建渲染缓冲区');
    t.w=w;t.h=h;
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let width=1,height=1,aspect=1;
  let raf=0,last=0,time=0,visible=true,pageHidden=false,destroyed=false,ambient=options.motion&&!reduced.matches,sized=false;
  let split=0,targetSplit=0,yaw=VIEW.yaw,pitch=VIEW.pitch,targetYaw=VIEW.yaw,targetPitch=VIEW.pitch;
  /* 视角「收合 = 恢复」进行中：视角缓动跟着离合时长走，拖动 / 双击复位即时打断（回 9 档） */
  let viewRestoring=false;
  let dragging=false,pointer=null,dragDist=0,flash=0,pendingStrike=false,sequence=null,hitFrame=null;
  /* 合璧时间线状态（2026-09-22 反馈十一轮）：蓄势 charge / 冲击后坐 recoil / 余辉 afterglow；
     impactAge = 冲击段时钟（秒；未在冲击段时为 Infinity）——粒子爆炸按它采样，不靠 flash 反推 */
  let charge=0,recoil=0,afterglow=0,impactAge=Infinity;
  let distance=6.5,neededDistance=6.5;
  /* 悬停通电状态（2026-09-22 反馈十轮）：hoverPoint = SDF 表面命中点（半体局部坐标） */
  let hoverPointer=null,hoverTarget=0,hoverAmount=0,hoverStarted=0,lastHoverPick=-Infinity,pickDirty=false,pointerDown=false;
  let hoverPoint=[0,.12,.45];
  const listeners=[];
  const on=(el,event,handler,opts)=>{el.addEventListener(event,handler,opts);listeners.push(()=>el.removeEventListener(event,handler,opts));};
  const settling=()=>Math.abs(targetSplit-split)>.002||Math.abs(targetYaw-yaw)>.0015||Math.abs(targetPitch-pitch)>.0015||Math.abs(neededDistance-distance)>.01||flash>.012||hoverAmount>.012;
  function resize(){
    const rect=canvas.getBoundingClientRect();
    /* 被 CSS 关掉（窄屏 / 过渡期布局未定）时布局盒为 0，别去动渲染目标——
       否则会拿 0 宽去建 FBO，framebuffer 不完整（2026-09-22 压测踩坑） */
    if(rect.width<8||rect.height<8)return;
    hoverPointer=null;hoverTarget=0;hoverAmount=0;
    const dpr=Math.min(devicePixelRatio||1,1.6);
    width=Math.max(1,Math.round(rect.width*dpr));height=Math.max(1,Math.round(rect.height*dpr));aspect=width/height;
    canvas.width=width;canvas.height=height;
    resizeTarget(sceneTarget,width,height);resizeTarget(bloomA,Math.max(1,width>>1),Math.max(1,height>>1));resizeTarget(bloomB,bloomA.w,bloomA.h);
    sized=true;
    render();
  }
  function drawMesh(m,model,material,view,projection,eyePos,energy,scan,modelIndex){
    gl.useProgram(meshProgram.p);uniform(meshProgram,'uModel',model);uniform(meshProgram,'uView',view);uniform(meshProgram,'uProjection',projection);
    uniform(meshProgram,'uEye',eyePos);uniform(meshProgram,'uTime',time);uniform(meshProgram,'uEnergy',energy);uniform(meshProgram,'uMaterial',material);uniform(meshProgram,'uFlash',flash);uniform(meshProgram,'uScan',scan);
    uniform(meshProgram,'uHover',hoverAmount);uniform(meshProgram,'uHoverPoint',hoverPoint);uniform(meshProgram,'uHoverTime',time-hoverStarted);
    uniform(meshProgram,'uCharge',charge);uniform(meshProgram,'uAfterglow',afterglow);uniform(meshProgram,'uSplit',split);uniform(meshProgram,'uHalf',modelIndex===0?1:-1);
    sampler(meshProgram,'uSurface',0,surface);gl.bindVertexArray(m.vao);gl.drawArrays(gl.TRIANGLES,0,m.count);
  }
  function drawLines(vertices,color,alpha,view,projection){
    if(vertices.length===0||alpha<.001)return;
    gl.useProgram(lineProgram.p);uniform(lineProgram,'uView',view);uniform(lineProgram,'uProjection',projection);uniform(lineProgram,'uColor',color);uniform(lineProgram,'uOpacity',alpha);
    gl.bindVertexArray(lineVao);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINES,0,vertices.length/3);
  }
  const transform=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
  /* —— 悬停命中（2026-09-22 反馈十轮，移植自试作 surface-picking.js）——
     用相机基向量出射线，逐半体逆变换回局部包围盒，沿射线步进 SDF 取**表面命中点**；
     不读像素、不进 GPU，一次取点几十步。 */
  const HOVER_BOUNDS={min:[-3.1,-1.04,-.014],max:[2.53,1.4,.82]};
  function pickSurface(px,py,eye,view,models){
    const spread=Math.tan(.65/2);
    const ray=vec.norm([0,1,2].map(i=>view[i*4]*px*aspect*spread+view[i*4+1]*py*spread-view[i*4+2]));
    let nearest=null;
    for(const model of models){
      const offset=eye.map((n,i)=>n-model[12+i]);
      const axes=[0,4,8].map(i=>[model[i],model[i+1],model[i+2]]);
      const origin=axes.map(axis=>vec.dot(offset,axis));
      const direction=axes.map(axis=>vec.dot(ray,axis));
      let near=0,far=nearest?nearest.distance:65;
      for(let axis=0;axis<3;axis++){
        if(Math.abs(direction[axis])<1e-8){
          if(origin[axis]<HOVER_BOUNDS.min[axis]||origin[axis]>HOVER_BOUNDS.max[axis])far=-1;
          continue;
        }
        const a=(HOVER_BOUNDS.min[axis]-origin[axis])/direction[axis];
        const b=(HOVER_BOUNDS.max[axis]-origin[axis])/direction[axis];
        near=Math.max(near,Math.min(a,b));
        far=Math.min(far,Math.max(a,b));
      }
      for(let step=0,t=near;step<96&&t<=far;step++){
        const point=origin.map((n,i)=>n+direction[i]*t);
        const gap=animalSdf(point[0],point[1],point[2]);
        if(gap<=.009){nearest={point,distance:t};break;}
        t+=Math.max(.006,gap*.7);
      }
    }
    return nearest;
  }
  /* 悬停判定：取点节流 50ms；**按下（点击 / 拖动）期间不清零**——命中就更新光点，没命中保持原样。
     用户 2026-09-22 反馈十轮：「鼠标点击的时候也保持 hover 的效果」。 */
  function updateHover(models,eye,view){
    if(reduced.matches||pageHidden||!visible){hoverTarget=0;return;}
    if(!hoverPointer&&!pointerDown){hoverTarget=0;return;}
    if(!pickDirty&&time-lastHoverPick<.05)return;
    pickDirty=false;lastHoverPick=time;
    if(!hoverPointer)return;
    const hit=pickSurface(hoverPointer[0],hoverPointer[1],eye,view,models);
    if(hit){
      if(!hoverTarget&&hoverAmount<.1)hoverStarted=time;
      hoverPoint=hit.point;hoverTarget=1;
    }else if(!pointerDown)hoverTarget=0;
  }
  function clearHover(){hoverPointer=null;hoverTarget=0;pickDirty=false;}
  function drawElectricBridge(models,amount,view,projection){
    let cursor=0;
    function strip(points,strength,seed){
      const vertex=(i,side)=>{
        const p=points[i],next=points[Math.min(i+1,points.length-1)],previous=points[Math.max(0,i-1)];
        for(let j=0;j<3;j++)arcData[cursor++]=p[j];
        for(let j=0;j<3;j++)arcData[cursor++]=next[j]-previous[j];
        arcData[cursor++]=side;arcData[cursor++]=i/(points.length-1);
        arcData[cursor++]=strength;arcData[cursor++]=seed;
      };
      for(let i=0;i<points.length-1;i++){
        vertex(i,-1);vertex(i,1);vertex(i+1,-1);
        vertex(i+1,-1);vertex(i,1);vertex(i+1,1);
      }
    }
    // Four locked contact pairs match the circular terminals on the mating face.
    for(let k=0;k<4;k++){
      const anchor=[-1.45+k*.9,.12,-.012];
      const a=transform(models[0],anchor),b=transform(models[1],anchor);
      const axis=vec.norm(vec.sub(b,a));
      const side=vec.norm(vec.cross(axis,[0,1,0])),up=vec.cross(side,axis);
      const points=[];
      for(let i=0;i<=48;i++){
        const t=i/48,envelope=Math.sin(t*Math.PI)*amount*(1-charge*.92);
        const bend=Math.sin(t*Math.PI)*(.10+Math.sin(k*2.3)*.07);
        const fine=Math.sin(t*65.-time*7.+k*11.)*.016+Math.sin(t*119.+time*11.+k)*.008;
        const sway=Math.sin(t*15.-time*2.8+k*2.)*.046;
        points.push(a.map((v,j)=>mix(v,b[j],t)+envelope*(side[j]*(bend+sway+fine)+up[j]*(Math.sin(t*21.+time*3.2+k)*.036+fine))));
      }
      strip(points,.78+(k%2)*.18,k*.271);
      // A quieter filament peels away and rejoins the same anchored main arc.
      const branch=[];
      for(let i=10;i<=35;i++){
        const t=(i-10)/25,spread=Math.sin(t*Math.PI)*amount*(.07+.045*Math.sin(time*1.7+k));
        branch.push(points[i].map((v,j)=>v+side[j]*spread+up[j]*Math.sin(t*TAU+time*2.+k)*spread*.5));
      }
      strip(branch,(.25+.10*Math.pow(Math.sin(time*2.3+k),2.))*(1-charge*.85),k*.271+.15);
    }
    gl.useProgram(arcProgram.p);
    uniform(arcProgram,'uView',view);uniform(arcProgram,'uProjection',projection);
    uniform(arcProgram,'uResolution',[width,height]);uniform(arcProgram,'uTime',time);
    uniform(arcProgram,'uOpacity',smooth(.025,.3,amount));
    uniform(arcProgram,'uCharge',charge);
    gl.bindVertexArray(arcVao);gl.bindBuffer(gl.ARRAY_BUFFER,arcBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,arcData.subarray(0,cursor));
    gl.drawArrays(gl.TRIANGLES,0,cursor/10);
  }
  /* —— 取景（2026-09-22 反馈三轮：旋转不再被裁；反馈四轮：旋转时镜头零推拉）——
     规则：镜头距离与横纵移位**只跟器物位比例（+ 分符量）走，与拖动姿态无关**。
     做法：在可旋转范围（yaw ±1.4 / pitch -.45~.55）上取一组采样姿态，
     把它们投影到取景框、取并集——先解出能装下全部姿态的距离，再把并集摆正到画面中心；
     距离按分符量分档缓存 + 档内插值（分符时该退就退，那是拆解的固有推拉）。
     拖动旋转时三项都不动，任何角度都不裁；代价是每个姿态都按包络留白（不再逐姿态放大）。 */
  const FIT_MARGIN=.06;
  const FIT_PAD=.06;   // 世界单位的安全垫：浮雕起伏 + 抗锯齿 + 泛光外溢
  const FIT_YAW=[-1.4,-1.05,-.7,-.35,0,.35,.7,1.05,1.4];
  const FIT_PITCH=[-.45,.1,.55];
  const FIT_STEPS=4;   // 分符量分档数（档内插值）
  const POSES=[];
  for(const gy of FIT_YAW)for(const gp of FIT_PITCH)POSES.push([gy,gp]);
  let panX=0,panY=0;   // 当前生效的镜头横/纵移位（世界单位，静态）
  const framingCache=new Map();
  function camBasis(d,pan){
    const e=[pan[0],.95+pan[1],d];
    const f=vec.norm(vec.sub([pan[0],.24+pan[1],0],e));
    const r=vec.norm(vec.cross(f,[0,1,0]));
    return {f,r,u:vec.cross(r,f)};
  }
  /* 采样点到取景框的斜率并集（sx=x_cam/near，sy=y_cam/near） */
  const bounds={x0:0,x1:0,y0:0,y1:0,clipped:false};
  function projectBounds(models,d,pan,out){
    const {f,r:right,u:up}=camBasis(d,pan);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,clipped=false;
    for(const m of models)for(const c of FIT_POINTS){
      const p=transform(m,c);
      const vx=p[0]-pan[0],vy=p[1]-(.95+pan[1]),vz=p[2]-d;
      const near=vx*f[0]+vy*f[1]+vz*f[2];   // 采样点在视线上都是「表面点」，直接取点深度
      if(near<.15){clipped=true;continue;}
      const sx=(vx*right[0]+vy*right[1]+vz*right[2])/near;
      const sy=(vx*up[0]+vy*up[1]+vz*up[2])/near;
      if(sx<x0)x0=sx;if(sx>x1)x1=sx;if(sy<y0)y0=sy;if(sy>y1)y1=sy;
    }
    out.x0=x0;out.x1=x1;out.y0=y0;out.y1=y1;out.clipped=clipped;
    return out;
  }
  /* 取景解算：把**实际网格采样点**投到取景框里，取最大「占框比」
     （1 = 正好压在 6% 边距线上）。比代理椭球可靠：不再有代理体盖不住真实几何的风险。 */
  function fitDistance(models,tan,pan){
    const kmx=(1-FIT_MARGIN)*tan*aspect,kmy=(1-FIT_MARGIN)*tan;
    const worstAt=d=>{
      projectBounds(models,d,pan,bounds);
      if(bounds.clipped)return 2;
      const pad=FIT_PAD/(d*.99);
      return Math.max(
        (Math.abs(bounds.x0)+pad)/kmx,(Math.abs(bounds.x1)+pad)/kmx,
        (Math.abs(bounds.y0)+pad)/kmy,(Math.abs(bounds.y1)+pad)/kmy);
    };
    let d=distance;
    for(let iter=0;iter<6;iter++){
      const worst=worstAt(d);
      if(Math.abs(worst-1)<.008)break;
      d=clamp(d*worst,3.2,16);
    }
    /* 收尾保险：仍有溢出（收敛慢的极端姿态）再退一档，宁小勿裁 */
    const last=worstAt(d);
    if(last>1)d=clamp(d*last*(1+.01),3.2,16);
    return d;
  }
  /* 拆解动作：两半各自朝外「上下爆开」＋翻转错位（用户 2026-09-22 指定保留原样，勿改） */
  const SPLIT={ trans:[.42,.96,.78], turn:[.10,.38,.08] };
  function splitOffset(side,amount){
    return {
      trans:[side*amount*SPLIT.trans[0],side*amount*SPLIT.trans[1],side*(.009+amount*SPLIT.trans[2])],
      turn:[side*amount*SPLIT.turn[0],side*amount*SPLIT.turn[1],side*amount*SPLIT.turn[2]],
    };
  }
  /* 采样姿态下的两半模型矩阵（基础位姿只留平移与旋转，不含浮动/扫掠等瞬时量） */
  function frameModels(amount,yawValue,pitchValue){
    const base=mult(translate(0,.15,0),rotation(pitchValue,yawValue,0));
    const out=[];
    for(const side of [1,-1]){
      const {trans,turn}=splitOffset(side,amount);
      const mirror=identity();mirror[10]=side;
      out.push(mult(base,mult(translate(...trans),mult(rotation(...turn),mirror))));
    }
    return out;
  }
  /* 移位与距离互相影响：在「合璧」姿态下跑几轮就收敛（分符时沿用同一移位，拆解中画面不会横移） */
  function solveFraming(tan){
    const pan=[0,0];
    for(let pass=0;pass<4;pass++){
      let d=6.5;
      for(const [gy,gp] of POSES)d=Math.max(d,fitDistance(frameModels(0,gy,gp),tan,pan));
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const [gy,gp] of POSES){
        projectBounds(frameModels(0,gy,gp),d,pan,bounds);
        x0=Math.min(x0,bounds.x0);x1=Math.max(x1,bounds.x1);
        y0=Math.min(y0,bounds.y0);y1=Math.max(y1,bounds.y1);
      }
      const cx=(x0+x1)/2,cy=(y0+y1)/2;
      if(Math.abs(cx)<.004&&Math.abs(cy)<.004)break;
      pan[0]+=cx*d*.99;pan[1]+=cy*d*.99/Math.max(.5,camBasis(d,pan).u[1]);
    }
    return pan;
  }
  /* 取景距离：**一张画框装下整段动作**——把「合璧 + 拆解全过程」都当采样姿态，
     取包络最大值，所以距离与分符量、与拖动姿态都无关（展开 / 旋转全程零推拉）。
     画框（器物位）因此比页头带高，见 site.css 的 --tiger-frame。 */
  function fitFraming(tan){
    /* 比例按 0.1 分档缓存：拖动窗口改大小时不至于每帧重解（误差 < 边距，不会裁） */
    const key=`${(Math.round(aspect*10)/10).toFixed(1)}|${tan.toFixed(4)}`;
    let entry=framingCache.get(key);
    if(!entry){
      const pan=solveFraming(tan);
      let worst=0;
      for(let step=0;step<=FIT_STEPS;step++)
        for(const [gy,gp] of POSES)worst=Math.max(worst,fitDistance(frameModels(step/FIT_STEPS,gy,gp),tan,pan));
      entry={pan,distance:worst};
      framingCache.set(key,entry);
    }
    panX=entry.pan[0];panY=entry.pan[1];
    return entry.distance;
  }
  function render(){
    if(destroyed||!sized||gl.isContextLost())return;
    const center=0;
    const energy=.025+split*(.65+charge*.35)+flash*.8+afterglow*.5;
    const scan=(time*.65)%7-3.5;
    const tan=Math.tan(.65/2);
    const floatY=ambient?Math.sin(time*.8)*.035:0;
    const basePos=[center,.15+floatY,0];
    const baseRot=rotation(pitch,yaw,Math.sin(time*.35)*.006);
    basePos[1]+=recoil;basePos[2]+=recoil*.45;
    const base=mult(translate(basePos[0],basePos[1],basePos[2]),mult(rotation(recoil*.38,0,recoil*.55),baseRot));
    const models=[],halves=[];
    for(const side of [1,-1]){
      const {trans,turn}=splitOffset(side,split);
      const mirror=identity();mirror[10]=side;
      models.push(mult(base,mult(translate(trans[0],trans[1],trans[2]),mult(rotation(turn[0],turn[1],turn[2]),mirror))));
      halves.push({trans,turn,rotM:rotation(turn[0],turn[1],turn[2]),side});
    }
    /* 取景：恒定（与拖动姿态、分符量都无关，见 fitFraming 注释）；单帧渲染直接落位，循环里由 update() 平滑 */
    neededDistance=fitFraming(tan);
    if(!raf)distance=neededDistance;
    const eyePos=[panX,.95+panY,distance];
    const target=[panX,.24+panY,0];
    const view=lookAt(eyePos,target);
    const projection=perspective(.65,aspect,.1,65);
    /* 命中测试用的相机基与半体变换：每帧记一份，点击时直接取用 */
    const fwd=vec.norm(vec.sub(target,eyePos));
    const right=vec.norm(vec.cross(fwd,[0,1,0]));
    const up=vec.cross(right,fwd);
    hitFrame={eye:eyePos,f:fwd,right,up,tan,aspect,pos:basePos,rotM:baseRot,halves};
    /* 三器切换流光的落点（2026-09-23）：虎符（含拆解姿态）在器物位里的投影中心，单位 CSS px。
       用当前帧的真实网格采样点求包围盒，分符 / 旋转 / 取景移动都跟着走。 */
    projectBounds(models,distance,[panX,panY],bounds);
    if(Number.isFinite(bounds.x0)&&Number.isFinite(bounds.x1)&&Number.isFinite(bounds.y0)&&Number.isFinite(bounds.y1)){
      canvas.__modelAnchor={
        x:(.5+(bounds.x0+bounds.x1)/(4*tan*aspect))*canvas.clientWidth,
        y:(.5-(bounds.y0+bounds.y1)/(4*tan))*canvas.clientHeight
      };
    }
    /* 悬停取点要在相机（eyePos / view）算好之后——否则同一作用域里 const 还在 TDZ */
    updateHover(models,eyePos,view);

    gl.bindFramebuffer(gl.FRAMEBUFFER,sceneTarget.fbo);gl.viewport(0,0,width,height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    /* 地面接影面只做影、**不写深度**：分符 / 俯仰后器物会有部分落到 y=-1.45 以下，
       写深度就会把这些部位整块切掉（2026-09-22 用户反馈「脚被切掉」的根因） */
    gl.depthMask(false);
    gl.useProgram(floorProgram.p);uniform(floorProgram,'uView',view);uniform(floorProgram,'uProjection',projection);uniform(floorProgram,'uCenter',center);gl.bindVertexArray(floor.vao);gl.drawArrays(gl.TRIANGLES,0,floor.count);
    gl.depthMask(true);gl.disable(gl.BLEND);
    for(let i=0;i<models.length;i++)for(const [m,material] of parts)drawMesh(m,models[i],material,view,projection,eyePos,energy,scan,i);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.depthMask(false);
    if(split>.03){
      drawElectricBridge(models,split,view,projection);
      // 场线只在「分符」时出现：合璧状态下不挂任何背景线（2026-09-22 用户反馈优化）
      const field=[],packets=[];
      for(let j=0;j<5;j++){
        const radius=2.4+j*.12;let prev=null;
        for(let i=0;i<=130;i++){
          const angle=i/130*TAU;
          const p=[center+Math.cos(angle)*radius,.10+Math.sin(angle)*radius*.48,Math.sin(angle)*.24-.45];
          p[1]+=.018*Math.sin(angle*12-time*.55+j);
          if(prev&&i%15<12){field.push(...prev,...p);if((i+Math.floor(time*14)+j*13)%130<7)packets.push(...prev,...p);}prev=p;
        }
      }
      drawLines(field,[.21,.42,.34],.05+split*.07,view,projection);
      drawLines(packets,[.22,1.3,.91],.1+split*.35,view,projection);
    }
    if(flash>.015){
      const shock=[];const radius=2+(1-flash)*3.1;
      for(let i=0;i<160;i++){
        const a=i/160*TAU,b=(i+1)/160*TAU;
        shock.push(center+Math.cos(a)*radius,.1+Math.sin(a)*radius*.56,0,center+Math.cos(b)*radius,.1+Math.sin(b)*radius*.56,0);
      }
      drawLines(shock,[.2,1.7,1.25],flash*.8,view,projection);
    }
    /* 冲击粒子爆炸（2026-09-22 反馈十五轮：旧版 75 条短划线跟着 flash 一闪即没（约 0.3s），
       用户要「原版那种粒子爆炸」——改成 190 颗电屑沿黄金角炸开，半径按冲击时钟先快后慢、
       带轻微下坠，1.2s 内渐隐；用确定性伪随机（rand）保证暂停 / 重播同帧一致 */
    if(impactAge<1.2){
      const t=impactAge/1.2,fade=(1-t)*(1-t);
      const hash=n=>{const v=Math.sin(n*127.1+42.7)*43758.5453;return v-Math.floor(v);};
      const sparks=[];
      for(let i=0;i<190;i++){
        const angle=i*2.39996,rnd=hash(i);
        const r=(1-Math.pow(1-t,2.2))*(2.4+rnd*3.4);
        const x=center+Math.cos(angle)*r,z=Math.sin(i*17.1)*r*.34;
        const y=.14+Math.sin(angle)*r*.62-t*t*(.8+rnd*1.2);
        const tail=.12+rnd*.2;
        sparks.push(x,y,z,x+Math.cos(angle)*tail,y+Math.sin(angle)*tail*.62,z);
      }
      drawLines(sparks,[1.2,2.4,1.64],Math.max(flash*.9,fade*.9),view,projection);
    }
    gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.bindVertexArray(null);
    gl.useProgram(blurProgram.p);
    let source=sceneTarget.texture;
    for(let i=0;i<6;i++){
      const dest=i%2===0?bloomA:bloomB;gl.bindFramebuffer(gl.FRAMEBUFFER,dest.fbo);gl.viewport(0,0,dest.w,dest.h);
      sampler(blurProgram,'uTexture',0,source);uniform(blurProgram,'uDirection',i%2===0?[1.8/dest.w,0]:[0,1.8/dest.h]);uniform(blurProgram,'uThreshold',i===0?.7:0);gl.drawArrays(gl.TRIANGLES,0,3);source=dest.texture;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.useProgram(composite.p);sampler(composite,'uScene',0,sceneTarget.texture);sampler(composite,'uBloom',1,source);uniform(composite,'uFlash',flash);gl.drawArrays(gl.TRIANGLES,0,3);
    canvas.dataset.state=split>.1?'separated':'joined';
    canvas.dataset.hover=hoverTarget?'active':hoverAmount>.01?'fading':'off';
    canvas.dataset.phase=sequence?sampleCoupling(time-sequence.start,sequence.initialSplit).stage:'idle';
    canvas.dataset.triangles=String(parts.reduce((n,[m])=>n+m.count/3,0)*2);
  }
  /* —— 合璧时间线（2026-09-22 反馈十一轮重做，内联自试作 motion-state.js；十二轮 +0.5s）——
     0~1.45s 开符 → 1.45~2.9s 蓄势（电弧绷紧增亮）→ 2.9~4.0s 牵引吸入 → 4.0s 冲击
     （闪光 + 后坐 + 粒子爆炸 + 余辉）→ 6.6s 收尾。整段由纯函数按时间采样，暂停 / 重播都不会漂。
     反馈十五轮（2026-09-22 用户定）：整段自动播放的入口已撤；**手动合璧到位的一瞬只补播冲击段**
     （sequence 从 t=4s 起算，见 update 的 pendingStrike 分支），开符 / 蓄势 / 牵引段留给试作同步；
     冲击段时长 +0.6s（2.0s → **2.6s**，收尾窗口与余辉一并拉长），粒子爆炸由 1.2s 的burst 承担。 */
  function sampleCoupling(elapsed,initialSplit=0){
    const t=Math.max(0,elapsed);
    if(t<1.45)return{stage:'opening',split:initialSplit+(1-initialSplit)*smooth(0,1.45,t),charge:0,flash:0,recoil:0,afterglow:0,done:false};
    if(t<2.9)return{stage:'charging',split:1,charge:smooth(1.45,2.9,t),flash:0,recoil:0,afterglow:0,done:false};
    if(t<4)return{stage:'pulling',split:1-Math.pow(clamp((t-2.9)/1.1),3.2),charge:1,flash:0,recoil:0,afterglow:0,done:false};
    const age=t-4;
    const settle=1-smooth(1.9,2.6,age);
    return{stage:age<.24?'impact':age<2.6?'afterglow':'idle',split:0,charge:0,
      flash:Math.exp(-age*14)*settle,
      recoil:settle?-.16*Math.sin(age*30)*Math.exp(-age*5.5)*settle:0,
      afterglow:Math.exp(-age*1.6)*settle,
      done:age>=2.6};
  }
  function resetCoupling(){charge=0;recoil=0;afterglow=0;impactAge=Infinity;}

  /* 时间线推进：整段序列与手动合璧冲击共用（手动那一次从冲击段起算）。 */
  function update(dt){
    if(ambient||sequence||hoverTarget||hoverAmount>.001)time+=dt;
    hoverAmount=mix(hoverAmount,hoverTarget,1-Math.exp(-dt*(hoverTarget?7:4)));
    flash*=Math.exp(-dt*5.5);
    if(sequence){
      const elapsed=time-sequence.start;
      impactAge=elapsed>=4?elapsed-4:Infinity;
      const state=sampleCoupling(elapsed,sequence.initialSplit);
      split=targetSplit=state.split;charge=state.charge;flash=state.flash;recoil=state.recoil;afterglow=state.afterglow;
      /* 恢复（合璧）时视角同时回默认角度：牵引段一开始就拨回，和收合一起缓动（2026-09-22 反馈十二轮） */
      if(state.stage==='pulling'&&!sequence.restoring){sequence.restoring=true;viewRestoring=true;targetYaw=VIEW.yaw;targetPitch=VIEW.pitch;}
      if(state.done){sequence=null;impactAge=Infinity;}
    }
    const k=1-Math.exp(-dt*SPLIT_RATE);
    /* 视角速率：拖动 / 双击复位照旧走 9（手感不变）；「收合 = 恢复」期间跟离合同一时长，二者同步缓动 */
    const kv=1-Math.exp(-dt*(viewRestoring?SPLIT_RATE:9));
    split=mix(split,targetSplit,k);
    yaw=mix(yaw,targetYaw,kv);pitch=mix(pitch,targetPitch,kv);
    distance=mix(distance,neededDistance,1-Math.exp(-dt*6));
    if(viewRestoring&&targetSplit===0&&split<.02)viewRestoring=false;
    /* 手动合璧到位的一瞬补一击：闪光 + 后坐抖动 + 粒子爆炸 + 余辉——
       复用合璧时间线的冲击段（t=4s 起算），自带时钟，约 2.6s 收尾；
       不在这里调 start()：循环尾部的续跑条件已含 sequence，重复调会挂出两条 rAF 链 */
    if(pendingStrike&&split<.045){
      pendingStrike=false;flash=1;
      resetCoupling();
      sequence={start:time-4,initialSplit:0};
    }
  }
  function loop(now){
raf=0;if(pageHidden||!visible||destroyed)return;
    const dt=last?Math.min(.045,(now-last)/1000):.016;last=now;
    update(dt);render();
    if(ambient||sequence||hoverTarget||settling())raf=requestAnimationFrame(loop);
    else last=0;
  }
  function start(){if(!raf&&!pageHidden&&visible&&!destroyed){last=0;raf=requestAnimationFrame(loop);}}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
  function toggleSplit(){
    sequence=null;resetCoupling();
    const want=targetSplit>.5?0:1;
    targetSplit=want;
    /* 收合 = 恢复：视角一并回默认角度（拆解时不动视角）；回收期间视角与离合同步时长 */
    if(want===0){targetYaw=VIEW.yaw;targetPitch=VIEW.pitch;viewRestoring=true;}
    else viewRestoring=false;
    pendingStrike=want===0&&split>.1;
    options.onState?.(want===1);
    if(reduced.matches){split=want;pendingStrike=false;flash=0;viewRestoring=false;render();return;}
    start();
  }
  /* —— 器物本体命中测试（点模型 = 拆解 / 收合一次）——
     做法：用相机基向量直接生成屏幕射线，逐层逆变换回每一半的局部空间，
     与解剖椭球（body anatomy + 头骨 + 尾椎小球）做精确相交。不读像素、不进 GPU，
     一次点击几十次交点计算；点到空处（背景）不算，不会误触。 */
  const HIT_SHAPES=anatomy.map(([c,r])=>[c,r]);
  HIT_SHAPES.push([[1.62,.65,0],[.27,.24,.33]]);
  for(let i=0;i<tailPoints.length;i+=2)HIT_SHAPES.push([tailPoints[i],[.11,.11,.11]]);
  const invRot=(m,v)=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[4]*v[0]+m[5]*v[1]+m[6]*v[2],m[8]*v[0]+m[9]*v[1]+m[10]*v[2]];
  function hitsTiger(px,py,cssW,cssH){
    const h=hitFrame;
    if(!h||!cssW||!cssH)return false;
    const ndcX=px/cssW*2-1,ndcY=1-py/cssH*2;
    const dir=vec.norm(h.f.map((n,i)=>n+h.right[i]*ndcX*h.tan*h.aspect+h.up[i]*ndcY*h.tan));
    const o0=invRot(h.rotM,vec.sub(h.eye,h.pos)),d0=invRot(h.rotM,dir);
    for(const half of h.halves){
      const o=invRot(half.rotM,[o0[0]-half.trans[0],o0[1]-half.trans[1],o0[2]-half.trans[2]]);
      const d=invRot(half.rotM,d0);
      o[2]*=half.side;d[2]*=half.side;
      for(const [c,r0] of HIT_SHAPES){
        /* 半径放宽 1.2×：小屏器物更小、分符后两半中间是空的，指点落在近旁也算命中 */
        const r=r0.map(n=>n*1.2);
        const ox=(o[0]-c[0])/r[0],oy=(o[1]-c[1])/r[1],oz=(o[2]-c[2])/r[2];
        const dx=d[0]/r[0],dy=d[1]/r[1],dz=d[2]/r[2];
        const A=dx*dx+dy*dy+dz*dz,B=2*(ox*dx+oy*dy+oz*dz),C=ox*ox+oy*oy+oz*oz-1;
        const disc=B*B-4*A*C;
        if(disc>=0&&(-B-Math.sqrt(disc))/(2*A)>=0)return true;
      }
    }
    return false;
  }
  on(canvas,'pointerdown',e=>{
    if(e.button!==0)return;
    dragging=true;dragDist=0;pointerDown=true;pointer={x:e.clientX,y:e.clientY,id:e.pointerId};
    viewRestoring=false;
    /* 触摸没有 hover 态：按下即点亮（点哪儿亮哪儿），释放时熄 */
    if(e.pointerType==='touch'){
      const rect=canvas.getBoundingClientRect();
      hoverPointer=[(e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2];pickDirty=true;
      if(!raf)start();
    }
    canvas.setPointerCapture(e.pointerId);
  });
  on(canvas,'pointermove',e=>{
    if(e.pointerType!=='touch'&&!reduced.matches){
      const rect=canvas.getBoundingClientRect();
      hoverPointer=[(e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2];pickDirty=true;
      if(!raf)start();
    }
    if(!dragging||!pointer)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    dragDist+=Math.abs(dx)+Math.abs(dy);
    targetYaw=clamp(targetYaw+dx*.006,-1.4,1.4);targetPitch=clamp(targetPitch+dy*.004,-.45,.55);
    pointer.x=e.clientX;pointer.y=e.clientY;
    if(reduced.matches){yaw=targetYaw;pitch=targetPitch;render();}else start();
  });
  /* 抬手时若几乎没动（不是拖视角），且落点在器物本体上 → 拆解 / 收合一次 */
  on(canvas,'pointerup',e=>{
    const moved=dragDist>6;
    dragging=false;pointerDown=false;pointer=null;
    if(e.pointerType==='touch')clearHover();
    if(moved||e.button!==0)return;
    const rect=canvas.getBoundingClientRect();
    if(hitsTiger(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height))toggleSplit();
  });
  const release=()=>{dragging=false;pointerDown=false;pointer=null;};
  on(canvas,'pointercancel',release);on(canvas,'lostpointercapture',release);
  on(canvas,'pointerleave',clearHover);
  on(canvas,'dblclick',()=>{targetYaw=VIEW.yaw;targetPitch=VIEW.pitch;viewRestoring=false;if(reduced.matches){yaw=targetYaw;pitch=targetPitch;render();}else start();});
  on(document,'visibilitychange',()=>{pageHidden=document.hidden;if(pageHidden){clearHover();hoverAmount=0;stop();}else start();});
  on(reduced,'change',()=>{ambient=options.motion&&!reduced.matches;clearHover();hoverAmount=0;stop();render();if(ambient)start();});
  on(canvas,'webglcontextlost',e=>{e.preventDefault();stop();options.onLost?.();console.info('虎符图腾：显卡渲染连接已暂停。');});
  /* 滚出视口就停（与星海同一套纪律）：常动只在器物位可见时发生 */
  let io=null;
  if('IntersectionObserver' in window){
    io=new IntersectionObserver((entries)=>{visible=entries[0].isIntersecting;visible?start():stop();},{threshold:.02});
    io.observe(canvas);
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function destroy(){
    if(destroyed)return;
    stop();
    destroyed=true;io?.disconnect();observer.disconnect();listeners.forEach(off=>off());
    for(const b of buffers)gl.deleteBuffer(b);for(const t of textures)gl.deleteTexture(t);for(const p of programs)gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);for(const v of vaos)gl.deleteVertexArray(v);for(const f of framebuffers)gl.deleteFramebuffer(f);for(const r of renderbuffers)gl.deleteRenderbuffer(r);
  }
  resize();
  options.onState?.(false);
  start();
  return {destroy,toggle:toggleSplit};
}
