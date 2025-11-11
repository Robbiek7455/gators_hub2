/* =========================================================
   Gators Hub — ESPN build
   - Roster + stats + schedule: ESPN JSON (CORS-safe)
   - Team stats extractor + computed fallback
   - HD banner via <img srcset>
   ========================================================= */
(function () {
  "use strict";

  const BOOT_VER = "v30";
  const boot = `[BOOT] app.js ${BOOT_VER} @ ${new Date().toLocaleString()}`;
  (function logBoot(){
    const d = document.querySelector("#diag");
    if (d) { d.style.display = 'block'; d.innerHTML = `<div class="card"><pre class="tiny">${boot}</pre></div>` + d.innerHTML; }
  })();
  function _health(label, obj) {
    const d = document.querySelector("#diag"); if (!d) return;
    d.innerHTML = `<div class="card"><pre class="tiny">[HEALTH] ${label}: ${JSON.stringify(obj)}</pre></div>` + d.innerHTML;
  }

  /* ---------- Settings ---------- */
  const CURRENT_SEASON = 2026;
  const SEASONS = [2026, 2025, 2024, 2023];
  const REFRESH_MS = 10 * 60 * 1000;

  /* ---------- ESPN API ---------- */
  // Robust JSON fetch with CORS-friendly fallbacks for local dev
  async function fjson(url){
    // Try direct first
    try{ const r = await fetch(url,{mode:'cors'}); if(r.ok) return await r.json(); }catch(e){}
    // Fallback 1: isomorphic-git CORS proxy
    try{ const r = await fetch(`https://cors.isomorphic-git.org/${url}`); if(r.ok) return await r.json(); }catch(e){}
    // Fallback 2: AllOrigins raw
    try{ const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); if(r.ok) return await r.json(); }catch(e){}
    // Fallback 3: r.jina.ai (returns text) → JSON.parse
    try{ const jurl = `https://r.jina.ai/http/${url.replace(/^https?:\/\//,'')}`; const r = await fetch(jurl); if(r.ok){ const t = await r.text(); return JSON.parse(t); } }catch(e){}
    throw new Error('Network/CORS error fetching: '+url);
  }

  // Text fetch with same CORS fallbacks
  async function ftext(url){
    async function t(u){ const r=await fetch(u,{mode:'cors'}); if(r.ok) return await r.text(); throw new Error('bad'); }
    try{ return await t(url); }catch(e){}
    try{ return await t(`https://cors.isomorphic-git.org/${url}`); }catch(e){}
    try{ const r=await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); if(r.ok) return await r.text(); }catch(e){}
    try{ const jurl = `https://r.jina.ai/http/${url.replace(/^https?:\/\//,'')}`; const r=await fetch(jurl); if(r.ok) return await r.text(); }catch(e){}
    throw new Error('Network/CORS text fetch error: '+url);
  }




  const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
  const TEAM_ID = 57; // Florida

  const ok = (r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r; };

  const espnRankings = ()=> fjson(`${ESPN_BASE}/rankings`);
  const espnSECStandings = (season)=> fjson(`https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?season=${season}&seasontype=2&group=23`);

  const j  = (r) => r.json();
  const espnTeam     = (season) => fjson(`${ESPN_BASE}/teams/${TEAM_ID}?enable=roster,statistics,record&season=${season}`);
  const espnRoster   = (season) => fjson(`${ESPN_BASE}/teams/${TEAM_ID}/roster?season=${season}`);
  const espnSchedule = (season, seasontype) => fjson(`${ESPN_BASE}/teams/${TEAM_ID}/schedule?season=${season}&seasontype=${seasontype}`);
  const espnSummary  = (eventId) => fjson(`${ESPN_BASE}/summary?event=${eventId}`);
  const espnAthlete  = (athleteId) => fjson(`${ESPN_BASE}/athletes/${athleteId}`);

  /* ---------- ESPN Core (sports.core.api) — mirrors team stats page ---------- */
  const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball";
  const coreTeam = (season) => fjson(`${CORE_BASE}/seasons/${season}/teams/${TEAM_ID}?lang=en&region=us`);
  const coreTeamStatistics = (season) => fjson(`${CORE_BASE}/seasons/${season}/types/0/teams/${TEAM_ID}/statistics?lang=en&region=us`);
  const coreTeamAthletes = (season) => fjson(`${CORE_BASE}/seasons/${season}/teams/${TEAM_ID}/athletes?lang=en&region=us`);
  const coreAthlete = (season,id) => fjson(`${CORE_BASE}/seasons/${season}/athletes/${id}?lang=en&region=us`);
  const coreAthleteStats = (season,id) => fjson(`${CORE_BASE}/seasons/${season}/types/0/athletes/${id}/statistics?lang=en&region=us`);
  function getStatValueFromSplits(splits, name){
    try{
      const cats = splits?.categories || [];
      for(const c of cats){ const s=(c.stats||[]).find(x=>x.name===name); if(s) return Number(s.value)||0; }
    }catch{}
    return 0;
  }


  /* ---------- DOM helpers ---------- */
  const $  = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  const fmt1 = (n) => (n===0||n)? Number(n).toFixed(1) : "—";
  const pct3 = (p) => (p===0||p)? Number(p).toFixed(3) : "—";
  const pad2 = (n) => String(n).padStart(2,"0");
  const toCSV = (rows) => rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  function toast(msg){ const t=$("#toast"); if(!t) return; t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),1600); }

  // Normalize ESPN "athletes"
  function normalizeAthletes(athletes) {
    if (!athletes) return [];
    if (Array.isArray(athletes)) {
      const first = athletes[0];
      const looksGrouped = first && typeof first === "object" && Array.isArray(first.items);
      return looksGrouped ? athletes.flatMap(g => g.items || []) : athletes;
    }
    if (athletes && Array.isArray(athletes.items)) return athletes.items;
    return [];
  }

  // Robust team stats extractor
  function extractTeamStats(teamData) {
    const cats =
      teamData?.team?.statistics?.splits?.categories ||
      teamData?.team?.team?.statistics?.splits?.categories ||
      teamData?.statistics?.splits?.categories ||
      [];
    const out = {};
    const put = (k, v) => { if (Number.isFinite(v)) out[k] = v; };
    const allStats = cats.flatMap(c => (c?.stats || []));
    for (const s of allStats) {
      const name = (s.name || s.displayName || s.shortDisplayName || s.abbreviation || "").toUpperCase().replace(/\s+/g,'');
      const val  = Number(s.value);
      if (/^POINTSPERGAME|^PPG$/.test(name)) put("pointsPerGame", val);
      else if (/^REBOUNDSPERGAME|^RPG$/.test(name)) put("reboundsPerGame", val);
      else if (/^ASSISTSPERGAME|^APG$/.test(name)) put("assistsPerGame", val);
      else if (/^STEALSPERGAME|^SPG$/.test(name)) put("stealsPerGame", val);
      else if (/^BLOCKSPERGAME|^BPG$/.test(name)) put("blocksPerGame", val);
      else if (/^FIELDGOALPCT|^FG%|^FGPCT$/.test(name)) put("fieldGoalPct", val);
      else if (/^THREEPOINT(FIELDGOAL)?PCT|^3P%|^3PTPCT$/.test(name)) put("threePointFieldGoalPct", val);
      else if (/^FREETHROWPCT|^FT%|^FTPCT$/.test(name)) put("freeThrowPct", val);
    }
    return out;
  }

  // Compute team stats from player per-game when team block is missing
  function computeTeamFromPlayers(players) {


    const sum = (k) => players.reduce((a,b)=>a + (Number(b[k])||0), 0);
    const avg = (k) => {
      const vals = players.map(p => Number(p[k])).filter(Number.isFinite);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    };
    return {
      pointsPerGame: sum("ppg"),
      reboundsPerGame: sum("rpg"),
      assistsPerGame: sum("apg"),
      stealsPerGame: sum("spg"),
      blocksPerGame: sum("bpg"),
      fieldGoalPct: avg("fgPct"),
      threePointFieldGoalPct: avg("threePct"),
      freeThrowPct: avg("ftPct"),
    };
  }

	  // Fallback: parse Sports-Reference roster when ESPN past-season roster is sparse
	  async function loadSRRoster(season){
	    try{
	      const url = `https://www.sports-reference.com/cbb/schools/florida/${season}.html`;
	      const html = await ftext(url);
	      const rows=[];
	      const trRe = /<tr[^>]*?data-append-csv[\s\S]*?<\/tr>/gi; let m;
	      while((m=trRe.exec(html))){ const row=m[0];
	        const get=(name)=>{ const mm=row.match(new RegExp(`data-stat=\"${name}\"[^>]*>(?:<a[^>]*>)?([^<]*)<`,'i')); return (mm?.[1]||'').trim(); };
	        const name = get('player'); if(!name) continue;
	        rows.push({ id:name, name, number:get('number'), pos:get('pos'), hometown:get('hometown'), class:get('class'), headshot:`https://source.boringavatars.com/beam/96/${encodeURIComponent(name)}` });
	      }
	      return rows;
	    }catch(e){ return []; }
	  }


  /* ---------- Theme ---------- */
  function applyTheme(){
    const saved=localStorage.getItem("ghub_theme")||"light";
    document.documentElement.classList.toggle("dark", saved==="dark");
    const t=$("#themeToggle"); if(t) t.textContent = saved==="dark" ? "☀️" : "🌙";
  }
  $("#themeToggle")?.addEventListener("click", ()=>{
    const now=(localStorage.getItem("ghub_theme")||"light")==="light"?"dark":"light";
    localStorage.setItem("ghub_theme", now); applyTheme();
  });
  applyTheme();

  /* ---------- Router ---------- */
  function showTab(tab){ $$(".tab").forEach(a=>a.classList.toggle("active", a.dataset.tab===tab)); $$(".panel").forEach(p=>p.classList.toggle("active", p.id===tab)); }
  function route(){ const m=location.hash.match(/^#\/([a-z]+)/i); showTab(m?m[1]:"schedule"); }
  window.addEventListener("hashchange", route);

  /* ---------- HD Banner via <img srcset> ---------- */
  const HERO_HD = [
    {
      src: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-26-scaled-e1744107148886.jpg",
      srcset: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-26-1536x1025.jpg 1536w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-26-2048x1367.jpg 2048w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-26-scaled-e1744107148886.jpg 2560w"
    },
    {
      src: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-11-scaled.jpg",
      srcset: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-11-1536x1025.jpg 1536w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-11-2048x1367.jpg 2048w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-11-scaled.jpg 2560w"
    },
    {
      src: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-21-scaled.jpg",
      srcset: "https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-21-1536x1025.jpg 1536w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-21-2048x1367.jpg 2048w, https://www.wruf.com/wp-content/uploads/2025/04/040725-UF-Basketball-Championship-ML-21-scaled.jpg 2560w"
    }
  ];
  let heroIdx=0;
  function renderHeroSlides(){
    const mount=$("#heroImages"); if(!mount) return;
    mount.innerHTML = HERO_HD.map((p,i)=>`
      <div class="slide${i===0?" active":""}">
        <img src="${p.src}" srcset="${p.srcset}" sizes="100vw" alt="Gators 2025 Champions">
      </div>`).join("");
  }
  function setHero(i){ const mount=$("#heroImages"); if(!mount) return; $$(".slide", mount).forEach((s,idx)=>s.classList.toggle("active", idx===i)); }
  function startHero(){
    renderHeroSlides();
    setInterval(()=>{ heroIdx=(heroIdx+1)%HERO_HD.length; setHero(heroIdx); }, 5000);
    $("#heroPrev")?.addEventListener("click", ()=>{ heroIdx=(heroIdx-1+HERO_HD.length)%HERO_HD.length; setHero(heroIdx); });
    $("#heroNext")?.addEventListener("click", ()=>{ heroIdx=(heroIdx+1)%HERO_HD.length; setHero(heroIdx); });
  }

  /* ---------- State ---------- */
  const STATE = { season: CURRENT_SEASON, schedule: [], roster: [], stats: { team:{}, players:[] }, analytics: [], standings: [], rankingsAP: [] };

  /* ---------- Season selects ---------- */
  function fillSeasonSelects(){
    const opts = SEASONS.map(y=>`<option value="${y}" ${y===STATE.season?"selected":""}>${y-1}-${String(y).slice(-2)}</option>`).join("");
    $("#seasonSelect").innerHTML=opts; $("#statsSeason").innerHTML=opts; $("#rosterSeason").innerHTML=opts;
  }
  ["seasonSelect","statsSeason","rosterSeason"].forEach(id=>{
    document.addEventListener("change", (e)=>{ if(e.target && e.target.id===id){ STATE.season=Number(e.target.value); refreshAll(); }});
  });

  /* ==================== LOADERS ==================== */

  async function loadRosterAndStats() {
    try {
      const season = STATE.season;
      // Core-first path: use ESPN sports.core API (same data as https://www.espn.com/.../team/stats)
      try {
        const [alist, tstat] = await Promise.all([
          coreTeamAthletes(season),
          coreTeamStatistics(season)
        ]);
        const items = alist?.items || [];
        if (items.length) {
          const ids = items.map(it => {
            const ref = it.$ref || it.href || ""; const parts = String(ref).split("/"); return parts[parts.length-1] || "";
          }).filter(Boolean);
          async function batched(ids, fn, batch=6){ const out=[]; for(let i=0;i<ids.length;i+=batch){ const slice=ids.slice(i,i+batch); const res=await Promise.all(slice.map(id=>fn(id).catch(()=>null))); out.push(...res); } return out; }
          const details = await batched(ids, id => coreAthlete(season,id));
          const stats   = await batched(ids, id => coreAthleteStats(season,id));
          const byId = new Map(); details.forEach(d=>{ if(d) byId.set(String(d.id), d); });
          // Roster
          STATE.roster = ids.map(id => { const d = byId.get(String(id)) || {}; return {
            id: Number(id), name: d.displayName || d.shortName || d.fullName || "",
            pos: d.position?.abbreviation || d.position?.displayName || "", number: d.jersey || "",
            headshot: d.headshot?.href || `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${id}.png`,
            hometown: [d.birthPlace?.city, d.birthPlace?.state].filter(Boolean).join(", "), class: d.experience?.displayValue || ""
          }; });
          // Players
          const statsById = new Map(); stats.forEach(s=>{ if(!s) return; const aid=String(s?.athlete?.$ref||"").split("/").pop(); if(aid) statsById.set(aid, s); });
          STATE.stats.players = ids.map(id => { const d=byId.get(String(id))||{}; const s=statsById.get(String(id)); const sp=s?.splits||{};
            const gp=getStatValueFromSplits(sp,'gamesPlayed'), mpg=getStatValueFromSplits(sp,'avgMinutes'), ppg=getStatValueFromSplits(sp,'avgPoints');
            const rpg=getStatValueFromSplits(sp,'avgRebounds'), apg=getStatValueFromSplits(sp,'avgAssists'), spg=getStatValueFromSplits(sp,'avgSteals');
            const bpg=getStatValueFromSplits(sp,'avgBlocks'), tpg=getStatValueFromSplits(sp,'avgTurnovers');
            const fgPct=getStatValueFromSplits(sp,'fieldGoalPct'), threePct=getStatValueFromSplits(sp,'threePointFieldGoalPct'), ftPct=getStatValueFromSplits(sp,'freeThrowPct');
            return { id:Number(id), name:d.displayName||d.fullName||"", link:`https://www.espn.com/mens-college-basketball/player/_/id/${id}`,
              gp, mpg, ppg, rpg, apg, spg, bpg, tpg, fgPct, threePct, ftPct,
              headshot: d.headshot?.href || `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${id}.png`, pos: d.position?.abbreviation||d.position?.displayName||"", class: d.experience?.displayValue||"" };
          });
          // Team
          const ts = tstat?.splits || {};
          STATE.stats.team = {
            pointsPerGame: getStatValueFromSplits(ts,'avgPoints'), reboundsPerGame: getStatValueFromSplits(ts,'avgRebounds'), assistsPerGame: getStatValueFromSplits(ts,'avgAssists'),
            stealsPerGame: getStatValueFromSplits(ts,'avgSteals'), blocksPerGame: getStatValueFromSplits(ts,'avgBlocks'), fieldGoalPct: getStatValueFromSplits(ts,'fieldGoalPct'),
            threePointFieldGoalPct: getStatValueFromSplits(ts,'threePointFieldGoalPct'), freeThrowPct: getStatValueFromSplits(ts,'freeThrowPct') };

          _health('roster/stats (core)', { roster: STATE.roster.length, players: (STATE.stats.players||[]).length, teamKeys: Object.keys(STATE.stats.team||{}).length });
          renderRoster(); renderTeamStats(); renderPlayerStats(); fillCompare(); renderPropsTable();
          return; // success via Core; skip legacy path below
        }
      } catch(_) { /* fall back to site.api path below */ }

      const [teamData, rosterData] = await Promise.all([
        espnTeam(season).catch(() => ({})),
        espnRoster(season).catch(() => ({}))
      ]);

      _health("raw-shapes", {
        roster_type: Array.isArray(rosterData?.athletes) ? (Array.isArray(rosterData.athletes[0]?.items) ? "groups" : "flat") : typeof rosterData?.athletes,
        team_has_athletes: !!teamData?.team?.athletes
      });

      // ---- ROSTER ----
      const flatRoster = normalizeAthletes(rosterData?.athletes);
      STATE.roster = flatRoster.map(a => ({
        id: a.id,
        name: a.displayName || a.fullName || a.name || "",
        pos: a.position?.abbreviation || a.position?.displayName || a.position || "",
        number: a.jersey || a.uniform || "",
        headshot: (a.headshot && (a.headshot.href || a.headshot.url)) ||
                  `https://source.boringavatars.com/beam/96/${encodeURIComponent(a.displayName || a.fullName || a.id)}`,
        hometown: a.homeTown || a.hometown || ""
      }));


	      // Fallback for past seasons if ESPN roster is sparse
	      if (season < CURRENT_SEASON && STATE.roster.length < 8) {
	        try { const sr = await loadSRRoster(season); if (sr.length) STATE.roster = sr; } catch(e){}
	      }

      // ---- PLAYER STATS ----
      let players = [];
      const teamAthletes = normalizeAthletes(teamData?.team?.athletes);
      if (teamAthletes.length) {
        players = teamAthletes.map(a => {

	      // Fallback for past seasons if ESPN roster is sparse
	      if (season < CURRENT_SEASON && STATE.roster.length < 8) {
	        try { const sr = await loadSRRoster(season); if (sr.length) STATE.roster = sr; } catch(e){}
	      }

          const pcats = a?.statistics?.splits?.categories || [];
          const m = pcats.reduce((acc, c) => { (c.stats || []).forEach(s => (acc[s.name] = +s.value || 0)); return acc; }, {});
          return {
            id: a.id,
            name: a.displayName || a.fullName || a.name || "",
            link: `https://www.espn.com/mens-college-basketball/player/_/id/${a.id}`,
            gp: m.gamesPlayed ?? null,
            mpg: m.minutesPerGame ?? null,
            ppg: m.pointsPerGame ?? null,
            rpg: m.reboundsPerGame ?? null,
            apg: m.assistsPerGame ?? null,
            spg: m.stealsPerGame ?? null,
            bpg: m.blocksPerGame ?? null,
            tpg: m.turnoversPerGame ?? null,
            fgPct: m.fieldGoalPct ?? 0,
            threePct: m.threePointFieldGoalPct ?? 0,
            ftPct: m.freeThrowPct ?? 0,
            headshot: (a.headshot && (a.headshot.href || a.headshot.url)) || ""
          };
        });
      }
      if (!players.length && STATE.roster.length) {
        const ids = STATE.roster.map(r => r.id);
        players = await (async function fetchAthleteStatsBatch(ids, batchSize = 5) {
          const out = [];
          for (let i = 0; i < ids.length; i += batchSize) {
            const slice = ids.slice(i, i + batchSize);
            const chunk = await Promise.all(slice.map(async id => {
              try {
                const a = await espnAthlete(id);
                const displayName = a?.athlete?.displayName || a?.athlete?.fullName || "";
                const cats = a?.athlete?.statistics?.splits?.categories || [];
                const m = cats.reduce((acc, c) => { (c.stats || []).forEach(s => (acc[s.name] = +s.value || 0)); return acc; }, {});
                return {
                  id, name: displayName, link: `https://www.espn.com/mens-college-basketball/player/_/id/${id}`,
                  gp: m.gamesPlayed ?? null, mpg: m.minutesPerGame ?? null, ppg: m.pointsPerGame ?? null,
                  rpg: m.reboundsPerGame ?? null, apg: m.assistsPerGame ?? null, spg: m.stealsPerGame ?? null,
                  bpg: m.blocksPerGame ?? null, tpg: m.turnoversPerGame ?? null,
                  fgPct: m.fieldGoalPct ?? 0, threePct: m.threePointFieldGoalPct ?? 0, ftPct: m.freeThrowPct ?? 0,
                  headshot: a?.athlete?.headshot?.href || `https://source.boringavatars.com/beam/96/${encodeURIComponent(displayName || id)}`
                };
              } catch { return null; }
            }));
            out.push(...chunk.filter(Boolean));
          }
          return out;
        })(ids);
      }

	      // Merge position/class from roster into player stats for depth chart
	      players = players.map(p=>{ const r=STATE.roster.find(x=>String(x.id||'')===String(p.id||'') || x.name===p.name); return Object.assign({}, p, { pos: r?.pos || p.pos, class: r?.class || p.class }); });

      STATE.stats.players = players;

      // ---- TEAM STATS ----
      let teamStats = extractTeamStats(teamData);
      if (!teamStats || !Object.keys(teamStats).length) teamStats = computeTeamFromPlayers(players);
      STATE.stats.team = teamStats;

      _health("roster/stats", {
        roster: STATE.roster.length,
        players: (STATE.stats.players||[]).length,
        teamKeys: Object.keys(STATE.stats.team||{}).length
      });

      renderRoster(); renderTeamStats(); renderPlayerStats(); fillCompare(); renderPropsTable();
    } catch (e) {
      const d=$("#diag"); if(d){ d.style.display='block'; d.innerHTML += `<div class="card"><pre class="tiny">loadRosterAndStats: ${esc(e.message)}</pre></div>`; }
      $("#rosterGrid").innerHTML = "";
      $("#rosterEmpty").style.display = "block";
      $("#playerStats").innerHTML = '<div class="card"><p class="tiny muted">Stats unavailable.</p></div>';
    }
  }

  async function loadSchedule(){
    try{
      const [reg, post] = await Promise.all([
        espnSchedule(STATE.season,2),
        espnSchedule(STATE.season,3).catch(()=>({events:[]}))
      ]);
      const items = [...(reg?.events||[]), ...(post?.events||[])];
      const games = items.map(ev=>{
        const comp = ev.competitions?.[0]||{};
        const uf   = (comp.competitors||[]).find(c=>c.team?.id==String(TEAM_ID))||{};
        const opp  = (comp.competitors||[]).find(c=>c.team?.id!=String(TEAM_ID))||{};
        const dt   = new Date(ev.date);
        let at = "Away";
        if (uf.homeAway === "home") at = "Home";
        else if (comp.neutralSite) at = "Neutral";
        const st = comp.status?.type || {};
        return {
          id:ev.id,
          date: dt.toLocaleDateString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",weekday:"short"}),
          time: dt.toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"}),
          opponent: opp.team?.displayName||"TBA",
          at, venue: comp.venue?.fullName||"", city: comp.venue?.address?.city||"",
          tv: comp.broadcasts?.[0]?.names?.[0] || "",
          result: uf.winner===true?"W":(opp.winner===true?"L":""),
          score: (uf.score && opp.score)? (uf.score+"-"+opp.score) : "",
          box: ev.links?.find(l=>/boxscore/i.test(l.text||""))?.href || `https://www.espn.com/mens-college-basketball/game/_/gameId/${ev.id}`,
          statusState: st.state || "",
          statusText: st.shortDetail || st.detail || ""
        };
      });
      STATE.schedule = games;

      _health("schedule", { games: STATE.schedule.length, first: STATE.schedule[0]?.opponent || null });

      renderSchedule(); renderCountdown(); fillTicketGames();
    }catch(e){
      const d=$("#diag"); if(d){ d.style.display='block'; d.innerHTML += `<div class="card"><pre class="tiny">loadSchedule: ${esc(e.message)}</pre></div>`; }
      $("#scheduleWrap").innerHTML='<div class="card"><p class="tiny muted">Schedule unavailable.</p></div>';
    }
  }

  async function loadAnalytics() {
    try {
      const done = STATE.schedule.filter(g => g.result).slice(-10);
      if (!done.length) { STATE.analytics = []; _health("analytics", { rows: 0 }); return renderAnalytics(); }
      const rows = [];
      for (const g of done) {
        try {
          const s = await espnSummary(g.id);
          const box = s?.boxscore?.teams || [];
          const us = box.find(t => t.team?.id == String(TEAM_ID))?.statistics?.[0]?.stats || [];
          const them = box.find(t => t.team?.id != String(TEAM_ID))?.statistics?.[0]?.stats || [];
          const toMap = arr => Object.fromEntries(arr.map(x => [x.name, Number(x.value) || 0]));
          const our = toMap(us), opp = toMap(them);

          const poss = t => (t.fieldGoalsAttempted||0) + 0.475*(t.freeThrowsAttempted||0) - (t.offensiveRebounds||0) + (t.turnovers||0);
          const efg  = t => { const fgm=t.fieldGoalsMade||0, fg3=t.threePointFieldGoalsMade||0, fga=t.fieldGoalsAttempted||0; return fga ? (fgm+0.5*fg3)/fga : 0; };
          const tor  = t => { const to=t.turnovers||0, fga=t.fieldGoalsAttempted||0, fta=t.freeThrowsAttempted||0; const d=fga+0.475*fta; return d? to/d : 0; };

          const pOur = poss(our), pOpp = poss(opp);
          const possEst = Math.max(1, Math.round((pOur + pOpp) / 2));
          const ptsUs = our.points || 0, ptsOpp = opp.points || 0;

          rows.push({ date: g.date, opp: g.opponent, at: g.at, score: g.score,
            ortg: +(ptsUs * 100 / possEst).toFixed(1),
            drtg: +(ptsOpp * 100 / possEst).toFixed(1),
            pace: +((possEst * 40) / (our.minutes || 200)).toFixed(1),
            efg: +(efg(our) * 100).toFixed(1),
            toPct: +(tor(our) * 100).toFixed(1),
            box: g.box });
        } catch {}
      }
      STATE.analytics = rows; _health("analytics", { rows: STATE.analytics.length }); renderAnalytics(); drawAnalyticsCharts();
    } catch (e) {
      const d=$("#diag"); if(d){ d.style.display='block'; d.innerHTML += `<div class="card"><pre class="tiny">loadAnalytics: ${esc(e.message)}</pre></div>`; }
      STATE.analytics = []; _health("analytics", { rows: 0, error: true }); renderAnalytics();
    }
  }

  /* ==================== RENDERERS ==================== */

  function renderSchedule(){
    const filter=$("#schedFilter")?.value||"ALL";
    const rows=STATE.schedule.filter(g=>filter==="ALL"?true:g.at===filter);
    const mount=$("#scheduleWrap"); if(!mount) return;
    mount.innerHTML = `
      <table id="scheduleTable">
        <thead><tr><th>Date</th><th>Time (ET)</th><th>Opponent</th><th>H/A</th><th>Result</th><th>Score</th><th>Links</th></tr></thead>
        <tbody>
          ${rows.map(g=>`
            <tr class="game-row" data-id="${g.id}">
              <td>${esc(g.date)}</td><td>${esc(g.time)}</td><td><strong>${esc(g.opponent)}</strong></td>
              <td>${g.at}</td><td>${esc(g.result||"")}</td><td>${esc(g.score||"")}</td>
              <td><a class="boxlink" target="_blank" rel="noopener" href="${g.box}">Box ↗</a></td>
            </tr>
            <tr class="details" data-det="${g.id}" style="display:none">
              <td colspan="7">
                <div style="display:flex;gap:16px;flex-wrap:wrap">
                  <div><span class="tiny muted">Venue</span><div>${esc(g.venue||"")}</div></div>
                  <div><span class="tiny muted">City</span><div>${esc(g.city||"")}</div></div>
                  <div><span class="tiny muted">TV</span><div>${esc(g.tv||"")}</div></div>
                  <div><button class="btn ghost addCal" data-game='${esc(JSON.stringify(g))}'>Add to Calendar</button></div>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;
    $$("#scheduleTable .game-row").forEach(tr=>tr.addEventListener("click", ()=>{ const id=tr.dataset.id; const det=$(`#scheduleTable [data-det="${id}"]`); if(det) det.style.display = det.style.display==="none" ? "" : "none"; }));
    $$("#scheduleTable .addCal").forEach(b=>b.addEventListener("click", (e)=>{ e.stopPropagation(); downloadICS(JSON.parse(b.dataset.game)); }));
  }
  function downloadICS(g){
    const start = new Date(`${g.date} ${g.time} ET`);
    const end = new Date(start.getTime()+2*60*60*1000);
    const toICS = (d)=> d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate())+'T'+pad2(d.getUTCHours())+pad2(d.getUTCMinutes())+pad2(d.getUTCSeconds())+'Z';
    const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Gators Hub//EN","BEGIN:VEVENT",
      `UID:${g.id}@gatorshub`,`DTSTAMP:${toICS(new Date())}`,`DTSTART:${toICS(start)}`,`DTEND:${toICS(end)}`,
      `SUMMARY:Florida vs ${g.opponent}`,`LOCATION:${g.venue?g.venue+", ":""}${g.city||""}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar"})); a.download=`UF_vs_${g.opponent.replace(/\s+/g,'_')}.ics`; a.click();
  }

  function renderRoster(){
    const q=$("#rosterFilter")?.value.toLowerCase()||""; const favOnly=$("#favOnly")?.checked; const favs=getFavs();
    let rows=STATE.roster.slice(); if(q) rows=rows.filter(p=>p.name.toLowerCase().includes(q)); if(favOnly) rows=rows.filter(p=>favs.includes(p.name));
    const mount=$("#rosterGrid"); if(!mount) return;
    if(!rows.length){ mount.innerHTML=""; $("#rosterEmpty").style.display="block"; return; }
    $("#rosterEmpty").style.display="none";
    mount.innerHTML = rows.map(p=>`
      <div class="card player" data-player="${esc(p.name)}">
        <div style="display:flex;gap:12px;align-items:center;">
          <img loading="lazy" src="${p.headshot}" alt="${esc(p.name)} headshot" width="64" height="64" style="border-radius:12px;object-fit:cover"/>
          <div><div><strong>${esc(p.name)}</strong> <span class="tiny muted">#${esc(p.number||"")} ${esc(p.pos||"")}</span></div><div class="meta">${esc(p.hometown||"")}</div></div>
          <button class="btn ghost" style="margin-left:auto" data-fav="${esc(p.name)}">${favs.includes(p.name)?"⭐":"☆"}</button>
        </div>
      </div>`).join("");
    $$("#rosterGrid [data-fav]").forEach(b=>b.addEventListener("click", (e)=>{ e.stopPropagation(); toggleFavorite(b.dataset.fav); renderRoster(); }));
    $$("#rosterGrid .player").forEach(card=>card.addEventListener("click", ()=>{ const p=STATE.stats.players.find(x=>x.name===card.dataset.player); openPlayerModal(p); }));
  }

  function renderTeamStats(){
    const t=STATE.stats.team||{};
    $("#teamStats").innerHTML = `<table><thead><tr><th>PTS/G</th><th>REB/G</th><th>AST/G</th><th>STL/G</th><th>BLK/G</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead>
      <tbody><tr><td class="stat">${fmt1(t.pointsPerGame)}</td><td>${fmt1(t.reboundsPerGame)}</td><td>${fmt1(t.assistsPerGame)}</td><td>${fmt1(t.stealsPerGame)}</td><td>${fmt1(t.blocksPerGame)}</td><td>${pct3(t.fieldGoalPct)}</td><td>${pct3(t.threePointFieldGoalPct)}</td><td>${pct3(t.freeThrowPct)}</td></tr></tbody></table>`;
  }
  function renderPlayerStats(){
    const q=$("#playerFilter")?.value.toLowerCase()||""; let rows=STATE.stats.players.slice(); if(q) rows=rows.filter(p=>p.name.toLowerCase().includes(q));
    rows.sort((a,b)=>(b.ppg||0)-(a.ppg||0));
    $("#playerStats").innerHTML = `<table id="playersTable"><thead><tr><th>Player</th><th>GP</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th><th>SPG</th><th>BPG</th><th>TOV</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead><tbody>
      ${rows.map(p=>`<tr class="plink" data-player="${esc(p.name)}"><td><div style="display:flex;align-items:center;gap:8px">${p.headshot?`<img src="${p.headshot}" width="20" height="20" style="border-radius:50%">`:""}<strong>${esc(p.name)}</strong></div></td><td>${p.gp??"—"}</td><td>${fmt1(p.mpg)}</td><td class="stat">${fmt1(p.ppg)}</td><td>${fmt1(p.rpg)}</td><td>${fmt1(p.apg)}</td><td>${fmt1(p.spg)}</td><td>${fmt1(p.bpg)}</td><td>${fmt1(p.tpg)}</td><td>${pct3(p.fgPct)}</td><td>${pct3(p.threePct)}</td><td>${pct3(p.ftPct)}</td></tr>`).join("")}
    </tbody></table>`;
    $$("#playersTable .plink").forEach(tr=>tr.addEventListener("click", ()=>{ const p=STATE.stats.players.find(x=>x.name===tr.dataset.player); openPlayerModal(p); }));
  }

	  function fillCompare(){
	    const players = STATE.stats.players || [];
	    const opts = players.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
	    const a = $("#cmpA"), b = $("#cmpB");
	    if (a) a.innerHTML = `<option value="">(Select)</option>` + opts;
	    if (b) b.innerHTML = `<option value="">(Select)</option>` + opts;
	    const btn = $("#drawCompare");
	    if (btn) btn.onclick = () => {
	      const nameA = $("#cmpA")?.value || "";
	      const nameB = $("#cmpB")?.value || "";
	      const pa = players.find(x => x.name === nameA);
	      const pb = players.find(x => x.name === nameB);
	      const wrap = $("#compareWrap");
	      if (!wrap) return;
	      if (!pa || !pb) { wrap.innerHTML = '<div class="card"><p class="tiny muted">Pick two players above, then click Draw.</p></div>'; return; }
	      const row = (label, ka, kb, fmt = (x)=>x ?? "—") => `<tr><td>${label}</td><td class="stat">${fmt(pa[ka])}</td><td>${fmt(pb[kb])}</td></tr>`;
	      wrap.innerHTML = `<table><thead><tr><th>Stat</th><th>${esc(pa.name)}</th><th>${esc(pb.name)}</th></tr></thead><tbody>
	        ${row('PPG','ppg','ppg',fmt1)}
	        ${row('RPG','rpg','rpg',fmt1)}
	        ${row('APG','apg','apg',fmt1)}
	        ${row('MPG','mpg','mpg',fmt1)}
	        ${row('FG%','fgPct','fgPct',(x)=>pct3(x))}
	        ${row('3P%','threePct','threePct',(x)=>pct3(x))}
	        ${row('FT%','ftPct','ftPct',(x)=>pct3(x))}
	      </tbody></table>`;
	    };
	  }


  function openPlayerModal(p){
    const modal=$("#scoutModal"), box=$("#scoutContent");
    if(!p){ box.innerHTML='<p class="muted">No data.</p>'; modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false"); return; }
    box.innerHTML = `<h3 style="margin-top:0">${esc(p.name)}</h3><p class="meta"><a href="${p.link}" target="_blank" rel="noopener">ESPN player profile ↗</a></p>
      <table><tbody>
        <tr><td>GP</td><td>${p.gp??"—"}</td></tr><tr><td>MPG</td><td>${fmt1(p.mpg)}</td></tr><tr><td>PPG</td><td>${fmt1(p.ppg)}</td></tr>
        <tr><td>RPG</td><td>${fmt1(p.rpg)}</td></tr><tr><td>APG</td><td>${fmt1(p.apg)}</td></tr><tr><td>SPG</td><td>${fmt1(p.spg)}</td></tr>
        <tr><td>BPG</td><td>${fmt1(p.bpg)}</td></tr><tr><td>TOV</td><td>${fmt1(p.tpg)}</td></tr><tr><td>FG%</td><td>${pct3(p.fgPct)}</td></tr>
        <tr><td>3P%</td><td>${pct3(p.threePct)}</td></tr><tr><td>FT%</td><td>${pct3(p.ftPct)}</td></tr>
      </tbody></table>`;
    modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
  }

	  // Modal close handlers
	  document.addEventListener("click", (e)=>{
	    const t = e.target;
	    if (t && (t.id === "scoutModal" || t.classList?.contains("modal-bg"))) {
	      const m = $("#scoutModal");
	      if (m) { m.classList.add("hidden"); m.setAttribute("aria-hidden","true"); }
	    }
	  });
	  window.addEventListener("keydown", (e)=>{
	    if (e.key === "Escape"){
	      const m = $("#scoutModal");
	      if (m) { m.classList.add("hidden"); m.setAttribute("aria-hidden","true"); }
	    }
	  });


  /* ---------- News, Photos, Props (same as before) ---------- */
  function loadPhotos(){
    const PHOTOS = HERO_HD.map(p=>({src:p.src, alt:"Gators 2025"}));
    $("#photoGrid").innerHTML = PHOTOS.map(p=>`<div class="card"><img loading="lazy" src="${p.src}" alt="${esc(p.alt)}"><div class="meta">${esc(p.alt)}</div></div>`).join('');
  }
  function loadNews(){
    fetch("https://floridagators.com/rss.aspx?path=mbball").then(r=>r.text()).then(xml=>{
      const items=[], itemRe=/<item[\s\S]*?<\/item>/gi, titleRe=/<title>([\s\S]*?)<\/title>/i, linkRe=/<link>([\s\S]*?)<\/link>/i, dateRe=/<pubDate>([\s\S]*?)<\/pubDate>/i, descRe=/<description>([\s\S]*?)<\/description>/i;
      (xml.match(itemRe)||[]).slice(0,12).forEach(b=>{
        const title=(b.match(titleRe)?.[1]||"").replace(/<!\[CDATA\[|\]\]>/g,'').trim();
        const link=(b.match(linkRe)?.[1]||"").trim();
        const summary=(b.match(descRe)?.[1]||"").replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]*>/g,'').trim();
        const date=new Date(b.match(dateRe)?.[1]||Date.now()).toISOString();
        if(title && link) items.push({title, link, summary, date});
      });
      $("#newsList").innerHTML = items.map(n=>`<article class="news-card"><h4><a href="${n.link}" target="_blank" rel="noopener">${esc(n.title)}</a></h4><p>${esc(n.summary||"")}</p><p class="meta">${new Date(n.date).toLocaleString()}</p></article>`).join('');
    }).catch(()=>{ $("#newsList").innerHTML = '<article class="news-card"><h4>Welcome</h4><p class="muted">Live schedule/roster/stats + analytics.</p></article>'; });
  }

  /* ---------- Utilities ---------- */
  function getFavs(){ try{ return JSON.parse(localStorage.getItem("ghub_favs"))||[]; }catch{ return []; } }
  function setFavs(v){ localStorage.setItem("ghub_favs", JSON.stringify(v)); }
  function toggleFavorite(name){ const favs=getFavs(); const i=favs.indexOf(name); if(i>=0) favs.splice(i,1); else favs.push(name); setFavs(favs); }
  function renderLeaderboard(){ const board=getLS(LS.board,[]).sort((a,b)=>b.bankroll-a.bankroll);
    $("#leaderboard").innerHTML = `<table><thead><tr><th>#</th><th>User</th><th>Bankroll</th><th>Updated</th></tr></thead><tbody>
      ${board.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.user)}</td><td>$${Number(b.bankroll).toLocaleString()}</td><td>${new Date(b.updated||Date.now()).toLocaleString()}</td></tr>`).join("")}
    </tbody></table>`;
  }
  function fillTicketGames(){ const sel=$("#ticketGame"); if(!sel) return;
    sel.innerHTML = `<option value="">(None)</option>` + STATE.schedule.map(g=>`<option value="${esc(`${g.date}|${g.time}|${g.opponent}`)}">${esc(`${g.date} – ${g.opponent} (${g.at})`)}</option>`).join("");
  }
  const LS={bankroll:"ghub_bankroll",username:"ghub_username",openBets:"ghub_openBets",history:"ghub_betHistory",board:"ghub_leaderboard"};
  const getLS=(k,d)=>{ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } };
  const setLS=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
  const roundHalf=(n)=>Math.round(n*2)/2;
  function defaultLines(){ return (STATE.stats.players||[]).map(p=>({ player:p.name, pts:roundHalf(p.ppg||0), reb:roundHalf(p.rpg||0), ast:roundHalf(p.apg||0), pra:roundHalf((p.ppg||0)+(p.rpg||0)+(p.apg||0)) })); }
  function bankrollUI(){ $("#bankroll").textContent="$"+Number(getLS(LS.bankroll,0)).toLocaleString(); if($("#usernameInput")) $("#usernameInput").value=getLS(LS.username,"")||""; }
  function upsertLeaderboard(user,bankroll){ const board=getLS(LS.board,[]); const i=board.findIndex(b=>b.user===user); if(i>=0)board[i].bankroll=bankroll; else board.push({user,bankroll,updated:Date.now()}); setLS(LS.board,board); renderLeaderboard(); }
  function renderPropsTable(){
    const lines = defaultLines();
    $("#propsTable").innerHTML = `<table><thead><tr><th>Player</th><th>PTS</th><th>REB</th><th>AST</th><th>P+R+A</th><th>Pick</th><th>Add</th></tr></thead><tbody>
      ${lines.map(l=>`<tr><td><strong>${esc(l.player)}</strong></td><td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td><td>${l.pra}</td>
        <td><select data-player="${esc(l.player)}" class="pick"><option value="PTS_O">PTS Over</option><option value="PTS_U">PTS Under</option><option value="REB_O">REB Over</option><option value="REB_U">REB Under</option><option value="AST_O">AST Over</option><option value="AST_U">AST Under</option><option value="PRA_O">PRA Over</option><option value="PRA_U">PRA Under</option></select></td>
        <td><button class="btn addBet" data-player="${esc(l.player)}">Add</button></td></tr>`).join("")}
    </tbody></table>`;
    $$(".addBet").forEach(b=>b.addEventListener("click", ()=>{ const player=b.dataset.player; const sel=b.closest("tr").querySelector(".pick").value; const slip=getLS(LS.openBets,[]); slip.push({player, market:sel, odds:-110}); setLS(LS.openBets, slip); renderBetSlip(); toast("Added to slip"); }));
  }
  function renderBetSlip(){ const slip=getLS(LS.openBets,[]); $("#betList").innerHTML = slip.length? slip.map((b,i)=>`<div class="card"><div><strong>${esc(b.player)}</strong> — ${b.market.replace('_',' ')} <span class="badge">@${b.odds}</span></div><div class="meta">Slip item #${i+1}</div></div>`).join("") : `<p class="muted tiny">No selections yet.</p>`; }
  function placeBets(){
    const wager=Math.max(1, Number($("#wagerInput")?.value||0)); const bank=getLS(LS.bankroll,0); const slip=getLS(LS.openBets,[]); const gameId=$("#ticketGame")?.value||"";
    if(!slip.length) return toast("Add picks first."); if(bank<wager) return toast("Not enough bankroll.");
    const hist=getLS(LS.history,[]); hist.push({ placedAt:Date.now(), wager, gameId, bets:slip, status:"pending" });
    setLS(LS.history, hist); setLS(LS.openBets, []); setLS(LS.bankroll, bank-wager); renderBetSlip(); bankrollUI(); renderHistory(); toast("Bets placed!");
  }
  $("#startBankroll")?.addEventListener("click", ()=>{ const user=$("#usernameInput")?.value.trim()||"Guest"; setLS(LS.username,user); setLS(LS.bankroll,1000); upsertLeaderboard(user,1000); bankrollUI(); toast("Bankroll set to $1,000"); });
  $("#resetBankroll")?.addEventListener("click", ()=>{ setLS(LS.bankroll,0); bankrollUI(); toast("Bankroll reset"); });
  $("#placeBets")?.addEventListener("click", placeBets);
  $("#clearBets")?.addEventListener("click", ()=>{ setLS(LS.openBets,[]); renderBetSlip(); toast("Slip cleared"); });
  $("#exportHistory")?.addEventListener("click", ()=>{ const h=getLS(LS.history,[]); const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([JSON.stringify(h,null,2)],{type:"application/json"})); a.download='bet_history.json'; a.click(); });
  $("#importHistory")?.addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(!f) return; const text=await f.text(); setLS(LS.history, JSON.parse(text)); renderHistory(); toast("History imported"); });
  $("#clearHistory")?.addEventListener("click", ()=>{ setLS(LS.history, []); renderHistory(); toast("History cleared"); });
  function renderHistory(){
    const hist=getLS(LS.history,[]); const key=g=>`${g.date}|${g.time}|${g.opponent}`; const map=new Map(STATE.schedule.map(g=>[key(g), g]));
    $("#historyWrap").innerHTML = `<table><thead><tr><th>Placed</th><th>Game</th><th>Wager</th><th>Status</th><th>Payout</th><th>Picks</th></tr></thead><tbody>
      ${hist.slice().reverse().map(t=>{ const g=t.gameId?map.get(t.gameId):null; const gameTxt = g ? `${g.date} vs ${g.opponent}${g.result?` (${g.result})`:""}${g.box?` • <a class="boxlink" href="${g.box}" target="_blank" rel="noopener">box ↗</a>`:""}` : "—";
        return `<tr><td>${new Date(t.placedAt).toLocaleString()}</td><td>${gameTxt}</td><td>$${Number(t.wager).toLocaleString()}</td><td>${esc(t.status||'pending')}</td><td>${t.payout?('$'+Number(t.payout).toLocaleString()):'—'}</td><td>${t.bets.map(b=>`${esc(b.player)} (${b.market.replace('_',' ')})`).join('<br/>')}</td></tr>`; }).join("")}
    </tbody></table>`;
  }

  /* ---------- Countdown, Analytics ---------- */
  function renderCountdown(){
    const el=$("#nextGame"); if(!el || !STATE.schedule.length) return;
    const upcoming = STATE.schedule.map(g=>Object.assign({}, g, { t: Date.parse(`${g.date} ${g.time} ET`) }))
      .filter(g=>!isNaN(g.t) && g.t>Date.now()).sort((a,b)=>a.t-b.t)[0];
    if(!upcoming){ el.textContent="Next game: TBA"; return; }
    (function tick(){ const diff=upcoming.t - Date.now(); if(diff<=0){ el.textContent=`Gameday: vs ${upcoming.opponent}!`; return; }
      const h=Math.floor(diff/3.6e6), m=Math.floor((diff%3.6e6)/6e4), s=Math.floor((diff%6e4)/1e3);
      el.textContent = `Next game vs ${upcoming.opponent}: ${h}h ${m}m ${s}s`;
      requestAnimationFrame(()=>setTimeout(tick,500));
    })();

  }

  /* ---------- Standings & GameCenter ---------- */
  async function loadStandings(){
    try{
      const [ap, sec] = await Promise.all([
        espnRankings().catch(()=>null),
        espnSECStandings(STATE.season).catch(()=>null)
      ]);
      // AP Poll
      const polls = ap?.rankings || ap?.polls || [];
      const poll = polls.find(p=>/associated|ap/i.test((p.name||'')+(p.shortName||''))) || polls[0] || null;
      const apRows = (poll?.ranks || poll?.rankings || []).map(r=>({ rank: r.current || r.rank || 0, team: r.team?.displayName || r.team?.name || '', rec: r.recordSummary || r.team?.recordSummary || '', id: r.team?.id }));
      STATE.rankingsAP = apRows.filter(x=>x.team);
      // SEC Standings
      const entries = ((sec?.standings?.entries)||[]).concat(...(sec?.children||[]).map(c=>c?.standings?.entries||[]));
      function val(map, keys){ for(const k of keys){ const v=map[k]; if(Number.isFinite(v)) return v; } return 0; }
      const secRows = (entries||[]).map(e=>{
        const tmName = e.team?.displayName || [e.team?.location, e.team?.name].filter(Boolean).join(' ') || e.team?.name || '';
        const smap = Object.fromEntries((e.stats||[]).map(s=>[s.name, Number(s.value)||0]));
        const ow=val(smap,['wins','overallWins','totalWins']), ol=val(smap,['losses','overallLosses','totalLosses']);
        const cw=val(smap,['confWins','conferenceWins']), cl=val(smap,['confLosses','conferenceLosses']);
        return { team: tmName, overall: `${ow}-${ol}`, conf: `${cw}-${cl}`, id: e.team?.id };
      }).sort((a,b)=>{
        const [aw,al]=a.conf.split('-').map(Number); const [bw,bl]=b.conf.split('-').map(Number);
        if (bw!==aw) return bw-aw; if (bl!==al) return al-bl;
        const [aow,aol]=a.overall.split('-').map(Number); const [bow,bol]=b.overall.split('-').map(Number);
        if (bow!==aow) return bow-aow; return aol-bol;
      });
      if (secRows.length) STATE.standings = secRows;
      if(!STATE.standings?.length){
        try{ const r = await fetch('./standings.json'); STATE.standings = await r.json(); }catch{}
      }

      renderAP();

      renderStandings();
    }catch(e){
      const el = $("#standingsWrap"); if(el){ el.innerHTML = '<div class="card"><p class="tiny muted">Standings unavailable.</p></div>'; }
    }
  }

  function renderAP(){
    const apEl = $("#apWrap"); if(!apEl) return;
    const ap = STATE.rankingsAP || [];
    apEl.innerHTML = ap.length ? `
      <table><thead><tr><th>#</th><th>Team</th><th>Record</th></tr></thead><tbody>
        ${ap.map(r=>`<tr${String(r.id)===String(TEAM_ID)?' style=\"font-weight:700;background:rgba(250,70,22,.05)\"':''}><td class=\"stat\">${r.rank}</td><td>${esc(r.team)}</td><td>${esc(r.rec||'')}</td></tr>`).join("")}
      </tbody></table>` : '<div class=\"card\"><p class=\"tiny muted\">AP Top 25 unavailable.</p></div>';
  }

  function renderStandings(){

    const el = $("#standingsWrap"); if(!el) return;
    const rows = STATE.standings || [];
    el.innerHTML = rows.length ? `
      <table><thead><tr><th>Team</th><th>Overall</th><th>SEC</th></tr></thead><tbody>
        ${rows.map(r=>`<tr><td>${esc(r.team)}</td><td class="stat">${esc(r.overall)}</td><td>${esc(r.conf)}</td><td>${r.link?`<a class="boxlink" href="${r.link}" target="_blank" rel="noopener">SR  A0 00↗</a>`:''}</td></tr>`).join("")}
      </tbody></table>`


      : '<div class="card"><p class="tiny muted">No standings yet.</p></div>';
  }

  // Patch: normalize SEC standings table to 3 columns
  renderStandings = function(){
    const el = $("#standingsWrap"); if(!el) return;
    const rows = STATE.standings || [];
    el.innerHTML = rows.length ? `
      <table><thead><tr><th>Team</th><th>Overall</th><th>SEC</th></tr></thead><tbody>
        ${rows.map(r=>`<tr><td>${esc(r.team)}</td><td class="stat">${esc(r.overall)}</td><td>${esc(r.conf)}</td></tr>`).join("")}
      </tbody></table>`
      : '<div class="card"><p class="tiny muted">No standings yet.</p></div>';
  };


  function upcomingFromSchedule(){
    if(!STATE.schedule?.length) return null;
    const upcoming = STATE.schedule.map(g=>Object.assign({}, g, { t: Date.parse(`${g.date} ${g.time} ET`) }))
      .filter(g=>!isNaN(g.t) && g.t>Date.now()).sort((a,b)=>a.t-b.t)[0];
    return upcoming || null;
  }

  async function loadGameCenter(){
    try{
      const next = upcomingFromSchedule();
      const [opps, scout, team] = await Promise.all([
        fetch('./opponents.json').then(r=>r.json()).catch(()=>[]),
        fetch('./opponents_scout.json').then(r=>r.json()).catch(()=>({})),
        fetch('./team.json').then(r=>r.json()).catch(()=>null)
      ]);
      const oppInfo = (opps||[]).find(o=>o.name === (next?.opponent||'')) || {};
      const s = (scout||{})[next?.opponent||''];
      // Next game card
      const nx = $("#gcNext"); if(nx){
        if(!next){ nx.innerHTML = '<p class="tiny muted">No upcoming games.</p>'; }
        else {
          nx.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px">
              ${oppInfo.logo?`<img src="${oppInfo.logo}" alt="${esc(next.opponent)}" width="44" height="44" style="border-radius:8px;border:1px solid #d7ddee">`:''}
              <div>
                <div><strong>Florida vs ${esc(next.opponent)}</strong> <span class="badge">${esc(next.at)}</span></div>
                <div class="meta">${esc(next.date)} • ${esc(next.time)} • ${esc(next.location||'')}</div>
                ${next.box?`<div class="meta"><a class="boxlink" href="${next.box}" target="_blank" rel="noopener">Game page ↗</a></div>`:''}
              </div>
            </div>`;
        }
      }
      // Scout card
      const sc = $("#gcScout"); if(sc){
        sc.innerHTML = s ? `
          <h4 style="margin:0 0 6px 0">Scout: ${esc(next.opponent)}</h4>
          <p class="meta">${esc(s.style)}</p>
          <ul style="margin:8px 0 0 18px">${(s.keys||[]).map(k=>`<li>${esc(k)}</li>`).join("")}</ul>
          <div class="meta" style="margin-top:6px">Players: ${(s.players||[]).map(p=>`${esc(p.name)} — ${esc(p.note)}`).join('; ')}</div>`
          : '<p class="tiny muted">No opponent scout available.</p>';
      }
      // Team overview
      const tm = $("#gcTeam"); if(tm){
        if(!team){ tm.innerHTML = '<p class="tiny muted">Team overview unavailable.</p>'; }
        else {
          const stat = (k, lbl)=>`<div><div class="meta">${lbl}</div><div class="stat">${k.includes('Pct')?pct3(team[k]):fmt1(team[k])}</div></div>`;
          tm.innerHTML = `<h4 style="margin:0 0 8px 0">Team Snapshot</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px">
              ${stat('pts','PPG')}${stat('reb','RPG')}${stat('ast','APG')}${stat('stl','SPG')}${stat('blk','BPG')}${stat('tov','TOV')}${stat('fgPct','FG%')}${stat('threePct','3P%')}${stat('ftPct','FT%')}
            </div>`;
        }
      }
      // Watch/Listen panel
      const w = $("#gcWatch"); if(w){
        const tv = next?.tv || 'TBA';
        const radio = 'TBA';
        w.innerHTML = `
          <h4 style="margin:0 0 6px 0">Where to Watch/Listen</h4>
          <ul style="margin:8px 0 0 18px">
            <li><strong>TV:</strong> ${esc(tv)}</li>
            ${next?.box?`<li><strong>Game page:</strong> <a class="boxlink" href="${next.box}" target="_blank" rel="noopener">ESPN ↗</a></li>`:''}
            <li><strong>Stream:</strong> <a class="boxlink" href="https://www.espn.com/watch/" target="_blank" rel="noopener">ESPN App ↗</a></li>
            <li><strong>Radio:</strong> ${radio}</li>
          </ul>`;
      }

      // Depth Chart (by position, sorted by MPG)
      const dc = $("#gcDepth"); if(dc){
        const players = (STATE.stats?.players||[]).slice();
        if(!players.length){ dc.innerHTML = '<p class="tiny muted">Depth chart unavailable.</p>'; }
        else {
          const cat={G:[],F:[],C:[]};
          players.forEach(p=>{ const pos=(p.pos||'').toUpperCase(); if(pos.includes('G')) cat.G.push(p); if(pos.includes('F')) cat.F.push(p); if(pos.includes('C')) cat.C.push(p); });
          const sortByMpg=(a,b)=> (b.mpg||0)-(a.mpg||0);
          Object.keys(cat).forEach(k=>cat[k].sort(sortByMpg));
          const renderCol=(label,list)=>`<div><div class="tiny muted">${label}</div>${list.slice(0,4).map(pl=>`<div>${esc(pl.name)} <span class="meta">${esc(pl.class||'')}</span> <span class="badge ghost">${fmt1(pl.mpg||0)} MPG</span></div>`).join('')}</div>`;
          dc.innerHTML = `<h4 style="margin:0 0 6px 0">Depth Chart</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px">
              ${renderCol('Guards', cat.G)}
              ${renderCol('Forwards', cat.F)}
              ${renderCol('Centers', cat.C)}
            </div>`;
        }
      }

    }catch(e){
      const d=$("#diag"); if(d){ d.style.display='block'; d.innerHTML += `<div class="card"><pre class="tiny">loadGameCenter: ${esc(e.message)}</pre></div>`; }
    }
  }
  /* ---------- Live & Fans ---------- */
  function findLiveFromSchedule(){ return (STATE.schedule||[]).find(g=>g.statusState==='in') || null; }
