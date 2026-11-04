/* =====================================================================
   醫護教育創意設計大賞｜app.js — 主要互動邏輯
   所有投票資格、防重複、狀態與計票均由後端（Supabase 資料庫函式）判定；
   前端只負責呈現與送出，不以 localStorage 作為任何防重複依據。
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.AWARDS_CONFIG || {};
  const AW = (window.AW = {});

  /* ------------------------------------------------------------------
     1. 共用工具
     ------------------------------------------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtTime(ts, withDate = true) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return withDate ? `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${t}` : t;
  }
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  }

  const STATUS = {
    setup: { label: '投票尚未開始', short: '尚未開始', en: 'Not Started' },
    open: { label: '投票進行中', short: '進行中', en: 'Voting Open' },
    paused: { label: '投票暫停中', short: '暫停中', en: 'Paused' },
    closed: { label: '投票已結束', short: '已結束', en: 'Closed' },
  };
  const CAT = {
    pres: { label: '簡報組', en: 'Presentation Awards', title: '簡報組｜最佳簡報作品票選', ceremony: '簡報組頒獎典禮' },
    poster: { label: '海報組', en: 'Poster Awards', title: '海報組｜最佳海報作品票選', ceremony: '海報組頒獎典禮' },
  };
  const PLACE = {
    1: { zh: '第一名', en: 'Gold Award', metal: 'gold' },
    2: { zh: '第二名', en: 'Silver Award', metal: 'silver' },
    3: { zh: '第三名', en: 'Bronze Award', metal: 'bronze' },
  };

  const ERR = {
    INVALID_CODE: '投票代碼無效，請確認後重新輸入。',
    NOT_ELIGIBLE: '此代碼目前沒有投票資格，請洽詢教師。',
    TOO_MANY_ATTEMPTS: '嘗試次數過多，請稍候一分鐘再試。',
    VOTING_NOT_STARTED: '投票尚未開始，請等待教師開放。',
    VOTING_PAUSED: '投票暫停中，請稍候教師重新開放。',
    VOTING_CLOSED: '投票已結束，無法再提交選票。',
    ALREADY_VOTED: '您已完成投票，無法再次投票。',
    INVALID_SELECTION: '選票內容不完整：每個類別都必須選擇 3 個不同組別。',
    SELF_VOTE_NOT_ALLOWED: '不可投給自己所屬的組別。',
    NOT_ADMIN: '此帳號沒有教師管理權限。',
    BAD_TRANSITION: '目前的投票狀態無法執行此操作，畫面已重新整理。',
    LOCKED_AFTER_START: '投票開始後，名單、投票資格與投票規則已鎖定，無法修改。',
    NOT_CLOSED: '請先結束投票。',
    TIE_NEEDS_DECISION: '此類別前三名有同票，請先選擇「並列名次」或「加賽後指定名次」。',
    ORDER_CONFLICTS_WITH_VOTES: '指定的名次與實際票數不符：只能在同票的組別之間調整順序。',
    BAD_ORDER: '名次設定不完整，請為每個名次選擇不同的組別。',
    DUPLICATE_ID: '學號或識別編號重複。',
    EMPTY_NAME: '名稱不可空白。',
    BAD_STUDENT_NO: '學號只能包含英文字母與數字。',
    NOT_FOUND: '找不到指定的資料。',
    NETWORK: '網路連線異常，請檢查網路後再試一次。',
    NOT_CONFIGURED: '尚未完成雲端資料庫設定（config.js）。',
    LIB_MISSING: '程式元件載入失敗，請重新整理頁面。',
  };
  function errMsg(e) {
    const raw = String((e && (e.message || e.error)) || e || '');
    const key = raw.split(':')[0].trim();
    if (key === 'CODES_MISSING') return `仍有 ${raw.split(':')[1]} 位具投票資格者尚未產生投票代碼，請先到「名冊與代碼」產生代碼。`;
    if (/permission denied/i.test(raw)) return ERR.NOT_ADMIN;
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(raw)) return ERR.NETWORK;
    if (/JWT|token is expired|invalid claim/i.test(raw)) return '登入已逾時，請重新登入。';
    return ERR[key] || '發生錯誤：' + raw;
  }

  let toastTimer = 0;
  function toast(msg, isErr) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 4800 : 2800);
  }

  /* 對話框（取代瀏覽器 confirm） */
  function modal({ title, message, html, confirmText = '確定', cancelText = '取消', danger = false, wide = false, hideCancel = false }) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal open';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.innerHTML = `<div class="modal-card${wide ? ' wide' : ''}">
        <h3>${esc(title || '')}</h3>
        ${message ? `<p class="msg">${esc(message)}</p>` : ''}
        ${html || ''}
        <div class="modal-actions">
          ${hideCancel ? '' : `<button class="btn" data-act="cancel">${esc(cancelText)}</button>`}
          ${confirmText ? `<button class="btn ${danger ? 'btn-danger' : 'btn-navy'}" data-act="ok">${esc(confirmText)}</button>` : ''}
        </div></div>`;
      document.body.appendChild(m);
      const done = (v) => { m.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      const f = m.querySelector('form');
      if (f) f.addEventListener('submit', (e) => { e.preventDefault(); done(new FormData(f)); });
      m.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (a) done(a.dataset.act === 'ok' ? (m.querySelector('form') ? new FormData(m.querySelector('form')) : true) : false);
        else if (e.target === m) done(false);
      });
      setTimeout(() => (m.querySelector('input,select') || m.querySelector('[data-act="cancel"]') || m.querySelector('[data-act="ok"]'))?.focus(), 30);
    });
  }

  /* 下載：CSV（UTF-8 BOM，Excel 可直接開啟）／ Excel（.xlsx） */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function toCSV(rows) {
    return '﻿' + rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  function exportRows(rows, baseName, kind) {
    if (kind === 'xlsx') {
      if (!window.XLSX) { toast('Excel 元件未載入，改為下載 CSV（Excel 可直接開啟）'); kind = 'csv'; }
      else {
        const ws = window.XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = rows[0].map((_, i) => ({ wch: Math.min(48, Math.max(10, ...rows.map((r) => String(r[i] == null ? '' : r[i]).length * 1.8))) }));
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, '資料');
        window.XLSX.writeFile(wb, baseName + '.xlsx');
        return;
      }
    }
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), baseName + '.csv');
  }

  /* 組員顯示 */
  function memberText(m) { return [m.no || m.honorific || '', m.name].filter(Boolean).join(' '); }
  function membersText(list) { return (list || []).map(memberText).join('、'); }
  function membersHTML(list) {
    return (list || []).map((m) => {
      const tag = m.no ? `<small>${esc(m.no)}</small>` : m.honorific ? `<small class="hon">${esc(m.honorific)}</small>` : '';
      return `<span>${tag}${esc(m.name)}</span>`;
    }).join('');
  }

  /* 金銀銅立體獎盃（SVG） */
  let trophySeq = 0;
  const METALS = {
    gold: ['#FFF7D6', '#EDD27C', '#D4AF37', '#94711A', '#F6E2A0'],
    silver: ['#FFFFFF', '#E4E9EF', '#B8C2CC', '#7C8896', '#F2F5F8'],
    bronze: ['#FCE5D5', '#DDA784', '#B77B56', '#774328', '#EFC3A6'],
  };
  function trophySVG(metal, cls = 'trophy') {
    const P = METALS[metal] || METALS.gold;
    const id = 'tr' + ++trophySeq;
    return `<svg class="${cls}" viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
