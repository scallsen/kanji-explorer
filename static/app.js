/* Kanji Explorer front end.
 *
 * Primary flow: pick a kanji -> see it large + the radicals it is made of ->
 * click a radical -> every kanji using it -> click one of those -> repeat.
 * Secondary tabs: related kanji, words, an incrementally-expanding graph, and
 * the freeform "Ask AI" box (Claude-generated Cypher).
 *
 * Every graph query goes through POST /api/query (fixed Cypher templates) and
 * is executed inside the Daytona sandbox on the server; the console strip at
 * the bottom shows what ran and how long it took.
 */

const $ = (id) => document.getElementById(id);

// ── state ────────────────────────────────────────────────────────────────
let KANJI = [];            // [{char, grade, readings, meanings}]
const META = new Map();    // char -> kanji record
let current = null;        // selected kanji char
let trail = [];            // drill-down path of kanji chars
let currentRadical = null; // radical whose users are listed
let activeTab = 'graph';
const loaded = new Set();  // "tab:char" keys already fetched
const cache = new Map();   // intent|params -> rows

// ── api ──────────────────────────────────────────────────────────────────
async function query(intent, params) {
  const key = intent + '|' + JSON.stringify(params);
  if (cache.has(key)) {
    conSet('ok', `${intent}(${Object.values(params).join(', ')})`, 'cached', cache.get(key).cypher, cache.get(key).rows.length);
    return cache.get(key).rows;
  }
  conSet('busy', `${intent}(${Object.values(params).join(', ')})`, 'running in Daytona sandbox…');
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, params }),
  });
  const data = await res.json();
  if (!res.ok) {
    conSet('err', `${intent}(${Object.values(params).join(', ')})`, data.error || 'failed');
    throw new Error(data.error || 'request failed');
  }
  cache.set(key, data);
  conSet('ok', `${intent}(${Object.values(params).join(', ')})`, `${data.elapsed_ms} ms`, data.cypher, data.rows.length);
  return data.rows;
}

// ── console strip ────────────────────────────────────────────────────────
function conSet(state, label, meta, cypher, rowCount) {
  $('conDot').className = 'dot ' + state;
  $('conMsg').innerHTML = `<b>${esc(label)}</b>` + (state === 'busy' ? ' · sandbox ▸ neo4j' : '');
  $('conMeta').innerHTML = (rowCount != null ? `<b>${rowCount}</b> rows · ` : '') + esc(meta || '');
  if (cypher) {
    $('conCypher').textContent = cypher;
    $('conToggle').hidden = false;
  } else if (state === 'busy') {
    $('conToggle').hidden = true;
    $('conBody').hidden = true;
  }
}
$('conToggle').addEventListener('click', () => { $('conBody').hidden = !$('conBody').hidden; });

// ── helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const isKatakana = (s) => /^[゠-ヿ]+$/.test(s.replace(/[.\-]/g, ''));
function meaningOf(char) { const m = META.get(char); return m && m.meanings ? m.meanings[0] : ''; }

function kanjiTile(char, opts = {}) {
  const b = document.createElement('button');
  b.className = 'tile' + (opts.cls ? ' ' + opts.cls : '');
  b.lang = 'ja';
  b.title = [char, meaningOf(char) || opts.meaning].filter(Boolean).join(' — ');
  const m = META.get(char);
  b.innerHTML = `${(m && m.grade) ? `<span class="g">G${m.grade}</span>` : ''}${esc(char)}<small>${esc(opts.caption ?? (meaningOf(char) || opts.meaning || ''))}</small>`;
  b.addEventListener('click', () => selectKanji(char, { push: true }));
  return b;
}

// ── picker: search + browse ──────────────────────────────────────────────
const search = $('search');
const suggest = $('suggest');
let hl = -1;

function matches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const k of KANJI) {
    let score = 0;
    if (k.char === q) score = 100;
    else if (k.meanings.some((m) => m.toLowerCase() === q)) score = 80;
    else if (k.meanings.some((m) => m.toLowerCase().startsWith(q))) score = 60;
    else if (k.readings.some((r) => r.replace('.', '').startsWith(q))) score = 50;
    else if (k.meanings.some((m) => m.toLowerCase().includes(q))) score = 30;
    if (score) out.push([score, k]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].grade - b[1].grade).slice(0, 12).map((x) => x[1]);
}