let LIVE_TICK=0; function scheduleLiveTicker(){ try{ if(LIVE_TICK){ clearInterval(LIVE_TICK); LIVE_TICK=0; } if(findLiveFromSchedule()){ LIVE_TICK=setInterval(()=>{ try{ loadLive(); }catch(e){} }, 30000); } }catch(e){} }

  async function loadLive(){
    const wrap = $("#liveWrap"); if(!wrap) return;
    const live = findLiveFromSchedule();
    if(!live){ const next = upcomingFromSchedule();
      wrap.innerHTML = next ? `
        <div style="display:flex;align-items:center;gap:12px">
          <div>
            <div><strong>Next: Florida vs ${esc(next.opponent)}</strong> <span class="badge">${esc(next.at)}</span></div>
            <div class="meta">${esc(next.date)} • ${esc(next.time)} ${next.statusText?`• ${esc(next.statusText)}`:""}</div>
            ${next.box?`<div class="meta"><a class="boxlink" href="${next.box}" target="_blank" rel="noopener">Game page ↗</a></div>`:""}
          </div>
        </div>` : '<p class="tiny muted">No live game right now.</p>';
      return; }
    try{
      const sum = await espnSummary(live.id);
      const comp = sum.header?.competitions?.[0]||{};
      const teams = comp.competitors||[];
      const uf = teams.find(t=>t.team?.id==String(TEAM_ID))||{};
      const opp = teams.find(t=>t.team?.id!=String(TEAM_ID))||{};
      const clock = comp.status?.type?.shortDetail || comp.status?.type?.detail || '';
      wrap.innerHTML = `
        <div class="sb-row">
          <div class="sb-team"><span class="sb-name">Florida</span><span class="sb-score">${esc(uf.score||'0')}</span></div>
          <div class="sb-meta">${esc(clock)}</div>
          <div class="sb-team"><span class="sb-name">${esc(opp.team?.displayName||'Opponent')}</span><span class="sb-score">${esc(opp.score||'0')}</span></div>
        </div>
        ${live.box?`<div class=\"meta\"><a class=\"boxlink\" href=\"${live.box}\" target=\"_blank\" rel=\"noopener\">Gamecast/Box \u2197</a></div>`:""}
      `;

      // Win probability (beta)
      const wpEl = document.querySelector('#winProb');
      if(wpEl){
        try{
          const us = Number(uf.score||0), them = Number(opp.score||0);
          const period = Number(comp?.status?.period || comp?.period || 1);
          const disp = comp?.status?.displayClock || '';
          const mm = (disp.match(/(\d+):(\d+)/)||[]);
          const secs = mm.length ? (Number(mm[1])*60 + Number(mm[2])) : 0;
          const remReg = period<=2 ? ((2 - period)*1200 + secs) : 0;
          const remOT = period>2 ? ((period - 2)*300 + secs) : 0;
          const rem = remReg + remOT;
          const total = 2400 + 900; // allow some OT cushion
          const tFrac = Math.max(0, Math.min(1, 1 - rem/total));
          const isHome = String(uf.homeAway||'home')==='home';
          const margin = us - them + (isHome?1.5:0);
          const z = 0.12*margin + 2.2*tFrac*(margin/6);
          const p = 1/(1+Math.exp(-z));
          const pctF = Math.round(p*100), pctO = 100 - pctF;
          wpEl.innerHTML = `<h4 style="margin-top:0">Win Probability</h4>
            <div class="wpbar" style="height:16px;background:#e9edf3;border-radius:8px;overflow:hidden">
              <div style="width:${pctF}%;height:100%;background:var(--gator-orange)"></div>
            </div>
            <div class="meta" style="display:flex;justify-content:space-between"><span>Florida ${pctF}%</span><span>${esc(opp.team?.displayName||'Opp')} ${pctO}%</span></div>`;
        }catch(e){ wpEl.innerHTML = '<p class="tiny muted">Win probability unavailable.</p>'; }
      }

      // Leaders and plays panels
    const leadersEl = $("#liveLeaders"), playsEl = $("#livePlays");
    if(leadersEl){
      try{
        const players = sum?.boxscore?.players || [];
        const blockFor = (teamId)=> players.find(p=>String(p.team?.id)===String(teamId));
        const extract = (block)=>{
          const stat = block?.statistics?.find(s=>s?.athletes?.length);
          if(!stat) return [];
          const names = stat.names||[];
          const idx = { PTS:names.indexOf('PTS'), REB:names.indexOf('REB'), AST:names.indexOf('AST'), MIN:names.indexOf('MIN') };
          return (stat.athletes||[]).map(a=>{
            const getNum = (k)=>{ const raw=a.stats?.[idx[k]]; const v=Number((raw||'0').toString().split('-').pop()); return Number.isFinite(v)?v:0; };
            return { name:a.athlete?.displayName||'Player', PTS:getNum('PTS'), REB:getNum('REB'), AST:getNum('AST'), MIN:a.stats?.[idx.MIN]||'' };
          });
        };
        const ufAll = extract(blockFor(TEAM_ID)); const opAll = extract(blockFor(opp.team?.id));
        const top = (arr, k)=> arr.slice().sort((a,b)=> (b[k]||0)-(a[k]||0)).slice(0,3);
        const sec = (title, ua, oa, k)=> `<div><div class="tiny muted">${title}</div>${top(ua,k).map(p=>`<div>${esc(p.name)} — <strong>${p[k]||0}</strong> <span class=\"tiny muted\">${esc(p.MIN||'')}</span></div>`).join("")||'<div class="tiny muted">No data</div>'}<div class="tiny muted" style="margin-top:6px">${esc(opp.team?.displayName||'Opponent')}</div>${top(oa,k).map(p=>`<div>${esc(p.name)} — <strong>${p[k]||0}</strong> <span class=\"tiny muted\">${esc(p.MIN||'')}</span></div>`).join("")||'<div class="tiny muted">No data</div>'}</div>`;
        leadersEl.innerHTML = `
          <h4 style="margin-top:0">Leaders</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            ${sec('Points', ufAll, opAll, 'PTS')}
            ${sec('Rebounds', ufAll, opAll, 'REB')}
            ${sec('Assists', ufAll, opAll, 'AST')}
          </div>`;
      }catch(e){ leadersEl.innerHTML = '<p class="tiny muted">Leaders unavailable.</p>'; }
    }
    const teamStatsEl = document.querySelector('#liveTeamStats');
    if(teamStatsEl){
      try{
        const boxTeams = sum?.boxscore?.teams || [];
        const toMap = arr => Object.fromEntries((arr||[]).map(x=>[x.name, Number(x.value)||0]));
        const our = toMap(boxTeams.find(t=>t.team?.id==String(TEAM_ID))?.statistics?.[0]?.stats||[]);
        const their = toMap(boxTeams.find(t=>t.team?.id!=String(TEAM_ID))?.statistics?.[0]?.stats||[]);
        const pct = (m,a)=> a? Math.round((m/a)*100) : 0;
        const line = (lab, a, b)=>`<tr><td>${lab}</td><td><strong>${a}</strong></td><td><strong>${b}</strong></td></tr>`;
        const fgmFG = `${our.fieldGoalsMade||0}-${our.fieldGoalsAttempted||0} (${pct(our.fieldGoalsMade,our.fieldGoalsAttempted)}%)`;
        const fgm3P = `${our.threePointFieldGoalsMade||0}-${our.threePointFieldGoalsAttempted||0} (${pct(our.threePointFieldGoalsMade,our.threePointFieldGoalsAttempted)}%)`;
        const ftmFT = `${our.freeThrowsMade||0}-${our.freeThrowsAttempted||0} (${pct(our.freeThrowsMade,our.freeThrowsAttempted)}%)`;
        const ofgmFG = `${their.fieldGoalsMade||0}-${their.fieldGoalsAttempted||0} (${pct(their.fieldGoalsMade,their.fieldGoalsAttempted)}%)`;
        const ofgm3P = `${their.threePointFieldGoalsMade||0}-${their.threePointFieldGoalsAttempted||0} (${pct(their.threePointFieldGoalsMade,their.threePointFieldGoalsAttempted)}%)`;
        const oftFT = `${their.freeThrowsMade||0}-${their.freeThrowsAttempted||0} (${pct(their.freeThrowsMade,their.freeThrowsAttempted)}%)`;
        teamStatsEl.innerHTML = `
          <h4 style="margin-top:0">Team stats (live)</h4>
          <div class="table-wrap"><table><thead><tr><th>Stat</th><th>Florida</th><th>${esc(opp.team?.displayName||'Opp')}</th></tr></thead><tbody>
            ${line('FG', fgmFG, ofgmFG)}
            ${line('3PT', fgm3P, ofgm3P)}
            ${line('FT', ftmFT, oftFT)}
            ${line('REB', (our.totalRebounds||0), (their.totalRebounds||0))}
            ${line('AST', (our.assists||0), (their.assists||0))}
            ${line('TO', (our.turnovers||0), (their.turnovers||0))}
          </tbody></table></div>`;
      }catch(e){ teamStatsEl.innerHTML = '<p class="tiny muted">Team stats unavailable.</p>'; }
    }

    }
    if(playsEl){
      try{
        const playsAll = (sum?.plays||[]);
        const present = Array.from(new Set(playsAll.map(p=>Number(p.period?.number||0)).filter(Boolean))).sort((a,b)=>a-b);
        const sel = (window.LIVE_PBP_PERIOD||'all');
        const filtered = sel==='all' ? playsAll : playsAll.filter(p=>Number(p.period?.number||0)===Number(sel));
        const latest = filtered.slice(-50);
        const periodBtns = ['all', ...present].map(p=>`<button class="btn ghost${String(sel)===String(p)?' active':''}" data-p="${p}">${p==='all'?'All':(p<=2?`H${p}`:`OT${p-2}`)}</button>`).join('');
        const auto = window.LIVE_AUTOSCROLL!==false;
        playsEl.innerHTML = latest.length
          ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><h4 style="margin:0">Play-by-play</h4><div class="actions">${periodBtns}<label class="select"><span>Auto-scroll</span><input id="autoScrollPBP" type="checkbox" ${auto?'checked':''}/></label></div></div>
             <ol class="pbp" style="max-height:280px;overflow:auto">${latest.map(pl=>`<li><span class=\"tiny muted\">${esc((pl.clock?.displayValue)||'')}</span> ${esc(pl.text||'')}</li>`).join("")}</ol>`
          : '<p class="tiny muted">Play-by-play unavailable.</p>';
        playsEl.querySelectorAll('button[data-p]')?.forEach(btn=>btn.addEventListener('click', (e)=>{ window.LIVE_PBP_PERIOD = e.currentTarget.getAttribute('data-p'); loadLive(); }));
        playsEl.querySelector('#autoScrollPBP')?.addEventListener('change', (e)=>{ window.LIVE_AUTOSCROLL = e.currentTarget.checked; });
        if(auto){ const listEl = playsEl.querySelector('.pbp'); try{ listEl?.lastElementChild?.scrollIntoView({block:'end'}); }catch(e){} }
      }catch(e){ playsEl.innerHTML = '<p class="tiny muted">Play-by-play unavailable.</p>'; }
    }


    }catch(e){ wrap.innerHTML = '<p class="tiny muted">Live data unavailable.</p>'; }
  }

  function requestTipNotify(){
    const next = upcomingFromSchedule(); if(!next) return toast("No upcoming tipoff found.");

// ---- Fans: Pick'em (local only)
function loadPickem(){
  const wrap = document.getElementById('pickemWrap'); if(!wrap) return;
  const upcoming = (STATE.schedule||[]).filter(g=>!g.result).slice(0,5);
  if(!upcoming.length){ wrap.innerHTML = '<p class="tiny muted">No upcoming games to pick.</p>'; return; }
  const key = `pickem-${(STATE.season||CURRENT_SEASON)}`;
  const saved = JSON.parse(localStorage.getItem(key)||'{}');
  wrap.innerHTML = `<h4 style="margin-top:0">Pick’em — next ${upcoming.length} games</h4>` + upcoming.map(g=>{
    const pick = saved[g.id] || '';
    return `<div class=\"pick-row\">
      <div class=\"tiny muted\">${esc(g.date)} ${esc(g.time)}</div>
      <div><strong>${g.at==='@'?'@':''} ${esc(g.opponent)}</strong></div>
      <div class=\"actions\">
        <button class=\"btn${pick==='Florida'?'\x20active':''}\" data-pick="Florida" data-gid="${g.id}">Florida</button>
        <button class=\"btn ghost${pick && pick!=='Florida'?'\x20active':''}\" data-pick="${esc(g.opponent)}" data-gid="${g.id}">${esc(g.opponent)}</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('button[data-gid]')?.forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const gid = e.currentTarget.getAttribute('data-gid');
      const val = e.currentTarget.getAttribute('data-pick');
      const cur = JSON.parse(localStorage.getItem(key)||'{}');
      cur[gid]=val; localStorage.setItem(key, JSON.stringify(cur));
      loadPickem(); toast('Pick saved');
    });
  });
}

    if(!("Notification" in window)) return toast("Notifications not supported");
    Notification.requestPermission().then(p=>{
      if(p!=="granted") return toast("Notifications blocked");
      const ts = Date.parse(`${next.date} ${next.time} ET`);


      if(isNaN(ts)) return toast("Could not parse tip time.");
      localStorage.setItem("tipNotifyAt", String(ts));
      scheduleTipReminder(); toast("We'll remind you at tipoff (while this tab is open).");
    });
  }
  function scheduleTipReminder(){
    const ts = Number(localStorage.getItem("tipNotifyAt")||0); if(!ts) return;
    const delay = ts - Date.now(); if(delay<=0){ localStorage.removeItem("tipNotifyAt"); return; }
    if(delay > 7*24*60*60*1000) return;
    try{ setTimeout(()=>{ try{ new Notification("Gators tipoff!", { body:"It’s gametime. Go Gators!", tag:"tipoff" }); }catch(e){} localStorage.removeItem("tipNotifyAt"); }, delay); }catch(e){}
  }

// ---- Schedule: iCal export (.ics)
function exportScheduleICS(){
  try{
    const rows = STATE.schedule||[]; if(!rows.length) return toast('No schedule loaded yet.');
    const now = new Date();
    const pad = n=>String(n).padStart(2,'0');
    const fmt = d=>`${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Gators Hub//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n';
    for(const g of rows){
      const ts = Date.parse(`${g.date} ${g.time} ET`);
      if(isNaN(ts)) continue; const start=new Date(ts); const end=new Date(ts+2*60*60*1000);
      const sum = `Florida vs ${g.opponent}${g.at==='@'?' (Away)':''}`;
      const uid = `${g.id || sum.replace(/[^A-Za-z0-9]/g,'')}-${start.getTime()}@gatorshub`;
      ics += 'BEGIN:VEVENT\n';
      ics += `UID:${uid}\n`;
      ics += `DTSTAMP:${fmt(now)}\n`;
      ics += `DTSTART:${fmt(start)}\n`;
      ics += `DTEND:${fmt(end)}\n`;
      ics += `SUMMARY:${sum}\n`;
      if(g.venue||g.city) ics += `LOCATION:${(g.venue||'')}${g.city?`, ${g.city}`:''}\n`;
      if(g.box) ics += `URL:${g.box}\n`;
      ics += 'END:VEVENT\n';
    }
    ics += 'END:VCALENDAR\n';
    const blob = new Blob([ics], {type:'text/calendar'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='gators_basketball_schedule.ics'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  }catch(e){ toast('Could not export calendar'); }
}

$('#exportCalendar')?.addEventListener('click', exportScheduleICS);


// ---- Fans: Pick'em (local only)
function loadPickem(){
  const wrap = document.getElementById('pickemWrap'); if(!wrap) return;
  const upcoming = (STATE.schedule||[]).filter(g=>!g.result).slice(0,5);
  if(!upcoming.length){ wrap.innerHTML = '<p class="tiny muted">No upcoming games to pick.</p>'; return; }
  const key = `pickem-${(STATE.season||CURRENT_SEASON)}`;
  const saved = JSON.parse(localStorage.getItem(key)||'{}');
  wrap.innerHTML = `<h4 style=\"margin-top:0\">Pick\u2019em \u2014 next ${upcoming.length} games</h4>` + upcoming.map(g=>{
    const pick = saved[g.id] || '';
    return `<div class=\"pick-row\">\n      <div class=\"tiny muted\">${esc(g.date)} ${esc(g.time)}</div>\n      <div><strong>${g.at==='@'?'@':''} ${esc(g.opponent)}</strong></div>\n      <div class=\"actions\">\n        <button class=\"btn${pick==='Florida'?'\\x20active':''}\" data-pick=\"Florida\" data-gid=\"${g.id}\">Florida</button>\n        <button class=\"btn ghost${pick && pick!=='Florida'?'\\x20active':''}\" data-pick=\"${esc(g.opponent)}\" data-gid=\"${g.id}\">${esc(g.opponent)}</button>\n      </div>\n    </div>`;
  }).join('');
  wrap.querySelectorAll('button[data-gid]')?.forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const gid = e.currentTarget.getAttribute('data-gid');
      const val = e.currentTarget.getAttribute('data-pick');
      const cur = JSON.parse(localStorage.getItem(key)||'{}');
      cur[gid]=val; localStorage.setItem(key, JSON.stringify(cur));
      loadPickem(); toast('Pick saved');
    });
  });
}


  function loadFans(){
    const el=$("#fansPoll"); if(!el) return; const next=upcomingFromSchedule();
    if(!next){ el.innerHTML='<p class="tiny muted">No upcoming game to vote on yet.</p>'; return; }
    const key=`poll-${next.id}`; const existing=localStorage.getItem(key); const opp=next.opponent;
    if(!existing){
      el.innerHTML = `
        <h4 style="margin:0 0 8px 0">Who wins vs ${esc(opp)}?</h4>
        <div class="actions">
          <button class="btn" id="voteUF">Florida</button>
          <button class="btn ghost" id="voteOPP">${esc(opp)}</button>
        </div>
        <p class="tiny muted">Local-only poll saved on this device.</p>`;
      $("#voteUF")?.addEventListener("click", ()=>{ localStorage.setItem(key, "Florida"); loadFans(); toast("Vote saved"); });
      $("#voteOPP")?.addEventListener("click", ()=>{ localStorage.setItem(key, opp); loadFans(); toast("Vote saved"); });
    }else{
      el.innerHTML = `
        <p>You picked <strong>${esc(existing)}</strong> vs ${esc(opp)}.</p>
        <div class="actions"><button class="btn ghost" id="clearVote">Change vote</button></div>
        <p class="tiny muted">This poll is local-only (no server).</p>`;
      $("#clearVote")?.addEventListener("click", ()=>{ localStorage.removeItem(key); loadFans(); });
    }
  }

  $("#refreshLive")?.addEventListener('click', loadLive);
  $("#notifyTip")?.addEventListener('click', requestTipNotify);


  $("#refreshStandings")?.addEventListener('click', loadStandings);
  $("#refreshAP")?.addEventListener('click', loadStandings);


  function renderAnalytics(){
    const rows=STATE.analytics.slice().reverse();
    $("#analyticsWrap").innerHTML = rows.length
      ? `<table><thead><tr><th>Date</th><th>Opponent</th><th>H/A</th><th>Score</th><th>ORtg</th><th>DRtg</th><th>Pace</th><th>eFG%</th><th>TO%</th><th>Box</th></tr></thead><tbody>
          ${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.opp)}</td><td>${r.at}</td><td>${esc(r.score)}</td><td class="stat">${r.ortg}</td><td>${r.drtg}</td><td>${r.pace}</td><td>${r.efg}</td><td>${r.toPct}</td><td><a class="boxlink" target="_blank" rel="noopener" href="${r.box}">↗</a></td></tr>`).join("")}
        </tbody></table>`
      : `<div class="card"><p class="tiny muted">No completed games yet.</p></div>`;
  }

  // extra charts enhancing analytics table
  let CHARTS={};
  function drawAnalyticsCharts(){
    try{
      const rows=STATE.analytics.slice().reverse(); if(!rows.length) return;
      const mount = document.querySelector('#analyticsWrap'); if(!mount) return;
      const labels = rows.map(r=>r.opp);
      const chartsHTML = `
        <div class="card mt"><h4 style="margin:0 0 8px 0">Efficiency trends</h4><canvas id="chEff" height="120"></canvas></div>
        <div class="grid-2 mt">
          <div class="card"><h4 style="margin:0 0 8px 0">Pace</h4><canvas id="chPace" height="120"></canvas></div>
          <div class="card"><h4 style="margin:0 0 8px 0">eFG%</h4><canvas id="chEFG" height="120"></canvas></div>
        </div>`;
      mount.insertAdjacentHTML('afterbegin', chartsHTML);
      if(typeof Chart==='undefined') return;


      CHARTS.eff && CHARTS.eff.destroy(); CHARTS.pace && CHARTS.pace.destroy(); CHARTS.efg && CHARTS.efg.destroy();
      const ctx1=document.getElementById('chEff').getContext('2d');
      CHARTS.eff=new Chart(ctx1,{type:'line',data:{labels, datasets:[
        {label:'ORtg', data:rows.map(r=>r.ortg), borderColor:'#FA4616', backgroundColor:'rgba(250,70,22,.15)', tension:.25},
        {label:'DRtg', data:rows.map(r=>r.drtg), borderColor:'#0021A5', backgroundColor:'rgba(0,33,165,.15)', tension:.25}
      ]}, options:{plugins:{legend:{display:true}}, scales:{y:{beginAtZero:false}}}});
      const ctx2=document.getElementById('chPace').getContext('2d');
      CHARTS.pace=new Chart(ctx2,{type:'bar',data:{labels,datasets:[{label:'Pace',data:rows.map(r=>r.pace), backgroundColor:'rgba(0,33,165,.45)'}]}, options:{plugins:{legend:{display:false}}}});
      const ctx3=document.getElementById('chEFG').getContext('2d');
      CHARTS.efg=new Chart(ctx3,{type:'bar',data:{labels,datasets:[{label:'eFG%',data:rows.map(r=>r.efg), backgroundColor:'rgba(250,70,22,.55)'}]}, options:{plugins:{legend:{display:false}}, scales:{y:{suggestedMax:70}}}});
    }catch(e){}
  }

  // ensure charts draw after Chart.js loads
  window.addEventListener('load', ()=>{ try{ drawAnalyticsCharts(); }catch(e){} });



  /* ---------- Init ---------- */
  async function refreshAll(){
    fillSeasonSelects();
    await Promise.all([loadRosterAndStats(), loadSchedule()]);
    await Promise.all([loadGameCenter(), loadStandings(), loadLive()]);
    scheduleLiveTicker();
    renderPropsTable(); renderBetSlip(); bankrollUI(); renderLeaderboard(); loadPhotos(); loadNews(); renderCountdown(); loadFans(); loadPickem();
    await loadAnalytics();
  }

  document.addEventListener("DOMContentLoaded", () => {
    route(); startHero(); refreshAll(); scheduleTipReminder();
    setInterval(async ()=>{ try{ await Promise.all([loadRosterAndStats(), loadSchedule()]); await Promise.all([loadAnalytics(), loadGameCenter(), loadStandings(), loadLive()]); scheduleLiveTicker(); loadFans(); loadPickem(); }catch(e){} }, REFRESH_MS);
  });

	  // Register service worker for offline/cache
	  if ("serviceWorker" in navigator) {
	    window.addEventListener("load", () => {
	      navigator.serviceWorker.register("./sw.js").catch(()=>{});
	    });
	  }

})();
