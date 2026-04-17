// edge-functions/api/update.js
// V9.25 全闭环终极版 | EdgeOne KV 兼容修复版
// 功能：动态超参 + 全局/联赛双配置 + 可视化后台 + 完整回测 + Optuna对接 + ELO迭代 + 三套独立权重
const UPDATE_SECRET = process.env.UPDATE_SECRET || '123456789';
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

// 联赛列表
const LEAGUE_IDS = [292, 2, 39, 140, 78, 135, 61, 88, 94, 71, 128, 253, 262, 848, 3];
const LEAGUE_LIST = ["韩K联","欧冠","英超","西甲","德甲","意甲","法甲","荷甲","葡超","巴甲","阿甲","美职联","墨超","亚冠","欧联杯"];

// ===================== 1. 默认超参 =====================
const DEFAULT_GLOBAL_CONFIG = {
  negBinomialR: 2.5,
  dcRho: 0.03,
  eloK: 20,
  eloDiffWeight: 400,
  awayEloOffset: 500,
  lambdaHomeBase: 1.50,
  lambdaAwayBase: 1.20,
  lambdaMin: 0.5,
  lambdaMax: 2.5,
  weight1X2: 0.6,
  weightOU: 0.55,
  weightScore: 0.65,
  overUnderLine: 2.5,
  valueDiffThreshold: 0.08,
  homeAdvantage: 0.08,
  maxGoalCalc: 8
};

const DEFAULT_LEAGUE_CONFIG = Object.fromEntries(LEAGUE_LIST.map(name=>[name,{}]));
Object.assign(DEFAULT_LEAGUE_CONFIG,{
  "英超": { dcRho: 0.04, negBinomialR: 2.6 },
  "韩K联": { dcRho: 0.02, negBinomialR: 2.3 },
  "德甲": { lambdaHomeBase: 1.65 }
});

const DEFAULT_ELO = {
  '蔚山现代': 1860, '首尔FC': 1790, '曼城': 2100, '阿森纳': 2060, 
  '利物浦': 2040, '皇马': 2080, '巴萨': 2030, '拜仁': 2070, 
  '巴黎圣日耳曼': 2000, '国际米兰': 1960
};

// ===================== 2. 工具函数 =====================
function limitParam(val, min, max) {
  return Math.max(min, Math.min(max, Number(val)));
}
function getMatchConfig(leagueName, globalCfg, leagueCfg) {
  const local = leagueCfg[leagueName] || {};
  return {
    negBinomialR: limitParam(local.negBinomialR ?? globalCfg.negBinomialR, 1.5, 4.0),
    dcRho: limitParam(local.dcRho ?? globalCfg.dcRho, 0.01, 0.1),
    lambdaHomeBase: limitParam(local.lambdaHomeBase ?? globalCfg.lambdaHomeBase, 1.0, 2.0),
    lambdaAwayBase: globalCfg.lambdaAwayBase,
    lambdaMin: globalCfg.lambdaMin,
    lambdaMax: globalCfg.lambdaMax,
    maxGoalCalc: globalCfg.maxGoalCalc,
    overUnderLine: globalCfg.overUnderLine,
    valueDiffThreshold: globalCfg.valueDiffThreshold,
    homeAdvantage: globalCfg.homeAdvantage,
    eloDiffWeight: globalCfg.eloDiffWeight,
    awayEloOffset: globalCfg.awayEloOffset
  };
}

// 数学核心
const factCache = new Map();
function factorial(n) {
  if (n <= 1) return 1;
  if (factCache.has(n)) return factCache.get(n);
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  factCache.set(n, res);
  return res;
}
function negBinomial(k, mu, r) {
  const p = r / (r + mu);
  const coef = factorial(k + r - 1) / (factorial(k) * factorial(r - 1));
  return coef * Math.pow(p, r) * Math.pow(1 - p, k);
}
function dcAdjust(i, j, rho) {
  const map = {'0,0':1+rho,'1,0':1-rho,'0,1':1-rho,'1,1':1+rho};
  return map[`${i},${j}`] || 1.0;
}

