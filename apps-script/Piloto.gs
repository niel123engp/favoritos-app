/**
 * Piloto.gs — Piloto de movimentação de odds (jogos com margem 0% na Parimatch).
 * Abas: 'Monitor 0%' (lista de jogos), 'Movimentos' (cada leitura), 'Deriva' (resumo por jogo, fórmulas),
 * 'Padrões' (cruzamentos, fórmulas). Só observa e registra: não mexe no método Favoritos.
 * Entrada pela API (Api.gs → doGet): ?monitor=<json> (lança/atualiza jogos), ?mov=<json> (grava leituras),
 * ?listaMonitor=1 (devolve os jogos ativos para o guardião).
 */
const PIL = {
  MON: 'Monitor 0%', MOV: 'Movimentos', DER: 'Deriva', PAD: 'Padrões',
  CAB_MON: ['ID', 'Liga', 'Início', 'Mandante', 'Visitante', 'URL liga', 'Visto 1ª vez', 'Última leitura', 'Leituras', 'Status', 'Gols casa', 'Gols fora', 'Resultado', 'Margem 0% (última)'],
  CAB_MOV: ['Lido em', 'ID', 'Liga', 'Jogo', 'Início', 'Min p/ apito', '1 (0%)', 'X (0%)', '2 (0%)', '1 normal', 'X normal', '2 normal', 'Margem 0%', 'Soma inversas', 'Origem']
};

function pilAba_(nome, cab) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function pilData_(dia, hora) {
  // dia: 'dd/MM/yyyy' ; hora 'HH:mm' (horário de Brasília)
  const p = String(dia).split('/'), h = String(hora).split(':');
  return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]), Number(h[0]), Number(h[1]));
}

/** Lança ou atualiza jogos na aba Monitor 0%. lista: [{id, liga, dia, hora, home, away, url, z}] */
function pilMonitor_(lista) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = pilAba_(PIL.MON, PIL.CAB_MON);
    const n = sh.getLastRow();
    const ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
    const agora = new Date();
    let novos = 0, atual = 0;
    const add = [];
    lista.forEach(j => {
      const ini = pilData_(j.dia, j.hora);
      const i = ids.indexOf(String(j.id));
      if (i < 0) {
        add.push([j.id, j.liga, ini, j.home, j.away, j.url || '', agora, '', 0, 'ATIVO', '', '', '', j.z ? 'SIM' : 'NÃO']);
        ids.push(String(j.id)); novos++;
      } else {
        // horário pode mudar (remarcação)
        sh.getRange(i + 2, 3).setValue(ini);
        if (j.url) sh.getRange(i + 2, 6).setValue(j.url);
        sh.getRange(i + 2, 14).setValue(j.z ? 'SIM' : 'NÃO');
        atual++;
      }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
    if (add.length) { sh.getRange(2, 3, sh.getLastRow() - 1, 1).setNumberFormat('dd/MM HH:mm'); sh.getRange(2, 7, sh.getLastRow() - 1, 2).setNumberFormat('dd/MM HH:mm'); }
    return { novos: novos, atualizados: atual };
  } finally { lock.releaseLock(); }
}

