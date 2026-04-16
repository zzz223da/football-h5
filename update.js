const fs = require('fs');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

const LEAGUE_IDS = [292, 2, 39, 140, 78, 135, 61, 88, 94, 71, 128, 253, 262, 848, 3];
const LEAGUE_NAMES = {292:'韩K联',2:'欧冠',39:'英超',140:'西甲',78:'德甲',135:'意甲',61:'法甲',88:'荷甲',94:'葡超',71:'巴甲',128:'阿甲',253:'美职联',262:'墨超',848:'亚冠',3:'欧联杯'};

let ELO_DB = { '蔚山现代':1860, '首尔FC':1790, '曼城':2100, '阿森纳':2060, '利物浦':2040, '皇马':2080, '巴萨':2030, '拜仁':2070 };
let COEFFS = { default: { eloK:30, homeAdv:0.35, lambdaBaseHome:1.50, lambdaBaseAway:1.20, negBinR:2.5, dcRho:0.03 } };
const COEFFS_FILE = 'coeffs.json'; if (fs.existsSync(COEFFS_FILE)) COEFFS = JSON.parse(fs.readFileSync(COEFFS_FILE));
const ELO_FILE = 'elo.json'; if (fs.existsSync(ELO_FILE)) ELO_DB = JSON.parse(fs.readFileSync(ELO_FILE));

function factorial(n) { if (n<=1) return 1; let f=1; for(let i=2;i<=n;i++) f*=i; return f; }
function negBinomial(k, mu, r) { let p = r/(r+mu); let coef = factorial(k+r-1)/(factorial(k)*factorial(r-1)); return coef * Math.pow(p, r) * Math.pow(1-p, k); }
function dcAdjust(i,j,rho) { if(i===0&&j===0) return 1+rho; if(i===1&&j===0) return 1-rho; if(i===0&&j===1) return 1-rho; if(i===1&&j===1) return 1+rho; return 1.0; }
function computeProbs(hl, al, r, rho, max=6) {
    let home=0, draw=0, away=0, scores=[];
    for(let i=0;i<=max;i++) for(let j=0;j<=max;j++) {
        let p = negBinomial(i,hl,r)*negBinomial(j,al,r)*dcAdjust(i,j,rho);
        scores.push({home:i,away:j,prob:p}); if(i>j) home+=p; else if(i===j) draw+=p; else away+=p;
    }
    let total = home+draw+away; home/=total; draw/=total; away/=total;
    scores.sort((a,b)=>b.prob-a.prob);
    return { homeWin:home, draw, awayWin:away, bestScore:`${scores[0].home}-${scores[0].away} (${(scores[0].prob*100).toFixed(1)}%)`, secondScore:`${scores[1].home}-${scores[1].away} (${(scores[1].prob*100).toFixed(1)}%)` };
}
function getElo(t) { return ELO_DB[t] || 1750; }
async function fetchH2H(homeId, awayId) { if(!FOOTBALL_API_KEY) return []; try { let res = await fetch(`https://v3.football.api-sports.io/fixtures/h2h?h2h=${homeId}-${awayId}&last=5`, { headers: { 'x-rapidapi-key': FOOTBALL_API_KEY, 'x-rapidapi-host':'v3.football.api-sports.io' }}); let data = await res.json(); return (data.response||[]).map(f=>({ date: f.fixture.date.split('T')[0], homeTeam: f.teams.home.name, awayTeam: f.teams.away.name, homeScore: f.goals.home, awayScore: f.goals.away })); } catch { return []; } }
async function fetchOdds(ht, at) { if(!ODDS_API_KEY) return null; try { let res = await fetch(`https://api.odds-api.io/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h`); let data = await res.json(); if(!data.data) return null; for(let g of data.data) { if(g.home_team&&g.away_team&&g.home_team.includes(ht)&&g.away_team.includes(at)) { let b = g.bookmakers[0]; if(!b) continue; let m = b.markets.find(m=>m.key==='h2h'); if(!m) continue; let ho = m.outcomes.find(o=>o.name===g.home_team); let ao = m.outcomes.find(o=>o.name===g.away_team); let d = m.outcomes.find(o=>o.name==='Draw'); if(ho&&ao&&d) return { home:ho.price, draw:d.price, away:ao.price }; } } } catch {} return null; }
function oddsToProb(h,d,a) { let hp=1/h, dp=1/d, ap=1/a, t=hp+dp+ap; return { home:hp/t, draw:dp/t, away:ap/t }; }

async function main() {
    const today = new Date().toISOString().split('T')[0];
    let fixtures = [];
    if (FOOTBALL_API_KEY) {
        for (let id of LEAGUE_IDS) {
            try {
                let res = await fetch(`https://v3.football.api-sports.io/fixtures?league=${id}&season=2026&date=${today}`, { headers: { 'x-rapidapi-key': FOOTBALL_API_KEY, 'x-rapidapi-host':'v3.football.api-sports.io' }});
                let data = await res.json();
                fixtures.push(...(data.response||[]));
            } catch {}
        }
    }
    if (fixtures.length === 0) fixtures = [{ teams: { home: { id:2744, name:'蔚山现代' }, away: { id:2746, name:'首尔FC' } }, fixture: { date: new Date().toISOString() }, league: { id:292, name:'韩K联', round:'测试' } }];
    
    let matches = [];
    for (let f of fixtures) {
        let ht = f.teams.home.name, at = f.teams.away.name;
        let he = getElo(ht), ae = getElo(at);
        let coeff = COEFFS[f.league.id] || COEFFS.default;
        let hl = coeff.lambdaBaseHome + (he-ae)/400;
        let al = coeff.lambdaBaseAway - (he-ae)/500;
        hl = Math.min(3, Math.max(0.5, hl)); al = Math.min(3, Math.max(0.5, al));
        let probs = computeProbs(hl, al, coeff.negBinR, coeff.dcRho);
        let odds = await fetchOdds(ht, at);
        let market = { home:0.33, draw:0.34, away:0.33 };
        if (odds) market = oddsToProb(odds.home, odds.draw, odds.away);
        let h2h = await fetchH2H(f.teams.home.id, f.teams.away.id);
        matches.push({
            homeTeam: ht, awayTeam: at, homeElo: he, awayElo: ae,
            date: new Date(f.fixture.date).toLocaleString('zh-CN', { timeZone: 'Asia/Seoul' }),
            league: f.league.name, round: f.league.round,
            homeLambda: hl, awayLambda: al,
            modelProbs: { home: probs.homeWin, draw: probs.draw, away: probs.awayWin },
            marketProbs: market,
            finalProbs: { home: probs.homeWin*0.6+market.home*0.4, draw: probs.draw*0.6+market.draw*0.4, away: probs.awayWin*0.6+market.away*0.4 },
            bestScore: probs.bestScore, secondScore: probs.secondScore,
            odds: odds || { home:2.1, draw:3.2, away:3.5 },
            isHighValue: Math.abs(probs.homeWin-market.home) > 0.08,
            h2h,
            factors: [ { name: 'Elo优势', value: (he-ae)/400 }, { name: '主场加持', value: coeff.homeAdv } ]
        });
    }
    fs.writeFileSync('data.json', JSON.stringify({ date: today, matches }, null, 2));
    fs.writeFileSync(COEFFS_FILE, JSON.stringify(COEFFS, null, 2));
    fs.writeFileSync(ELO_FILE, JSON.stringify(ELO_DB, null, 2));
    console.log(`生成 ${matches.length} 场比赛`);
}
main().catch(console.error);