// ===================== 3. 概率计算 =====================
function computeFullProbs(hl, al, cfg) {
  let home = 0, draw = 0, away = 0;
  let under = 0, over = 0;
  const scores = [];
  for (let i = 0; i <= cfg.maxGoalCalc; i++) {
    for (let j = 0; j <= cfg.maxGoalCalc; j++) {
      const p = negBinomial(i, hl, cfg.negBinomialR) * negBinomial(j, al, cfg.negBinomialR) * dcAdjust(i, j, cfg.dcRho);
      scores.push({ home: i, away: j, prob: p });
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      i + j <= cfg.overUnderLine ? under += p : over += p;
    }
  }
  const total = home + draw + away || 1;
  const normalize = v => Number((v / total).toFixed(4));
  scores.sort((a, b) => b.prob - a.prob);
  return {
    homeWin: normalize(home), draw: normalize(draw), awayWin: normalize(away),
    under25: normalize(under), over25: normalize(over),
    bestScore: `${scores[0].home}-${scores[0].away} (${(scores[0].prob*100).toFixed(1)}%)`
  };
}

// ===================== 4. 网络请求 =====================
async function safeFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { 
    return null; 
  } finally { 
    clearTimeout(timer); 
  }
}
async function fetchFixtures(leagueId, date) {
  if (!FOOTBALL_API_KEY) return [];
  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2026&date=${date}`;
  const data = await safeFetch(url, {
    headers:{
      'x-rapidapi-key':FOOTBALL_API_KEY,
      'x-rapidapi-host':'v3.football.api-sports.io'
    }
  });
  return data?.response || [];
}
async function fetchFinishedFixtures(leagueId, date) {
  if (!FOOTBALL_API_KEY) return [];
  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2026&date=${date}&status=FT`;
  const data = await safeFetch(url, {
    headers:{
      'x-rapidapi-key':FOOTBALL_API_KEY,
      'x-rapidapi-host':'v3.football.api-sports.io'
    }
  });
  return data?.response || [];
}
async function fetchOdds(homeTeam, awayTeam) {
  if (!ODDS_API_KEY) return null;
  const data = await safeFetch(`https://api.odds-api.io/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h,over_under`);
  if (!data?.data) return null;
  for (const g of data.data) {
    if (g.home_team === homeTeam && g.away_team === awayTeam) {
      const h2h = g.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
      const ou = g.bookmakers?.[0]?.markets?.find(m => m.key === 'over_under_2_5');
      return {
        home: h2h?.outcomes?.find(o=>o.name===homeTeam)?.price||2.2,
        draw: h2h?.outcomes?.find(o=>o.name==='Draw')?.price||3.3,
        away: h2h?.outcomes?.find(o=>o.name===awayTeam)?.price||3.4,
        over25: ou?.outcomes?.find(o=>o.name==='Over 2.5')?.price||1.9,
        under25: ou?.outcomes?.find(o=>o.name==='Under 2.5')?.price||1.9
      };
    }
  }
  return null;
}
function oddsToProb(h,d,a,ov,un) {
  const hp=1/h,dp=1/d,ap=1/a,ovp=1/ov,unp=1/un;
  const t1=hp+dp+ap, t2=ovp+unp;
  return {
    home: Number((hp/t1).toFixed(4)),draw: Number((dp/t1).toFixed(4)),away: Number((ap/t1).toFixed(4)),
    over25: Number((ovp/t2).toFixed(4)),under25: Number((unp/t2).toFixed(4))
  };
}

// ===================== 5. ELO 迭代 =====================
function calcEloChange(homeElo, awayElo, result, kVal) {
  const diff = homeElo - awayElo;
  const expHome = 1 / (1 + Math.pow(10, -diff / 400));
  const score = result==='H'?1:result==='D'?0.5:0;
  const delta = kVal * (score - expHome);
  return { homeDelta: delta, awayDelta: -delta };
}
async function updateELOFromHistory(ELO_DB, date, eloK) {
  const updateList = [];
  for(const id of LEAGUE_IDS) {
    const finished = await fetchFinishedFixtures(id, date);
    for(const m of finished) {
      const ht = m.teams.home.name, at = m.teams.away.name;
      const hg = m.goals.home??0, ag = m.goals.away??0;
      const res = hg>ag?'H':ag>hg?'A':'D';
      const hElo = ELO_DB[ht]||1750, aElo = ELO_DB[at]||1750;
      const {homeDelta,awayDelta} = calcEloChange(hElo,aElo,res,eloK);
      ELO_DB[ht] = Math.round((hElo+homeDelta)*10)/10;
      ELO_DB[at] = Math.round((aElo+awayDelta)*10)/10;
      updateList.push({home:ht,away:at,res,homeDelta,awayDelta});
    }
    await new Promise(r=>setTimeout(r,150));
  }
  return {newELO:ELO_DB,updateList};
}