/** Grava leituras. lista: [{id, liga, jogo, dia, hora, z:[1,X,2], n:[1,X,2], mz:bool}] */
function pilMov_(lista, origem) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const mov = pilAba_(PIL.MOV, PIL.CAB_MOV);
    const mon = pilAba_(PIL.MON, PIL.CAB_MON);
    const nM = mon.getLastRow();
    const dm = nM > 1 ? mon.getRange(2, 1, nM - 1, 10).getValues() : [];
    const pos = {}; dm.forEach((r, i) => pos[String(r[0])] = i);
    const agora = new Date();
    const linhas = [];
    lista.forEach(j => {
      const ini = pilData_(j.dia, j.hora);
      const min = Math.round((ini - agora) / 60000);
      const z = j.z || ['', '', ''], nn = j.n || ['', '', ''];
      const soma = z[0] && z[1] && z[2] ? (1 / z[0] + 1 / z[1] + 1 / z[2]) : '';
      linhas.push([agora, j.id, j.liga, j.jogo, ini, min, z[0], z[1], z[2], nn[0], nn[1], nn[2], j.mz ? 'SIM' : 'NÃO', soma, origem || 'guardião']);
      const i = pos[String(j.id)];
      if (i !== undefined) {
        mon.getRange(i + 2, 8).setValue(agora);
        mon.getRange(i + 2, 9).setValue(Number(dm[i][8] || 0) + 1);
        mon.getRange(i + 2, 14).setValue(j.mz ? 'SIM' : 'NÃO');
        dm[i][8] = Number(dm[i][8] || 0) + 1;
      }
    });
    if (linhas.length) {
      const r0 = mov.getLastRow() + 1;
      mov.getRange(r0, 1, linhas.length, linhas[0].length).setValues(linhas);
      mov.getRange(r0, 1, linhas.length, 1).setNumberFormat('dd/MM HH:mm');
      mov.getRange(r0, 5, linhas.length, 1).setNumberFormat('dd/MM HH:mm');
      mov.getRange(r0, 14, linhas.length, 1).setNumberFormat('0.000');
    }
    pilStatus_();
    return { gravadas: linhas.length };
  } finally { lock.releaseLock(); }
}

/** Marca INICIADO os jogos que já começaram. */
function pilStatus_() {
  const mon = pilAba_(PIL.MON, PIL.CAB_MON);
  const n = mon.getLastRow(); if (n < 2) return;
  const v = mon.getRange(2, 3, n - 1, 8).getValues();
  const agora = new Date();
  const st = v.map(r => [r[7] === 'ATIVO' && r[0] instanceof Date && r[0] <= agora ? 'INICIADO' : r[7]]);
  mon.getRange(2, 10, n - 1, 1).setValues(st);
}

/** Lista para o guardião: jogos ATIVOS (ou iniciados há < 5 min) com início nas próximas 30 h. */
function pilLista_() {
  pilStatus_();
  const mon = pilAba_(PIL.MON, PIL.CAB_MON);
  const n = mon.getLastRow(); if (n < 2) return [];
  const v = mon.getRange(2, 1, n - 1, 10).getValues();
  const agora = new Date();
  return v.filter(r => r[9] === 'ATIVO' && r[2] instanceof Date && (r[2] - agora) < 30 * 3600000)
    .map(r => ({ id: String(r[0]), liga: r[1], ini: r[2].getTime(), home: r[3], away: r[4], url: r[5], ult: r[7] instanceof Date ? r[7].getTime() : 0 }));
}

/** A planilha está em pt-BR: setFormula espera ";" entre argumentos e "," decimal. Converte fora das aspas duplas. */
function loc_(f) {
  let out = '', q = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"') { q = !q; out += ch; continue; }
    if (!q && ch === ',') { out += ';'; continue; }
    if (!q && ch === '.' && /\d/.test(f[i - 1] || '') && /\d/.test(f[i + 1] || '')) { out += ','; continue; }
    out += ch;
  }
  return out;
}