<linearGradient id="${id}a" x1="0" x2="1"><stop offset="0" stop-color="${P[3]}"/><stop offset=".2" stop-color="${P[2]}"/><stop offset=".42" stop-color="${P[0]}"/><stop offset=".6" stop-color="${P[1]}"/><stop offset=".82" stop-color="${P[2]}"/><stop offset="1" stop-color="${P[3]}"/></linearGradient>
<linearGradient id="${id}b" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${P[4]}"/><stop offset="1" stop-color="${P[3]}"/></linearGradient>
<radialGradient id="${id}g" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="${P[0]}" stop-opacity=".95"/><stop offset="1" stop-color="${P[0]}" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="100" cy="96" rx="96" ry="86" fill="url(#${id}g)" opacity=".6"/>
<path d="M46 50C12 50 10 106 60 120" fill="none" stroke="url(#${id}b)" stroke-width="11" stroke-linecap="round"/>
<path d="M154 50C188 50 190 106 140 120" fill="none" stroke="url(#${id}b)" stroke-width="11" stroke-linecap="round"/>
<path d="M40 34H160V58C160 112 132 141 100 147C68 141 40 112 40 58Z" fill="url(#${id}a)"/>
<ellipse cx="100" cy="34" rx="60" ry="9" fill="${P[1]}"/><ellipse cx="100" cy="34.5" rx="53" ry="5.5" fill="${P[3]}" opacity=".5"/>
<path d="M58 48C58 92 70 122 90 135" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="7" stroke-linecap="round"/>
<path d="M100 64l7.6 15.4 17 2.5-12.3 12 2.9 16.9L100 102.8l-15.2 8 2.9-16.9-12.3-12 17-2.5z" fill="${P[0]}" opacity=".9"/>
<path d="M90 147H110L114 182H86Z" fill="url(#${id}a)"/>
<ellipse cx="100" cy="184" rx="31" ry="7" fill="url(#${id}b)"/>
<path d="M58 196H142L151 236H49Z" fill="url(#${id}a)"/>
<rect x="43" y="234" width="114" height="17" rx="4" fill="url(#${id}b)"/>
<rect x="76" y="207" width="48" height="17" rx="3" fill="${P[3]}" opacity=".32"/>
</svg>`;
  }
  function fillTrophies() { $$('[data-trophy]').forEach((el) => { el.innerHTML = trophySVG(el.dataset.trophy, el.dataset.cls || ''); }); }

  /* ------------------------------------------------------------------
     2. Supabase 連線
     ------------------------------------------------------------------ */
  function configured() {
    return !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && !/YOUR-PROJECT|YOUR-KEY|your-project/i.test(CFG.SUPABASE_URL + CFG.SUPABASE_KEY));
  }
  let client = null;
  function db() {
    if (client) return client;
    if (!configured()) throw new Error('NOT_CONFIGURED');
    if (!window.supabase || !window.supabase.createClient) throw new Error('LIB_MISSING');
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hec-awards-auth' },
    });
    return client;
  }
  async function rpc(fn, args) {
    const { data, error } = await db().rpc(fn, args || {});
    if (error) throw new Error(error.message || error.code || 'ERROR');
    return data;
  }
  /* 公開函式以 {ok:false,error} 回報預期錯誤 */
  async function rpcOk(fn, args) {
    const d = await rpc(fn, args);
    if (d && d.ok === false) throw new Error(d.error);
    return d;
  }

  function poller(fn, ms) {
    let t = 0, stopped = false;
    const run = async () => {
      try { await fn(); } catch (e) { /* 下一輪重試 */ }
      if (!stopped) t = setTimeout(run, document.hidden ? ms * 3 : ms);
    };
    run();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) { clearTimeout(t); run(); } });
    return { stop() { stopped = true; clearTimeout(t); }, now() { clearTimeout(t); run(); } };
  }

  function setStatusPill(el, status) {
    if (!el) return;
    const s = STATUS[status] || STATUS.setup;
    el.dataset.status = status;
    el.innerHTML = `<i></i>${esc(s.label)}`;
  }

  function voteURL() {
    if (CFG.PUBLIC_SITE_URL) return CFG.PUBLIC_SITE_URL.replace(/\/?$/, '/') + 'vote.html';
    return new URL('vote.html', location.href).href.split('?')[0];
  }

  function boot(page) {
    fillTrophies();
    $$('.nav a').forEach((a) => { if (a.getAttribute('href') === page + '.html') a.setAttribute('aria-current', 'page'); });
    if (!configured()) {
      const b = document.createElement('div');
      b.className = 'config-banner';
      b.innerHTML = '尚未完成雲端資料庫設定：請依 README 編輯 <code>config.js</code>，填入 Supabase 專案網址（Project URL）與金鑰（Publishable／anon key）。';
      document.body.prepend(b);
      return false;
    }
    if (!window.supabase) { toast(ERR.LIB_MISSING, true); return false; }
    return true;
  }

  /* ------------------------------------------------------------------
     3. 首頁 index.html
     ------------------------------------------------------------------ */
  AW.home = function () {
    if (!boot('index')) return;
    poller(async () => {
      const st = await rpc('aw_public_state');
      $('#evName').textContent = st.event_name;
      document.title = st.event_name + '｜Healthcare Education Creative Awards';
      setStatusPill($('#status'), st.status);
      $('#statGroups').textContent = st.groups.length;
      $('#statVoters').textContent = st.eligible_count;
      $('#ruleSelf').textContent = st.allow_self ? '本次活動允許投給自己所屬的組別。' : '不可投給自己所屬的組別（系統會自動停用）。';
      const cta = $('#ctaVote');
      cta.classList.toggle('btn-gold', st.status === 'open');
      $('#ctaHint').textContent = { setup: '投票尚未開始，請等待教師宣布開放。', open: '投票進行中，請以個人專屬代碼登入投票。', paused: '投票暫停中，請稍候教師重新開放。', closed: '投票已結束，感謝您的參與。' }[st.status];
      const anyPub = st.published.pres || st.published.poster;
      $('#ctaResults').hidden = !anyPub;
    }, 5000);
  };

  /* ------------------------------------------------------------------
     4. 學生投票 vote.html
     ------------------------------------------------------------------ */
  AW.vote = function () {
    if (!boot('vote')) { $('#vCode').hidden = false; $('#codeForm button').disabled = true; return; }
    const KEY = 'hec-awards-vote-draft';    // 僅暫存「尚未送出」的選擇，方便重新整理後續填；不作為防重複依據
    const S = { step: 'code', code: '', me: null, st: null, cat: 'pres', sel: { pres: [], poster: [] }, submitting: false };
    const views = ['vCode', 'vWelcome', 'vPick', 'vConfirm', 'vDone', 'vVoted'];

    function saveDraft() { try { sessionStorage.setItem(KEY, JSON.stringify({ code: S.code, sel: S.sel })); } catch (e) {} }
    function clearDraft() { try { sessionStorage.removeItem(KEY); } catch (e) {} }

    function show(v) {
      S.step = v;
      views.forEach((id) => ($('#' + id).hidden = id !== v));
      $('#selbar').hidden = v !== 'vPick';
      const map = { vCode: 0, vWelcome: 0, vPick: S.cat === 'pres' ? 1 : 2, vConfirm: 3, vDone: 4, vVoted: 4 };
      $$('#steps span').forEach((s, i) => { s.classList.toggle('on', i === map[v]); s.classList.toggle('done', i < map[v]); });
      updateGate();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* 狀態提示（每 4 秒同步） */
    function updateGate() {
      const st = S.st && S.st.status;
      const note = $('#gateNote');
      const inFlow = ['vWelcome', 'vPick', 'vConfirm'].includes(S.step);
      if (inFlow && st && st !== 'open') {
        note.hidden = false;
        note.className = 'notice ' + (st === 'closed' ? 'danger' : 'warn');
        note.querySelector('span').textContent = { setup: '投票尚未開始。您可以先瀏覽作品，教師開放後即可送出選票。', paused: '投票暫停中：教師暫時停止收件，您的選擇會保留，重新開放後即可送出。', closed: '投票已結束，伺服器將不再接受新選票。' }[st];
      } else note.hidden = true;
      $('#btnBegin').disabled = !(st === 'open' || st === 'setup' || st === 'paused') || st === 'closed';
      $('#btnSubmit').disabled = st !== 'open' || S.submitting;
      setStatusPill($('#status'), st || 'setup');
    }
    const statePoll = poller(async () => {
      S.st = await rpc('aw_public_state');
      $('#evName').textContent = S.st.event_name;
      updateGate();
      if (S.step === 'vPick') renderCards();
    }, 4000);

    /* 第一步：代碼 */
    const codeIn = $('#codeInput');
    codeIn.addEventListener('input', () => {
      let v = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
      codeIn.value = v;
      $('#codeErr').hidden = true;
    });
    $('#codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#codeForm button');
      const code = codeIn.value.trim();
      if (code.replace(/-/g, '').length !== 8) { showCodeErr('請輸入完整的 8 碼投票代碼。'); return; }
      btn.classList.add('loading');
      try { await verify(code, true); }
      catch (err) { showCodeErr(errMsg(err)); }
      finally { btn.classList.remove('loading'); }
    });
    function showCodeErr(m) { const el = $('#codeErr'); el.hidden = false; el.querySelector('span').textContent = m; }

    async function verify(code, fresh) {
      const me = await rpcOk('aw_verify_code', { p_code: code });
      if (!S.st) S.st = await rpc('aw_public_state');
      S.code = code; S.me = me;
      if (me.has_voted) { clearDraft(); showVoted(me); return; }
      if (fresh) { S.sel = { pres: [], poster: [] }; }
      S.sel.pres = S.sel.pres.filter((g) => me.allow_self || g !== me.group_id);
      S.sel.poster = S.sel.poster.filter((g) => me.allow_self || g !== me.group_id);
      saveDraft();
      $('#wName').textContent = `歡迎，${me.name}`;
      $('#wGroup').textContent = `您是${me.group_label}參賽者`;
      $('#wSelf').textContent = S.st.allow_self ? '本次活動允許投給自己所屬的組別。' : '依活動規則，您所屬的組別將自動停用，不可投票。';
      show('vWelcome');
    }
    function showVoted(me) {
      $('#votedName').textContent = me ? `${me.name}（${me.group_label}）` : '';
      $('#votedAt').textContent = me && me.voted_at ? '完成時間：' + fmtTime(me.voted_at) : '';
      show('vVoted');
    }
    $('#btnSwitch').addEventListener('click', () => { clearDraft(); S.code = ''; S.me = null; codeIn.value = ''; show('vCode'); });
    $('#btnBegin').addEventListener('click', () => { S.cat = 'pres'; renderPick(); show('vPick'); });

    /* 選組 */
    function renderPick() {
      const c = CAT[S.cat];
      $('#pickTitle').textContent = c.title;
      $('#pickEn').textContent = c.en;
      $('#btnNext').innerHTML = S.cat === 'pres' ? '下一步：海報組 →' : '下一步：確認選票 →';
      $('#btnPrev').textContent = S.cat === 'pres' ? '← 返回' : '← 上一步：簡報組';
      renderCards();
    }
    function renderCards() {
      const sel = S.sel[S.cat];
      const own = S.me.group_id;
      const allowSelf = S.st.allow_self;
      $('#groupGrid').innerHTML = S.st.groups.map((g) => {
        const isOwn = g.id === own && !allowSelf;
        const idx = sel.indexOf(g.id);
        const title = S.cat === 'pres' ? g.title_pres : g.title_poster;
        return `<button type="button" class="gcard${idx >= 0 ? ' selected' : ''}${sel.length >= 3 ? ' full' : ''}" data-id="${g.id}" ${isOwn ? 'disabled aria-disabled="true"' : ''} aria-pressed="${idx >= 0}">
          <span class="check" aria-hidden="true">${idx >= 0 ? idx + 1 : ''}</span>
          <span class="g-no">${esc(g.label)}</span>
          ${isOwn ? '<span class="own">所屬組別，不可投票</span>' : ''}
          <span class="g-title${title ? '' : ' empty'}">${title ? esc(title) : '作品名稱待公布'}</span>
          <span class="g-members">${membersHTML(g.members)}</span>
        </button>`;
      }).join('');
      const n = sel.length;
      $('#selCount').innerHTML = `已選擇 <b>${n}</b> / 3 組`;
      $$('#selDots i').forEach((d, i) => d.classList.toggle('on', i < n));
      $('#btnNext').disabled = n !== 3;
    }
    $('#groupGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.gcard');
      if (!card || card.disabled) return;
      const id = +card.dataset.id;
      const sel = S.sel[S.cat];
      const i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1);
      else if (sel.length >= 3) { toast('每個類別最多選擇 3 組，請先取消其他組別。'); return; }
      else sel.push(id);
      saveDraft();
      renderCards();
    });
    $('#btnNext').addEventListener('click', () => {
      if (S.sel[S.cat].length !== 3) return;
      if (S.cat === 'pres') { S.cat = 'poster'; renderPick(); show('vPick'); }
      else { renderConfirm(); show('vConfirm'); }
    });
    $('#btnPrev').addEventListener('click', () => {
      if (S.cat === 'poster') { S.cat = 'pres'; renderPick(); show('vPick'); }
      else show('vWelcome');
    });

    /* 確認 */
    function renderConfirm() {
      const byId = Object.fromEntries(S.st.groups.map((g) => [g.id, g]));
      ['pres', 'poster'].forEach((c) => {
        $('#sum_' + c).innerHTML = S.sel[c].map((id) => {
          const g = byId[id];
          const t = c === 'pres' ? g.title_pres : g.title_poster;
          return `<li><b>${esc(g.label)}</b><span>${t ? esc(t) + '<br>' : ''}${esc(membersText(g.members))}</span></li>`;
        }).join('');
      });
    }
    $('#btnEdit').addEventListener('click', () => { S.cat = 'pres'; renderPick(); show('vPick'); });
    $('#btnSubmit').addEventListener('click', async () => {
      if (S.submitting) return;
      S.submitting = true;
      const btn = $('#btnSubmit');
      btn.classList.add('loading');
      updateGate();
      try {
        const r = await rpc('aw_submit_ballot', { p_code: S.code, p_pres: S.sel.pres, p_poster: S.sel.poster });
        if (r && r.ok) {
          clearDraft();
          $('#doneAt').textContent = '完成時間：' + fmtTime(r.submitted_at);
          show('vDone');
          return;
        }
        const code = r && r.error;
        if (code === 'ALREADY_VOTED') { clearDraft(); showVoted({ name: S.me.name, group_label: S.me.group_label }); toast(ERR.ALREADY_VOTED); }
        else if (code === 'INVALID_CODE' || code === 'NOT_ELIGIBLE') { clearDraft(); toast(errMsg(code), true); show('vCode'); }
        else if (code === 'SELF_VOTE_NOT_ALLOWED' || code === 'INVALID_SELECTION') { toast(errMsg(code), true); S.cat = 'pres'; renderPick(); show('vPick'); }
        else { toast(errMsg(code), true); statePoll.now(); }
      } catch (err) {
        toast('網路異常，選票可能尚未送出。請確認網路後再按一次「確認送出」，系統保證只會計票一次。', true);
      } finally {
        S.submitting = false;
        btn.classList.remove('loading');
        updateGate();
      }
    });

    /* 重新整理後：若有未送出的草稿，重新向伺服器驗證身分與投票狀態 */
    (async () => {
      let d = null;
      try { d = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
      if (d && d.code) {
        S.sel = d.sel || S.sel;
        codeIn.value = d.code;
        try { await verify(d.code, false); return; } catch (e) { clearDraft(); }
      }
      show('vCode');
      codeIn.focus();
    })();
  };

  /* ------------------------------------------------------------------
     5. 統計圖（後台與頒獎頁共用）
     ------------------------------------------------------------------ */
  function renderBars(container, catData, ballots, catKey) {
    const rows = catData.rows || [];
    const max = Math.max(1, ...rows.map((r) => r.votes));
    container.innerHTML = `
      <p class="chart-note">
        ${esc(CAT[catKey].label)}總得票數 <b>${catData.total_votes}</b> 票（有效選票 ${ballots} 張 × 3）。
        得票率＝該組得票 ÷ 該類別總得票數；支持率＝選擇該組的投票者人數 ÷ 有效選票數（分母 ${ballots} 人）。
      </p>
      <div class="bars">${rows.map((r) => `
        <div class="bar-row${r.rank <= 3 && r.votes > 0 ? ' top' : ''}">
          <span class="rk${r.votes > 0 && r.rank <= 3 ? ' r' + r.rank : ''}">${r.rank}</span>
          <span class="who"><b>${esc(r.label)}</b><span>${r.title ? esc(r.title) + '｜' : ''}${esc(membersText(r.members))}</span></span>
          <span class="bar-track"><i style="width:${(r.votes / max) * 100}%"></i></span>
          <span class="num"><b>${r.votes}</b>票<br>得票率 ${Number(r.pct_votes).toFixed(1)}%｜支持率 ${Number(r.pct_voters).toFixed(1)}%</span>
        </div>`).join('')}</div>`;
  }

  /* ------------------------------------------------------------------
     6. 教師後台 admin.html
     ------------------------------------------------------------------ */
  AW.admin = function () {
    if (!boot('admin')) return;
    const cli = db();
    const A = { ov: null, roster: null, tab: 'stats', cat: 'pres', filter: 'all', poll: null, lastCodes: null };

    async function start() {
      const { data } = await cli.auth.getSession();
      if (!data.session) return showLogin();
      try {
        const who = await rpc('aw_admin_whoami');
        if (!who.is_admin) { await cli.auth.signOut(); return showLogin(ERR.NOT_ADMIN); }
      } catch (e) { return showLogin(errMsg(e)); }
      showDash(data.session.user.email);
    }
    function showLogin(msg) {
      $('#login').hidden = false; $('#dash').hidden = true;
      if (A.poll) A.poll.stop();
      const n = $('#loginErr');
      n.hidden = !msg;
      if (msg) n.querySelector('span').textContent = msg;
    }
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#loginForm button[type=submit]');
      btn.classList.add('loading');
      try {
        const { error } = await cli.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
        if (error) throw new Error(/invalid login/i.test(error.message) ? '帳號或密碼錯誤。' : error.message);
        await start();
      } catch (err) { showLogin(err.message); }
      finally { btn.classList.remove('loading'); }
    });

    function showDash(email) {
      $('#login').hidden = true; $('#dash').hidden = false;
      $('#whoami').textContent = email || '';
      A.poll = poller(refresh, 3000);
      loadRoster();
    }
    async function refresh() {
      try { A.ov = await rpc('aw_admin_overview'); }
      catch (e) { if (/NOT_ADMIN|JWT|permission/i.test(e.message)) { showLogin(errMsg(e)); } throw e; }
      render();
    }
    async function loadRoster() {
      try { A.roster = await rpc('aw_admin_roster'); renderRoster(); } catch (e) { toast(errMsg(e), true); }
    }

    function render() {
      const o = A.ov, s = o.settings;
      setStatusPill($('#status'), s.status);
      $('#dashEvent').textContent = s.event_name;
      const meta = [`第 ${s.round_no} 輪`];
      if (s.started_at) meta.push('開始 ' + fmtTime(s.started_at));
      if (s.status === 'paused' && s.paused_at) meta.push('暫停 ' + fmtTime(s.paused_at, false));
      if (s.closed_at) meta.push('結束 ' + fmtTime(s.closed_at));
      meta.push(s.allow_self ? '允許投自己組' : '不允許投自己組');
      $('#dashMeta').textContent = meta.join('　·　');
      const st = s.status;
      $('#cStart').disabled = st !== 'setup';
      $('#cPause').disabled = st !== 'open';
      $('#cResume').disabled = st !== 'paused';
      $('#cClose').disabled = !(st === 'open' || st === 'paused');
      $('#cPublish').disabled = st !== 'closed';
      $('#cCeremony').disabled = !(s.published_pres || s.published_poster);
      $('#kEligible').textContent = o.eligible;
      $('#kVoted').textContent = o.voted;
      $('#kNot').textContent = o.not_voted;
      $('#kRate').textContent = Number(o.rate).toFixed(1);
      $('#kRateBar').style.width = o.rate + '%';
      $('#kPres').textContent = o.categories.pres.total_votes;
      $('#kPoster').textContent = o.categories.poster.total_votes;
      const warn = $('#codesWarn');
      warn.hidden = !(st === 'setup' && o.codes_missing > 0);
      if (!warn.hidden) warn.querySelector('span').textContent = `尚有 ${o.codes_missing} 位具投票資格者沒有投票代碼。開始投票前，請到「名冊與代碼」按「產生未發放代碼」，並把代碼發給每位參賽者。`;
      renderStats();
      renderSettings();
      if (A.tab === 'qr') renderQR();
      if (A.tab === 'roster' && A.roster) {
        const voted = A.roster.filter((v) => v.voted_at).length;
        if (voted !== o.voted) loadRoster();
      }
      if (A.tab === 'groups' && !$('#groupsEdit').dataset.loaded) renderGroups();
    }

    /* 主要控制 */
    async function act(action) {
      const o = A.ov;
      if (action === 'start') {
        const ok = await modal({
          title: '開始投票',
          message: `開始投票後：\n・學生即可以個人代碼登入投票\n・參賽名單、投票資格與「是否允許投自己組」將鎖定\n\n目前設定：${o.settings.allow_self ? '允許' : '不允許'}投給自己所屬組別\n具投票資格：${o.eligible} 人`,
          confirmText: '開始投票',
        });
        if (!ok) return;
      }
      if (action === 'close') {
        const ok = await modal({
          title: '確定要結束投票嗎？',
          message: `結束後將：\n・停止接受所有新選票\n・鎖定正式統計結果並計算兩類別排名\n・尚未投票的 ${o.not_voted} 位參賽者將無法再提交\n・學生暫時看不到得獎名單，需由您另行公布\n\n此操作無法復原。`,
          confirmText: '確定結束投票', danger: true,
        });
        if (!ok) return;
      }
      try {
        A.ov = await rpc('aw_admin_set_status', { p_action: action });
        render();
        toast({ start: '投票已開始', pause: '投票已暫停，已提交的選票均保留', resume: '投票已重新開放', close: '投票已結束，正式統計已鎖定' }[action]);
        if (action === 'close') { switchTab('stats'); }
      } catch (e) { toast(errMsg(e), true); A.poll.now(); }
    }
    $('#cStart').onclick = () => act('start');
    $('#cPause').onclick = () => act('pause');
    $('#cResume').onclick = () => act('resume');
    $('#cClose').onclick = () => act('close');
    $('#cStats').onclick = () => { switchTab('stats'); $('#tabStats').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $('#cPublish').onclick = () => { switchTab('stats'); setTimeout(() => $('#awardBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
    $('#cCeremony').onclick = () => {
      const s = A.ov.settings;
      const cat = s.published_pres ? 'pres' : 'poster';
      window.open(`results.html?cat=${cat}`, '_blank');
    };

    /* 分頁 */
    function switchTab(t) {
      A.tab = t;
      $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
      $$('.tabpanel').forEach((p) => (p.hidden = p.dataset.tab !== t));
      if (t === 'roster') loadRoster();
      if (t === 'groups') renderGroups();
      if (t === 'qr') renderQR();
    }
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    /* --- 統計與名次 --- */
    $$('#catSeg button').forEach((b) => b.addEventListener('click', () => {
      A.cat = b.dataset.cat;
      $$('#catSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderStats();
    }));
    function renderStats() {
      if (!A.ov) return;
      const c = A.ov.categories[A.cat];
      renderBars($('#bars'), c, A.ov.ballots, A.cat);
      renderAward(c);
    }
    function renderAward(c) {
      const box = $('#awardBox');
      const s = A.ov.settings;
      const label = CAT[A.cat].label;
      if (s.status !== 'closed') {
        box.innerHTML = `<h3>${label}前三名</h3><p class="muted" style="margin-top:8px">投票結束後，系統會依實際票數自動計算名次；若前三名出現同票，將在此提示您處理。</p>`;
        return;
      }
      const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]));
      let html = `<div class="row"><h3>${label}前三名</h3><span class="spacer"></span>${c.published ? '<span class="tag ok">已公布</span>' : '<span class="tag no">尚未公布</span>'}</div>`;
      if (c.ties.length) {
        html += `<div class="notice warn" style="margin-top:14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span><b>同票警示：</b>${c.ties.map((t) => `第 ${t.rank} 名由 ${t.groups.map((g) => esc(byId[g].label)).join('、')} 同票（各 ${t.votes} 票）`).join('；')}。系統不會任意決定名次，請選擇處理方式：</span></div>
          <div class="row" style="margin-top:12px"><button class="btn btn-sm" id="tieShared">並列名次</button><button class="btn btn-sm" id="tieManual">加賽後指定名次</button>${c.mode ? `<span class="muted" style="font-size:14px">目前採用：${c.mode === 'shared' ? '並列名次' : '加賽後指定名次'}</span>` : ''}</div>`;
      }
      if (c.placements) {
        const places = c.placements;
        html += places.length
          ? `<div class="place-list">${places.map((p) => {
              const r = byId[p.group_id];
              const shared = places.filter((x) => x.place === p.place).length > 1;
              return `<div><span class="pl p${p.place}">${PLACE[p.place].zh}${shared ? '（並列）' : ''}</span><b>${esc(r.label)}</b><span class="t">${esc(membersText(r.members))}</span><span>${p.votes} 票</span></div>`;
            }).join('')}</div>`
          : '<p class="muted" style="margin-top:10px">本類別沒有任何得票，無得獎組別。</p>';
        html += `<div class="row" style="margin-top:16px">${c.published
          ? `<button class="btn btn-sm" id="unpub">收回公布</button><a class="btn btn-sm btn-gold" href="results.html?cat=${A.cat}" target="_blank">開始${CAT[A.cat].ceremony}</a>`
          : `<button class="btn btn-gold" id="pub">公布${label}前三名</button>`}</div>`;
      } else {
        html += `<p class="muted" style="margin-top:12px">請先處理同票，確認名次後才能公布。</p>`;
      }
      box.innerHTML = html;
      const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
      on('tieShared', async () => {
        if (!(await modal({ title: '採用並列名次', message: '同票組別將獲得相同名次（例如兩組並列第一名，下一名次為第三名）。確定採用？', confirmText: '採用並列名次' }))) return;
        try { await rpc('aw_admin_set_placements', { p_cat: A.cat, p_mode: 'shared', p_order: null }); toast('已設定並列名次'); A.poll.now(); } catch (e) { toast(errMsg(e), true); }
      });
      on('tieManual', () => manualOrder(c));
      on('pub', async () => {
        if (!(await modal({ title: `公布${label}前三名`, message: '公布後，學生與投影畫面即可看到正式得獎結果。', confirmText: '確定公布' }))) return;
        try { await rpc('aw_admin_publish', { p_cat: A.cat, p_on: true }); toast(`${label}得獎結果已公布`); A.poll.now(); } catch (e) { toast(errMsg(e), true); }
      });
      on('unpub', async () => {
        if (!(await modal({ title: '收回公布', message: '收回後，學生與投影畫面將暫時看不到此類別的得獎結果。', confirmText: '收回公布', danger: true }))) return;
        try { await rpc('aw_admin_publish', { p_cat: A.cat, p_on: false }); toast('已收回公布'); A.poll.now(); } catch (e) { toast(errMsg(e), true); }
      });
    }
    async function manualOrder(c) {
      const scored = c.rows.filter((r) => r.votes > 0);
      const k = Math.min(3, scored.length);
      const kth = scored.slice().sort((a, b) => b.votes - a.votes)[k - 1];
      const cand = scored.filter((r) => r.votes >= kth.votes);
      const opts = cand.map((r) => `<option value="${r.id}">${esc(r.label)}（${r.votes} 票）</option>`).join('');
      const html = `<form style="margin-top:14px;display:grid;gap:12px">
        ${[1, 2, 3].slice(0, k).map((p) => `<div class="field"><label>${PLACE[p].zh}</label><select class="select" name="p${p}" required><option value="">請選擇</option>${opts}</select></div>`).join('')}
        <p class="muted" style="font-size:13.5px;line-height:1.8">只能在同票的組別之間調整順序；系統會在伺服器端檢查是否與實際票數一致。</p></form>`;
      const fd = await modal({ title: '加賽後指定名次', message: '請依加賽結果指定名次：', html, confirmText: '確認名次' });
      if (!fd) return;
      const order = [1, 2, 3].slice(0, k).map((p) => +fd.get('p' + p));
      if (order.some((x) => !x) || new Set(order).size !== order.length) { toast(ERR.BAD_ORDER, true); return; }
      try { await rpc('aw_admin_set_placements', { p_cat: A.cat, p_mode: 'manual', p_order: order }); toast('名次已確認'); A.poll.now(); }
      catch (e) { toast(errMsg(e), true); }
    }

    /* --- 名冊與代碼 --- */
    $$('#rosterFilter button').forEach((b) => b.addEventListener('click', () => {
      A.filter = b.dataset.f;
      $$('#rosterFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderRoster();
    }));
    function renderRoster() {
      if (!A.roster) return;
      const st = A.ov ? A.ov.settings.status : 'setup';
      const setup = st === 'setup';
      $('#genMissing').disabled = !setup;
      $('#genAll').disabled = !setup;
      $('#addVoter').disabled = !setup;
      $('#rosterLock').hidden = setup;
      const list = A.roster.filter((v) => A.filter === 'all' || (A.filter === 'voted' ? v.voted_at : !v.voted_at && v.eligible));
      $('#rosterBody').innerHTML = list.map((v) => `<tr>
        <td class="mono">${esc(v.voter_key)}</td>
        <td>${v.honorific ? `<span class="tag no">${esc(v.honorific)}</span> ` : ''}${esc(v.name)}</td>
        <td>${esc(v.group_label)}</td>
        <td>${v.eligible ? '<span class="tag ok">具資格</span>' : '<span class="tag off">已停用</span>'}</td>
        <td>${v.has_code ? '<span class="tag ok">已發放</span>' : '<span class="tag warn">未產生</span>'}</td>
        <td>${v.voted_at ? '<span class="tag ok">已完成</span>' : '<span class="tag no">未投票</span>'}</td>
        <td style="white-space:nowrap">${v.voted_at ? fmtTime(v.voted_at) : '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" data-edit="${v.id}" ${setup ? '' : 'disabled'}>編輯</button>
          <button class="btn btn-sm" data-reissue="${v.id}" ${!v.eligible || v.voted_at || st === 'closed' ? 'disabled' : ''}>${v.has_code ? '補發代碼' : '產生代碼'}</button>
        </td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">沒有符合條件的資料</td></tr>';
      const voted = A.roster.filter((v) => v.voted_at).length;
      $('#rosterSummary').textContent = `共 ${A.roster.length} 位｜具資格 ${A.roster.filter((v) => v.eligible).length} 位｜已投票 ${voted} 位`;
    }
    $('#rosterBody').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      const re = e.target.closest('[data-reissue]');
      if (ed) editVoter(A.roster.find((v) => v.id === ed.dataset.edit));
      if (re) {
        const v = A.roster.find((x) => x.id === re.dataset.reissue);
        const ok = await modal({ title: v.has_code ? '補發投票代碼' : '產生投票代碼', message: `${v.name}（${v.group_label}）\n\n${v.has_code ? '補發後，舊代碼將立即失效。' : ''}新代碼只會顯示這一次，請立即交給本人。`, confirmText: v.has_code ? '補發代碼' : '產生代碼' });
        if (!ok) return;
        try { const r = await rpc('aw_admin_generate_codes', { p_scope: 'one', p_voter: v.id }); showCodes(r.codes, false); loadRoster(); A.poll.now(); }
        catch (err) { toast(errMsg(err), true); }
      }
    });
    async function genCodes(scope) {
      const msg = scope === 'all'
        ? '將替所有具投票資格者重新產生代碼，所有舊代碼立即失效。\n新代碼只會顯示這一次，系統會自動下載代碼名冊。確定？'
        : '將替尚未取得代碼的投票者產生代碼。\n代碼只會顯示這一次（資料庫只保存加密雜湊），系統會自動下載代碼名冊，請妥善保存。';
      if (!(await modal({ title: scope === 'all' ? '全部重新產生代碼' : '產生投票代碼', message: msg, confirmText: '產生代碼', danger: scope === 'all' }))) return;
      try {
        const r = await rpc('aw_admin_generate_codes', { p_scope: scope, p_voter: null });
        if (!r.codes.length) { toast('所有具投票資格者都已有代碼'); return; }
        showCodes(r.codes, true);
        loadRoster(); A.poll.now();
      } catch (e) { toast(errMsg(e), true); }
    }
    $('#genMissing').onclick = () => genCodes('missing');
    $('#genAll').onclick = () => genCodes('all');
    $('#exportRoster').onclick = () => exportParticipation('xlsx');

    function codeRows(codes) {
      const url = voteURL();
      return [['投票者識別編號', '學號', '稱謂', '姓名', '所屬組別', '投票代碼', '投票網址']].concat(
        codes.map((c) => [c.voter_key, c.student_no || '', c.honorific || '', c.name, c.group_label, c.code, url]));
    }
    function showCodes(codes, autoDownload) {
      A.lastCodes = codes;
      const base = `醫護教育創意設計大賞_投票代碼發放名冊_${stamp()}`;
      if (autoDownload) exportRows(codeRows(codes), base, 'csv');
      const html = `<div class="notice warn" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span>代碼只會顯示這一次。${autoDownload ? '代碼名冊（CSV）已自動下載；' : ''}關閉此視窗前，請確認已下載或列印。代碼等同投票權，請個別發放、勿公開張貼。</span></div>
        <div class="table-wrap" style="max-height:46vh"><table class="tbl"><thead><tr><th>識別編號</th><th>姓名</th><th>組別</th><th>投票代碼</th></tr></thead><tbody>
        ${codes.map((c) => `<tr><td class="mono">${esc(c.voter_key)}</td><td>${c.honorific ? esc(c.honorific) + ' ' : ''}${esc(c.name)}</td><td>${esc(c.group_label)}</td><td class="mono" style="font-size:18px;font-weight:600">${esc(c.code)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="row" style="margin-top:14px"><button class="btn btn-sm" data-dl="csv">下載 CSV</button><button class="btn btn-sm" data-dl="xlsx">下載 Excel</button><button class="btn btn-sm" data-dl="print">列印代碼單</button></div>`;
      const p = modal({ title: `投票代碼（${codes.length} 位）`, html, confirmText: '我已保存，關閉', hideCancel: true, wide: true });
      setTimeout(() => {
        $$('[data-dl]').forEach((b) => (b.onclick = () => {
          if (b.dataset.dl === 'print') printSlips(codes);
          else exportRows(codeRows(codes), base, b.dataset.dl);
        }));
      }, 50);
      return p;
    }
    function printSlips(codes) {
      const url = voteURL();
      const ev = A.ov ? A.ov.settings.event_name : '醫護教育創意設計大賞';
      let area = $('#printArea');
      area.innerHTML = `<div class="slips">${codes.map((c) => `<div class="slip">
        <div class="ev">${esc(ev)}｜個人投票代碼</div>
        <div class="nm">${c.honorific ? esc(c.honorific) + ' ' : ''}${esc(c.name)}</div>
        <div class="gp">${esc(c.group_label)}｜識別編號 ${esc(c.voter_key)}</div>
        <div class="cd">${esc(c.code)}</div>
        <div class="url">投票網址：${esc(url)}</div>
        <div class="note">每人一次，送出後不可修改。請勿將代碼交給他人。</div></div>`).join('')}</div>`;
      window.print();
    }

    async function editVoter(v) {
      const groups = (A.ov && A.ov.categories.pres.rows.slice().sort((a, b) => a.id - b.id)) || [];
      const html = `<form style="margin-top:14px;display:grid;gap:12px">
        <div class="grid-2">
          <div class="field"><label>學號（文字，保留前導零；學長姊可空白）</label><input class="input" name="no" value="${esc(v ? v.student_no || '' : '')}" maxlength="20"></div>
          <div class="field"><label>稱謂</label><select class="select" name="hon"><option value="">（無）</option>${['學長', '學姊'].map((h) => `<option ${v && v.honorific === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>姓名</label><input class="input" name="name" required value="${esc(v ? v.name : '')}"></div>
        <div class="field"><label>所屬組別</label><select class="select" name="group">${groups.map((g) => `<option value="${g.id}" ${v && v.group_id === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></div>
        <label class="toggle"><input type="checkbox" name="eligible" ${!v || v.eligible ? 'checked' : ''}><span class="track"></span>具投票資格</label>
      </form>`;
      const fd = await modal({ title: v ? '編輯投票者' : '新增投票者', html, confirmText: '儲存' });
      if (!fd) return;
      try {
        await rpc('aw_admin_upsert_voter', {
          p_id: v ? v.id : null, p_student_no: fd.get('no'), p_honorific: fd.get('hon'), p_name: fd.get('name'),
          p_group_id: +fd.get('group'), p_eligible: fd.get('eligible') === 'on', p_sort_order: null,
        });
        toast('已儲存'); loadRoster(); A.poll.now();
      } catch (e) { toast(errMsg(e), true); }
    }
    $('#addVoter').onclick = () => editVoter(null);

    /* --- 組別與作品 --- */
    function renderGroups() {
      if (!A.ov) return;
      const rows = A.ov.categories.pres.rows.slice().sort((a, b) => a.id - b.id);
      const posterById = Object.fromEntries(A.ov.categories.poster.rows.map((r) => [r.id, r]));
      const box = $('#groupsEdit');
      box.dataset.loaded = '1';
      box.innerHTML = rows.map((r) => `<div class="ge-row" data-gid="${r.id}">
        <div class="field"><label>組別名稱</label><input class="input" name="label" value="${esc(r.label)}"></div>
        <div class="field"><label>簡報組作品名稱</label><input class="input" name="tp" value="${esc(r.title)}" placeholder="例如：智慧照護衛教新模式"></div>
        <div class="field"><label>海報組作品名稱</label><input class="input" name="tq" value="${esc(posterById[r.id].title)}" placeholder="例如：守護長者用藥安全"></div>
        <button class="btn btn-navy" data-save>儲存</button>
        <div class="members">組員：${esc(membersText(r.members))}</div></div>`).join('');
    }
    $('#groupsEdit').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-save]');
      if (!b) return;
      const row = b.closest('[data-gid]');
      b.classList.add('loading');
      try {
        await rpc('aw_admin_update_group', { p_id: +row.dataset.gid, p_label: $('[name=label]', row).value, p_title_pres: $('[name=tp]', row).value, p_title_poster: $('[name=tq]', row).value });
        toast('已儲存組別與作品名稱');
        A.poll.now();
      } catch (err) { toast(errMsg(err), true); }
      finally { b.classList.remove('loading'); }
    });
    $('#reloadGroups').onclick = () => { $('#groupsEdit').dataset.loaded = ''; renderGroups(); };

    /* --- 設定 --- */
    function renderSettings() {
      const s = A.ov.settings;
      const t = $('#allowSelf');
      t.checked = s.allow_self;
      t.disabled = s.status !== 'setup';
      $('#allowSelfNote').textContent = s.status === 'setup' ? '須在開始投票前設定完成。' : '投票已開始，此設定已鎖定。';
      if (document.activeElement !== $('#eventName')) $('#eventName').value = s.event_name;
      $('#newRound').disabled = s.status !== 'closed';
    }
    $('#allowSelf').addEventListener('change', async (e) => {
      const v = e.target.checked;
      try { await rpc('aw_admin_set_allow_self', { p_allow: v }); toast(v ? '已設定：允許投自己組' : '已設定：不允許投自己組'); A.poll.now(); }
      catch (err) { e.target.checked = !v; toast(errMsg(err), true); }
    });
    $('#saveEvent').onclick = async () => {
      try { await rpc('aw_admin_set_event_name', { p_name: $('#eventName').value }); toast('活動名稱已更新'); A.poll.now(); }
      catch (e) { toast(errMsg(e), true); }
    };
    $('#newRound').onclick = async () => {
      const fd = await modal({
        title: '建立新一輪投票',
        message: '本輪的選票會保留在資料庫作為紀錄，但新一輪將從 0 票重新開始，得獎公布也會全部收回。投票代碼沿用（如需更換，可在新一輪開始前重新產生）。\n\n請輸入「新一輪」確認：',
        html: '<form style="margin-top:10px"><input class="input" name="c" autocomplete="off"></form>', confirmText: '建立新一輪', danger: true,
      });
      if (!fd) return;
      if (fd.get('c') !== '新一輪') { toast('確認文字不正確，未建立新一輪'); return; }
      try { await rpc('aw_admin_new_round'); toast('已建立新一輪投票'); A.poll.now(); loadRoster(); } catch (e) { toast(errMsg(e), true); }
    };
    $('#logout').onclick = async () => { await cli.auth.signOut(); showLogin(); };

    /* --- QR Code --- */
    function qrSVG(text) {
      if (!window.qrcode) return '<p class="muted">QR Code 元件未載入</p>';
      const q = window.qrcode(0, 'M');
      q.addData(text, 'Byte');
      q.make();
      return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    }
    function renderQR() {
      const url = voteURL();
      $('#qrUrl').textContent = url;
      if ($('#qrBox').dataset.url !== url) { $('#qrBox').innerHTML = qrSVG(url); $('#qrBox').dataset.url = url; }
      const bad = !/^https:\/\//i.test(url) || /localhost|127\.0\.0\.1/.test(url);
      $('#qrWarn').hidden = !bad;
      const scr = $('#qrScreen');
      if (scr.classList.contains('open')) {
        setStatusPill($('#qrStatus'), A.ov ? A.ov.settings.status : 'setup');
        $('#qrEvent').textContent = A.ov ? A.ov.settings.event_name : '';
      }
    }
    $('#qrProject').onclick = () => {
      const url = voteURL();
      $('#qrBig').innerHTML = qrSVG(url);
      $('#qrBigUrl').textContent = url;
      $('#qrScreen').classList.add('open');
      renderQR();
      document.documentElement.requestFullscreen?.().catch(() => {});
    };
    $('#qrClose').onclick = () => { $('#qrScreen').classList.remove('open'); if (document.fullscreenElement) document.exitFullscreen(); };
    $('#qrCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(voteURL()); toast('已複製投票網址'); } catch (e) { toast('請手動複製網址'); }
    };
    $('#qrDownload').onclick = () => {
      if (!window.qrcode) return;
      const q = window.qrcode(0, 'M'); q.addData(voteURL(), 'Byte'); q.make();
      const a = document.createElement('a'); a.href = q.createDataURL(16, 4); a.download = '投票QRCode.gif'; a.click();
    };

    /* --- 匯出 --- */
    function statsRows() {
      const rows = [['競賽類別', '名次', '組別', '作品名稱', '組員姓名', '得票數', '得票率(%)', '支持率(%)', '有效選票數']];
      ['pres', 'poster'].forEach((c) => {
        A.ov.categories[c].rows.forEach((r) => rows.push([CAT[c].label, r.rank, r.label, r.title, membersText(r.members), r.votes, Number(r.pct_votes).toFixed(1), Number(r.pct_voters).toFixed(1), A.ov.ballots]));
      });
      return rows;
    }
    async function exportParticipation(kind) {
      await loadRoster();
      const rows = [['投票者識別編號', '學號', '稱謂', '姓名', '所屬組別', '投票資格', '是否完成投票', '完成時間']].concat(
        A.roster.map((v) => [v.voter_key, v.student_no || '', v.honorific || '', v.name, v.group_label, v.eligible ? '具資格' : '已停用', v.voted_at ? '已完成' : '未投票', v.voted_at ? fmtTime(v.voted_at) : '']));
      exportRows(rows, `醫護教育創意設計大賞_投票參與名冊_${stamp()}`, kind);
    }
    function awardRows() {
      const rows = [['競賽類別', '名次', '組別', '作品名稱', '組員姓名', '得票數', '是否已公布']];
      ['pres', 'poster'].forEach((c) => {
        const cd = A.ov.categories[c];
        const byId = Object.fromEntries(cd.rows.map((r) => [r.id, r]));
        (cd.placements || []).forEach((p) => {
          const r = byId[p.group_id];
          const shared = cd.placements.filter((x) => x.place === p.place).length > 1;
          rows.push([CAT[c].label, PLACE[p.place].zh + (shared ? '（並列）' : ''), r.label, r.title, membersText(r.members), p.votes, cd.published ? '已公布' : '未公布']);
        });
      });
      return rows;
    }
    $('#exStatsCsv').onclick = () => exportRows(statsRows(), `醫護教育創意設計大賞_投票統計報表_${stamp()}`, 'csv');
    $('#exStatsXlsx').onclick = () => exportRows(statsRows(), `醫護教育創意設計大賞_投票統計報表_${stamp()}`, 'xlsx');
    $('#exRosterCsv').onclick = () => exportParticipation('csv');
    $('#exRosterXlsx').onclick = () => exportParticipation('xlsx');
    $('#exAwardCsv').onclick = () => { const r = awardRows(); if (r.length < 2) return toast('尚無確認的名次（請先結束投票並處理同票）'); exportRows(r, `醫護教育創意設計大賞_得獎名單_${stamp()}`, 'csv'); };
    $('#exAwardXlsx').onclick = () => { const r = awardRows(); if (r.length < 2) return toast('尚無確認的名次（請先結束投票並處理同票）'); exportRows(r, `醫護教育創意設計大賞_得獎名單_${stamp()}`, 'xlsx'); };

    start();
  };

  /* ------------------------------------------------------------------
     7. 頒獎典禮 results.html
     ------------------------------------------------------------------ */
  function FX(canvas) {
    const ctx = canvas.getContext('2d');
    let parts = [], raf = 0, w = 0, h = 0;
    function size() { const r = canvas.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); w = r.width; h = r.height; canvas.width = w * d; canvas.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
    const GOLD = ['#D4AF37', '#F3DE93', '#C5A46D', '#FFF5D1', '#E9C766', '#FFFFFF'];
    const MIX = ['#D4AF37', '#F3DE93', '#B8C2CC', '#B77B56', '#FFFFFF', '#C5A46D', '#A9B9C9'];
    function confetti(n, palette) {
      for (let i = 0; i < n; i++) parts.push({ k: 'c', x: Math.random() * w, y: -20 - Math.random() * h * 0.6, vx: (Math.random() - 0.5) * 60, vy: 70 + Math.random() * 120, r: Math.random() * 6, vr: (Math.random() - 0.5) * 6, s: 6 + Math.random() * 8, sw: Math.random() * 6, c: palette[i % palette.length], life: 0, max: 9 });
    }
    function sparkle(x, y, n) {
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260; parts.push({ k: 's', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, s: 2 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 5, c: GOLD[i % GOLD.length], life: 0, max: 1 + Math.random() * 1.2 }); }
    }
    function star(x, y, r, rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0); ctx.quadraticCurveTo(r * 0.18, r * 0.18, 0, r); ctx.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0); ctx.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r); ctx.fill(); ctx.restore(); }
    function loop() {
      cancelAnimationFrame(raf);
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        ctx.clearRect(0, 0, w, h);
        parts = parts.filter((p) => (p.life += dt) < p.max && p.y < h + 40);
        for (const p of parts) {
          if (p.k === 'c') { p.sw += dt * 2.4; p.x += (p.vx + Math.sin(p.sw) * 36) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = 0.92; ctx.fillStyle = p.c; const sc = Math.abs(Math.cos(p.sw)); ctx.fillRect(-p.s / 2, -p.s * 0.7 * sc / 2, p.s, p.s * 0.7 * sc + 1); ctx.restore(); }
          else { p.vx *= 0.96; p.vy = p.vy * 0.96 + 50 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; const k = 1 - p.life / p.max;
            ctx.globalAlpha = k; ctx.fillStyle = p.c; ctx.shadowColor = 'rgba(255,215,120,.9)'; ctx.shadowBlur = 10; star(p.x, p.y, p.s * (0.6 + 0.4 * k), p.r); ctx.shadowBlur = 0; }
        }
        ctx.globalAlpha = 1;
        if (parts.length) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, w, h);
      };
      raf = requestAnimationFrame(tick);
    }
    return {
      size,
      celebrate(gold) { size(); confetti(gold ? 170 : 90, gold ? GOLD : MIX); loop(); },
      sparkle(x, y, n = 60) { size(); sparkle(x, y, n); loop(); },
      clear() { parts = []; ctx.clearRect(0, 0, w, h); },
    };
  }

  AW.results = function () {
    const qs = new URLSearchParams(location.search);
    const R = { cat: qs.get('cat') === 'poster' ? 'poster' : 'pres', data: {}, steps: [], step: -1, auto: false, autoTimer: 0, isAdmin: false, ov: null };
    if (!boot('results')) return;
    const stage = $('#stage');
    const fx = FX($('#fx'));

    function slotHTML(place, entries) {
      const empty = !entries.length;
      return `<div class="slot p${place}${empty ? ' empty' : ''}" data-place="${place}">
        ${empty ? '' : trophySVG(PLACE[place].metal)}
        <div class="winners${entries.length > 1 ? ' multi' : ''}">${entries.map((e) => `
          <div class="wcard">
            <div class="place">${PLACE[place].zh}</div>
            <div class="place-en">${PLACE[place].en}</div>
            ${entries.length > 1 ? '<span class="tie">並列 · Tied</span>' : ''}
            <div class="grp">${esc(e.label)}</div>
            ${e.title ? `<div class="work">${esc(e.title)}</div>` : ''}
            <div class="names">${membersHTML(e.members)}</div>
            <span class="votes">得票 ${e.votes} 票</span>
          </div>`).join('')}</div>
        <div class="block"><span>${place}</span></div>
      </div>`;
    }

    function build() {
      const d = R.data[R.cat];
      clearTimeout(R.autoTimer);
      fx.clear();
      stage.className = 'stage';
      $('#stTitle').textContent = `${CAT[R.cat].ceremony}`;
      $('#stEn').textContent = CAT[R.cat].en;
      $('#stEvent').textContent = (d && d.event_name) || '醫護教育創意設計大賞';
      $('#gloryCat').textContent = `${(d && d.event_name) || ''}｜${CAT[R.cat].ceremony}`;
      $$('#catTabs button, .tb-cat').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === R.cat)));
      if (!d || !d.published) {
        $('#podium').innerHTML = '';
        $('#waiting').hidden = false;
        $('#startCover').hidden = true;
        $('#waitTitle').textContent = `${CAT[R.cat].label}得獎結果尚未公布`;
        R.steps = []; R.step = -1;
        updateBar();
        return;
      }
      $('#waiting').hidden = true;
      const by = { 1: [], 2: [], 3: [] };
      d.placements.forEach((p) => by[p.place] && by[p.place].push(p));
      $('#podium').innerHTML = slotHTML(2, by[2]) + slotHTML(1, by[1]) + slotHTML(3, by[3]);
      R.steps = ['glory'].concat([3, 2, 1].filter((p) => by[p].length)).concat(['final']);
      R.step = -1;
      $('#startCover').hidden = false;
      $('#startTitle').textContent = CAT[R.cat].ceremony;
      $('#startNote').textContent = d.placements.length ? '準備就緒。按下「開始頒獎」，依序揭曉第三名、第二名與第一名。' : '本類別沒有任何得票，無得獎組別。';
      $('#startBtn').disabled = !d.placements.length;
      updateBar();
    }

    const STEP_LABEL = { glory: '榮耀時刻', 3: '揭曉第三名', 2: '揭曉第二名', 1: '揭曉第一名', final: '完整得獎名單' };
    function updateBar() {
      const has = R.steps.length > 0;
      const started = R.step >= 0;
      $('#tbStart').textContent = started ? '重新播放' : '開始頒獎';
      $('#tbStart').disabled = !has;
      $('#tbNext').disabled = !has || !started || R.step >= R.steps.length - 1;
      $('#tbAuto').disabled = !has;
      $('#tbAuto').setAttribute('aria-pressed', String(R.auto));
      $('#tbAuto').textContent = R.auto ? '自動播放：開' : '自動播放：關';
      $('#tbPng').disabled = !has;
      $('#tbCsv').disabled = !has;
      $('#stepInd').textContent = started ? `${R.step + 1} / ${R.steps.length}　${STEP_LABEL[R.steps[R.step]]}` : (has ? '尚未開始' : '等待公布');
    }

    function slotEl(p) { return $(`.slot[data-place="${p}"]`, stage); }
    function revealPlace(p, instant) {
      const el = slotEl(p);
      if (!el) return;
      el.classList.add('rise');
      const showIt = () => {
        el.classList.add('show');
        if (instant) return;
        const r = el.querySelector('.trophy');
        const sr = stage.getBoundingClientRect();
        if (r) { const b = r.getBoundingClientRect(); fx.sparkle(b.left - sr.left + b.width / 2, b.top - sr.top + b.height * 0.35, p === 1 ? 90 : 45); }
        if (p === 1) { stage.classList.add('spot-on'); setTimeout(() => fx.celebrate(true), 500); }
      };
      if (instant) showIt(); else setTimeout(showIt, 700);
    }
    function go(i) {
      clearTimeout(R.autoTimer);
      if (i < 0 || i >= R.steps.length) return;
      R.step = i;
      const s = R.steps[i];
      $('#startCover').hidden = true;
      stage.classList.toggle('glory', s === 'glory');
      if (s === 'glory') {
        $$('.slot', stage).forEach((el) => el.classList.remove('rise', 'show'));
        stage.classList.remove('spot-on', 'final');
      } else if (s === 'final') {
        [3, 2, 1].forEach((p) => { const el = slotEl(p); if (el) { el.classList.add('rise'); if (!el.classList.contains('empty')) el.classList.add('show'); } });
        stage.classList.add('final');
        setTimeout(() => fx.celebrate(false), 300);
      } else {
        revealPlace(s, false);
        $$('.slot.empty', stage).forEach((el) => { if (+el.dataset.place > s) el.classList.add('rise'); });
      }
      updateBar();
      if (R.auto && i < R.steps.length - 1) R.autoTimer = setTimeout(() => go(i + 1), s === 'glory' ? 3200 : s === 1 ? 5200 : 4200);
    }
    function startCeremony() { fx.clear(); stage.className = 'stage'; $$('.slot', stage).forEach((el) => el.classList.remove('rise', 'show')); setTimeout(() => go(0), 80); }
    function jumpFinal() {
      clearTimeout(R.autoTimer);
      $('#startCover').hidden = true;
      stage.classList.remove('glory');
      [3, 2, 1].forEach((p) => { const el = slotEl(p); if (el) { el.classList.add('rise'); if (!el.classList.contains('empty')) el.classList.add('show'); } });
      stage.classList.add('final', 'spot-on');
      R.step = R.steps.length - 1;
      updateBar();
    }

    async function load(cat, rebuild) {
      const d = await rpc('aw_public_results', { p_cat: cat });
      const prev = R.data[cat];
      R.data[cat] = d;
      const changed = !prev || prev.published !== d.published || JSON.stringify(prev.placements) !== JSON.stringify(d.placements);
      if (cat === R.cat && (rebuild || (changed && R.step < 0))) build();
    }
    function setCat(c) {
      R.cat = c;
      history.replaceState(null, '', `?cat=${c}`);
      R.auto = false;
      build();
      load(c, true).catch((e) => toast(errMsg(e), true));
      if (R.isAdmin) renderAdminStats();
    }

    poller(() => load(R.cat, false), 5000);

    /* 工具列 */
    $('#startBtn').onclick = startCeremony;
    $('#tbStart').onclick = startCeremony;
    $('#tbNext').onclick = () => go(R.step + 1);
    $('#tbAuto').onclick = () => { R.auto = !R.auto; updateBar(); if (R.auto && R.step >= 0 && R.step < R.steps.length - 1) R.autoTimer = setTimeout(() => go(R.step + 1), 1500); if (!R.auto) clearTimeout(R.autoTimer); };
    $$('#catTabs button, .tb-cat').forEach((b) => (b.onclick = () => setCat(b.dataset.cat)));
    const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    function toggleFull() {
      const el = document.documentElement;
      if (!isFull()) { const r = el.requestFullscreen || el.webkitRequestFullscreen; if (r) { const p = r.call(el); if (p && p.catch) p.catch(() => document.body.classList.toggle('present')); } else document.body.classList.toggle('present'); }
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
      document.body.classList.toggle('present', isFull());
      $('#tbFull').textContent = isFull() ? '結束全螢幕' : '全螢幕';
      fx.size();
    }));
    $('#tbFull').onclick = toggleFull;
    $('#presentBtn').onclick = toggleFull;
    const toggleTools = () => { const hidden = $('#toolbar').classList.toggle('hidden'); $('#showTools').hidden = !hidden; };
    $('#tbHide').onclick = toggleTools;
    $('#showTools').onclick = toggleTools;
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input,textarea,select')) return;
      if ([' ', 'ArrowRight', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); if (R.step < 0) { if (R.steps.length) startCeremony(); } else go(R.step + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (R.step > 0) { const target = R.step - 1; startCeremonyTo(target); } }
      else if (e.key.toLowerCase() === 'h') toggleTools();
      else if (e.key.toLowerCase() === 'f') toggleFull();
    });
    function startCeremonyTo(target) {
      const keepAuto = R.auto; R.auto = false;
      fx.clear(); stage.className = 'stage';
      $$('.slot', stage).forEach((el) => el.classList.remove('rise', 'show'));
      for (let i = 0; i <= target; i++) {
        const s = R.steps[i];
        if (typeof s === 'number') { const el = slotEl(s); el.classList.add('rise', 'show'); if (s === 1) stage.classList.add('spot-on'); }
      }
      R.step = target;
      stage.classList.toggle('glory', R.steps[target] === 'glory');
      $('#startCover').hidden = true;
      R.auto = keepAuto;
      updateBar();
    }

    $('#tbPng').onclick = async () => {
      if (!window.html2canvas) return toast('截圖元件未載入', true);
      if (R.step !== R.steps.length - 1) jumpFinal();
      const btn = $('#tbPng'); btn.classList.add('loading');
      await sleep(1700);
      stage.classList.add('capturing');
      try {
        const canvas = await window.html2canvas(stage, { scale: 2, backgroundColor: '#F8F6F1', useCORS: true, logging: false, ignoreElements: (el) => el.classList && (el.classList.contains('rays') || el.classList.contains('spot') || el.id === 'fx') });
        canvas.toBlob((b) => download(b, `醫護教育創意設計大賞_${CAT[R.cat].label}得獎畫面.png`), 'image/png');
        toast('已匯出得獎畫面 PNG');
      } catch (e) { toast('匯出失敗：' + e.message, true); }
      finally { stage.classList.remove('capturing'); btn.classList.remove('loading'); }
    };
    $('#tbCsv').onclick = () => {
      const rows = [['競賽類別', '名次', '組別', '作品名稱', '組員姓名', '得票數']];
      ['pres', 'poster'].forEach((c) => {
        const d = R.data[c];
        if (!d || !d.published) return;
        d.placements.forEach((p) => rows.push([CAT[c].label, PLACE[p.place].zh + (d.placements.filter((x) => x.place === p.place).length > 1 ? '（並列）' : ''), p.label, p.title, membersText(p.members), p.votes]));
      });
      if (rows.length < 2) return toast('尚無已公布的得獎結果');
      exportRows(rows, `醫護教育創意設計大賞_得獎名單_${stamp()}`, 'xlsx');
    };

    /* 教師專用：票數統計（需登入） */
    async function checkAdmin() {
      try {
        const { data } = await db().auth.getSession();
        if (!data.session) return;
        const who = await rpc('aw_admin_whoami');
        R.isAdmin = !!who.is_admin;
        $('#statsToggle').hidden = !R.isAdmin;
      } catch (e) { /* 一般觀眾：不顯示 */ }
    }
    async function renderAdminStats() {
      if (!R.isAdmin || $('#statsView').hidden) return;
      try {
        R.ov = await rpc('aw_admin_overview');
        $('#statsTitle').textContent = `${CAT[R.cat].label}票數統計（教師專用）`;
        renderBars($('#statsBars'), R.ov.categories[R.cat], R.ov.ballots, R.cat);
      } catch (e) { toast(errMsg(e), true); }
    }
    $('#statsToggle').onclick = () => { const v = $('#statsView'); v.hidden = !v.hidden; $('#statsToggle').textContent = v.hidden ? '顯示票數統計' : '隱藏票數統計'; renderAdminStats(); if (!v.hidden) v.scrollIntoView({ behavior: 'smooth' }); };
    checkAdmin();

    build();
    load(R.cat, true).catch((e) => toast(errMsg(e), true));
    load(R.cat === 'pres' ? 'poster' : 'pres', false).catch(() => {});
    window.addEventListener('resize', () => fx.size());
  };
})();