function renderSuggest() {
  const hits = matches(search.value);
  suggest.innerHTML = '';
  hl = -1;
  if (!hits.length) { suggest.hidden = true; return; }
  hits.forEach((k) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="sk" lang="ja">${esc(k.char)}</span><span class="sm">${esc(k.meanings.join(', '))}</span><span class="sr" lang="ja">${esc(k.readings.slice(0, 3).join(' '))} · G${k.grade}</span>`;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(k.char); });
    suggest.appendChild(b);
  });
  suggest.hidden = false;
}
function pick(char) {
  search.value = '';
  suggest.hidden = true;
  selectKanji(char, { reset: true });
}
search.addEventListener('input', renderSuggest);
search.addEventListener('focus', renderSuggest);
search.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 120));
search.addEventListener('keydown', (e) => {
  const items = [...suggest.querySelectorAll('button')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((b, i) => b.classList.toggle('hl', i === hl));
    items[hl].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const hits = matches(search.value);
    if (!hits.length) return;
    pick(hits[Math.max(hl, 0)].char);
  } else if (e.key === 'Escape') {
    suggest.hidden = true;
  }
});

let browseGrade = 1;
function renderBrowse() {
  const list = KANJI.filter((k) => k.grade === browseGrade);
  $('browseCount').textContent = `${list.length} kanji`;
  const grid = $('browseGrid');
  grid.innerHTML = '';
  list.forEach((k) => grid.appendChild(kanjiTile(k.char)));
}
document.querySelectorAll('.chip[data-grade]').forEach((c) => c.addEventListener('click', () => {
  browseGrade = Number(c.dataset.grade);
  document.querySelectorAll('.chip[data-grade]').forEach((x) => x.classList.toggle('on', x === c));
  renderBrowse();
}));

// ── detail: hero + made-of ───────────────────────────────────────────────
async function selectKanji(char, { push = false, reset = false } = {}) {
  if (!META.has(char)) return;
  if (reset) trail = [char];
  else if (push) { if (trail[trail.length - 1] !== char) trail.push(char); }
  else if (!trail.includes(char)) trail.push(char);
  current = char;
  currentRadical = null;

  const m = META.get(char);
  $('heroChar').textContent = char;
  $('heroGrade').textContent = `GRADE ${m.grade}`;
  $('heroMeaning').textContent = m.meanings[0] || '';
  $('heroAlt').textContent = m.meanings.slice(1).join(' · ');
  $('heroOn').textContent = m.readings.filter(isKatakana).join('  ') || '—';
  $('heroKun').textContent = m.readings.filter((r) => !isKatakana(r)).join('  ') || '—';
  $('relatedChar').textContent = char;
  $('wordsChar').textContent = char;
  $('radResults').hidden = true;
  $('radHint').textContent = 'Hover a radical to see how many other kanji use it. Click it to list them.';
  $('radHint').className = 'hint';

  $('browse').hidden = true;
  $('detail').hidden = false;
  renderTrail();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // made-of equation
  const eq = $('equation');
  eq.innerHTML = `<div class="eq-k" lang="ja">${esc(char)}</div><span class="op">=</span><span class="none blink">querying…</span>`;
  let rows;
  try {
    rows = await query('components', { kanji: char });
  } catch (e) {
    eq.innerHTML = `<div class="eq-k" lang="ja">${esc(char)}</div><span class="op">=</span><span class="none">error: ${esc(e.message)}</span>`;
    return;
  }
  if (current !== char) return; // user moved on while we waited
  eq.innerHTML = `<div class="eq-k" lang="ja">${esc(char)}</div><span class="op">=</span>`;
  if (!rows.length) {
    eq.insertAdjacentHTML('beforeend', '<span class="none">itself — this kanji is its own radical</span>');
  }
  rows.forEach((r, i) => {
    if (i) eq.insertAdjacentHTML('beforeend', '<span class="op">+</span>');
    const b = document.createElement('button');
    b.className = 'rad';
    b.lang = 'ja';
    b.dataset.radical = r.char;
    b.innerHTML = `${esc(r.char)}<small>${r.others} other</small>`;
    b.addEventListener('mouseenter', () => {
      if (net && gNodes.get('r:' + r.char)) setDim('r:' + r.char); // echo in the graph
      if (currentRadical) return;
      $('radHint').textContent = `${r.char} appears in ${r.others} other kanji in this set. Click to see them.`;
    });
    b.addEventListener('mouseleave', () => {
      if (net) setDim(null);
      if (currentRadical) return;
      $('radHint').textContent = 'Hover a radical to see how many other kanji use it. Click it to list them.';
    });
    b.addEventListener('click', () => showRadical(r.char, b));
    eq.appendChild(b);
  });

  // secondary tabs: reload whichever is open, others lazily
  loadTab(activeTab);
}

async function showRadical(radical, btn) {
  currentRadical = radical;
  document.querySelectorAll('.rad').forEach((b) => b.classList.toggle('on', b === btn));
  btn.classList.add('busy');
  $('radHint').textContent = `Looking up every kanji that contains ${radical}…`;
  const box = $('radResults');
  const grid = $('radResultsGrid');
  try {
    const rows = await query('kanji_by_radical', { radical });
    if (currentRadical !== radical) return;
    const others = rows.filter((r) => r.char !== current);
    $('radResultsChar').textContent = radical;
    $('radResultsCount').textContent = `${others.length} kanji`;
    grid.innerHTML = '';
    others.forEach((r) => grid.appendChild(kanjiTile(r.char, { meaning: r.meaning })));
    box.hidden = false;
    $('radHint').textContent = `${others.length} other kanji contain ${radical}. Click one to keep going.`;
    $('radHint').className = 'hint';
  } catch (e) {
    $('radHint').textContent = 'Error: ' + e.message;
    $('radHint').className = 'hint err';
  } finally {
    btn.classList.remove('busy');
  }
}

function renderTrail() {
  const t = $('trail');
  t.innerHTML = '';
  trail.forEach((c, i) => {
    if (i) t.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
    if (i === trail.length - 1) {
      t.insertAdjacentHTML('beforeend', `<span class="cur" lang="ja">${esc(c)}</span>`);
    } else {
      const b = document.createElement('button');
      b.lang = 'ja';
      b.textContent = c;
      b.title = meaningOf(c);
      b.addEventListener('click', () => { trail = trail.slice(0, i + 1); selectKanji(c); });
      t.appendChild(b);
    }
  });
  const back = document.createElement('button');
  back.className = 'btn ghost back';
  back.textContent = '← pick another kanji';
  back.addEventListener('click', () => {
    $('detail').hidden = true;
    $('browse').hidden = false;
    current = null;
    search.focus();
  });
  t.appendChild(back);
}

// ── tabs ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  activeTab = b.dataset.tab;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
  loadTab(activeTab);
}));

function loadTab(tab) {
  if (!current) return;
  const key = tab + ':' + current;
  if (tab === 'related' && !loaded.has(key)) { loaded.add(key); loadRelated(current); }
  if (tab === 'words' && !loaded.has(key)) { loaded.add(key); loadWords(current); }
  if (tab === 'graph') {
    if (!graphHas(current) || !expanded.has('k:' + current)) seedGraph(current); else focusGraph(current);
  }
}

async function loadRelated(char) {
  const grid = $('relatedGrid');
  grid.innerHTML = '';
  $('relatedHint').textContent = 'querying…';
  try {
    const rows = await query('shared_radical', { kanji: char });
    if (current !== char) return;
    $('relatedHint').textContent = rows.length ? `${rows.length} kanji, most shared radicals first` : 'Nothing shares a radical with this one.';
    rows.forEach((r) => grid.appendChild(kanjiTile(r.char, { meaning: r.meaning, caption: 'via ' + r.via.join('') })));
  } catch (e) {
    loaded.delete('related:' + char);
    $('relatedHint').textContent = 'Error: ' + e.message;
  }
}

async function loadWords(char) {
  const list = $('wordsList');
  list.innerHTML = '';
  $('wordsHint').textContent = 'querying…';
  try {
    const rows = await query('words', { kanji: char });
    if (current !== char) return;
    $('wordsHint').textContent = rows.length ? '' : 'No words in the set use this kanji.';
    rows.forEach((r) => {
      list.insertAdjacentHTML('beforeend', `<li><b lang="ja">${esc(r.text)}</b><span>${esc(r.meaning)}</span></li>`);
    });
  } catch (e) {
    loaded.delete('words:' + char);
    $('wordsHint').textContent = 'Error: ' + e.message;
  }
}

// ── explore graph (vis-network, expands on click) ────────────────────────
// Every radical gets its own colour (PICO-8 palette, brand red excluded) and
// its edges inherit it, so "which radical links these two kanji" is readable
// at a glance. Unexplored nodes have a dashed border; hovering a node dims
// everything that isn't its neighbourhood and fills the HUD.
let net = null;
const gNodes = new vis.DataSet();
const gEdges = new vis.DataSet();
const expanded = new Set();
const radColor = new Map();       // radical char -> colour
const moreOffset = new Map();     // radical char -> how many kanji already shown
const RAD_PALETTE = ['#FFA300', '#29ADFF', '#00E436', '#FFEC27', '#FF77A8', '#83769C', '#FFCCAA', '#AB5236', '#008751', '#1D2B53'];
const RAD_BATCH = 12;
const C = { kanjiBg: '#313131', kanjiBorder: '#C2C3C7', text: '#E8E8E8', cur: '#FF004D', curBg: '#4a1020', dim: 0.15 };

function colorFor(radical) {
  if (!radColor.has(radical)) radColor.set(radical, RAD_PALETTE[radColor.size % RAD_PALETTE.length]);
  return radColor.get(radical);
}
function kanjiNode(c) {
  const isCur = c === current;
  return {
    id: 'k:' + c, label: c, kind: 'kanji',
    font: { size: isCur ? 28 : 22, color: isCur ? '#fff' : C.text },
    color: nodeColor(isCur ? C.cur : C.kanjiBorder, isCur ? C.curBg : C.kanjiBg),
    shapeProperties: { borderRadius: 0, borderDashes: expanded.has('k:' + c) ? false : [6, 4] },
    borderWidth: isCur ? 3 : 2,
  };
}
function radicalNode(c, others) {
  const col = colorFor(c);
  const n = {
    id: 'r:' + c, label: c, kind: 'radical',
    font: { size: 16, color: col },
    color: nodeColor(col, '#222'),
    shapeProperties: { borderRadius: 0, borderDashes: expanded.has('r:' + c) ? false : [6, 4] },
    borderWidth: 2,
  };
  if (others != null) n.others = others;
  return n;
}
function moreNode(radical, remaining) {
  return {
    id: 'more:' + radical, label: `+${remaining} more`, kind: 'more', radical,
    font: { size: 12, color: '#888' }, color: nodeColor('#4A4A4A', '#1E1E1E'),
    shapeProperties: { borderRadius: 0, borderDashes: [3, 3] }, borderWidth: 2,
  };
}
function nodeColor(border, background) {
  return { border, background, highlight: { border: '#fff', background }, hover: { border: '#fff', background } };
}
function edgeFor(kanji, radical) {
  const col = colorFor(radical);
  return { id: `k:${kanji}>r:${radical}`, from: 'k:' + kanji, to: 'r:' + radical, radical, color: { color: col, opacity: 0.55, highlight: col, hover: col } };
}

function graphHas(char) { return gNodes.get('k:' + char) != null; }
function placeNear(parentId) {
  if (!net || !parentId || !gNodes.get(parentId)) return {};
  const pos = net.getPositions([parentId])[parentId];
  if (!pos) return {};
  return { x: pos.x + (Math.random() - 0.5) * 120, y: pos.y + (Math.random() - 0.5) * 120 };
}
function addNode(n, nearId) {
  if (gNodes.get(n.id)) return false;
  gNodes.add(Object.assign(n, placeNear(nearId)));
  return true;
}
function addEdge(e) { if (!gEdges.get(e.id)) gEdges.add(e); }
// after nodes are added, let physics settle then bring everything back into view
let fitTimer = null;
function fitSoon() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => { if (net) net.fit({ animation: { duration: 500 } }); }, 900);
}
function refreshNode(id) {
  const n = gNodes.get(id);
  if (!n) return;
  if (n.kind === 'kanji') gNodes.update(kanjiNode(n.label));
  else if (n.kind === 'radical') gNodes.update(radicalNode(n.label, n.others));
}
function markCurrent() { gNodes.forEach((n) => { if (n.kind === 'kanji') refreshNode(n.id); }); }

// hover: dim everything outside the hovered node's neighbourhood
function setDim(hoverId) {
  const keep = new Set();
  if (hoverId) {
    keep.add(hoverId);
    net.getConnectedNodes(hoverId).forEach((id) => keep.add(id));
  }
  gNodes.update(gNodes.map((n) => ({ id: n.id, opacity: !hoverId || keep.has(n.id) ? 1 : C.dim })));
  gEdges.update(gEdges.map((e) => {
    const on = !hoverId || e.from === hoverId || e.to === hoverId;
    return { id: e.id, color: Object.assign({}, e.color, { opacity: on ? (hoverId ? 1 : 0.55) : 0.06 }), width: on && hoverId ? 3 : 2 };
  }));
}
function hud(id) {
  const n = id ? gNodes.get(id) : null;
  const openBtn = $('hudOpen');
  document.querySelectorAll('.rad.hot').forEach((b) => b.classList.remove('hot'));
  if (!n) {
    $('hudChar').textContent = '';
    $('hudTitle').textContent = 'Explore';
    $('hudSub').innerHTML = 'Click a node to expand it. Double-click a kanji to open it.';
    openBtn.hidden = true;
    return;
  }
  if (n.kind === 'kanji') {
    const m = META.get(n.label);
    $('hudChar').textContent = n.label;
    $('hudTitle').textContent = (m && m.meanings[0]) || n.label;
    const rads = net.getConnectedNodes(id).filter((x) => x.startsWith('r:')).map((x) => x.slice(2));
    $('hudSub').innerHTML = `grade ${m ? m.grade : '?'}${rads.length ? ' · made of <b>' + esc(rads.join(' ')) + '</b>' : ''}${expanded.has(id) ? '' : ' · click to expand'}`;
    openBtn.hidden = n.label === current;
    openBtn.textContent = 'open ' + n.label;
    openBtn.onclick = () => selectKanji(n.label, { push: true });
  } else if (n.kind === 'radical') {
    $('hudChar').textContent = n.label;
    $('hudTitle').textContent = 'radical ' + n.label;
    const shown = net.getConnectedNodes(id).filter((x) => x.startsWith('k:')).length;
    $('hudSub').innerHTML = `${n.others != null ? `used in <b>${n.others + 1}</b> kanji · ` : ''}${shown} in view${expanded.has(id) ? '' : ' · click to expand'}`;
    openBtn.hidden = true;
    document.querySelectorAll('.rad').forEach((b) => { if (b.dataset.radical === n.label) b.classList.add('hot'); });
  } else {
    $('hudChar').textContent = '';
    $('hudTitle').textContent = n.label;
    $('hudSub').textContent = 'click to add the next batch of kanji using ' + n.radical;
    openBtn.hidden = true;
  }
}

function ensureNet() {
  if (net) return;
  net = new vis.Network($('graph'), { nodes: gNodes, edges: gEdges }, {
    nodes: { shape: 'box', margin: 8, font: { face: 'DotGothic16' }, chosen: { node: (v) => { v.borderWidth = 3; }, label: false } },
    edges: { width: 2, smooth: false, selectionWidth: 1, hoverWidth: 1 },
    physics: {
      solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -45, centralGravity: 0.008, springLength: 100, springConstant: 0.06, avoidOverlap: 0.7 },
      stabilization: { iterations: 120 },
    },
    interaction: { hover: true, tooltipDelay: 999999, multiselect: false },
  });
  net.on('hoverNode', (p) => { setDim(p.node); hud(p.node); });
  net.on('blurNode', () => { setDim(null); hud(null); });
  net.on('click', async (p) => {
    if (!p.nodes.length) return;
    const id = p.nodes[0];
    hud(id);
    if (id.startsWith('more:')) { await expandRadical(id.slice(5)); hud(null); return; }
    if (expanded.has(id)) return;
    try {
      if (id.startsWith('k:')) await expandKanji(id.slice(2));
      else await expandRadical(id.slice(2));
      hud(id);
    } catch (e) { /* console strip already shows the error */ }
  });
  net.on('doubleClick', (p) => {
    if (!p.nodes.length) return;
    const id = p.nodes[0];
    if (id.startsWith('k:')) selectKanji(id.slice(2), { push: true });
  });
}

async function expandKanji(c) {
  const rows = await query('components', { kanji: c });
  expanded.add('k:' + c);
  refreshNode('k:' + c);
  rows.forEach((r) => {
    addNode(radicalNode(r.char, r.others), 'k:' + c);
    if (r.others != null) gNodes.update({ id: 'r:' + r.char, others: r.others });
    addEdge(edgeFor(c, r.char));
  });
  fitSoon();
}
async function expandRadical(c) {
  const rows = (await query('kanji_by_radical', { radical: c })).filter((r) => r.char !== c);
  expanded.add('r:' + c);
  refreshNode('r:' + c);
  const start = moreOffset.get(c) || 0;
  const batch = rows.slice(start, start + RAD_BATCH);
  batch.forEach((r) => { addNode(kanjiNode(r.char), 'r:' + c); addEdge(edgeFor(r.char, c)); });
  const shown = start + batch.length;
  moreOffset.set(c, shown);
  if (gEdges.get('more:' + c + '>')) gEdges.remove('more:' + c + '>');
  if (gNodes.get('more:' + c)) gNodes.remove('more:' + c);
  if (shown < rows.length) {
    addNode(moreNode(c, rows.length - shown), 'r:' + c);
    gEdges.add({ id: 'more:' + c + '>', from: 'more:' + c, to: 'r:' + c, color: { color: '#4A4A4A', opacity: 0.4 }, dashes: true });
  }
  fitSoon();
}
async function seedGraph(char) {
  ensureNet();
  addNode(kanjiNode(char), trail.length > 1 ? 'k:' + trail[trail.length - 2] : null);
  markCurrent();
  // radicals are shared node ids, so a kanji reached by drilling through a
  // radical lands already linked to it -- the graph mirrors the trail.
  try { await expandKanji(char); } catch (e) { /* shown in console strip */ }
  fitSoon();
}
function focusGraph(char) {
  ensureNet();
  markCurrent();
  net.focus('k:' + char, { scale: 1.1, animation: { duration: 300 } });
}
$('graphReset').addEventListener('click', () => {
  gNodes.clear(); gEdges.clear(); expanded.clear(); moreOffset.clear(); radColor.clear();
  hud(null);
  if (current) seedGraph(current);
});
$('graphFit').addEventListener('click', () => { if (net) net.fit({ animation: { duration: 400 } }); });

// ── ask AI (freeform -> Claude -> Cypher -> sandbox) ─────────────────────
async function askAI() {
  const question = $('askInput').value.trim();
  if (!question) return;
  $('askBtn').disabled = true;
  $('askHint').innerHTML = '<span class="blink">Claude is writing Cypher…</span>';
  $('askAnswer').textContent = '';
  $('askRows').innerHTML = '';
  $('askCypherWrap').hidden = true;
  conSet('busy', 'ask', 'Claude → Cypher → Daytona sandbox');
  try {
    const res = await fetch('/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'request failed');
    $('askHint').textContent = `${data.rows.length} rows`;
    $('askAnswer').textContent = data.answer;
    $('askCypher').textContent = data.cypher;
    $('askCypherWrap').hidden = false;
    // any kanji chars in the results become clickable tiles
    const chars = new Set();
    data.rows.forEach((r) => Object.values(r).forEach((v) => { if (typeof v === 'string' && META.has(v)) chars.add(v); }));
    [...chars].slice(0, 30).forEach((c) => $('askRows').appendChild(kanjiTile(c)));
    conSet('ok', 'ask', 'done', data.cypher, data.rows.length);
  } catch (e) {
    $('askHint').textContent = '';
    $('askAnswer').textContent = 'Error: ' + e.message;
    conSet('err', 'ask', e.message);
  } finally {
    $('askBtn').disabled = false;
  }
}
$('askBtn').addEventListener('click', askAI);
$('askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') askAI(); });

// ── boot ─────────────────────────────────────────────────────────────────
async function init() {
  KANJI = await fetch('/api/kanji').then((r) => r.json());
  KANJI.forEach((k) => META.set(k.char, k));
  renderBrowse();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && META.has(hash)) selectKanji(hash, { reset: true });
  else search.focus();
}
init();