/** Cria/recria as abas de análise com fórmulas (pode rodar de novo sem perder dados). */
function pilotoMontar() {
  pilAba_(PIL.MON, PIL.CAB_MON);
  pilAba_(PIL.MOV, PIL.CAB_MOV);
  const ss = SpreadsheetApp.getActive();
  // ---------- Deriva: uma linha por jogo, tudo fórmula ----------
  let d = ss.getSheetByName(PIL.DER); if (!d) d = ss.insertSheet(PIL.DER); d.clear();
  const cabD = ['ID', 'Liga', 'Jogo', 'Início', 'Leituras', 'Fav (lado)', 'Favorito', 'Fav abertura', 'Fav fechamento', 'Var fav', 'X abertura', 'X fechamento', 'Var X', 'Zebra abertura', 'Zebra fechamento', 'Var zebra', 'Horas de histórico', 'Resultado', 'Fav venceu', 'Lucro fav abertura', 'Lucro fav fechamento', 'Encurtou', 'Faixa fav', 'Tipo'];
  d.getRange(1, 1, 1, cabD.length).setValues([cabD]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  d.setFrozenRows(1);
  const M = "'" + PIL.MOV + "'", MO = "'" + PIL.MON + "'";
  // IDs com pelo menos 1 leitura
  d.getRange('A2').setFormula(loc_('=IFERROR(FILTER(' + MO + '!A2:A, ' + MO + '!I2:I>0), "")'));
  d.getRange('B2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!B2:B, ""))))'));
  d.getRange('C2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!D2:D, "") & " x " & XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!E2:E, ""))))'));
  d.getRange('D2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!C2:C, ""))))'));
  d.getRange('E2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", COUNTIF(' + M + '!B2:B, i))))'));
  // abertura = primeira leitura com odds 0%; fechamento = última leitura com no máximo 0 min para o apito (antes do jogo)
  const ab = c => 'IFERROR(INDEX(FILTER(' + M + '!' + c + '2:' + c + ', ' + M + '!B2:B=i, ' + M + '!' + c + '2:' + c + '<>""), 1), "")';
  const fe = c => 'IFERROR(INDEX(SORT(FILTER(HSTACK(' + M + '!A2:A, ' + M + '!' + c + '2:' + c + '), ' + M + '!B2:B=i, ' + M + '!F2:F>=0, ' + M + '!' + c + '2:' + c + '<>""), 1, FALSE), 1, 2), "")';
  // lado do favorito pela abertura (menor odd entre 1 e 2)
  d.getRange('F2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", LET(a, ' + ab('G') + ', b, ' + ab('I') + ', IF(OR(a="", b=""), "", IF(a<=b, "CASA", "FORA"))))))'));
  d.getRange('G2').setFormula(loc_('=MAP(A2:A, F2:F, LAMBDA(i, l, IF(i="", "", IF(l="CASA", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!D2:D, ""), IF(l="FORA", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!E2:E, ""), "")))))'));
  d.getRange('H2').setFormula(loc_('=MAP(A2:A, F2:F, LAMBDA(i, l, IF(i="", "", IF(l="CASA", ' + ab('G') + ', IF(l="FORA", ' + ab('I') + ', "")))))'));
  d.getRange('I2').setFormula(loc_('=MAP(A2:A, F2:F, LAMBDA(i, l, IF(i="", "", IF(l="CASA", ' + fe('G') + ', IF(l="FORA", ' + fe('I') + ', "")))))'));
  d.getRange('J2').setFormula(loc_('=MAP(H2:H, I2:I, LAMBDA(a, b, IF(OR(a="", b=""), "", b/a-1)))'));
  d.getRange('K2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", ' + ab('H') + ')))'));
  d.getRange('L2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", ' + fe('H') + ')))'));
  d.getRange('M2').setFormula(loc_('=MAP(K2:K, L2:L, LAMBDA(a, b, IF(OR(a="", b=""), "", b/a-1)))'));
  d.getRange('N2').setFormula(loc_('=MAP(A2:A, F2:F, LAMBDA(i, l, IF(i="", "", IF(l="CASA", ' + ab('I') + ', IF(l="FORA", ' + ab('G') + ', "")))))'));
  d.getRange('O2').setFormula(loc_('=MAP(A2:A, F2:F, LAMBDA(i, l, IF(i="", "", IF(l="CASA", ' + fe('I') + ', IF(l="FORA", ' + fe('G') + ', "")))))'));
  d.getRange('P2').setFormula(loc_('=MAP(N2:N, O2:O, LAMBDA(a, b, IF(OR(a="", b=""), "", b/a-1)))'));
  d.getRange('Q2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", IFERROR((MAXIFS(' + M + '!F2:F, ' + M + '!B2:B, i) - MINIFS(' + M + '!F2:F, ' + M + '!B2:B, i, ' + M + '!F2:F, ">=0"))/60, ""))))'));
  d.getRange('R2').setFormula(loc_('=MAP(A2:A, LAMBDA(i, IF(i="", "", XLOOKUP(i, ' + MO + '!A2:A, ' + MO + '!M2:M, ""))))'));
  d.getRange('S2').setFormula(loc_('=MAP(F2:F, R2:R, LAMBDA(l, r, IF(OR(l="", r=""), "", IF(OR(AND(l="CASA", r="1"), AND(l="FORA", r="2")), 1, 0))))'));
  d.getRange('T2').setFormula(loc_('=MAP(H2:H, S2:S, LAMBDA(o, v, IF(OR(o="", v=""), "", IF(v=1, 100*(o-1), -100))))'));
  d.getRange('U2').setFormula(loc_('=MAP(I2:I, S2:S, LAMBDA(o, v, IF(OR(o="", v=""), "", IF(v=1, 100*(o-1), -100))))'));
  d.getRange('V2').setFormula(loc_('=MAP(J2:J, LAMBDA(v, IF(v="", "", IF(v<0, 1, 0))))'));
  d.getRange('W2').setFormula(loc_('=MAP(H2:H, LAMBDA(o, IF(o="", "", IF(o<1.3, "<1,30", IF(o<1.5, "1,30-1,49", IF(o<1.7, "1,50-1,69", IF(o<1.9, "1,70-1,89", IF(o<2.2, "1,90-2,19", "2,20+"))))))))'));
  d.getRange('X2').setFormula(loc_('=MAP(B2:B, LAMBDA(l, IF(l="", "", IF(REGEXMATCH(LOWER(l), "copa|cup|taça|pokal|coupe|coppa|libertadores|sul-americana|champions|europa league|conference"), "Copa", "Liga"))))'));
  d.getRange('D2:D').setNumberFormat('dd/MM HH:mm');
  ['J2:J', 'M2:M', 'P2:P'].forEach(r => d.getRange(r).setNumberFormat('+0.0%;-0.0%;0.0%'));
  d.getRange('Q2:Q').setNumberFormat('0.0');
  d.getRange('T2:U').setNumberFormat('#,##0');

  // ---------- Padrões ----------
  let p = ss.getSheetByName(PIL.PAD); if (!p) p = ss.insertSheet(PIL.PAD); p.clear();
  const D = "'" + PIL.DER + "'";
  p.getRange('A1').setValue('PADRÕES DE MOVIMENTAÇÃO — piloto margem 0% (n < 30 = pouca confiança)').setFontWeight('bold').setFontSize(13);
  const bloco = (cel, titulo, chave) => {
    p.getRange(cel).setValue(titulo).setFontWeight('bold');
    const r = p.getRange(cel).getRow() + 1, c = p.getRange(cel).getColumn();
    p.getRange(r, c).setFormula(loc_('=IFERROR(QUERY(' + D + '!A2:X, "select ' + chave + ', count(A), avg(J), sum(V), avg(M), avg(P), sum(T), sum(U), count(S) where A is not null and J is not null group by ' + chave + ' order by count(A) desc label ' + chave + ' \'' + titulo + '\', count(A) \'n jogos\', avg(J) \'var fav média\', sum(V) \'nº encurtou\', avg(M) \'var X média\', avg(P) \'var zebra média\', sum(T) \'lucro fav abertura\', sum(U) \'lucro fav fechamento\', count(S) \'com resultado\'", 0), "sem dados ainda")'));
  };
  bloco('A3', 'Liga', 'B');
  bloco('L3', 'Faixa fav (abertura)', 'W');
  bloco('L14', 'Tipo', 'X');
  bloco('L22', 'Favorito (time)', 'G');
  p.getRange('A2').setValue('Var fav negativa = odd do favorito caiu até o apito. Lucro = stake fixa R$ 100 no favorito, na abertura ou no fechamento.').setFontColor('#64748b');
  return 'ok';
}

function pilotoTeste() {
  Logger.log(JSON.stringify(pilLista_().slice(0, 3)));
}
