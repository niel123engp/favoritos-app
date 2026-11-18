// ==UserScript==
// @name         Guardião Favoritos — odds Parimatch
// @namespace    favoritos
// @updateURL    https://niel123engp.github.io/favoritos-app/guardiao-parimatch.user.js
// @downloadURL  https://niel123engp.github.io/favoritos-app/guardiao-parimatch.user.js
// @version      2.4
// @description  Lê as odds 1x2 (margem 0%) dos jogos do dia e acompanha a movimentação dos jogos de margem 0% (piloto) na Parimatch, gravando na planilha "Favorito e odds de valor". Só lê; nunca aposta.
// @match        https://parimatch-hub.bet/*
// @match        https://packball.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  // ======== CONFIG ========
  const API = 'https://script.google.com/macros/s/AKfycbz1ZowgfolCmH6HWEH49olOa4p2WZASaI8r8uNgl922SOBMxCg10GNOQ5dB_phDy83L-w/exec';
  // A chave NÃO fica neste arquivo (ele é público). Na primeira vez o guardião pergunta e guarda no Chrome.
  let KEY = localStorage.getItem('guard.key') || '';
  // Segura um Web Lock: o Chrome congela abas paradas em segundo plano; aba com lock não é congelada.
  try { navigator.locks.request('favoritos-guardiao-' + Date.now(), () => new Promise(() => {})); } catch (e) { /* sem locks */ }

  // ======== COLETOR PACKBALL (v2.1) ========
  // No site do PackBall este mesmo script vira o coletor: para cada jogo das abas da planilha ele abre
  // todas as abas do jogo (pré-jogo, odds, estatísticas, jogadores, características, confrontos,
  // classificação, oportunidades, análise), copia o texto e manda para a planilha. Só lê.
  // Só trabalha na aba aberta em https://packball.com/pt/matches#coletor (a aba que você usa fica livre).
  if (location.hostname.endsWith('packball.com')) { coletorPackball(); return; }

  function coletorPackball() {
    if (window.__pbColetor) return;
    if (location.hash === '#coletor') sessionStorage.setItem('pb.coletor', '1');
    if (sessionStorage.getItem('pb.coletor') !== '1') return;
    window.__pbColetor = true;

    const cap = {};
    const O = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.addEventListener('load', () => {
        try {
          if (!String(u).includes('api.packball.com')) return;
          const p = new URL(u, location.href).pathname, rt = this.responseType;
          if (rt === '' || rt === 'text') cap[p] = this.responseText;
          else if (rt === 'json') cap[p] = JSON.stringify(this.response);
          else if (rt === 'arraybuffer') cap[p] = new TextDecoder().decode(this.response);
          else if (rt === 'blob') this.response.text().then((t) => { cap[p] = t; });
        } catch (e) { /* ignora */ }
      });
      return O.apply(this, arguments);
    };

    // Segura um Web Lock: o Chrome não congela abas que seguram um (abas paradas ou em grupo recolhido).
    try { navigator.locks.request('pb-coletor-' + Date.now(), () => new Promise(() => {})); } catch (e) { /* sem locks */ }
    // Relógio num Worker: o Chrome segura os timers de aba em segundo plano (1 por minuto); os do Worker não.
    let relogio = null; const espera = {}; let seq = 0;
    try {
      relogio = new Worker(URL.createObjectURL(new Blob(['onmessage=function(e){setTimeout(function(){postMessage(e.data.id)},e.data.ms)}'], { type: 'text/javascript' })));
      relogio.onmessage = (e) => { const f = espera[e.data]; if (f) { delete espera[e.data]; f(); } };
      relogio.onerror = () => { relogio = null; Object.keys(espera).forEach((k) => { const f = espera[k]; delete espera[k]; f(); }); };
    } catch (e) { relogio = null; }
    const sleep = (ms) => new Promise((r) => {
      if (!relogio) return setTimeout(r, ms);
      const id = ++seq; espera[id] = r; relogio.postMessage({ id, ms });
    });
    const estado = { ultimo: '', feitos: 0, falhas: {}, log: [] };
    window.__pbEstado = estado;
    const log = (t) => {
      estado.ultimo = new Date().toLocaleTimeString() + ' ' + t;
      estado.log.push(estado.ultimo); if (estado.log.length > 80) estado.log.shift();
      console.log('[coletor PackBall]', t);
    };
    const go = async (path, ms) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); await sleep(ms || 3000); };
    const painel = () => {
      let p = document.querySelector('li > a[href$="/standings"]');
      while (p && p.parentElement && !p.parentElement.querySelector('.grid-matches')) p = p.parentElement;
      return p && p.parentElement ? p : null;
    };

    const LIXO = new Set('fc sc ec ca cf ac cd rj sp ba mg rs pr go ce pe club clube de do da la el rb as afc cs'.split(' '));
    const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const toks = (s) => semAcento(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t && !LIXO.has(t));
    const sim = (a, b) => {
      const A = toks(a), B = toks(b);
      if (!A.length || !B.length) return 0;
      const n = A.filter((t) => B.some((u) => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u))))).length;
      return n / Math.min(A.length, B.length);
    };
    const slug = (s) => semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    async function irParaDia(ymd) {
      if (!document.querySelector('.arrow-nav')) await go('/pt/matches', 4000);
      const alvo = ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
      const atual = () => ((document.querySelector('.arrow-nav .title-active') || {}).innerText || '').trim().slice(0, 5);
      const num = (s) => +(s.slice(3, 5) + s.slice(0, 2));
      const clicar = async (sel) => { const e = document.querySelector('.arrow-nav ' + sel); if (e) e.click(); await sleep(1300); };
      for (let i = 0; i < 14 && atual() !== alvo; i++) await clicar(num(atual()) < num(alvo) ? '.arrow-next' : '.arrow-previous');
      if (atual() !== alvo) return [];
      // recarrega a lista deste dia para ter certeza de que a resposta capturada é a dele
      await sleep(1500);
      await clicar('.arrow-next'); await sleep(800);
      delete cap['/fixtures/markets'];
      await clicar('.arrow-previous');
      for (let k = 0; k < 30 && !cap['/fixtures/markets']; k++) await sleep(400);
      try { return JSON.parse(cap['/fixtures/markets']).data.b || []; } catch (e) { return []; }
    }

    function achar(j, fx) {
      let best = null, bs = 0;
      fx.forEach((f) => {
        const h = sim(j.home, f.i && f.i.b), a = sim(j.away, f.j && f.j.b);
        if (h < 0.5 || a < 0.5) return;
        const t = f.g && f.g.a ? Date.parse(f.g.a) : 0;
        if (j.kick && t && Math.abs(t - j.kick) > 3 * 3600000) return;
        if (h + a > bs) { bs = h + a; best = f; }
      });
      return best;
    }

    const ABAS = {
      preview: 'preview', odds: 'odds', 'team-stats': 'head-to-head/team-stats', 'player-stats': 'head-to-head/player-stats',
      characteristics: 'head-to-head/characteristics', 'h2h-stats': 'head-to-head/h2h-stats', standings: 'standings',
      predictions: 'predictions', analysis: 'analysis',
    };
    const limpa = (t) => {
      const i = t.indexOf('Anotações');
      return (i > 0 && i < 700 ? t.slice(i + 9) : t).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    };

    async function lerJogo(f) {
      const base = '/pt/matches/' + f.a + '/match/' + slug(f.i.b) + 'x' + slug(f.j.b) + '/';
      const abas = {};
      for (const nome of Object.keys(ABAS)) {
        await go(base + ABAS[nome], 3200);
        let p = painel();
        for (let k = 0; k < 8 && !p; k++) { await sleep(500); p = painel(); }
        if (!p) continue;
        let txt = limpa(p.innerText);
        const vistos = new Set([txt]);
        // sub-abas dentro da aba (outro time, gols, escanteios, cartões, casa/fora...)
        const subs = [...p.querySelectorAll('ul.tabs > li')].filter((li) => {
          const a = li.querySelector('a');
          const h = a && a.getAttribute('href');
          return !(h && h !== '#');
        }).slice(0, 8);
        for (const li of subs) {
          const rot = (li.innerText || '').trim().slice(0, 40);
          try { (li.querySelector('a') || li).click(); } catch (e) { continue; }
          await sleep(1300);
          const p2 = painel(); if (!p2) break;
          const t2 = limpa(p2.innerText);
          if (!vistos.has(t2)) { vistos.add(t2); txt += '\n\n=== ' + (rot || 'sub-aba') + ' ===\n' + t2; }
        }
        abas[nome] = txt.slice(0, 44000);
      }
      return { abas, url: location.origin + base + 'preview' };
    }

    const proximoDia = (ymd) => new Date(Date.parse(ymd + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);

    (async () => {
      // Chave própria do coletor: nasce aqui e é aceita pela planilha num pareamento (sem digitar nada).
      let PBK = localStorage.getItem('pb.key') || '';
      const parear = async () => {
        const nova = (crypto.randomUUID() + crypto.randomUUID()).replace(/[^\w-]/g, '');
        try {
          const r = await (await fetch(API, { method: 'POST', body: JSON.stringify({ pbPair: nova }) })).json();
          if (r.ok) { PBK = nova; localStorage.setItem('pb.key', nova); log('pareado com a planilha'); }
          else log('aguardando pareamento com a planilha (' + r.erro + ')');
        } catch (e) { log('pareamento: ' + e); }
      };
      log('coletor ligado');
      while (true) {
        if (!PBK) { await parear(); if (!PBK) { await sleep(60000); continue; } }
        try {
          const api = await (await fetch(API + '?k=' + encodeURIComponent(PBK) + '&pbLista=1&_=' + Date.now(), { cache: 'no-store' })).json();
          const lista = (api.jogos || []).filter((j) => !(estado.falhas[j.dia + '|' + j.jogo] > Date.now()));
          log(api.ok ? 'pendentes: ' + lista.length : 'erro da planilha: ' + api.erro);
          if (!api.ok && /chave/.test(String(api.erro))) { PBK = ''; localStorage.removeItem('pb.key'); }
          const listas = {};
          const fxDia = async (ymd) => { if (!listas[ymd]) listas[ymd] = await irParaDia(ymd); return listas[ymd]; };
          for (const j of lista) {
            let f = achar(j, await fxDia(j.data));
            if (!f) f = achar(j, await fxDia(proximoDia(j.data)));
            if (!f) { estado.falhas[j.dia + '|' + j.jogo] = Date.now() + 3 * 3600000; log('não achei no PackBall: ' + j.jogo + ' (' + j.data + ')'); continue; }
            const r = await lerJogo(f);
            if (!Object.keys(r.abas).length) { log('sem painel: ' + j.jogo); continue; }
            const resp = await (await fetch(API, {
              method: 'POST',
              body: JSON.stringify({ k: PBK, packball: { dia: j.dia, hora: j.hora, liga: j.liga, jogo: j.jogo, id: f.a, url: r.url, abas: r.abas } }),
            })).json();
            estado.feitos++;
            log(j.dia + ' ' + j.jogo + ' → ' + (resp.ok ? 'gravado; análise: ' + resp.analise : 'erro: ' + resp.erro));
          }
        } catch (e) { log('erro: ' + e); }
        await sleep(20 * 60000);
      }
    })();
  }
  const CADA_MIN = 5;                        // varredura normal
  const CADA_MIN_PERTO = 2;                  // quando há jogo em até 20 min
  const PARALELO = 3;                        // jogos lidos ao mesmo tempo
  const JANELA_ANTES_H = 6;                  // só lê jogos que começam em até 6 h
  const JANELA_DEPOIS_MIN = 5;               // e até 5 min depois do início
  // ========================

  if (window.top !== window.self) return;    // não roda dentro dos iframes que ele mesmo abre
  if (!KEY) {
    const v = prompt('Guardião Favoritos — cole a chave de acesso (a mesma do app):');
    if (!v) return;
    KEY = v.trim(); localStorage.setItem('guard.key', KEY);
  }
  const LOCK = 'guard.lock', CACHE = 'guard.ids';
  const log = (...a) => console.log('[guardião]', ...a);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const palavras = (s) => norm(s).split(' ').filter((w) => w.length >= 4 && !['club', 'clube', 'city', 'united', 'real', 'sport', 'atletico', 'deportivo', 'sporting'].includes(w));
  const bate = (a, b) => { const pa = palavras(a), pb = palavras(b); return pa.some((w) => pb.includes(w)) || norm(a) === norm(b); };

  // ---- badge na tela ----
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:999999;background:#0B1220;color:#34D399;border:1px solid #243049;border-radius:10px;padding:6px 10px;font:12px/1.3 Inter,system-ui,sans-serif;opacity:.9';
  badge.textContent = 'guardião: iniciando…';
  document.body.appendChild(badge);
  const st = (t, cor) => { badge.textContent = 'guardião: ' + t; badge.style.color = cor || '#34D399'; };

  // ---- só uma aba trabalha ----
  const meuId = Math.random().toString(36).slice(2);
  const souDono = () => {
    try {
      const l = JSON.parse(localStorage.getItem(LOCK) || '{}');
      if (l.id && l.id !== meuId && Date.now() - l.t < 90000) return false;
      localStorage.setItem(LOCK, JSON.stringify({ id: meuId, t: Date.now() }));
      return true;
    } catch (e) { return true; }
  };

  // ---- lê um evento num iframe escondido ----
  function lerEvento(id, timeoutMs = 30000) {
    return new Promise((res) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:4000px;opacity:0.01;z-index:-1;pointer-events:none';
      f.src = '/pt/events/x-' + id;
      document.body.appendChild(f);
      const t0 = Date.now();
      const iv = setInterval(() => {
        let t = '', title = '';
        try { t = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : ''; title = f.contentDocument ? f.contentDocument.title : ''; } catch (e) { }
        const i = t.indexOf('Resultado da partida');
        const bloco = i > 0 ? t.slice(i, i + 400) : '';
        const nums = (bloco.match(/\d+\.\d\d/g) || []).map(Number);
        const oddsOk = i > 0 && (nums.length >= 6 || (nums.length >= 3 && !bloco.includes('0% margem')));
        const tituloOk = /Aposte em .+ x .+ \|/.test(title);
        // a página mostra as odds antes do título; espera o título (até o limite) para confirmar os times
        const pronto = oddsOk && tituloOk;
        if (pronto || Date.now() - t0 > timeoutMs) {
          clearInterval(iv); f.remove();
          if (!oddsOk) return res(null);
          const m = title.match(/Aposte em (.+?) \| (.+?) \|/);
          const cab = bloco.slice(0, Math.max(0, bloco.search(/\d+\.\d\d/)));   // só o cabeçalho do mercado
          const zero = cab.includes('0% margem');
          const pa = /Pagamento antec/i.test(cab);                                // etiqueta de pagamento antecipado (2UP)
          const o = zero ? { n1: nums[0], o1: nums[1], nX: nums[2], oX: nums[3], n2: nums[4], o2: nums[5] }
                         : { n1: nums[0], o1: nums[0], nX: nums[1], oX: nums[1], n2: nums[2], o2: nums[2] };
          res(Object.assign({ id, titulo: m ? m[1] : title, liga: m ? m[2] : '', margemZero: zero, pa }, o));
        }
      }, 500);
    });
  }

  async function buscarIds(termo) {
    const r = await fetch('/api/Search/v5?query=' + encodeURIComponent(termo) + '&categoryType=All&skip=0&take=30&grouping=3');
    const j = await r.json();
    return (j.payload || []).filter((p) => p.itemType === 'SportCard' && p.item && p.item.type === 'Match' && p.item.secondaryType === 'Football').map((p) => p.item.itemId);
  }

  // acha o evento de um jogo "Casa x Fora" (cache por dia)
  async function acharEvento(jogo, dia) {
    const cache = JSON.parse(localStorage.getItem(CACHE) || '{}');
    if (cache.dia !== dia) { localStorage.setItem(CACHE, JSON.stringify({ dia, m: {} })); return acharEvento(jogo, dia); }
    if (cache.m[jogo]) return cache.m[jogo];
    const [casa, fora] = jogo.split(/\s+x\s+/i);
    if (!casa || !fora) return null;
    let ids = await buscarIds(palavras(casa)[0] || casa);
    if (!ids.length) ids = await buscarIds(palavras(fora)[0] || fora);
    for (const id of ids.slice(0, 4)) {
      const ev = await lerEvento(id, 30000);
      if (!ev || !ev.titulo) continue;
      const [tc, tf] = ev.titulo.split(/\s+x\s+/i);
      if (tc && tf && bate(tc, casa) && bate(tf, fora)) {
        cache.m[jogo] = { id, liga: ev.liga };
        localStorage.setItem(CACHE, JSON.stringify(cache));
        return { id, liga: ev.liga, odds: ev };   // já traz as odds lidas agora
      }
    }
    return null;
  }

  function minutosAte(hora) {
    const m = String(hora || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return null;
    const d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
    return (d.getTime() - Date.now()) / 60000;
  }

  async function varrer() {
    if (!souDono()) { st('outra aba está cuidando', '#94A3B8'); return CADA_MIN; }
    st('lendo lista…');
    let api;
    try { api = await (await fetch(API + '?k=' + encodeURIComponent(KEY) + '&_=' + Date.now(), { cache: 'no-store' })).json(); }
    catch (e) { st('sem acesso à planilha', '#F87171'); return CADA_MIN; }
    if (!api.ok) { st('chave inválida', '#F87171'); return CADA_MIN; }
    const dia = String(api.dia);
    const jogos = (api.hoje.jogos || []).filter((j) => {
      const min = minutosAte(j.hora);
      return !j.resultado && min !== null && min <= JANELA_ANTES_H * 60 && min >= -JANELA_DEPOIS_MIN;
    });
    const perto = jogos.some((j) => minutosAte(j.hora) <= 20);
    if (!jogos.length) { st('nenhum jogo nas próximas ' + JANELA_ANTES_H + ' h · ' + new Date().toLocaleTimeString('pt-BR').slice(0, 5), '#94A3B8'); return CADA_MIN; }

    const leituras = [];
    for (let i = 0; i < jogos.length; i += PARALELO) {
      const lote = jogos.slice(i, i + PARALELO);
      st('lendo ' + (i + 1) + '–' + Math.min(i + PARALELO, jogos.length) + ' de ' + jogos.length);
      const rs = await Promise.all(lote.map(async (j) => {
        try {
          const ev = await acharEvento(j.jogo, dia);
          if (!ev) { log('não achei', j.jogo); return null; }
          const o = ev.odds || await lerEvento(ev.id);
          if (!o) { log('sem odds', j.jogo); return null; }
          return { jogo: j.jogo, hora: j.hora, o1: o.o1, oX: o.oX, o2: o.o2, n1: o.n1, nX: o.nX, n2: o.n2, liga: o.liga, eventId: ev.id, pa: o.pa, margemZero: o.margemZero };
        } catch (e) { log('erro', j.jogo, e); return null; }
      }));
      rs.forEach((r) => r && leituras.push(r));
    }
    let resp = null;
    if (leituras.length) {
      try {
        // GET, porque o site da Parimatch bloqueia POST para fora
        const url = API + '?k=' + encodeURIComponent(KEY) + '&dia=' + encodeURIComponent(dia) + '&leituras=' + encodeURIComponent(JSON.stringify(leituras)) + '&_=' + Date.now();
        resp = await (await fetch(url, { cache: 'no-store' })).json();
      } catch (e) { log('falha ao gravar', e); }
    }
    const hhmm = new Date().toLocaleTimeString('pt-BR').slice(0, 5);
    st(leituras.length + '/' + jogos.length + ' odds gravadas ' + hhmm + (resp && resp.alertas ? ' · 🎯 ' + resp.alertas : ''), resp && resp.ok ? '#34D399' : '#FBBF24');
    log('varredura', hhmm, leituras, resp);
    return perto ? CADA_MIN_PERTO : CADA_MIN;
  }

  (async function loop() {
    while (true) {
      let esperar = CADA_MIN;
      try { esperar = await varrer(); } catch (e) { log('erro geral', e); st('erro: ' + e.message, '#F87171'); }
      limparFila();
      await new Promise((r) => setTimeout(r, esperar * 60000));
    }
  })();

  // =====================================================================
  // PILOTO MARGEM 0% — acompanha a movimentação dos jogos de margem 0%
  // nas 24 h antes do apito (30 min longe, 10 min a 1–6 h, 3 min na última hora)
  // e procura jogos novos de margem 0% de hora em hora.
  // =====================================================================
  const PIL_JANELA_H = 24;
  const PIL_CADENCIA = (min) => (min > 360 ? 30 : min > 60 ? 10 : 3);   // minutos entre leituras
  const PIL_BUSCA_MIN = 60;                                           // procura jogos novos
  const PIL_LIGAS = 'pil.ligas0';                                     // ligas onde já apareceu margem 0%

  // o site acumula filas de estatística no armazenamento a cada página aberta; quando enche, nada mais grava
  function limparFila() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('snowplowOutQueue_')).forEach((k) => localStorage.removeItem(k)); } catch (e) { }
  }

  const MESES = { JAN: 0, FEV: 1, MAR: 2, ABR: 3, MAI: 4, JUN: 5, JUL: 6, AGO: 7, SET: 8, OUT: 9, NOV: 10, DEZ: 11 };
  function dataDe(rot) {   // 'HOJE' | 'AMANHÃ' | '21 DE NOV.'
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (/^HOJE/.test(rot)) return d;
    if (/^AMANH/.test(rot)) { d.setDate(d.getDate() + 1); return d; }
    const m = rot.match(/^(\d{1,2}) DE ([A-ZÇ]{3})/);
    if (!m || MESES[m[2]] === undefined) return null;
    const r = new Date(d.getFullYear(), MESES[m[2]], +m[1]);
    if (r < d && d.getMonth() === 11 && MESES[m[2]] === 0) r.setFullYear(d.getFullYear() + 1);
    return r;
  }
  const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();

  // lê a página de uma liga e devolve os jogos com odds normais e de margem 0%
  function lerLiga(doc) {
    const txt = doc.body ? doc.body.innerText : '';
    const lm = txt.match(/Futebol\. ([^\n]+)/);
    const liga = lm ? lm[1].trim() : '';
    const out = [];
    doc.querySelectorAll('a[href*="/events/"]').forEach((a) => {
      const idm = (a.getAttribute('href') || '').match(/-(\d+)$/); if (!idm) return;
      const ls = a.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const dm = (ls[0] || '').match(/^(HOJE|AMANHÃ|\d{1,2} DE [A-ZÇ]+\.?), (\d{1,2}:\d{2})$/); if (!dm) return;
      let j = 1; if (/^\+\d+$/.test(ls[j])) j++;
      const home = ls[j], away = ls[j + 1]; j += 2;
      const nums = []; const pos = [];
      for (; j < ls.length; j++) {
        if (/^\d+\.\d+$/.test(ls[j])) nums.push(parseFloat(ls[j]));
        else if (/^[1X2]$/.test(ls[j])) pos.push(nums.length);
        else break;
      }
      const dia = dataDe(dm[1]); if (!dia || !home || !away) return;
      let z = null, n = null;
      if (pos.join() === '2,4,6' && nums.length === 6) { n = [nums[0], nums[2], nums[4]]; z = [nums[1], nums[3], nums[5]]; }
      else if (pos.join() === '1,2,3' && nums.length === 3) { n = nums.slice(0, 3); }
      out.push({ id: idm[1], liga, dia: dd(dia), hora: dm[2].padStart(5, '0'), home, away, jogo: home + ' x ' + away, n, z, mz: !!z });
    });
    return out;
  }

  function abrir(url, ms = 15000) {
    return new Promise((res) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:5000px;opacity:0.01;z-index:-1;pointer-events:none';
      f.src = url; document.body.appendChild(f);
      const t0 = Date.now(); let ult = -1;
      const iv = setInterval(() => {
        let r = null;
        try {
          const d = f.contentDocument; const n = d.querySelectorAll('a[href*="/events/"]').length;
          if (n > 0 && n === ult) r = lerLiga(d); ult = n;
          if (!r && Date.now() - t0 > ms) r = lerLiga(d);
        } catch (e) { if (Date.now() - t0 > ms) r = []; }
        if (r) { clearInterval(iv); f.remove(); limparFila(); res({ url, jogos: r }); }
      }, 1200);
    });
  }

  async function api(params) {
    let q = API + '?k=' + encodeURIComponent(KEY);
    Object.keys(params).forEach((k) => { q += '&' + k + '=' + encodeURIComponent(params[k]); });
    return (await fetch(q + '&_=' + Date.now(), { cache: 'no-store' })).json();
  }
  async function enviarEmLotes(chave, lista, extra) {
    let tot = 0;
    for (let i = 0; i < lista.length; i += 12) {
      try { const r = await api(Object.assign({ [chave]: JSON.stringify(lista.slice(i, i + 12)) }, extra || {})); if (r && r.ok) tot += (r.gravadas || r.novos || 0) + (r.atualizados || 0); } catch (e) { log('piloto: falha ao enviar', e); }
    }
    return tot;
  }

  async function lerVarias(urls, paralelo = 3) {
    const res = []; let i = 0;
    const w = async () => { while (i < urls.length) { const u = urls[i++]; res.push(await abrir(u)); } };
    await Promise.all(Array.from({ length: paralelo }, w));
    return res;
  }

  // procura jogos novos de margem 0% (ligas já conhecidas a cada hora)
  async function pilotoBuscar() {
    const ligas = JSON.parse(localStorage.getItem(PIL_LIGAS) || '[]');
    if (!ligas.length) return 0;
    const rs = await lerVarias(ligas);
    const novos = [];
    rs.forEach((r) => r.jogos.filter((j) => j.mz).forEach((j) => novos.push({ id: j.id, liga: j.liga, dia: j.dia, hora: j.hora, home: j.home, away: j.away, url: r.url, z: true })));
    return novos.length ? enviarEmLotes('monitor', novos) : 0;
  }

  // lê as ligas que têm jogo "na hora" de leitura
  async function pilotoLer() {
    const r = await api({ listaMonitor: 1 });
    if (!r || !r.ok) return { lidos: 0, devidos: 0 };
    const agora = Date.now();
    const devidos = (r.jogos || []).filter((j) => {
      const min = (j.ini - agora) / 60000;
      if (min > PIL_JANELA_H * 60 || min < -5) return false;
      return !j.ult || (agora - j.ult) >= PIL_CADENCIA(min) * 60000 - 30000;
    });
    if (!devidos.length) return { lidos: 0, devidos: 0, prox: (r.jogos || []).length };
    const urls = [...new Set(devidos.map((j) => j.url).filter(Boolean))];
    const rs = await lerVarias(urls);
    const porId = {}; rs.forEach((x) => x.jogos.forEach((j) => { porId[j.id] = j; }));
    const movs = [];
    devidos.forEach((d) => {
      const j = porId[d.id];
      if (j) movs.push({ id: d.id, liga: j.liga || d.liga, jogo: j.jogo, dia: j.dia, hora: j.hora, z: j.z, n: j.n, mz: j.mz });
    });
    const g = movs.length ? await enviarEmLotes('mov', movs) : 0;
    return { lidos: g, devidos: devidos.length };
  }

  (async function loopPiloto() {
    await new Promise((r) => setTimeout(r, 45000));     // deixa a primeira varredura dos Favoritos rodar
    let ultBusca = 0;
    while (true) {
      try {
        if (souDono()) {
          if (Date.now() - ultBusca > PIL_BUSCA_MIN * 60000) { const n = await pilotoBuscar(); ultBusca = Date.now(); log('piloto: busca', n); }
          const r = await pilotoLer();
          const hh = new Date().toLocaleTimeString('pt-BR').slice(0, 5);
          if (r.devidos) log('piloto: ' + r.lidos + '/' + r.devidos + ' leituras ' + hh);
          badge.title = 'Piloto 0%: ' + r.lidos + '/' + r.devidos + ' leituras às ' + hh;
        }
      } catch (e) { log('piloto: erro', e); }
      limparFila();
      await new Promise((r) => setTimeout(r, 60000));
    }
  })();
})();