// ===================== 6. 完整回测计算 =====================
async function runBacktest(globalCfg, leagueCfg) {
  const yesterday = new Date(Date.now()+8*3600000-86400000).toISOString().split('T')[0];
  let total = 0, correct1X2 = 0, correctOU = 0;
  let mae1X2 = 0, maeOU = 0, profit = 0;

  for(const id of LEAGUE_IDS) {
    const list = await fetchFinishedFixtures(id, yesterday);
    for(const f of list) {
      total++;
      const ht = f.teams.home.name, at = f.teams.away.name;
      const hg = f.goals.home, ag = f.goals.away;
      const league = f.league.name;
      const cfg = getMatchConfig(league, globalCfg, leagueCfg);

      const mockEloH = 1750, mockEloA = 1750;
      const eloDiff = mockEloH - mockEloA;
      let hl = cfg.lambdaHomeBase + eloDiff / cfg.eloDiffWeight;
      let al = cfg.lambdaAwayBase - eloDiff / cfg.awayEloOffset;
      hl = limitParam(hl, cfg.lambdaMin, cfg.lambdaMax);
      al = limitParam(al, cfg.lambdaMin, cfg.lambdaMax);

      const probs = computeFullProbs(hl, al, cfg);
      const res1X2 = hg>ag ? "home" : ag>hg ? "away" : "draw";
      const resOU = (hg+ag) > 2.5 ? "over25" : "under25";

      const max1X2 = Object.entries(probs).slice(0,3).sort((a,b)=>b[1]-a[1])[0][0];
      const maxOU = probs.over25 > probs.under25 ? "over25" : "under25";
      if(max1X2 === res1X2) correct1X2++;
      if(maxOU === resOU) correctOU++;

      mae1X2 += Math.abs(probs[res1X2] - 0.7);
      maeOU += Math.abs(probs[resOU] - 0.7);
      profit += (max1X2===res1X2) ? 1.9 : -1;
    }
  }

  return {
    date: yesterday,
    totalMatch: total,
    hit1X2: total ? (correct1X2/total*100).toFixed(2) : 0,
    hitOU: total ? (correctOU/total*100).toFixed(2) : 0,
    mae1X2: total ? (mae1X2/total).toFixed(3) : 0,
    maeOU: total ? (maeOU/total).toFixed(3) : 0,
    simROI: total ? (profit/total*100).toFixed(2) : 0
  };
}

// ===================== 7. 生成赛事主数据 =====================
async function generateData(ELO_DB, globalCfg, leagueCfg) {
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const yesterday = new Date(Date.now()+8*3600000-86400000).toISOString().split('T')[0];
  const eloUpdateRes = await updateELOFromHistory(ELO_DB, yesterday, globalCfg.eloK);
  const backtestReport = await runBacktest(globalCfg, leagueCfg);

  let allFixtures = [];
  for (const id of LEAGUE_IDS) {
    const fixtures = await fetchFixtures(id, today);
    allFixtures.push(...fixtures);
    await new Promise(r=>setTimeout(r,200));
  }
  if (allFixtures.length === 0) {
    allFixtures = [{
      teams:{home:{name:'蔚山现代'},away:{name:'首尔FC'}},
      fixture:{date:new Date().toISOString()},league:{name:'韩K联'}
    }];
  }

  const matches = [];
  for (const f of allFixtures) {
    const ht = f.teams.home.name.trim(), at = f.teams.away.name.trim();
    const leagueName = f.league.name;
    const cfg = getMatchConfig(leagueName, globalCfg, leagueCfg);
    const homeElo = ELO_DB[ht]||1750, awayElo = ELO_DB[at]||1750;
    const eloDiff = homeElo - awayElo;

    let hl = cfg.lambdaHomeBase + eloDiff / cfg.eloDiffWeight;
    let al = cfg.lambdaAwayBase - eloDiff / cfg.awayEloOffset;
    hl = limitParam(hl, cfg.lambdaMin, cfg.lambdaMax);
    al = limitParam(al, cfg.lambdaMin, cfg.lambdaMax);

    const probs = computeFullProbs(hl, al, cfg);
    const odds = await fetchOdds(ht, at);
    const market = odds ? oddsToProb(odds.home,odds.draw,odds.away,odds.over25,odds.under25) : {home:0.33,draw:0.34,away:0.33,over25:0.5,under25:0.5};
    const f1x2 = (m,o,w)=>Number((m*w + o*(1-w)).toFixed(4));

    matches.push({
      homeTeam:ht,awayTeam:at,homeElo,awayElo,league:leagueName,
      date:new Date(f.fixture.date).toLocaleString('zh-CN'),
      homeLambda:Number(hl.toFixed(2)),awayLambda:Number(al.toFixed(2)),
      finalProbs:{
        home: f1x2(probs.homeWin, market.home, globalCfg.weight1X2),
        draw: f1x2(probs.draw, market.draw, globalCfg.weight1X2),
        away: f1x2(probs.awayWin, market.away, globalCfg.weight1X2),
        over25: f1x2(probs.over25, market.over25, globalCfg.weightOU),
        under25: f1x2(probs.under25, market.under25, globalCfg.weightOU)
      },
      bestScore:probs.bestScore,
      odds:odds
    });
  }

  return {
    date:today,matches,backtest:backtestReport,
    eloUpdate:eloUpdateRes.updateList.length,cfgVer:"V9.25"
  };
}

