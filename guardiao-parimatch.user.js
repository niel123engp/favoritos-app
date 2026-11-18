// ==UserScript==
// @name         Guardião Favoritos — odds Parimatch
// @namespace    favoritos
// @updateURL    https://niel123engp.github.io/favoritos-app/guardiao-parimatch.user.js
// @downloadURL  https://niel123engp.github.io/favoritos-app/guardiao-parimatch.user.js
// @version      1.3
// @description  Lê as odds 1x2 (margem 0%) e marca se há pagamento antecipado (2UP) nos jogos do dia na Parimatch e grava na planilha "Favorito e odds de valor". Só lê; nunca aposta.
// @match        https://parimatch-hub.bet/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  // ======== CONFIG ========
  const API = 'https://script.google.com/macros/s/AKfycbz1ZowgfolCmH6HWEH49olOa4p2WZASaI8r8uNgl922SOBMxCg10GNOQ5dB_phDy83L-w/exec';
  // A chave NÃO fica neste arquivo (ele é público). Na primeira vez o guardião pergunta e guarda no Chrome.
  let KEY = localStorage.getItem('guard.key') || '';
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
  function lerEvento(id, timeoutMs = 25000) {
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
        const pronto = i > 0 && (nums.length >= 6 || (nums.length >= 3 && !bloco.includes('0% margem')));
        if (pronto || Date.now() - t0 > timeoutMs) {
          clearInterval(iv); f.remove();
          if (!pronto) return res(null);
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
      const ev = await lerEvento(id, 15000);
      if (!ev) continue;
      const [tc, tf] = ev.titulo.split(/\s+x\s+/i);
      if (tc && tf && bate(tc, casa) && bate(tf, fora)) {
        cache.m[jogo] = { id, liga: ev.liga };
        localStorage.setItem(CACHE, JSON.stringify(cache));
        return cache.m[jogo];
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
          const o = await lerEvento(ev.id);
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
      await new Promise((r) => setTimeout(r, esperar * 60000));
    }
  })();
})();