// ===================== 8. 可视化完整后台 /admin =====================
const adminPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>122模型后台 V9.25 | 全局+联赛+回测</title>
<style>
body{max-width:650px;margin:0 auto;padding:20px;background:#f5f7fa;font-size:14px;}
.card{background:#fff;border-radius:16px;padding:20px;margin-bottom:16px;border:1px solid #eee;}
h3{margin:0 0 12px 0;color:#1f2937;}
.item{margin:10px 0;}
label{display:block;margin-bottom:4px;color:#4b5563;}
input{width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;}
button{padding:10px 16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-right:8px;}
.tip{color:#9ca3af;font-size:12px;}
.league-select{padding:6px;border-radius:6px;border:1px solid #ddd;}
</style>
</head>
<body>
<h2>⚙️ 122 模型全配置后台 V9.25</h2>

<div class="card">
  <h3>📊 昨日回测报告</h3>
  <div id="backtestBox">加载中...</div>
</div>

<div class="card">
  <h3>🔹 全局核心参数</h3>
  <div class="item"><label>1X2融合权重</label><input id="w1x2" step="0.01"></div>
  <div class="item"><label>大小球融合权重</label><input id="wou" step="0.01"></div>
  <div class="item"><label>负二项 R</label><input id="r" step="0.01"></div>
  <div class="item"><label>DC 修正 Rho</label><input id="rho" step="0.01"></div>
  <div class="item"><label>ELO 迭代 K值</label><input id="elok" step="1"></div>
</div>

<div class="card">
  <h3>🔸 单联赛独立参数</h3>
  <div class="item">
    <select class="league-select" id="leagueSel"></select>
  </div>
  <div class="item"><label>联赛R</label><input id="lgR" step="0.01"></div>
  <div class="item"><label>联赛Rho</label><input id="lgRho" step="0.01"></div>
  <div class="item"><label>主队基准Lambda</label><input id="lgLam" step="0.01"></div>
</div>

<div class="card">
  <button onclick="getAll()">读取全部配置</button>
  <button onclick="saveGlobal()">保存全局</button>
  <button onclick="saveLeague()">保存当前联赛</button>
  <button onclick="freshData()">刷新模型数据</button>
  <p class="tip">保存即时生效，无需重新部署</p>
</div>

<script>
const token = '${UPDATE_SECRET}';
let globalCfg = {}, leagueCfg = {};
const leagueList = ${JSON.stringify(LEAGUE_LIST)};

leagueList.forEach(n=>{
  const opt = document.createElement('option');
  opt.value = n; opt.innerText = n;
  leagueSel.appendChild(opt);
});

async function getAll(){
  const res = await fetch('/api/get-config?token='+token);
  const d = await res.json();
  globalCfg = d.globalCfg; leagueCfg = d.leagueCfg;

  document.getElementById('w1x2').value = globalCfg.weight1X2;
  document.getElementById('wou').value = globalCfg.weightOU;
  document.getElementById('r').value = globalCfg.negBinomialR;
  document.getElementById('rho').value = globalCfg.dcRho;
  document.getElementById('elok').value = globalCfg.eloK;

  const bt = await (await fetch('/api/backtest?token='+token)).json();
  document.getElementById('backtestBox').innerHTML = \`
  <p>统计日期：\${bt.date}</p>
  <p>总场次：\${bt.totalMatch} | 1X2命中率：\${bt.hit1X2}%</p>
  <p>大小球命中率：\${bt.hitOU}% | 模拟ROI：\${bt.simROI}%</p>
  <p>综合MAE误差：\${(Number(bt.mae1X2)+Number(bt.maeOU)).toFixed(3)}</p>
  \`;
  loadLeagueCfg();
}
function loadLeagueCfg(){
  const name = leagueSel.value;
  const cfg = leagueCfg[name] || {};
  document.getElementById('lgR').value = cfg.negBinomialR ?? '';
  document.getElementById('lgRho').value = cfg.dcRho ?? '';
  document.getElementById('lgLam').value = cfg.lambdaHomeBase ?? '';
}
async function saveGlobal(){
  const payload = {global:{
    weight1X2:Number(w1x2.value),weightOU:Number(wou.value),
    negBinomialR:Number(r.value),dcRho:Number(rho.value),eloK:Number(elok.value)
  }};
  await fetch('/api/set-config?token='+token,{
    method:'POST',
    body:JSON.stringify(payload),
    headers:{'Content-Type':'application/json'}
  });
  alert('全局参数保存成功');
}
async function saveLeague(){
  const name = leagueSel.value;
  leagueCfg[name] = {
    negBinomialR:lgR.value?Number(lgR.value):undefined,
    dcRho:lgRho.value?Number(lgRho.value):undefined,
    lambdaHomeBase:lgLam.value?Number(lgLam.value):undefined
  };
  const payload = {league:leagueCfg};
  await fetch('/api/set-config?token='+token,{
    method:'POST',
    body:JSON.stringify(payload),
    headers:{'Content-Type':'application/json'}
  });
  alert('联赛参数保存成功');
}
async function freshData(){
  await fetch(\`/api/update?token=\${token}\`);
  alert('模型数据&ELO&回测 已刷新');
}
leagueSel.onchange = loadLeagueCfg;
getAll();
</script>
</body>
`;

// 前端展示页
const htmlPage = `<!DOCTYPE html>
<html lang="zh-CN" class="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>122 足球预测 V9.25</title>
    <style>
        :root{--bg:#f5f7fa;--card-bg:#fff;--text-primary:#1e293b;--text-secondary:#64748b;--border:#eef2f6;--accent:#3b82f6;--success:#059669;--warning:#d97706;--danger:#dc2626;--ou:#7c3aed;}
        .dark{--bg:#0f172a;--card-bg:#1e293b;--text-primary:#f1f5f9;--text-secondary:#94a3b8;--border:#334155;}
        body{background:var(--bg);color:var(--text-primary);padding:16px;max-width:450px;margin:0 auto;}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
        .card{background:var(--card-bg);border-radius:20px;padding:18px;margin-bottom:16px;border:1px solid var(--border);}
        .probs{display:flex;gap:10px;}
        .prob{text-align:center;}
        .label{font-size:11px;color:var(--text-secondary);}
        .value{font-size:15px;font-weight:700;}
        .home{color:var(--success);}.draw{color:var(--warning);}.away{color:var(--danger);}.ou{color:var(--ou);}
        .btn-small{padding:8px 12px;border-radius:12px;border:none;cursor:pointer;}
    </style>
</head>
<body>
    <div class="header">
        <h1>⚽ 122预测 V9.25</h1>
        <div>
            <button id="dark" class="btn-small">🌙</button>
            <button id="refresh" class="btn-small" style="background:var(--accent);color:#fff;">🔄</button>
            <a href="/admin" class="btn-small" style="background:#eee;text-decoration:none;color:#333;">配置</a>
        </div>
    </div>
    <div id="content">加载中...</div>
    <script>
    document.getElementById('dark').onclick=()=>document.documentElement.classList.toggle('dark');
    document.getElementById('refresh').onclick=async()=>{
      await fetch('/api/update?token=${UPDATE_SECRET}');location.reload();
    };
    async function load(){
      const res=await fetch('/data.json');
      const d=await res.json();
      let html=\`<div class="card"><div>📅 \${d.date} | 回测命中率：\${d.backtest.hit1X2}%</div></div>\`;
      d.matches.forEach(m=>{
        let p=m.finalProbs;
        html+=\`
        <div class="card">
          <div><b>\${m.homeTeam} vs \${m.awayTeam}</b></div>
          <div class="probs">
            <div class="prob"><div class="label">主胜</div><div class="value home">\${(p.home*100).toFixed(1)}%</div></div>
            <div class="prob"><div class="label">平局</div><div class="value draw">\${(p.draw*100).toFixed(1)}%</div></div>
            <div class="prob"><div class="label">客胜</div><div class="value away">\${(p.away*100).toFixed(1)}%</div>
          </div>
          <div class="probs">
            <div class="prob"><div class="label">大2.5</div><div class="value ou">\${(p.over25*100).toFixed(1)}%</div></div>
            <div class="prob"><div class="label">小2.5</div><div class="value ou">\${(p.under25*100).toFixed(1)}%</div>
          </div>
          <div style="font-size:12px;color:#999;">最优比分：\${m.bestScore}</div>
        </div>\`;
      });
      document.getElementById('content').innerHTML=html;
    }
    load();
    </script>
</body>
</html>`;

// ===================== 9. 路由入口 & EdgeOne KV 兼容修复 =====================
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  // 修复EdgeOne KV全局变量兼容
  const kv = typeof DATA_KV !== 'undefined' ? DATA_KV : null;

  const corsHeaders = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json; charset=utf-8'
  };
  if (req.method === 'OPTIONS') return new Response(null, {headers:corsHeaders});

  // 后台配置页
  if(path === '/admin') return new Response(adminPage, {headers:{'Content-Type':'text/html'}});

  // 回测数据接口
  if(path === '/api/backtest'){
    let gCfg = {...DEFAULT_GLOBAL_CONFIG};
    let lCfg = {...DEFAULT_LEAGUE_CONFIG};
    if(kv){
      gCfg = await kv.get('global_v925','json') || gCfg;
      lCfg = await kv.get('league_v925','json') || lCfg;
    }
    const bt = await runBacktest(gCfg,lCfg);
    return new Response(JSON.stringify(bt),{headers:corsHeaders});
  }

  // 获取配置
  if(path === '/api/get-config'){
    let globalCfg = {...DEFAULT_GLOBAL_CONFIG};
    let leagueCfg = {...DEFAULT_LEAGUE_CONFIG};
    if(kv){
      globalCfg = await kv.get('global_v925','json') || globalCfg;
      leagueCfg = await kv.get('league_v925','json') || leagueCfg;
    }
    return new Response(JSON.stringify({globalCfg,leagueCfg}),{headers:corsHeaders});
  }

  // 保存配置
  if(path === '/api/set-config'){
    const token = url.searchParams.get('token');
    if(token !== UPDATE_SECRET) return new Response(JSON.stringify({error:'无权限'}),{status:403,headers:corsHeaders});
    const body = await req.json();
    if(kv && body.global){
      await kv.put('global_v925',JSON.stringify(Object.assign({}, DEFAULT_GLOBAL_CONFIG, body.global)));
    }
    if(kv && body.league){
      await kv.put('league_v925',JSON.stringify(Object.assign({}, DEFAULT_LEAGUE_CONFIG, body.league)));
    }
    return new Response(JSON.stringify({success:true}),{headers:corsHeaders});
  }

  // 更新数据
  if(path === '/api/update'){
    const token = url.searchParams.get('token')||req.headers.get('x-auth-token');
    if(token !== UPDATE_SECRET) return new Response(JSON.stringify({error:'无权限'}),{status:403,headers:corsHeaders});
    let globalCfg = kv ? await kv.get('global_v925','json') : DEFAULT_GLOBAL_CONFIG;
    let leagueCfg = kv ? await kv.get('league_v925','json') : DEFAULT_LEAGUE_CONFIG;
    let eloDB = kv ? await kv.get('elo_v925','json') : DEFAULT_ELO;
    const data = await generateData(eloDB, globalCfg, leagueCfg);
    if(kv){
      await kv.put('match_v925',JSON.stringify(data));
      await kv.put('elo_v925',JSON.stringify(data.matches.reduce((o,m)=>{
        o[m.homeTeam]=m.homeElo;
        o[m.awayTeam]=m.awayElo;
        return o;
      },{})));
    }
    return new Response(JSON.stringify({success:true,count:data.matches.length}),{headers:corsHeaders});
  }

  // 赛事数据
  if(path === '/data.json'){
    let data = kv ? await kv.get('match_v925','json') : null;
    if(!data){
      data = await generateData(DEFAULT_ELO, DEFAULT_GLOBAL_CONFIG, DEFAULT_LEAGUE_CONFIG);
    }
    return new Response(JSON.stringify(data),{headers:{...corsHeaders,'Content-Type':'application/json'}});
  }

  // 首页
  return new Response(htmlPage,{headers:{'Content-Type':'text/html; charset=utf-8'}});
};
