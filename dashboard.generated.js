if (window.location.protocol === 'file:') {
      window.location.replace('http://localhost:3000/dashboard.html' + window.location.search + window.location.hash);
    }

;

const PROVIDER_TOKEN_KEY = 'vg_ptk';
    const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;

    function looksLikeProviderToken(token) {
      return typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
    }

    function setProviderToken(token) {
      if (!looksLikeProviderToken(token)) return;
      try {
        sessionStorage.setItem(PROVIDER_TOKEN_KEY, JSON.stringify({
          value: token,
          expiresAt: Date.now() + PROVIDER_TOKEN_TTL_MS
        }));
      } catch (e) {
        console.warn('Could not persist provider token in session storage:', e);
      }
    }

    function getProviderToken() {
      try {
        var raw = sessionStorage.getItem(PROVIDER_TOKEN_KEY);
        if (!raw) return '';
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (parsed && parsed.value) {
          if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
            clearProviderToken();
            return '';
          }
          return looksLikeProviderToken(parsed.value) ? parsed.value : '';
        }
        if (looksLikeProviderToken(raw)) {
          setProviderToken(raw);
          return raw;
        }
        clearProviderToken();
        return '';
      } catch (e) {
        return '';
      }
    }

    function clearProviderToken() {
      try {
        sessionStorage.removeItem(PROVIDER_TOKEN_KEY);
      } catch (e) {
        console.warn('Could not clear provider token from session storage:', e);
      }
    }

    window.setProviderToken = setProviderToken;
    window.getProviderToken = getProviderToken;
    window.clearProviderToken = clearProviderToken;

    function purgeLegacySensitiveStorage() {
      try {
        [
          'gmail_access_token',
          'gmail_refresh_token',
          'gmail_user_token',
          'slack_access_token',
          'slack_refresh_token',
          'slack_user_token',
          'hubspot_access_token',
          'hubspot_refresh_token',
          'hubspot_user_token',
          'notion_access_token',
          'notion_refresh_token',
          'notion_user_token',
          'discord_access_token',
          'discord_refresh_token',
          'discord_user_token',
          'sf_access_token',
          'sf_refresh_token',
          'sf_user_token'
        ].forEach(function (key) { localStorage.removeItem(key); });
      } catch (e) {
        console.warn('Legacy token cleanup skipped:', e);
      }
    }
    purgeLegacySensitiveStorage();

    try {
      var isPopup = (window.name === 'GoogleAuth');
      var rawHash = window.location.hash;
      var params = window.location.search || rawHash.substring(1);
      var pTkk = null;

      if (params) {
        var p = new URLSearchParams(params.replace('?', ''));
        pTkk = p.get('provider_token');
        if (pTkk) {
          setProviderToken(pTkk);
          var clean = new URL(window.location.href);
          clean.searchParams.delete('provider_token');
          clean.searchParams.delete('access_token');
          clean.searchParams.delete('refresh_token');
          clean.searchParams.delete('expires_in');
          clean.searchParams.delete('token_type');
          if (clean.hash && (clean.hash.includes('provider_token=') || clean.hash.includes('access_token=') || clean.hash.includes('refresh_token='))) clean.hash = '';
          window.history.replaceState({}, document.title, clean.pathname + clean.search + clean.hash);
        }
      }

      if (isPopup) {
        // Browser strict security often blocks window.close(), so we hide the dashboard UI so the user isn't confused.
        document.addEventListener("DOMContentLoaded", () => {
          document.body.textContent = '';
          var wrap = document.createElement('div');
          wrap.style.cssText = 'background:#111;color:#0f0;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;';
          var title = document.createElement('h2');
          title.textContent = 'Login successful';
          var msg = document.createElement('p');
          msg.textContent = 'You can close this small window safely.';
          wrap.appendChild(title);
          wrap.appendChild(msg);
          document.body.appendChild(wrap);
        });
        window.close(); // Try to close anyway
      }
    } catch (e) { console.error(e); }

    window.supabaseClient = null;
    window.isUserLoggedIn = false;

    async function loadPublicConfig() {
      var cfgResp = await fetch('/api/public-config', { method: 'GET', credentials: 'same-origin' });
      var cfg = await cfgResp.json().catch(function () { return {}; });
      if (!cfgResp.ok) throw new Error(cfg.error || 'Missing public auth config');
      return cfg;
    }

    async function initializeSupabaseClient() {
      try {
        var cfg = await loadPublicConfig();
        window.supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

        window.supabaseClient.auth.onAuthStateChange((event, session) => {
          window.isUserLoggedIn = !!session;
          if (session && session.provider_token) {
            setProviderToken(session.provider_token);
            window.isGlobalGmailConnected = true;
            if (window.name === 'GoogleAuth' || window.opener) {
              window.close(); // Automatically close popup after Supabase parses token!
            }
          } else if (event === 'SIGNED_OUT') {
            clearProviderToken();
          }
        });
      } catch (error) {
        console.error('Supabase init failed:', error);
        window.supabaseClient = null;
      }
    }

    async function checkAuth() {
      if (!window.supabaseClient) return;
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) {
        console.log('User not authenticated, but allowing them to view the dashboard.');
      }
      window.isUserLoggedIn = !!session;
      if (session && session.provider_token) setProviderToken(session.provider_token);
    }

    initializeSupabaseClient().then(() => {
      checkAuth().catch(function (error) { console.warn('Auth check failed:', error); });
    });

;

function waitForSupabaseClient(timeoutMs) {
      return new Promise(function (resolve) {
        var start = Date.now();
        (function poll() {
          if (window.supabaseClient) return resolve(window.supabaseClient);
          if (Date.now() - start > timeoutMs) return resolve(null);
          setTimeout(poll, 80);
        })();
      });
    }

    async function getSupabaseSession() {
      var client = window.supabaseClient || await waitForSupabaseClient(2200);
      if (!client || !client.auth) return null;
      try {
        var result = await client.auth.getSession();
        return result && result.data ? result.data.session : null;
      } catch (e) {
        return null;
      }
    }

    async function getProviderTokenFromSession() {
      var session = await getSupabaseSession();
      if (session && session.provider_token) {
        if (window.setProviderToken) window.setProviderToken(session.provider_token);
        return session.provider_token;
      }
      return window.getProviderToken ? window.getProviderToken() : '';
    }

    window.getSupabaseSession = getSupabaseSession;
    window.getProviderTokenFromSession = getProviderTokenFromSession;

;

var tid = null;

    // Read provider token only from this browser tab session to reduce leakage.
    function getPTk() {
      if (window.getProviderToken) return window.getProviderToken();
      return '';
    }
    function isConnected() { return !!localStorage.getItem('gmail_composio_connected') || !!getPTk(); }

    // Watcher: Automatically updates the UI if the token arrives via Head Script asynchronously
    setInterval(function () {
      var b = document.getElementById('gcb');
      if (b && isConnected() && b.textContent === 'Connect') {
        updateGUI(true);
      }
    }, 500);

    // Version: Composio_v2_Fixed
    console.log("Flowlet AI: Composio Integration Loaded");

    function openConnectionsModal() {
      document.getElementById('connections-modal').style.display = 'flex';
      updateGUI(isConnected());
    }
    function closeConnectionsModal() {
      document.getElementById('connections-modal').style.display = 'none';
    }

    function updateGUI(c) {
      var gBtn = document.getElementById('m-g-btn'), cBtn = document.getElementById('m-c-btn');
      try {
        var b = document.getElementById('gcb'), s = document.getElementById('gst');
        if (s) s.textContent = 'Checking connection...';
        if (!window.supabaseClient || !window.supabaseClient.auth) {
          if (s) s.textContent = 'Auth client initializing...';
          return;
        }

        window.supabaseClient.auth.getSession().then(({ data, error }) => {
          var session = data ? data.session : null;
          var hasLocal = !!getPTk();
          var hasSessPtk = session && session.provider_token;

          var dbg = "URL Hash: " + (window.location.hash ? window.location.hash.substring(0, 20) + "..." : "None") + " | ";
          dbg += "Local: " + hasLocal + " | ";
          dbg += "Sess: " + (session ? "YES" : "NO") + " | ";
          dbg += "Sess.pTk: " + !!hasSessPtk + " | ";
          if (error) dbg += "Err: " + error.message;

          var cb = document.getElementById('ccb'), cs = document.getElementById('cst');

          if (c) {
            if (b) { b.textContent = 'Connected \u2713'; b.className = 'con-btn ok'; }
            if (s) { s.textContent = 'Active | ' + dbg; s.style.color = 'var(--gr)'; }
            if (cb) { cb.textContent = 'Connected \u2713'; cb.className = 'con-btn ok'; }
            if (cs) { cs.textContent = 'Active'; cs.style.color = 'var(--gr)'; }
            if (gBtn) { gBtn.textContent = 'Disconnect'; gBtn.className = 'int-dis'; }
            if (cBtn) { cBtn.textContent = 'Disconnect'; cBtn.className = 'int-dis'; }
          } else {
            if (b) { b.textContent = 'Connect'; b.className = 'con-btn'; }
            if (s) { s.textContent = dbg; s.style.color = 'var(--mu)'; }
            if (cb) { cb.textContent = 'Connect'; cb.className = 'con-btn'; }
            if (cs) { cs.textContent = 'Not connected'; cs.style.color = 'var(--mu)'; }
            if (gBtn) { gBtn.textContent = 'Connect'; gBtn.className = 'int-btn'; }
            if (cBtn) { cBtn.textContent = 'Connect'; cBtn.className = 'int-btn'; }
          }
        }).catch(e => {
          if (s) s.textContent = "Fail: " + e.message;
        });
      } catch (err) {
        if (s) s.textContent = "Fatal: " + err.message;
      }
    }

    // STORAGE
    var ST = 'vt';
    (function cleanOldBackendErrors() {
      try {
        var raw = localStorage.getItem(ST);
        if (!raw) return;
        var chats = JSON.parse(raw);
        if (!Array.isArray(chats)) return;
        var changed = false;
        chats.forEach(function (chat) {
          if (!Array.isArray(chat.messages)) return;
          var before = chat.messages.length;
          chat.messages = chat.messages.filter(function (message) {
            return !(message && (message.role === 'ai' || message.role === 'assistant') && String(message.text || '').includes('Chat backend connect nahi ho paaya'));
          });
          if (chat.messages.length !== before) changed = true;
        });
        if (changed) localStorage.setItem(ST, JSON.stringify(chats));
      } catch (e) {
        console.warn('Chat cleanup skipped:', e);
      }
    })();
    function all() { try { return JSON.parse(localStorage.getItem(ST)) || []; } catch (e) { return []; } }
    function redactSensitiveText(value) {
      return String(value || '')
        .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted-api-key]')
        .replace(/\b(ya29\.[A-Za-z0-9._-]{20,})\b/g, '[redacted-google-token]')
        .replace(/\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g, '[redacted-slack-token]')
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/gi, '$1[redacted-token]')
        .replace(/\b(refresh_token|access_token|provider_token)=([^&\s]+)/gi, '$1=[redacted]');
    }
    function sanitizeChatForStorage(chats) {
      if (!Array.isArray(chats)) return [];
      return chats.slice(0, 50).map(function (chat) {
        var safe = Object.assign({}, chat);
        safe.title = redactSensitiveText(safe.title || 'New Chat').slice(0, 80);
        safe.messages = Array.isArray(chat.messages)
          ? chat.messages.slice(-80).map(function (message) {
              return {
                role: message && message.role === 'user' ? 'user' : 'ai',
                text: redactSensitiveText(message && message.text)
              };
            })
          : [];
        return safe;
      });
    }
    function save(t) { localStorage.setItem(ST, JSON.stringify(sanitizeChatForStorage(t))); }
    function gt(id) { return all().find(function (t) { return t.id === id; }) || null; }
    function push(role, txt) { var safeTxt = redactSensitiveText(txt); var ts = all(), t = ts.find(function (x) { return x.id === tid; }); if (!t) { t = { id: tid, title: safeTxt.substring(0, 38) + (safeTxt.length > 38 ? '\u2026' : ''), messages: [], at: Date.now() }; ts.unshift(t); } t.messages.push({ role: role, text: safeTxt }); save(ts); renderList(); }

    function deleteT(id) {
      var ts = all();
      var filtered = ts.filter(function (x) { return x.id !== id; });
      save(filtered);
      if (tid === id) { newT(); } else { renderList(); }
    }

    function getRelativeTime(timestamp) {
      if (!timestamp) return '1m';
      var diff = Date.now() - timestamp;
      var mins = Math.floor(diff / 60000);
      if (mins < 60) return mins + 'm';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h';
      var days = Math.floor(hrs / 24);
      if (days < 7) return days + 'd';
      var weeks = Math.floor(days / 7);
      return weeks + 'w';
    }

    function seedChatsIfEmpty() {
      var key = 'vt';
      try {
        var existing = localStorage.getItem(key);
        if (existing) {
          var parsed = JSON.parse(existing);
          if (parsed && parsed.length > 0 && parsed[0].title === 'Add heartbeat attention ...') {
            parsed[0].title = 'I heartbeat attention ...';
            localStorage.setItem(key, JSON.stringify(parsed));
          }
        }
        if (!existing || JSON.parse(existing).length === 0) {
          var sixDaysAgo = Date.now() - 6 * 24 * 3600 * 1000;
          var oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;
          var seed = [
            { id: 'seed1', title: 'I heartbeat attention ...', messages: [{role: 'user', text: 'I heartbeat attention to the system'}, {role: 'ai', text: 'I have added the heartbeat attention mechanism.'}], at: sixDaysAgo },
            { id: 'seed2', title: 'Greet user', messages: [{role: 'user', text: 'Greet user'}, {role: 'ai', text: 'Hello! How can I assist you today?'}], at: sixDaysAgo },
            { id: 'seed3', title: 'Create priorities Notion ...', messages: [{role: 'user', text: 'Create priorities Notion page'}, {role: 'ai', text: 'I have set up the priorities page in your Notion database.'}], at: sixDaysAgo },
            { id: 'seed4', title: 'Break down team triage', messages: [{role: 'user', text: 'Break down team triage process'}, {role: 'ai', text: 'Here is a breakdown of the team triage workflows.'}], at: sixDaysAgo },
            { id: 'seed5', title: 'Define AI', messages: [{role: 'user', text: 'Define AI'}, {role: 'ai', text: 'Artificial Intelligence refers to the simulation of human intelligence in machines.'}], at: oneWeekAgo },
            { id: 'seed6', title: 'Say hello', messages: [{role: 'user', text: 'Say hello'}, {role: 'ai', text: 'Hello! Nice to meet you.'}], at: oneWeekAgo }
          ];
          localStorage.setItem(key, JSON.stringify(seed));
        }
      } catch (e) {
        console.warn('Seeding failed', e);
      }
    }

    function renderList() {
      seedChatsIfEmpty();
      var l = document.getElementById('tlist');
      if (!l) return;
      l.innerHTML = '';
      all().slice(0, 25).forEach(function (t) {
        var isPinned = t.title.includes('heartbeat');
        var d = document.createElement('div');
        d.className = 'sb-item' + (t.id === tid || isPinned ? ' on' : '');
        d.style.cssText = 'display:flex; align-items:center; justify-content:space-between; cursor:pointer; width:100%; box-sizing:border-box; position:relative;';

        // Left side: Title
        var titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left; font-size:13.5px; display:flex; align-items:center; gap:6px;';
        
        if (isPinned) {
          titleSpan.innerHTML = '<svg class="chat-pin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.89A2 2 0 0 0 5 15.24Z"></path></svg>';
          var pinnedTitle = document.createElement('span');
          pinnedTitle.textContent = t.title || 'New Chat';
          titleSpan.appendChild(pinnedTitle);
        } else {
          titleSpan.textContent = t.title || 'New Chat';
        }
        
        d.appendChild(titleSpan);

        // Right side container for Time / Options
        var rightContainer = document.createElement('div');
        rightContainer.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; min-width:32px; height:18px; margin-left:8px;';

        if (isPinned) {
          var archiveIcon = document.createElement('div');
          archiveIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>';
          rightContainer.appendChild(archiveIcon);
        } else {
          // Time Label
          var timeLabel = document.createElement('span');
          timeLabel.className = 'sb-time-label';
          timeLabel.style.cssText = 'font-size:11px; color:#52525b; font-weight:500; transition:opacity 0.15s;';
          timeLabel.textContent = getRelativeTime(t.at);
          rightContainer.appendChild(timeLabel);
        }

        // Options Button (visible on hover via class styles)
        var delBtn = document.createElement('button');
        delBtn.className = 't-opt-btn';
        delBtn.style.cssText = 'background:transparent; border:none; color:inherit; cursor:pointer; display:none; padding:2px; line-height:0;';
        delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
        delBtn.title = "Options";

        delBtn.onclick = function (e) {
          e.stopPropagation();
          showChatMenu(e, t.id);
        };
        rightContainer.appendChild(delBtn);

        d.appendChild(rightContainer);

        // Click handling
        d.onclick = function () { loadT(t.id); };
        
        l.appendChild(d);
      });
    }



    // Auth state check
    function isLoggedIn() {
      return !!window.isUserLoggedIn;
    }

    // VIEWS Ã¢â‚¬â€ sidebar shows on chat, hides on home
    function goHome() {
      document.body.classList.remove('dashboard-active');
	      if (isLoggedIn()) {
	        goChat();
	        return;
	      }
	      const home = document.getElementById('home');
	      const chat = document.getElementById('chat');
	      const adv = document.getElementById('advanced-dashboard');
	      const sb = document.getElementById('sidebar');
	      const sp = document.getElementById('spreadsheet-view');
	      const plugins = document.getElementById('plugins-view');
	      const demo = document.getElementById('perplexity-demo-view');
	      const main = document.querySelector('.main');

      if (home) {
        home.style.display = 'flex';
        home.style.backgroundImage = 'none';
      }
	      if (chat) chat.style.display = 'none';
	      if (adv) adv.style.display = 'none';
	      if (sp) sp.style.display = 'none';
	      if (plugins) plugins.style.display = 'none';
	      if (demo) demo.style.display = 'none';
	      if (main) main.style.display = 'flex';

      // Hide sidebar on landing page when not logged in
      if (sb) {
        sb.style.display = 'none';
        sb.classList.add('hidden');
      }
    }
	    function goChat() {
	      document.body.classList.add('dashboard-active');
	      const home = document.getElementById('home');
	      const chat = document.getElementById('chat');
	      const adv = document.getElementById('advanced-dashboard');
	      const sp = document.getElementById('spreadsheet-view');
	      const plugins = document.getElementById('plugins-view');
	      const demo = document.getElementById('perplexity-demo-view');
	      const sb = document.getElementById('sidebar');
	      const main = document.querySelector('.main');

	      if (home) home.style.display = 'none';
	      if (adv) adv.style.display = 'none';
	      if (chat) chat.style.display = 'none';
	      if (main) main.style.display = 'none';
	      if (plugins) plugins.style.display = 'none';
	      if (demo) demo.style.display = 'none';

      // Keep sidebar visible in the dashboard chat view
      if (sb) {
        sb.style.display = 'flex';
        sb.classList.remove('hidden');
      }

	      if (sp) {
	        sp.style.display = 'flex';
        var typedEl = document.getElementById('adv-ci');
        var typed = typedEl ? typedEl.value.trim() : '';
        if (typed && document.getElementById('sp-chat-content')) {
          document.getElementById('sp-chat-content').textContent = typed;
        }
      }
    }
    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('hidden');
    }

    function newT() { 
      tid = 't' + Date.now(); 
      var mhTarget = document.getElementById('sp-mh'); 
      if(mhTarget) mhTarget.innerHTML = ''; 
      goHome(); 
      renderList(); 
      refreshWorkspaceEmptyState();
      // Focus sp-ci input box
      const inp = document.getElementById('sp-ci');
      if (inp) setTimeout(() => inp.focus(), 100);
    }
    function loadT(id) { 
      tid = id; 
      var mhTarget = document.getElementById('sp-mh'); 
      if(mhTarget) mhTarget.innerHTML = ''; 
      var t = gt(id); 
      if (t && t.messages && t.messages.length) { 
        goChat(); 
        t.messages.forEach(function (m) { addMsg(m.role, m.text, false); }); 
      } else { 
        goHome(); 
      } 
      renderList(); 
      refreshWorkspaceEmptyState();
    }

    // MESSAGES
    function addMsg(role, txt, anim, stream) {
      if (role === 'assistant') role = 'ai';
      if (anim !== false) goChat();
      var displayTxt = role === 'ai' ? formatAiDisplayText(txt) : txt;
      var w = document.createElement('div');
      w.className = 'msg ' + role;
      var b = document.createElement('div');
      b.className = 'bubble';
      w.appendChild(b);

      var txtWrap = b;

      if (role === 'ai') {
        b.innerHTML = ''; // clear
        txtWrap = document.createElement('div');
        txtWrap.className = 'ai-text-wrap';

        b.appendChild(txtWrap);
      }

      var mhTarget = document.getElementById('sp-mh');
      if (mhTarget) {
        mhTarget.appendChild(w);
        if (typeof isSPActive === 'function' && isSPActive()) {
          var spt = document.getElementById('sp-title');
          var spb = document.getElementById('sp-btns');
          var spe = document.getElementById('sp-extra-btns');
          var spp = document.getElementById('sp-prospecting');
          if (spt) spt.style.display = 'none';
          if (spb) spb.style.display = 'none';
          if (spe) spe.style.display = 'none';
          if (spp) spp.style.display = 'none';
        }
      }
      refreshWorkspaceEmptyState();

      if (stream && role === 'ai') {
        var i = 0;
        function nextChunk(text, idx) {
          var remaining = text.length - idx;
          if (remaining <= 0) return 0;
          if (remaining < 220) return 4;
          if (remaining < 900) return 8;
          return 14;
        }
        function nextDelay(text, idx) {
          var ch = text.charAt(Math.max(0, idx - 1));
          if (/[.!?]/.test(ch)) return 160 + Math.floor(Math.random() * 80);
          if (/[,;:]/.test(ch)) return 90 + Math.floor(Math.random() * 60);
          if (/\n/.test(ch)) return 110 + Math.floor(Math.random() * 70);
          return 18 + Math.floor(Math.random() * 18);
        }
        function typeW() {
          if (window.stopStream) {
            addActions(b);
            addMsgCopyButton(w, txt, 'ai');
            resetSendButtons();
            return;
          }
          if (i < txt.length) {
            i += nextChunk(txt, i);
            var partialText = txt.substring(0, i);
            txtWrap.innerHTML = renderMarkdownToHtml(partialText);
            scroll();
            setTimeout(typeW, nextDelay(txt, i));
          } else {
            txtWrap.innerHTML = renderMarkdownToHtml(txt);
            applyAiTextMode(txtWrap, txt);
            addActions(b);
            addMsgCopyButton(w, txt, 'ai');
            resetSendButtons();
          }
        }
        typeW();
      } else {
        if (role === 'ai') renderAiDisplay(txtWrap, txt);
        else txtWrap.textContent = displayTxt;
        if (role === 'ai') {
          applyAiTextMode(txtWrap, txt);
          addActions(b);
          addMsgCopyButton(w, txt, 'ai');
        } else {
          addMsgCopyButton(w, txt, 'user');
        }
        scroll();
      }
    }

    function addMsgCopyButton(w, text, role) {
      if (!w) return;
      var metaRow = document.createElement('div');
      metaRow.className = 'msg-meta';
      if (role === 'user') {
        var timeLabel = document.createElement('span');
        timeLabel.className = 'msg-time';
        timeLabel.textContent = formatMsgTime(new Date());
        metaRow.appendChild(timeLabel);
      } else {
        metaRow.classList.add('ai-meta');
      }
      
      var copyBtn = document.createElement('button');
      copyBtn.className = 'msg-copy-btn';
      copyBtn.innerHTML = getCopyIconSvg();
      copyBtn.title = 'Copy message';
      copyBtn.onclick = function() {
        navigator.clipboard.writeText(text).then(function() {
          copyBtn.innerHTML = getCopiedIconSvg();
          setTimeout(function() {
            copyBtn.innerHTML = getCopyIconSvg();
          }, 1500);
        });
      };
      metaRow.appendChild(copyBtn);
      if (role === 'user') {
        var editBtn = document.createElement('button');
        editBtn.className = 'msg-copy-btn msg-edit-btn';
        editBtn.innerHTML = getEditIconSvg();
        editBtn.title = 'Edit message';
        editBtn.onclick = function() {
          var el = document.getElementById('sp-ci') || document.querySelector('.demo-search-input');
          if (el) {
            el.value = text;
            resizeInputField(el);
            el.focus();
          }
        };
        metaRow.appendChild(editBtn);
      }
      w.appendChild(metaRow);
    }

    function formatMsgTime(date) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function applyAiTextMode(el, raw) {
      if (!el) return;
      // Always remove code-ish - prose AI responses should never use monospace font
      // The code-ish class was incorrectly matching words like "from Notion" or "functionalities"
      el.classList.remove('code-ish');
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      });
    }

    function getCopyIconSvg() {
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }

    function getCopiedIconSvg() {
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }

    function getEditIconSvg() {
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
    }

    function setCopyBtnState(btn, copied) {
      if (!btn) return;
      if (btn._copyResetTimer) {
        clearTimeout(btn._copyResetTimer);
        btn._copyResetTimer = null;
      }
      if (copied) {
        btn.classList.add('copied');
        btn.dataset.copied = '1';
        btn.innerHTML = getCopiedIconSvg();
      } else {
        btn.classList.remove('copied');
        btn.dataset.copied = '0';
        btn.innerHTML = getCopyIconSvg();
      }
    }

    window.copyCode = function(btn) {
      if (btn && btn.dataset.copied === '1') {
        setCopyBtnState(btn, false);
        return;
      }
      var container = btn.closest('.code-block-container');
      if (!container) return;
      var codeEl = container.querySelector('code');
      if (!codeEl) return;
      navigator.clipboard.writeText(codeEl.innerText).then(function() {
        setCopyBtnState(btn, true);
        btn._copyResetTimer = setTimeout(function() {
          setCopyBtnState(btn, false);
        }, 1700);
      }).catch(function(err) {
        console.error('Failed to copy code: ', err);
      });
    };

    function boldBeforeColon(text) {
      if (text.includes('<strong>') || text.includes('<b>')) return text;
      var colonIdx = text.indexOf(':');
      if (colonIdx > 0 && colonIdx < 50) {
        var key = text.substring(0, colonIdx);
        var val = text.substring(colonIdx + 1);
        return '<strong>' + key + ':</strong>' + val;
      }
      return text;
    }

    function formatAiInline(value) {
      var html = escapeHtml(value)
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
      return boldBeforeColon(html);
    }

    function sanitizeAiHtml(html) {
      var template = document.createElement('template');
      template.innerHTML = String(html || '');
      var allowedTags = new Set([
        'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE',
        'DIV', 'SPAN', 'BUTTON', 'H3', 'H4', 'H5', 'H6'
      ]);
      var allowedClasses = new Set([
        'ai-header', 'ai-line-heading', 'inline-code', 'code-block-container',
        'code-block-header', 'code-block-lang', 'copy-code-btn',
        'tok-key', 'tok-str', 'tok-com', 'tok-fn', 'tok-type', 'tok-num', 'tok-anno'
      ]);
      Array.from(template.content.querySelectorAll('*')).forEach(function (node) {
        if (!allowedTags.has(node.tagName)) {
          node.replaceWith(document.createTextNode(node.textContent || ''));
          return;
        }
        Array.from(node.attributes).forEach(function (attr) {
          var name = attr.name.toLowerCase();
          if (name === 'class') {
            var safeClasses = attr.value.split(/\s+/).filter(function (cls) { return allowedClasses.has(cls); });
            if (safeClasses.length) node.setAttribute('class', safeClasses.join(' '));
            else node.removeAttribute('class');
            return;
          }
          if (name === 'data-copied' || name === 'data-copy-code' || name === 'aria-label') return;
          node.removeAttribute(attr.name);
        });
      });
      return template.innerHTML;
    }

    function highlightCodeSnippet(source) {
      var placeholders = [];
      function stash(type, text) {
        var key = '@@' + '!'.repeat(placeholders.length + 1) + '@@';
        placeholders.push({ key: key, type: type, text: text });
        return key;
      }

      var work = String(source || '');
      work = work.replace(/\/\/[^\n]*|#[^\n]*/g, function (m) { return stash('com', m); });
      work = work.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, function (m) { return stash('str', m); });
      work = escapeHtml(work);

      work = work.replace(/(^|\s)(@[A-Za-z_]\w*)/gm, function (_, lead, anno) {
        return lead + stash('anno', anno);
      });
      work = work.replace(/\b(?:suspend|fun|class|interface|data|object|return|if|else|for|while|try|catch|finally|import|from|const|let|var|function|def|async|await|public|private|protected|static|new|true|false|null|undefined|in|is|when|package|val|void)\b/g, function (m) {
        return stash('key', m);
      });
      work = work.replace(/\b([A-Za-z_]\w*)(?=\s*\()/g, function (m) {
        return stash('fn', m);
      });
      work = work.replace(/\b[A-Z][A-Za-z0-9_]*\b/g, function (m) {
        return stash('type', m);
      });
      work = work.replace(/\b\d+(?:\.\d+)?\b/g, function (m) {
        return stash('num', m);
      });

      for (var i = 0; i < placeholders.length; i++) {
        var token = placeholders[i];
        var replacement = '<span class="tok-' + token.type + '">' + escapeHtml(token.text) + '</span>';
        work = work.split(token.key).join(replacement);
      }
      return work;
    }

    function renderMarkdownToHtml(text) {
      if (!text) return '';
      
      // Strip thought blocks
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
      
      var html = '';
      var blocks = [];
      var lastIdx = 0;
      var regex = /```/g;
      var match;
      var isInsideCode = false;
      var currentLang = 'text';
      var currentCode = '';
      
      while ((match = regex.exec(text)) !== null) {
        var tickIndex = match.index;
        var contentBefore = text.substring(lastIdx, tickIndex);
        
        if (isInsideCode) {
          currentCode += contentBefore;
          blocks.push({ type: 'code', lang: currentLang, content: currentCode });
          isInsideCode = false;
          currentCode = '';
        } else {
          blocks.push({ type: 'text', content: contentBefore });
          isInsideCode = true;
          
          var rest = text.substring(tickIndex + 3);
          var lineEnd = rest.indexOf('\n');
          if (lineEnd !== -1 && lineEnd < 20) {
            currentLang = rest.substring(0, lineEnd).trim() || 'text';
            regex.lastIndex = tickIndex + 3 + lineEnd + 1;
          } else {
            currentLang = 'text';
            regex.lastIndex = tickIndex + 3;
          }
        }
        lastIdx = regex.lastIndex;
      }
      
      var remaining = text.substring(lastIdx);
      if (isInsideCode) {
        currentCode += remaining;
        blocks.push({ type: 'code', lang: currentLang, content: currentCode, unclosed: true });
      } else {
        blocks.push({ type: 'text', content: remaining });
      }
      
      for (var idx = 0; idx < blocks.length; idx++) {
        var block = blocks[idx];
        if (block.type === 'code') {
          var highlighted = highlightCodeSnippet(block.content.trim());
          html += '<div class="code-block-container">' +
                    '<div class="code-block-header">' +
                      '<span class="code-block-lang">' + (block.lang || 'text').toLowerCase() + '</span>' +
                      '<button class="copy-code-btn" data-copied="0" data-copy-code="true" aria-label="Copy code">' +
                        getCopyIconSvg() +
                      '</button>' +
                    '</div>' +
                    '<pre><code class="language-' + block.lang + '">' + highlighted + '</code></pre>' +
                  '</div>';
        } else {
          var lines = block.content.split('\n');
          var inList = false;
          var inNumList = false;
          var currentParagraph = '';
          
          for (var l = 0; l < lines.length; l++) {
            var line = lines[l];
            var trimmed = line.trim();
            
            if (!trimmed) {
              if (inList) { html += '</ul>'; inList = false; }
              if (inNumList) { html += '</ol>'; inNumList = false; }
              if (currentParagraph) {
                html += '<p>' + formatAiInline(currentParagraph) + '</p>';
                currentParagraph = '';
              }
              continue;
            }
            
            var headerMatch = line.match(/^(\s*)(#{1,6})\s+(.+)$/);
            if (headerMatch) {
              if (inList) { html += '</ul>'; inList = false; }
              if (inNumList) { html += '</ol>'; inNumList = false; }
              if (currentParagraph) {
                html += '<p>' + formatAiInline(currentParagraph) + '</p>';
                currentParagraph = '';
              }
              
              var level = headerMatch[2].length;
              var tag = 'h' + Math.min(6, level + 2);
              html += '<' + tag + ' class="ai-header">' + formatAiInline(headerMatch[3]) + '</' + tag + '>';
              continue;
            }
            
            var bulletMatch = line.match(/^(\s*)([*\-â€¢\u2022\u00b7\u2023\u2043\u25e6\u25cf\u26ab])\s+(.+)$/);
            if (bulletMatch) {
              if (inNumList) { html += '</ol>'; inNumList = false; }
              if (currentParagraph) {
                html += '<p>' + formatAiInline(currentParagraph) + '</p>';
                currentParagraph = '';
              }
              if (!inList) { html += '<ul>'; inList = true; }
              html += '<li>' + formatAiInline(bulletMatch[3]) + '</li>';
              continue;
            }
            
            var numListMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
            if (numListMatch) {
              if (inList) { html += '</ul>'; inList = false; }
              if (currentParagraph) {
                html += '<p>' + formatAiInline(currentParagraph) + '</p>';
                currentParagraph = '';
              }
              if (!inNumList) { html += '<ol>'; inNumList = true; }
              html += '<li>' + formatAiInline(numListMatch[3]) + '</li>';
              continue;
            }
            
            if (inList || inNumList) {
              var lastLi = html.lastIndexOf('</li>');
              if (lastLi !== -1) {
                html = html.substring(0, lastLi) + ' ' + formatAiInline(trimmed) + html.substring(lastLi);
              } else {
                html += ' ' + formatAiInline(trimmed);
              }
            } else {
              currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
            }
          }
          
          if (inList) html += '</ul>';
          if (inNumList) html += '</ol>';
          if (currentParagraph) {
            html += '<p>' + formatAiInline(currentParagraph) + '</p>';
          }
        }
      }
      
      return sanitizeAiHtml(html);
    }

    function renderAiDisplay(el, raw) {
      if (!el) return;
      el.innerHTML = renderMarkdownToHtml(raw);
    }

    function formatAiDisplayText(raw) {
      return String(raw || '')
        .replace(/```[a-z0-9_-]*\n?/gi, '')
        .replace(/```/g, '')
        .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/(^|[^\w])`([^`\n]+)`/g, '$1$2')
        .replace(/^\s*[\*\-]\s+/gm, '\u2022 ')
        .replace(/^\s*\*\s*/gm, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function addActions(b) {
      return;
      if (b.querySelector('.ai-actions')) return;
      var actWrap = document.createElement('div');
      actWrap.className = 'ai-actions';
      actWrap.innerHTML = '<button class="ai-act-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button><button class="ai-act-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg></button>';
      b.appendChild(actWrap);
    }
    function scroll() { var h = document.getElementById('sp-scroll-area'); if (!h) return; setTimeout(function () { h.scrollTop = h.scrollHeight; }, 10); }
    function ecrd(fetching) { var w = document.createElement('div'); w.className = 'msg ai'; var d = document.createElement('div'); d.className = 'ecrd'; d.innerHTML = '<img class="ecrd-icon" src="https://img.icons8.com/color/512/gmail-new.png"/><span>Email List</span><span class="ebadge">' + (fetching ? 'Fetching...' : 'Complete \u2713') + '</span>'; w.appendChild(d); var mhTarget = document.getElementById('sp-mh'); if (mhTarget) mhTarget.appendChild(w); scroll(); return w; }
    var typEl = null;
    var typTimer = null;
    var thinkingStartedAt = 0;
    var thinkingMinMs = 0;
    var replyDelayTimer = null;
	    function typ(on) {
	      var mhTarget = document.getElementById('sp-mh');
	      if (on) {
	        if (typEl) return;
	        typEl = document.createElement('div');
	        typEl.className = 'msg ai';
	        typEl.innerHTML = '<div class="thinking-row"><span class="thinking-label">Thinking...</span></div>';
	        if (mhTarget) mhTarget.appendChild(typEl);
	        refreshWorkspaceEmptyState();
	        scroll();
	      } else {
	        if (typTimer) {
	          clearInterval(typTimer);
	          typTimer = null;
	        }
	        if (typEl) {
	          typEl.remove();
	          typEl = null;
	        }
	        refreshWorkspaceEmptyState();
	      }
	    }

	    function setSidebarTopActive(id) {
	      var ids = ['sb-search', 'sb-automations'];
	      ids.forEach(function (itemId) {
	        var el = document.getElementById(itemId);
	        if (!el) return;
	        if (itemId === id) el.classList.add('on');
	        else el.classList.remove('on');
	      });
	    }

	    function openPluginsView() {
	      goHome();
	    }

	    function openAutomationsView() {
	      goHome();
	      setSidebarTopActive('sb-automations');
	    }

	    function setPluginsTab(which) {
	      var tabPlugins = document.getElementById('plugins-tab-plugins');
	      var tabSkills = document.getElementById('plugins-tab-skills');
	      var btnPlugins = document.getElementById('pl-tab-plugins');
	      var btnSkills = document.getElementById('pl-tab-skills');
	      if (which === 'skills') {
	        if (tabPlugins) tabPlugins.style.display = 'none';
	        if (tabSkills) tabSkills.style.display = 'block';
	        if (btnPlugins) btnPlugins.classList.remove('active');
	        if (btnSkills) btnSkills.classList.add('active');
	      } else {
	        if (tabPlugins) tabPlugins.style.display = 'block';
	        if (tabSkills) tabSkills.style.display = 'none';
	        if (btnPlugins) btnPlugins.classList.add('active');
	        if (btnSkills) btnSkills.classList.remove('active');
	      }
	    }

	    // Network error UX (Manus-like): show a retry link when fetch fails.
		    var lastChatPayload = null;
		    var lastChatUserText = '';
		    var lastChatRetryBusy = false;
		    var netErrTimer = null;

	    function isNetworkIssue(err) {
	      try {
	        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
	      } catch (_) { }
	      var msg = String((err && err.message) ? err.message : (err || ''));
	      return /Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ERR_INTERNET_DISCONNECTED/i.test(msg);
	    }


		    async function retryLastChatRequest() {
		      if (lastChatRetryBusy) return;
		      if (!lastChatPayload) return;
		      lastChatRetryBusy = true;
		      hideNetworkErrorBanner();

		      try {
		        window.stopStream = false;
		        window.currentAbortController = new AbortController();
		        setStopButtons();

		        thinkingStartedAt = Date.now();
		        thinkingMinMs = getThinkingHoldMs(lastChatUserText || '');
		        typ(true);

		        var data = await postBackend('/api/chat', lastChatPayload);
		        if (data && data.choices && data.choices[0] && data.choices[0].message) {
		          handleAIReply(data.choices[0].message.content);
		        } else {
		          throw new Error('Invalid response format from backend');
		        }
		      } catch (e) {
		        typ(false);
		        if (isNetworkIssue(e)) {
		          addNetworkErrorMsg();
		        } else {
		          addMsg('ai', 'Something went wrong. Please try again.');
		        }
		        resetSendButtons();
		      } finally {
		        lastChatRetryBusy = false;
		      }
		    }

		    function showNetworkErrorRowNow() {
		      var mhTarget = document.getElementById('sp-mh');
		      if (!mhTarget) return;

		      // Remove previous in-chat error row if present (avoid duplicates)
		      var prev = document.getElementById('net-err-row');
		      if (prev) prev.remove();

		      var row = document.createElement('div');
		      row.className = 'net-err-row';
		      row.id = 'net-err-row';

		      var brand = document.createElement('div');
		      brand.className = 'net-err-brand';
		      brand.innerHTML = '<span class="net-err-brand-dot"></span><span>Codex</span>';
		      row.appendChild(brand);

		      var text = document.createElement('div');
		      text.className = 'net-err-text';
		      text.innerHTML = 'Network connection error. Please check your network settings and try again. <a href=\"#\" id=\"net-err-retry-inline\">Click to retry.</a>';
		      row.appendChild(text);

		      mhTarget.appendChild(row);
		      // trigger fade-in
		      setTimeout(function () { row.classList.add('show'); }, 10);
		      refreshWorkspaceEmptyState();
		      scroll();

		      var retry = document.getElementById('net-err-retry-inline');
		      if (retry) {
		        retry.onclick = function (e) {
		          e.preventDefault();
		          retryLastChatRequest().catch(function () { });
		        };
		      }
		    }

		    function addNetworkErrorMsg() {
		      if (netErrTimer) {
		        clearTimeout(netErrTimer);
		        netErrTimer = null;
		      }
		      // Keep "Thinking..." visible briefly, then show the network error row.
		      netErrTimer = setTimeout(function () {
		        netErrTimer = null;
		        typ(false);
		        showNetworkErrorRowNow();
		        resetSendButtons();
		      }, 700);
		    }

		    function hideNetworkErrorBanner() {
		      if (netErrTimer) {
		        clearTimeout(netErrTimer);
		        netErrTimer = null;
		      }
		      var prev = document.getElementById('net-err-row');
		      if (prev) prev.remove();
		    }

	    function clean(t) {
      if (!t) return "";
      return t.replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\r\n/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function isGmail(t) { var x = t.toLowerCase(); return x.includes('email') || x.includes('gmail') || x.includes('inbox') || x.includes('unread') || x.includes('mail') && !x.includes('email address'); }
    function gmailAction(t) { var x = t.toLowerCase(); if (x.includes('unread')) return 'unread'; if (x.includes('recent') || x.includes('old') || x.includes('puran') || x.includes('all') || x.includes('apr') || x.includes('date') || x.includes('pichle') || x.includes('back') || x.includes('history')) return 'readAll'; return 'readEmails'; }

    function isCalendar(t) { var x = t.toLowerCase(); return x.includes('calendar') || x.includes('meeting') || x.includes('event') || x.includes('appointment') || x.includes('schedule') || x.includes('calander'); }
    function isSlack(t) { var x = t.toLowerCase(); return x.includes('slack') || x.includes('channel') || x.includes('message on slack') || x.includes('ping') || x.includes('workspace'); }

    async function manageCalendar(text) {
      try {
        var myTk = getPTk();
        if (!myTk) return 'Error: Google Token missing.';

        var x = text.toLowerCase();
        // 1. Reading Calendar
        if (x.includes('check') || x.includes('show') || x.includes('list') || x.includes('schedule')) {
          var r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&timeMin=' + (new Date().toISOString()), { headers: { 'Authorization': 'Bearer ' + myTk } });
          var d = await r.json();
          if (!d.items || d.items.length === 0) return 'No upcoming events found.';
          var out = 'Upcoming Events:\n';
          d.items.forEach(ev => { out += `- ${ev.summary} (${ev.start.dateTime || ev.start.date})\n`; });
          return out;
        }

        // 2. Creating Event (Very simple heuristic)
        var summary = text.replace(/set|a|meeting|at|for|schedule|event|calendar/gi, '').trim();
        if (!summary) summary = 'New Meeting';

        // Heuristic for time: 2pm -> 14:00
        var now = new Date();
        var start = new Date();
        var timeMatch = text.match(/(\d+)\s*(am|pm)/i);
        if (timeMatch) {
          var hr = parseInt(timeMatch[1]);
          if (timeMatch[2].toLowerCase() === 'pm' && hr < 12) hr += 12;
          if (timeMatch[2].toLowerCase() === 'am' && hr === 12) hr = 0;
          start.setHours(hr, 0, 0, 0);
        } else {
          start.setHours(now.getHours() + 1, 0, 0, 0); // Default to next hour
        }

        var end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration

        var evObj = {
          'summary': summary,
          'start': { 'dateTime': start.toISOString() },
          'end': { 'dateTime': end.toISOString() }
        };

        var r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + myTk, 'Content-Type': 'application/json' },
          body: JSON.stringify(evObj)
        });
        var d = await r.json();
        if (d.id) return 'Success: Meeting "' + summary + '" set for ' + start.toLocaleString();
        return 'Error creating event: ' + (d.error ? d.error.message : 'Unknown error');
      } catch (e) { return 'Error: ' + e.message; }
    }

    async function readGmail(action) {
      try {
        var accountId = localStorage.getItem('gmail_composio_account_id') || COMPOSIO_ACCOUNT_ID;

        var q = '';
        if (action === 'unread') q = 'is:unread';
        else if (action === 'readAll') q = '';
        else q = 'newer_than:30d';

        // Use Composio to execute GMAIL_LIST_THREADS action
        var data = await postBackend('/api/composio-action', {
          action: 'GMAIL_LIST_THREADS',
          connectedAccountId: accountId,
          input: { query: q, max_results: 20 }
        });
        console.log('Composio readGmail:', data);

        if (!data || data.error) return 'Error fetching emails: ' + (data.error || JSON.stringify(data));

        var threads = (data.data && data.data.threads) || data.threads || [];
        if (!threads.length) return 'No emails found.';

        var out = '';
        threads.forEach(function (t) {
          var msg = t.messages ? t.messages[0] : t;
          var hdrs = (msg && msg.payload && msg.payload.headers) || [];
          var subject = (hdrs.find(h => h.name.toLowerCase() === 'subject') || {}).value || 'No Subject';
          var from = (hdrs.find(h => h.name.toLowerCase() === 'from') || {}).value || 'Unknown';
          var date = (hdrs.find(h => h.name.toLowerCase() === 'date') || {}).value || '';
          var snippet = msg.snippet || '';
          out += `---EMAIL_START---\nSENDER: ${from}\nDATE: ${date}\nSUBJECT: ${subject}\nPREVIEW: ${snippet}\n---EMAIL_END---\n\n`;
        });

        return out || 'No emails found.';
      } catch (e) { return 'Error: ' + e.message; }
    }


    window.currentAbortController = null;
    window.isStreaming = false;
    window.stopStream = false;

    function setStopButtons() {
      window.isStreaming = true; window.stopStream = false;
      var svStop = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
      var s1 = document.getElementById('sb'), s2 = document.getElementById('sb2'), ssp = document.getElementById('sb-sp'), sdemo = document.getElementById('demo-send-btn');
      [s1, s2, ssp, sdemo].forEach(function (btn) {
        if (btn) { btn.innerHTML = svStop; btn.classList.add('active', 'streaming-stop'); }
      });
    }

    function resetSendButtons() {
      window.isStreaming = false;
      var s1 = document.getElementById('sb'), s2 = document.getElementById('sb2'), ssp = document.getElementById('sb-sp'), sdemo = document.getElementById('demo-send-btn');
      if (s1) { s1.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'; s1.classList.remove('active', 'streaming-stop'); if (document.getElementById('ci').value.trim()) s1.classList.add('active'); }
      if (s2) { s2.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'; s2.classList.remove('active', 'streaming-stop'); if (document.getElementById('ci2').value.trim()) s2.classList.add('active'); }
      if (ssp) { ssp.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'; ssp.classList.remove('active', 'streaming-stop'); if (document.getElementById('sp-ci') && document.getElementById('sp-ci').value.trim()) ssp.classList.add('active'); }
      if (sdemo) { sdemo.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'; sdemo.classList.remove('active', 'streaming-stop'); var demoInput = document.querySelector('.demo-search-input'); if (demoInput && demoInput.value.trim()) sdemo.classList.add('active'); }
    }

    function handleStop() {
      if (!window.isStreaming) return false;
      window.stopStream = true;
      if (window.currentAbortController) window.currentAbortController.abort();
      if (replyDelayTimer) {
        clearTimeout(replyDelayTimer);
        replyDelayTimer = null;
      }
      typ(false);
      resetSendButtons();
      return true;
    }
    async function getBackendAuthHeaders() {
      try {
        if (window.supabaseClient) {
          var result = await window.supabaseClient.auth.getSession();
          var session = result && result.data ? result.data.session : null;
          if (session && session.access_token) {
            return { 'Authorization': 'Bearer ' + session.access_token };
          }
        }
      } catch (e) {
        console.warn('Auth header unavailable:', e);
      }
      return {};
    }
    function backendUrl(url) {
      if (!/^\/api\/[a-z0-9-]+$/i.test(String(url || ''))) {
        throw new Error('Blocked unsafe backend URL');
      }
      if (window.location.protocol === 'file:') return 'http://localhost:3000' + url;
      return url;
    }


    async function postBackend(url, payload) {
      var authHeaders = await getBackendAuthHeaders();
      var resp = await fetch(backendUrl(url), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {})
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) {
        throw new Error(data.error || data.message || ('Backend request failed: ' + resp.status));
      }
      return data;
    }

    function markConnected(provider, data) {
      localStorage.setItem(provider + '_connected', 'true');
      if (data && data.connectionId) localStorage.setItem(provider + '_connection_id', data.connectionId);
    }

    function markDisconnected(provider) {
      localStorage.removeItem(provider + '_connected');
      localStorage.removeItem(provider + '_connection_id');
      localStorage.removeItem(provider + '_access_token');
      localStorage.removeItem(provider + '_refresh_token');
      localStorage.removeItem(provider + '_user_token');
    }


    function isConnected() { return !!localStorage.getItem('gmail_composio_connected') || !!(window.getProviderToken && window.getProviderToken()); }
    function getPTk() { return window.getProviderToken ? window.getProviderToken() : ''; }
    function openConnectionsModal() { document.getElementById('connections-modal').style.display = 'flex'; }
    function closeConnectionsModal() { document.getElementById('connections-modal').style.display = 'none'; }
    function updateGUI(conn) {
      var gBtn = document.getElementById('m-g-btn'), cBtn = document.getElementById('m-c-btn'), st = document.getElementById('gst');
      if (conn) {
        if (gBtn) { gBtn.textContent = 'Disconnect'; gBtn.className = 'int-dis'; }
        if (cBtn) { cBtn.textContent = 'Disconnect'; cBtn.className = 'int-dis'; }
        if (st) { st.textContent = 'Connected \u2713'; st.style.color = '#16a34a'; }
        // Update all Gmail pills on dashboard
        document.querySelectorAll('[data-onclick="h80"], [data-onclick="h81"]').forEach(function (pill) {
          pill.style.background = '#f0fdf4';
          pill.style.borderColor = '#bbf7d0';
          pill.style.color = '#16a34a';
          if (pill.childNodes.length > 0) {
            for (var n of pill.childNodes) {
              if (n.nodeType === 3 && n.textContent.trim()) {
                n.textContent = ' Gmail Connected \u2713';
              }
            }
          }
        });
      } else {
        if (gBtn) { gBtn.textContent = 'Connect'; gBtn.className = 'int-btn'; }
        if (cBtn) { cBtn.textContent = 'Connect'; cBtn.className = 'int-btn'; }
        if (st) { st.textContent = 'Ready to connect'; st.style.color = 'var(--mu)'; }
        // Reset Gmail pills
        document.querySelectorAll('[data-onclick="h80"], [data-onclick="h81"]').forEach(function (pill) {
          pill.style.background = '';
          pill.style.borderColor = '';
          pill.style.color = '';
          if (pill.childNodes.length > 0) {
            for (var n of pill.childNodes) {
              if (n.nodeType === 3 && n.textContent.trim()) {
                n.textContent = ' Connect via Composio';
              }
            }
          }
        });
      }
    }
    // \u2744 COMPOSIO GMAIL CONFIG \u2744
    var COMPOSIO_ACCOUNT_ID = null;

    window.isGlobalGmailConnected = !!localStorage.getItem('gmail_composio_connected');
    if (window.isGlobalGmailConnected) {
      document.addEventListener('DOMContentLoaded', function () { updateGUI(true); });
      if (document.readyState !== 'loading') { updateGUI(true); }
    }

    async function connectComposioGmail() {
      console.log("Initiating Composio Gmail Connection...");
      if (window.isGlobalGmailConnected) {
        // Disconnect
        localStorage.removeItem('gmail_composio_connected');
        localStorage.removeItem('gmail_composio_account_id');
        window.isGlobalGmailConnected = false;
        updateGUI(false);
        return;
      }

      try {
        const data = await postBackend('/api/composio-init', { redirectUrl: window.location.href });
        console.log('Composio Initiate Response:', data);

        if (!data.redirectUrl) {
          throw new Error(data.message || 'No redirect URL returned from Composio');
        }

        var composioUrl = data.redirectUrl;
        var w = 500, h = 680;
        var left = Math.round(screen.width / 2 - w / 2);
        var top = Math.round(screen.height / 2 - h / 2);
        var popup = window.open(composioUrl, 'ComposioAuth', 'width=' + w + ',height=' + h + ',top=' + top + ',left=' + left + ',noopener,noreferrer');

        // Watch for popup to close
        var timer = setInterval(function () {
          if (!popup || popup.closed) {
            clearInterval(timer);
            // Mark as connected after popup closes
            localStorage.setItem('gmail_composio_connected', 'true');
            // If data.connectedAccountId exists, use it, else fallback to default
            var accountId = data.connectedAccountId || COMPOSIO_ACCOUNT_ID || localStorage.getItem('gmail_composio_account_id') || '';
            if (accountId) localStorage.setItem('gmail_composio_account_id', accountId);
            window.isGlobalGmailConnected = true;
            updateGUI(true);
          }
        }, 800);
      } catch (err) {
        console.error('Composio Connection Error:', err);
        alert('Failed to initiate connection: ' + err.message);
      }
    }

    var OAUTH_STATE_PREFIX = 'flowlet_oauth_';
    function oauthStateKey(provider) { return 'flowlet_oauth_state_' + provider; }
    function secureRandomId() {
      var bytes = new Uint8Array(16);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
      return (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);
    }
    function createOAuthState(provider) {
      var rand = secureRandomId();
      var state = OAUTH_STATE_PREFIX + provider + '_' + rand;
      try {
        sessionStorage.setItem(oauthStateKey(provider), JSON.stringify({
          value: state,
          expiresAt: Date.now() + 10 * 60 * 1000
        }));
      } catch (e) { }
      return state;
    }
    function consumeOAuthState(provider, incomingState) {
      if (!incomingState) return false;
      try {
        var raw = sessionStorage.getItem(oauthStateKey(provider));
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        var expected = parsed && parsed.value ? parsed.value : raw;
        var expiresAt = parsed && parsed.expiresAt ? parsed.expiresAt : 0;
        if (expiresAt && expiresAt < Date.now()) {
          sessionStorage.removeItem(oauthStateKey(provider));
          return false;
        }
        if (!expected || expected !== incomingState) return false;
        sessionStorage.removeItem(oauthStateKey(provider));
        return true;
      } catch (e) {
        return false;
      }
    }
    function getOAuthRedirectUri() {
      return window.location.origin + window.location.pathname;
    }
    function oauthPopupFeatures(w, h) {
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      return 'width=' + w + ',height=' + h + ',top=' + top + ',left=' + left + ',noopener,noreferrer';
    }

    // \u2744 SLACK OAUTH CONFIG \u2744
    var SLACK_CLIENT_ID = '11027248303175.11042818546578';
    var SLACK_SCOPES = 'channels:read,chat:write,users:read,channels:history,im:write';

    window.isGlobalSlackConnected = !!localStorage.getItem('slack_connected');

    // On page load: check if Slack OAuth returned a code
    (function handleSlackCallback() {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('slack_code') || params.get('code');
      var state = params.get('state');
      if (code && consumeOAuthState('slack', state)) {
        // Clean URL
        var cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        // Exchange code for token via Slack API
        exchangeSlackCode(code);
      }
      // If already connected from previous session
      if (window.isGlobalSlackConnected) {
        setTimeout(updateSlackUI, 500);
      }
    })();

    async function exchangeSlackCode(code) {
      updateSlackLoadingUI();
      try {
        var redirectUri = getOAuthRedirectUri();
        var data = await postBackend('/api/oauth-token', { provider: 'slack', code: code, redirectUri: redirectUri });
        if (data.connected || data.ok) {
          markConnected('slack', data);
          window.isGlobalSlackConnected = true;
          updateSlackUI();
        } else {
          console.error('Slack token exchange failed:', data.error);
          updateSlackDisconnectUI();
          alert('Slack connection failed: ' + data.error + '\n\nMake sure your Redirect URL is added in Slack App settings.');
        }
      } catch (e) {
        console.error('Slack OAuth error:', e);
        updateSlackDisconnectUI();
        alert('Slack OAuth error: ' + e.message);
      }
    }

    function updateSlackLoadingUI() {
      var pill = document.getElementById('slack-pill');
      var sideTxt = document.getElementById('slack-sidebar-text');
      if (pill) {
        pill.style.pointerEvents = 'none';
        pill.innerHTML = '<div class="dots dots-compact dots-tiny"><span class="dot-slack-red"></span><span class="dot-slack-blue"></span><span class="dot-slack-green"></span></div>';
      }
      if (sideTxt) sideTxt.textContent = 'Connecting...';
    }

    function updateSlackUI() {
      var pill = document.getElementById('slack-pill');
      var sideBtn = document.getElementById('slack-sidebar-btn');
      var sideTxt = document.getElementById('slack-sidebar-text');
      if (pill) {
        pill.innerHTML = '<img src="https://img.icons8.com/color/48/slack-new.png" width="18" height="18"> Connected \u2713';
        pill.style.background = '#f0fdf4';
        pill.style.borderColor = '#bbf7d0';
        pill.style.color = '#16a34a';
        pill.style.pointerEvents = 'auto';
        pill.style.transition = '0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        pill.style.transform = 'scale(1.05)';
        setTimeout(() => pill.style.transform = 'scale(1)', 200);
      }
      if (sideBtn) sideBtn.style.color = '#16a34a';
      if (sideTxt) sideTxt.textContent = 'Slack Connected \u2713';
    }

    function updateSlackDisconnectUI() {
      var pill = document.getElementById('slack-pill');
      var sideBtn = document.getElementById('slack-sidebar-btn');
      var sideTxt = document.getElementById('slack-sidebar-text');
      window.isGlobalSlackConnected = false;
      markDisconnected('slack');
      if (pill) {
        pill.innerHTML = '<img src="https://img.icons8.com/color/48/slack-new.png" width="18" height="18"> <span id="slack-pill-text">Connect Slack</span>';
        pill.style.background = '#ffffff';
        pill.style.borderColor = '#e5e7eb';
        pill.style.color = '#3f3f46';
        pill.style.pointerEvents = 'auto';
      }
      if (sideBtn) sideBtn.style.color = '#6b7280';
      if (sideTxt) sideTxt.textContent = 'Connect Slack';
    }

    function connectSlack() {
      if (window.isGlobalSlackConnected) {
        updateSlackDisconnectUI();
        return;
      }
      var redirectUri = encodeURIComponent(getOAuthRedirectUri());
      var state = createOAuthState('slack');
      var slackAuthUrl = 'https://slack.com/oauth/v2/authorize'
        + '?client_id=' + SLACK_CLIENT_ID
        + '&scope=' + encodeURIComponent(SLACK_SCOPES)
        + '&redirect_uri=' + redirectUri
        + '&state=' + encodeURIComponent(state);

      updateSlackLoadingUI();

      var w = 560, h = 680;
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      var popup = window.open(slackAuthUrl, 'SlackAuth', oauthPopupFeatures(w, h));

      // Watch for popup close / redirect
      var timer = setInterval(function () {
        if (!popup || popup.closed) {
          clearInterval(timer);
          // Check if code came back via URL (redirect to same page)
          setTimeout(function () {
            var params = new URLSearchParams(window.location.search);
            var code = params.get('code') || params.get('slack_code');
            if (code) {
              exchangeSlackCode(code);
            } else if (!window.isGlobalSlackConnected) {
              updateSlackDisconnectUI();
            }
          }, 800);
        }
      }, 800);
    }

    // \u2744 HUBSPOT OAUTH CONFIG \u2744
    var HUBSPOT_CLIENT_ID = '8eef7dc3-681b-4010-a430-3a1252f86799';
    var HUBSPOT_SCOPES = 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.companies.read';

    window.isGlobalHubSpotConnected = !!localStorage.getItem('hubspot_connected');

    // \u2744 NOTION OAUTH CONFIG \u2744
    var NOTION_CLIENT_ID = '359d872b-594c-8132-83dc-0037f3d7055f';
    window.isGlobalNotionConnected = !!localStorage.getItem('notion_connected');

    // \u2744 DISCORD OAUTH CONFIG \u2744
    var DISCORD_CLIENT_ID = '1501815569513713775';
    window.isGlobalDiscordConnected = !!localStorage.getItem('discord_connected');

    // \u2744 SALESFORCE OAUTH CONFIG \u2744
    var SF_CLIENT_ID = '3MVG9...'; // Placeholder - User must provide their Connected App Consumer Key
    var SF_SCOPES = 'api refresh_token';
    window.isGlobalSFConnected = !!localStorage.getItem('sf_connected');

    // On page load: check if CRM OAuth returned a code
    (function handleCRMCallbacks() {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('code');
      var state = params.get('state');

      if (code) {
        var cleanUrl = window.location.origin + window.location.pathname;
        if (consumeOAuthState('hubspot', state)) {
          window.history.replaceState({}, document.title, cleanUrl);
          exchangeHubSpotCode(code);
        } else if (consumeOAuthState('salesforce', state)) {
          window.history.replaceState({}, document.title, cleanUrl);
          exchangeSFCode(code);
        } else if (consumeOAuthState('notion', state)) {
          window.history.replaceState({}, document.title, cleanUrl);
          exchangeNotionCode(code);
        } else if (consumeOAuthState('discord', state)) {
          window.history.replaceState({}, document.title, cleanUrl);
          exchangeDiscordCode(code);
        }
      }

      if (window.isGlobalHubSpotConnected) setTimeout(updateHubSpotUI, 500);
      if (window.isGlobalSFConnected) setTimeout(updateSFUI, 500);
      if (window.isGlobalNotionConnected) setTimeout(updateNotionUI, 500);
      if (window.isGlobalDiscordConnected) setTimeout(updateDiscordUI, 500);
    })();

    async function exchangeHubSpotCode(code) {
      updateHubSpotLoadingUI();
      try {
        var redirectUri = getOAuthRedirectUri();
        var data = await postBackend('/api/oauth-token', { provider: 'hubspot', code: code, redirectUri: redirectUri });
        if (data.connected) {
          markConnected('hubspot', data);
          window.isGlobalHubSpotConnected = true;
          updateHubSpotUI();
        } else {
          console.error('HubSpot token exchange failed:', data);
          updateHubSpotDisconnectUI();
          alert('HubSpot connection failed: ' + (data.message || JSON.stringify(data)) + '\n\nMake sure Redirect URL is added in HubSpot App settings.');
        }
      } catch (e) {
        console.error('HubSpot OAuth error:', e);
        updateHubSpotDisconnectUI();
        alert('HubSpot OAuth error: ' + e.message);
      }
    }

    window.connectNotion = function () {
      if (window.isGlobalNotionConnected) {
        markDisconnected('notion');
        window.isGlobalNotionConnected = false;
        alert('Notion Disconnected');
        return;
      }
      // Redirect URI must match what's set in Notion Dev Portal
      var redirectUri = encodeURIComponent(getOAuthRedirectUri());
      var oauthState = createOAuthState('notion');
      var notionAuthUrl = 'https://api.notion.com/v1/oauth/authorize'
        + '?client_id=' + NOTION_CLIENT_ID
        + '&response_type=code&owner=user'
        + '&redirect_uri=' + redirectUri
        + '&state=' + encodeURIComponent(oauthState);

      var w = 500, h = 680;
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      var popup = window.open(notionAuthUrl, 'NotionAuth', oauthPopupFeatures(w, h));

      var timer = setInterval(function () {
        if (!popup || popup.closed) {
          clearInterval(timer);
          // The code exchange happens in the main window after redirect
        }
      }, 800);
    }

    async function exchangeNotionCode(code) {
      try {
        var data = await postBackend('/api/oauth-token', { provider: 'notion', code: code, redirectUri: getOAuthRedirectUri() });
        if (data.connected) {
          markConnected('notion', data);
          window.isGlobalNotionConnected = true;
          alert('Notion Connected Successfully! Ã¢Å“â€œ');
        } else {
          console.error('Notion token exchange failed:', data);
          alert('Notion connection failed: ' + (data.error || JSON.stringify(data)));
        }
      } catch (e) {
        console.error('Notion OAuth error:', e);
        alert('Notion OAuth error: ' + e.message);
      }
    }
    function updateNotionUI() {
      var pill = document.getElementById('notion-pill');
      var txt = document.getElementById('notion-pill-text');
      if (pill) {
        pill.style.background = '#f0fdf4';
        pill.style.borderColor = '#bbf7d0';
        pill.style.color = '#16a34a';
      }
      if (txt) txt.textContent = 'Notion Connected \u2713';

      var sidebarText = document.getElementById('notion-sidebar-text');
      if (sidebarText) sidebarText.textContent = 'Notion Connected \u2713';

      var sidebarBtn = document.getElementById('notion-sidebar-btn');
      if (sidebarBtn) {
        sidebarBtn.style.background = '#f0fdf4';
        sidebarBtn.style.borderColor = '#bbf7d0';
        sidebarBtn.style.color = '#16a34a';
      }
    }

    function updateNotionDisconnectUI() {
      var pill = document.getElementById('notion-pill');
      var txt = document.getElementById('notion-pill-text');
      if (pill) {
        pill.style.background = '';
        pill.style.borderColor = '';
        pill.style.color = '';
      }
      if (txt) txt.textContent = 'Connect Notion';

      var sidebarText = document.getElementById('notion-sidebar-text');
      if (sidebarText) sidebarText.textContent = 'Connect Notion';

      var sidebarBtn = document.getElementById('notion-sidebar-btn');
      if (sidebarBtn) {
        sidebarBtn.style.background = '';
        sidebarBtn.style.borderColor = '';
        sidebarBtn.style.color = '';
      }
    }

    window.connectDiscord = function () {
      if (window.isGlobalDiscordConnected) {
        markDisconnected('discord');
        window.isGlobalDiscordConnected = false;
        alert('Discord Disconnected');
        updateDiscordDisconnectUI();
        return;
      }
      var redirectUri = encodeURIComponent(getOAuthRedirectUri());
      var oauthState = createOAuthState('discord');
      var discordAuthUrl = 'https://discord.com/api/oauth2/authorize'
        + '?client_id=' + DISCORD_CLIENT_ID
        + '&redirect_uri=' + redirectUri
        + '&response_type=code'
        + '&scope=identify%20email%20guilds'
        + '&state=' + encodeURIComponent(oauthState);

      var w = 500, h = 680;
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      window.open(discordAuthUrl, 'DiscordAuth', oauthPopupFeatures(w, h));
    }

    async function exchangeDiscordCode(code) {
      try {
        var data = await postBackend('/api/oauth-token', { provider: 'discord', code: code, redirectUri: getOAuthRedirectUri() });
        if (data.connected) {
          markConnected('discord', data);
          window.isGlobalDiscordConnected = true;
          updateDiscordUI();
          alert('Discord Connected Successfully! Ã¢Å“â€œ');
        } else {
          console.error('Discord exchange failed:', data);
          alert('Discord connection failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        console.error('Discord exchange error:', e);
      }
    }

    function updateDiscordUI() {
      var pill = document.getElementById('discord-pill');
      var txt = document.getElementById('discord-pill-text');
      if (pill) {
        pill.style.background = '#f0fdf4';
        pill.style.borderColor = '#bbf7d0';
        pill.style.color = '#16a34a';
      }
      if (txt) txt.textContent = 'Discord Connected \u2713';

      var sidebarText = document.getElementById('discord-sidebar-text');
      if (sidebarText) sidebarText.textContent = 'Discord Connected \u2713';

      var sidebarBtn = document.getElementById('discord-sidebar-btn');
      if (sidebarBtn) {
        sidebarBtn.style.background = '#f0fdf4';
        sidebarBtn.style.borderColor = '#bbf7d0';
        sidebarBtn.style.color = '#16a34a';
      }
    }

    function updateDiscordDisconnectUI() {
      var pill = document.getElementById('discord-pill');
      var txt = document.getElementById('discord-pill-text');
      if (pill) {
        pill.style.background = '';
        pill.style.borderColor = '';
        pill.style.color = '';
      }
      if (txt) txt.textContent = 'Connect Discord';

      var sidebarText = document.getElementById('discord-sidebar-text');
      if (sidebarText) sidebarText.textContent = 'Connect Discord';

      var sidebarBtn = document.getElementById('discord-sidebar-btn');
      if (sidebarBtn) {
        sidebarBtn.style.background = '';
        sidebarBtn.style.borderColor = '';
        sidebarBtn.style.color = '';
      }
    }

    function updateHubSpotLoadingUI() {
      var pill = document.getElementById('hubspot-pill');
      if (pill) {
        pill.style.pointerEvents = 'none';
        pill.innerHTML = '<div class="dots dots-compact dots-tiny"><span class="dot-hubspot-1"></span><span class="dot-hubspot-2"></span><span class="dot-hubspot-3"></span></div>';
      }
    }

    function updateHubSpotUI() {
      var pill = document.getElementById('hubspot-pill');
      if (pill) {
        pill.innerHTML = '<span class="hubspot-icon-wrap"><img class="hubspot-icon-img" src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20448%20512%22%3E%3Cpath%20fill%3D%22%23FF7A59%22%20d%3D%22M123.6%20390.5a72.5%2072.5%200%200%201-5.7-28.7c0-39.7%2032.2-72%2072-72a72.1%2072.1%200%200%201%2021.6%203.3L324.5%20180c-2.4-5.6-3.8-11.7-3.8-18.1%200-25.3%2020.5-45.9%2045.9-45.9s45.9%2020.5%2045.9%2045.9-20.5%2045.9-45.9%2045.9a46.1%2046.1%200%200%201-13.7-2.1L240.2%20318.5c2.4%205.6%203.8%2011.7%203.8%2018.1%200%2025.3-20.5%2045.9-45.9%2045.9s-45.9%2020.5-45.9%2045.9a46.1%2046.1%200%200%201%202.1-13.7L50.7%20219.2a46.1%2046.1%200%200%201-4.8%201.1C20.5%20220.3%200%20199.8%200%20174.4S20.5%20128.5%2045.9%20128.5s45.9%2020.5%2045.9%2045.9a46.1%2046.1%200%200%201-3.3%2017.2l128.2%20128.2a72.1%2072.1%200%200%201%2039.3-11.8c39.7%200%2072%2032.2%2072%2072s-32.2%2072-72%2072c-39.7%200-72-32.2-72-72%200-11.7%202.8-22.8%207.7-32.5L123.6%20390.5z%22%2F%3E%3C%2Fsvg%3E" width="16" height="16"></span> Connected \u2713';
        pill.style.background = '#f0fdf4';
        pill.style.borderColor = '#bbf7d0';
        pill.style.color = '#16a34a';
        pill.style.pointerEvents = 'auto';
        pill.style.transition = '0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        pill.style.transform = 'scale(1.05)';
        setTimeout(() => pill.style.transform = 'scale(1)', 200);
      }
    }

    function updateHubSpotDisconnectUI() {
      var pill = document.getElementById('hubspot-pill');
      window.isGlobalHubSpotConnected = false;
      markDisconnected('hubspot');
      if (pill) {
        pill.innerHTML = '<span class="hubspot-icon-wrap"><img class="hubspot-icon-img" src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20448%20512%22%3E%3Cpath%20fill%3D%22%23FF7A59%22%20d%3D%22M123.6%20390.5a72.5%2072.5%200%200%201-5.7-28.7c0-39.7%2032.2-72%2072-72a72.1%2072.1%200%200%201%2021.6%203.3L324.5%20180c-2.4-5.6-3.8-11.7-3.8-18.1%200-25.3%2020.5-45.9%2045.9-45.9s45.9%2020.5%2045.9%2045.9-20.5%2045.9-45.9%2045.9a46.1%2046.1%200%200%201-13.7-2.1L240.2%20318.5c2.4%205.6%203.8%2011.7%203.8%2018.1%200%2025.3-20.5%2045.9-45.9%2045.9s-45.9%2020.5-45.9%2045.9a46.1%2046.1%200%200%201%202.1-13.7L50.7%20219.2a46.1%2046.1%200%200%201-4.8%201.1C20.5%20220.3%200%20199.8%200%20174.4S20.5%20128.5%2045.9%20128.5s45.9%2020.5%2045.9%2045.9a46.1%2046.1%200%200%201-3.3%2017.2l128.2%20128.2a72.1%2072.1%200%200%201%2039.3-11.8c39.7%200%2072%2032.2%2072%2072s-32.2%2072-72%2072c-39.7%200-72-32.2-72-72%200-11.7%202.8-22.8%207.7-32.5L123.6%20390.5z%22%2F%3E%3C%2Fsvg%3E" width="16" height="16"></span> <span id="slack-pill-text">Connect HubSpot</span>';
        pill.style.background = '#ffffff';
        pill.style.borderColor = '#e5e7eb';
        pill.style.color = '#3f3f46';
        pill.style.pointerEvents = 'auto';
      }
    }

    // \u2744 SALESFORCE LOGIC \u2744
    function connectSalesforce() {
      if (window.isGlobalSFConnected) {
        updateSFDisconnectUI();
        return;
      }
      var redirectUri = encodeURIComponent(getOAuthRedirectUri());
      var oauthState = createOAuthState('salesforce');
      var sfAuthUrl = 'https://login.salesforce.com/services/oauth2/authorize'
        + '?response_type=code'
        + '&client_id=' + SF_CLIENT_ID
        + '&redirect_uri=' + redirectUri
        + '&scope=' + encodeURIComponent(SF_SCOPES)
        + '&state=' + encodeURIComponent(oauthState);

      updateSFLoadingUI();

      var w = 600, h = 700;
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      var popup = window.open(sfAuthUrl, 'SFAuth', oauthPopupFeatures(w, h));

      var timer = setInterval(function () {
        if (!popup || popup.closed) {
          clearInterval(timer);
          setTimeout(function () {
            var params = new URLSearchParams(window.location.search);
            var code = params.get('code');
            var state = params.get('state');
            if (code && consumeOAuthState('salesforce', state)) {
              exchangeSFCode(code);
            } else if (!window.isGlobalSFConnected) {
              updateSFDisconnectUI();
            }
          }, 800);
        }
      }, 800);
    }

    async function exchangeSFCode(code) {
      updateSFLoadingUI();
      try {
        var redirectUri = getOAuthRedirectUri();
        var data = await postBackend('/api/oauth-token', { provider: 'salesforce', code: code, redirectUri: redirectUri });
        if (data.connected) {
          markConnected('sf', data);
          window.isGlobalSFConnected = true;
          updateSFUI();
        } else {
          throw new Error(data.error || 'Salesforce connection failed');
        }
      } catch (e) {
        updateSFDisconnectUI();
        alert('Salesforce OAuth error: ' + e.message);
      }
    }

    function updateSFLoadingUI() {
      var pill = document.getElementById('salesforce-pill');
      if (pill) {
        pill.style.pointerEvents = 'none';
        pill.innerHTML = '<span class="sf-icon-wrap"><div class="dots dots-compact dots-tiny"><span class="dot-sf-1"></span><span class="dot-sf-2"></span><span class="dot-sf-3"></span></div></span><div><div class="sf-title">Salesforce</div><div class="sf-desc">Connecting...</div></div>';
      }
    }

    function updateSFUI() {
      var pill = document.getElementById('salesforce-pill');
      if (pill) {
        pill.innerHTML = '<span class="sf-icon-wrap"><img src="https://img.icons8.com/color/48/salesforce.png" width="18" height="18"></span><div><div class="sf-title">Salesforce</div><div class="sf-desc sf-desc-connected">Connected \u2713</div></div>';
        pill.style.background = '#f0fdf4';
        pill.style.borderColor = '#bbf7d0';
        pill.style.pointerEvents = 'auto';
      }
    }

    function updateSFDisconnectUI() {
      var pill = document.getElementById('salesforce-pill');
      window.isGlobalSFConnected = false;
      markDisconnected('sf');
      if (pill) {
        pill.innerHTML = '<span class="sf-icon-wrap"><img src="https://img.icons8.com/color/48/salesforce.png" width="18" height="18"></span><div><div class="sf-title">Salesforce</div><div class="sf-desc">CRM and sales automation</div></div>';
        pill.style.background = 'transparent';
        pill.style.borderColor = 'transparent';
        pill.style.pointerEvents = 'auto';
      }
    }

    function openCRMModal() {
      document.getElementById('crm-modal').style.display = 'flex';
    }
    function closeCRMModal() {
      document.getElementById('crm-modal').style.display = 'none';
    }

    function connectHubSpot() {
      if (window.isGlobalHubSpotConnected) {
        updateHubSpotDisconnectUI();
        return;
      }
      var redirectUri = encodeURIComponent(getOAuthRedirectUri());
      var oauthState = createOAuthState('hubspot');
      var hubspotAuthUrl = 'https://app.hubspot.com/oauth/authorize'
        + '?client_id=' + HUBSPOT_CLIENT_ID
        + '&redirect_uri=' + redirectUri
        + '&scope=' + encodeURIComponent(HUBSPOT_SCOPES)
        + '&state=' + encodeURIComponent(oauthState);

      updateHubSpotLoadingUI();

      var w = 560, h = 680;
      var left = Math.round(screen.width / 2 - w / 2);
      var top = Math.round(screen.height / 2 - h / 2);
      var popup = window.open(hubspotAuthUrl, 'HubSpotAuth', oauthPopupFeatures(w, h));

      var timer = setInterval(function () {
        if (!popup || popup.closed) {
          clearInterval(timer);
          setTimeout(function () {
            var params = new URLSearchParams(window.location.search);
            var code = params.get('code');
            var state = params.get('state');
            if (code && consumeOAuthState('hubspot', state)) {
              exchangeHubSpotCode(code);
            } else if (!window.isGlobalHubSpotConnected) {
              updateHubSpotDisconnectUI();
            }
          }, 800);
        }
      }, 800);
    }

    function handleImport(event) {
      const file = event.target.files[0];
      if (!file) return;

      const updateStatus = (id) => {
        const status = document.getElementById(id);
        if (status) {
          status.textContent = '\u2713 ' + file.name + ' selected';
          status.style.display = 'inline-block';
          setTimeout(() => status.style.display = 'none', 5000);
        }
      };

      updateStatus('import-status');
      updateStatus('import-status-sp');

      window.selectedImportFile = file;
      console.log('File imported:', file.name);
    }

    window.addEventListener('storage', (e) => {
      if (e.key === 'gmail_composio_connected') updateGUI(isConnected());
    });

    function getModel() { var m = document.getElementById('ms2') || document.getElementById('ms'); return m ? m.value : 'gemini'; }
    function isAdvActive() { var adv = document.getElementById('advanced-dashboard'); return adv && adv.style.display === 'flex'; }
    function isSPActive() { var sp = document.getElementById('spreadsheet-view'); return sp && sp.style.display === 'flex'; }
    function getInput() {
      if (isSPActive()) return document.getElementById('sp-ci');
      if (isAdvActive()) return document.getElementById('adv-ci');
      return document.getElementById('ci');
    }

    function getThinkingHoldMs(text) {
      var len = String(text || '').trim().length;
      if (len < 80) return 450;
      if (len < 240) return 650;
      if (len < 700) return 900;
      if (len < 1600) return 1200;
      return 1500;
    }

    async function doSend(text) {
      if (!text) return;
      hideNetworkErrorBanner();
      push('user', text); addMsg('user', text);
      var inp = getInput(); if (inp) { inp.value = ''; inp.style.height = 'auto'; }

      window.currentAbortController = new AbortController();
      setStopButtons();
      thinkingStartedAt = Date.now();
      thinkingMinMs = getThinkingHoldMs(text);
      typ(true);

	      var msgs = [];
	      msgs.push({ role: 'system', content: 'You are Codex AI, a helpful intelligent assistant. Think carefully and respond in a calm, natural pace. Keep replies concise by default, and for hard prompts give a useful structured answer. Use standard Markdown formatting like bolding key terms with **bold**, headers with ### (use Level 3 headers maximum for visual compatibility), list items with - or *, and code fences (```lang ... ```) for code blocks.' });
	      var t = gt(tid);
	      if (t && t.messages) t.messages.forEach(function (m) { msgs.push({ role: (m.role === 'ai' || m.role === 'assistant') ? 'assistant' : 'user', content: m.text }); });

	      // Save the last request so "Click to retry" can resend without duplicating the user message.
	      lastChatUserText = text;
	      lastChatPayload = { model: 'openai/gpt-4o-mini', messages: msgs.map(m => ({ role: m.role, content: m.content })) };

	      try {
	        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
	          typ(false);
	          addNetworkErrorMsg();
	          resetSendButtons();
	          return;
	        }
	      } catch (_) { }

	      // --- SECURE BACKEND AI API ---
	      try {
	        console.log("Trying Flowlet Backend AI...");
	        const openRouterResponse = await postBackend('/api/chat', lastChatPayload);

        const data = openRouterResponse;
        if (data.choices && data.choices[0] && data.choices[0].message) {
            handleAIReply(data.choices[0].message.content);
            return;
          } else {
            throw new Error('Invalid response format from OpenRouter');
          }
	      } catch (openRouterErr) {
	        typ(false);
	        if (isNetworkIssue(openRouterErr)) {
	          addNetworkErrorMsg();
	        } else {
	          addMsg('ai', 'Something went wrong. Please try again.');
	        }
	        resetSendButtons();
	      }
	    }

    function handleAIReply(content) {
      if (window.stopStream) return;
      var repPreview = clean(content || '');
      var elapsed = Date.now() - thinkingStartedAt;
      var repLen = repPreview.length;
      var replyBasedHold = 2600;
      if (repLen > 220) replyBasedHold = 4200;
      if (repLen > 520) replyBasedHold = 6200;
      if (repLen > 1000) replyBasedHold = 8200;
      var waitMs = Math.max(0, Math.max(thinkingMinMs, replyBasedHold) - elapsed);
      if (replyDelayTimer) clearTimeout(replyDelayTimer);

      replyDelayTimer = setTimeout(function () {
	        replyDelayTimer = null;
	        if (window.stopStream) return;
	        typ(false);
	        hideNetworkErrorBanner();
	        var rep = clean(content);
	        push('ai', rep);
	        addMsg('ai', rep, true, true);
	        resetSendButtons();
	      }, waitMs);
	    }

    function send() { if (handleStop()) return; var t = document.getElementById('ci').value.trim(); if (!t) return; doSend(t); }
    function send2() { if (handleStop()) return; var t = document.getElementById('ci2').value.trim(); if (!t) return; doSend(t); }
    function sendAdv() { if (handleStop()) return; var t = document.getElementById('adv-ci').value.trim(); if (!t) return; goChat(); doSend(t); }
    function sendLanding() { 
      if (handleStop()) return; 
      var el = document.getElementById('ci-landing');
      var t = el ? el.value.trim() : ''; 
      if (!t) return; 
      if (el) { el.value = ''; resizeInputField(el); }
      openAdvancedDashboard(); 
      doSend(t); 
    }
    function sendSP() { if (handleStop()) return; var t = document.getElementById('sp-ci').value.trim(); if (!t) return; doSend(t); }
    function sendDemo() { if (handleStop()) return; var el = document.querySelector('.demo-search-input'); var t = el ? el.value.trim() : ''; if (!t) return; if (el) { el.value = ''; resizeInputField(el); } closeDemoDashboard(); goChat(); doSend(t); }
    function go(t) { document.getElementById('ci').value = t; doSend(t); }

    function getInputBaseHeight(el) {
      var cs = window.getComputedStyle(el);
      var h = parseInt(cs.minHeight, 10);
      if (!Number.isFinite(h) || h <= 0) h = parseInt(el.getAttribute('rows') || '1', 10) * parseFloat(cs.lineHeight || '20');
      if (!Number.isFinite(h) || h <= 0) h = 36;
      return h;
    }

    function resizeInputField(el) {
      if (!el) return;
      var baseHeight = getInputBaseHeight(el);
      var maxHeight = parseInt(window.getComputedStyle(el).maxHeight, 10);
      if (!Number.isFinite(maxHeight) || maxHeight <= 0) maxHeight = 132;

      if (!el.value.trim()) {
        el.style.height = baseHeight + 'px';
        el.style.overflowY = 'hidden';
        el.scrollTop = 0;
        return;
      }

      // For short single-line input, keep the baseline height (Codex-like stable composer).
      // Grow only when the user adds a newline or the content truly wraps.
      var hasNewline = el.value.indexOf('\n') !== -1;
      el.style.height = 'auto';
      var raw = el.scrollHeight;
      var nextHeight = Math.max(baseHeight, Math.min(raw, maxHeight));
      if (!hasNewline && raw <= baseHeight + 6) nextHeight = baseHeight;
      el.style.height = nextHeight + 'px';
      el.style.overflowY = raw > maxHeight ? 'auto' : 'hidden';
      if (raw <= maxHeight) el.scrollTop = 0;
    }

    function refreshWorkspaceEmptyState() {
      var hero = document.getElementById('sp-empty-hero');
      var mh = document.getElementById('sp-mh');
      var inp = document.getElementById('sp-ci');
      if (!hero || !mh) return;
      var hasInput = !!(inp && inp.value && inp.value.trim().length > 0);
      hero.style.display = (mh.children.length > 0 || hasInput) ? 'none' : 'flex';
    }

    // Input binding
    function bindInput(id, sbId) {
      var el = document.getElementById(id), sb = document.getElementById(sbId);
      if (!el) return;
      resizeInputField(el);
      refreshWorkspaceEmptyState();
      el.addEventListener('input', function () {
        resizeInputField(this);
        setTimeout(() => resizeInputField(this), 0);
        refreshWorkspaceEmptyState();
        if (sb) {
          if (this.value.trim()) {
            sb.style.display = 'flex';
            sb.classList.add('active');
          } else {
            sb.classList.remove('active');
          }
        }
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (id === 'ci') send();
          else if (id === 'ci2') send2();
          else if (id === 'adv-ci') sendAdv();
          else if (id === 'sp-ci') sendSP();
          else if (id === 'ci-landing') sendLanding();
        }
      });
    }
    bindInput('ci', 'sb');
    bindInput('ci2', 'sb2');
    bindInput('adv-ci', null);
    bindInput('ci-landing', null);
    bindInput('sp-ci', 'sb-sp');

    // Replaced ncBtn assignment to avoid null reference error

    // CHAT MENU LOGIC
    var activeChatMenuId = null;
    function showChatMenu(e, id) {
      e.stopPropagation();
      var menu = document.getElementById('chat-menu-popup');
      activeChatMenuId = id;
      menu.style.display = 'flex';
      var rect = e.currentTarget.getBoundingClientRect();
      menu.style.top = (rect.bottom + 5) + 'px';
      menu.style.left = (rect.right - 140) + 'px';
    }
    function delActiveMenu() {
      if (activeChatMenuId) { deleteT(activeChatMenuId); document.getElementById('chat-menu-popup').style.display = 'none'; activeChatMenuId = null; }
    }
    document.addEventListener('click', function () {
      var menu = document.getElementById('chat-menu-popup');
      if (menu) menu.style.display = 'none';
    });

    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('hidden');
      updateOpenBtn();
    }

    function closeSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.add('hidden');
      updateOpenBtn();
    }

    function openSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('hidden');
      updateOpenBtn();
    }

    function updateOpenBtn() {
      const sidebar = document.getElementById('sidebar');
      const btn = document.getElementById('sb-open-btn');
      if (!btn) return;
      btn.style.display = sidebar && sidebar.classList.contains('hidden') ? 'flex' : 'none';
    }

    function openAdvancedDashboard() {
      // KEY FIX: #advanced-dashboard is INSIDE #home
      // So we must NOT hide #home \u2014 only hide the landing-page child inside it

      window.isUserLoggedIn = true;
      // Hide landing content (inside #home)
      const landing = document.getElementById('landing-page');
      if (landing) landing.style.display = 'none';

      const landingChat = document.getElementById('landing-chat-section');
      if (landingChat) landingChat.style.display = 'none';

      // Hide chat view
      const chat = document.getElementById('chat');
      if (chat) chat.style.display = 'none';

      // Open spreadsheet-view (which is the actual workspace/dashboard) directly!
      goChat();

      // Show Sidebar
      const sb = document.getElementById('sidebar');
      if (sb) {
        sb.style.display = 'flex';
        sb.classList.remove('hidden');
      }

      // Hide Auth Buttons
      const auth = document.getElementById('authButtons');
      if (auth) auth.style.display = 'none';
    }



    // BOOT
    renderList();
    newT(); // Always show Home dashboard at startup
    updateGUI(isConnected());

    // CHECK SUPABASE AUTH
    (async function () {
      const authButtons = document.getElementById('authButtons');
      const userProfile = document.getElementById('userProfile');

      var sbClient = window.supabaseClient || await waitForSupabaseClient(2500);
      if (!sbClient) {
        console.error("No Supabase client found");
        return;
      }
      try {
        const { data: { session }, error: sessionError } = await sbClient.auth.getSession();
        if (sessionError) throw sessionError;

        const activeUser = session?.user;
        const userEmail = activeUser?.email;

        if (userEmail) {
          if (authButtons) authButtons.style.display = 'none';
          if (userProfile) userProfile.style.display = 'flex';

          const emailDisplay = document.getElementById('userEmailDisplay');
          if (emailDisplay) emailDisplay.textContent = userEmail.split('@')[0];

          // Auto-open dashboard if logged in
          openAdvancedDashboard();
        } else {
          console.warn("Session found but no userEmail present");
        }
      } catch (e) {
        console.error("Auth check failed:", e);
      }
    })();

;

document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('.int-btn:not([onclick])').forEach(function (button) {
        button.textContent = 'Coming soon';
        button.disabled = true;
        button.classList.add('coming-soon');
        button.setAttribute('aria-disabled', 'true');
      });
    });

    function openDemoDashboard() {
      document.body.classList.add('dashboard-active');
      // Hide other main layout views
      const home = document.getElementById('home');
      const chat = document.getElementById('chat');
      const adv = document.getElementById('advanced-dashboard');
      const sp = document.getElementById('spreadsheet-view');
      const main = document.querySelector('.main');
      if (home) home.style.display = 'none';
      if (adv) adv.style.display = 'none';
      if (chat) chat.style.display = 'none';
      if (main) main.style.display = 'none';
      if (sp) sp.style.display = 'none';

      // Show the main sidebar next to it
      const sb = document.getElementById('sidebar');
      if (sb) {
        sb.style.display = 'flex';
        sb.classList.remove('hidden');
        sb.classList.add('demo-mode');
      }

      // Show the Perplexity demo dashboard view
      const demo = document.getElementById('perplexity-demo-view');
      if (demo) {
        demo.style.display = 'flex';
        demo.offsetHeight; // force reflow
        demo.classList.add('active');
      }
      document.body.style.overflow = 'hidden';
    }
    
    function closeDemoDashboard() {
      document.body.classList.remove('dashboard-active');
      const demo = document.getElementById('perplexity-demo-view');
      if (demo) {
        demo.classList.remove('active');
        setTimeout(() => {
          demo.style.display = 'none';
        }, 700);
      }
      document.body.style.overflow = '';

      // Return back to the landing page layout
      const home = document.getElementById('home');
      const main = document.querySelector('.main');
      const sb = document.getElementById('sidebar');
      
      if (home) home.style.display = 'flex';
      if (main) main.style.display = 'flex';
      if (sb) {
        sb.style.display = 'none';
        sb.classList.add('hidden');
        sb.classList.remove('demo-mode');
      }
    }

    function startNewDemoChat() {
      const textarea = document.querySelector('.demo-search-input');
      if (textarea) {
        textarea.value = '';
        textarea.focus();
      }
    }

    function changeDemoProjectName(newName) {
      if (!newName) {
        newName = prompt("Enter project name:", "New project");
      }
      if (newName && newName.trim() !== "") {
        const cleanName = newName.trim();
        const titleName = document.getElementById('demo-project-title-name');
        const dropdownName = document.getElementById('demo-project-dropdown-name');
        if (titleName) titleName.textContent = cleanName;
        if (dropdownName) dropdownName.textContent = cleanName;
      }
    }

    // Live search filtering for plugins page
    window.addEventListener('DOMContentLoaded', function() {
      const searchInput = document.getElementById('pl-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          const query = this.value.toLowerCase().trim();
          const items = document.querySelectorAll('#plugins-tab-plugins .pl-item');
          items.forEach(item => {
            const titleEl = item.querySelector('.pl-item-title');
            const subEl = item.querySelector('.pl-item-sub');
            const title = titleEl ? titleEl.textContent.toLowerCase() : '';
            const sub = subEl ? subEl.textContent.toLowerCase() : '';
            if (title.includes(query) || sub.includes(query)) {
              item.style.display = 'flex';
            } else {
              item.style.display = 'none';
            }
          });
        });
      }
    });

(function attachGeneratedEventHandlers(){
  var handlers = {
    "h1": function(event){
      this.style.backgroundColor='rgba(255,255,255,0.05)'; this.style.color='#fff';
    },
    "h2": function(event){
      this.style.backgroundColor='transparent'; this.style.color='#a1a1aa';
    },
    "h3": function(event){
      toggleSidebar()
    },
    "h4": function(event){
      newT()
    },
    "h5": function(event){
      goHome()
    },
    "h6": function(event){
      openPluginsView()
    },
    "h7": function(event){
      openAutomationsView()
    },
    "h8": function(event){
      openConnectionsModal()
    },
    "h9": function(event){
      openConnectionsModal()
    },
    "h10": function(event){
      toggleSidebar()
    },
    "h11": function(event){
      goHome()
    },
    "h12": function(event){
      this.style.color='#fff'
    },
    "h13": function(event){
      this.style.color='rgba(255,255,255,0.7)'
    },
    "h14": function(event){
      this.style.color='#fff'
    },
    "h15": function(event){
      this.style.color='rgba(255,255,255,0.7)'
    },
    "h16": function(event){
      this.style.color='#fff'
    },
    "h17": function(event){
      this.style.color='rgba(255,255,255,0.7)'
    },
    "h18": function(event){
      this.style.color='#fff'
    },
    "h19": function(event){
      this.style.color='rgba(255,255,255,0.7)'
    },
    "h20": function(event){
      this.style.background='#f3f3f1'; this.style.borderColor='rgba(17,17,17,0.16)'
    },
    "h21": function(event){
      this.style.background='#ffffff'; this.style.borderColor='rgba(17,17,17,0.12)'
    },
    "h22": function(event){
      openDemoDashboard()
    },
    "h23": function(event){
      this.style.background='#252525'; this.style.borderColor='#252525'
    },
    "h24": function(event){
      this.style.background='#101010'; this.style.borderColor='#101010'
    },
    "h25": function(event){
      this.style.background='#f8f8f8'; this.style.transform='translateY(-1px)'
    },
    "h26": function(event){
      this.style.background='#ffffff'; this.style.transform='translateY(0)'
    },
    "h27": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h28": function(event){
      this.style.background='#000000'
    },
    "h29": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h30": function(event){
      this.style.background='#000000'
    },
    "h31": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h32": function(event){
      this.style.background='#000000'
    },
    "h33": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h34": function(event){
      this.style.background='#000000'
    },
    "h35": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h36": function(event){
      this.style.background='#000000'
    },
    "h37": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h38": function(event){
      this.style.background='#000000'
    },
    "h39": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h40": function(event){
      this.style.background='#000000'
    },
    "h41": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h42": function(event){
      this.style.background='#000000'
    },
    "h43": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h44": function(event){
      this.style.background='#000000'
    },
    "h45": function(event){
      this.style.background='rgba(255,255,255,0.03)'
    },
    "h46": function(event){
      this.style.background='#000000'
    },
    "h47": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h48": function(event){
      this.style.background='#000000'
    },
    "h49": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h50": function(event){
      this.style.background='#000000'
    },
    "h51": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h52": function(event){
      this.style.background='#000000'
    },
    "h53": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h54": function(event){
      this.style.background='#000000'
    },
    "h55": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h56": function(event){
      this.style.background='#000000'
    },
    "h57": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h58": function(event){
      this.style.background='#000000'
    },
    "h59": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h60": function(event){
      this.style.background='#000000'
    },
    "h61": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h62": function(event){
      this.style.background='#000000'
    },
    "h63": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h64": function(event){
      this.style.background='#000000'
    },
    "h65": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h66": function(event){
      this.style.background='#000000'
    },
    "h67": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h68": function(event){
      this.style.background='#000000'
    },
    "h69": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h70": function(event){
      this.style.background='#000000'
    },
    "h71": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h72": function(event){
      this.style.background='#000000'
    },
    "h73": function(event){
      this.style.background='rgba(255,255,255,0.05)'
    },
    "h74": function(event){
      this.style.background='#000000'
    },
    "h75": function(event){
      event.stopPropagation()
    },
    "h76": function(event){
      delActiveMenu()
    },
    "h77": function(event){
      closeConnectionsModal()
    },
    "h78": function(event){
      event.stopPropagation()
    },
    "h79": function(event){
      closeConnectionsModal()
    },
    "h80": function(event){
      connectComposioGmail()
    },
    "h81": function(event){
      connectComposioGmail()
    },
    "h82": function(event){
      connectNotion()
    },
    "h83": function(event){
      resizeInputField(this)
    },
    "h84": function(event){
      this.style.color='#fff'
    },
    "h85": function(event){
      this.style.color='#737373'
    },
    "h86": function(event){
      this.style.color='#ff9533';
    },
    "h87": function(event){
      this.style.color='#ff7a00';
    },
    "h88": function(event){
      this.querySelector('span:first-child').style.color='#fff';
    },
    "h89": function(event){
      this.querySelector('span:first-child').style.color='#e4e4e7';
    },
    "h90": function(event){
      this.style.color='#fff'
    },
    "h91": function(event){
      this.style.color='#737373'
    },
    "h92": function(event){
      sendSP()
    },
    "h93": function(event){
      this.style.background='#f4f4f5'; this.style.color='#000';
    },
    "h94": function(event){
      this.style.background='#ffffff'; this.style.color='#000000';
    },
    "h95": function(event){
      setPluginsTab('plugins')
    },
    "h96": function(event){
      setPluginsTab('skills')
    },
    "h97": function(event){
      goChat()
    },
    "h98": function(event){
      if(event.target === this) closeCRMModal()
    },
    "h99": function(event){
      closeCRMModal()
    },
    "h100": function(event){
      this.style.color='#fff'; this.style.background='rgba(255,255,255,0.05)'
    },
    "h101": function(event){
      this.style.color='#71717a'; this.style.background='transparent'
    },
    "h102": function(event){
      this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)'
    },
    "h103": function(event){
      this.style.background='transparent'; this.style.borderColor='transparent'
    },
    "h104": function(event){
      connectHubSpot(); closeCRMModal();
    },
    "h105": function(event){
      this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)'
    },
    "h106": function(event){
      this.style.background='transparent'; this.style.borderColor='transparent'
    },
    "h107": function(event){
      connectSalesforce()
    },
    "h108": function(event){
      this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)'
    },
    "h109": function(event){
      this.style.background='transparent'; this.style.borderColor='transparent'
    },
    "h110": function(event){
      closeCRMModal();
    },
    "h111": function(event){
      window.location.href='login.html'
    },
    "h112": function(event){
      this.style.background='#e0e0e0'
    },
    "h113": function(event){
      this.style.background='#fff'
    },
    "h114": function(event){
      window.location.href='login.html?mode=signup'
    },
    "h115": function(event){
      this.style.borderColor='#fff'; this.style.background='rgba(255,255,255,0.05)'
    },
    "h116": function(event){
      this.style.borderColor='rgba(255,255,255,0.2)'; this.style.background='transparent'
    },
    "h117": function(event){
      resizeInputField(this);
      var btn = document.getElementById('demo-send-btn');
      if (btn && !btn.classList.contains('streaming-stop')) {
        if (this.value.trim()) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    },
    "h118": function(event){
      if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendDemo(); }
    },
    "h119": function(event){
      this.style.color='#fff'
    },
    "h120": function(event){
      this.style.color='#737373'
    },
    "h121": function(event){
      this.style.color='#ff9533';
    },
    "h122": function(event){
      this.style.color='#ff7a00';
    },
    "h123": function(event){
      this.querySelector('span:first-child').style.color='#fff';
    },
    "h124": function(event){
      this.querySelector('span:first-child').style.color='#e4e4e7';
    },
    "h125": function(event){
      this.style.color='#fff'
    },
    "h126": function(event){
      this.style.color='#737373'
    },
    "h127": function(event){
      sendDemo()
    },
    "h128": function(event){
      this.style.background='#f4f4f5'; this.style.color='#000';
    },
    "h129": function(event){
      this.style.background='#ffffff'; this.style.color='#000000';
    },
    "h130": function(event){
      changeDemoProjectName()
    },
    "h131": function(event){
      this.style.borderColor='rgba(255,255,255,0.15)'; this.style.color='#fff';
    },
    "h132": function(event){
      this.style.borderColor='rgba(255,255,255,0.08)'; this.style.color='#737373';
    },
    "hAuthOverlayClose": function(event){
      if(event.target === this) { this.classList.remove('is-open'); setTimeout(()=>this.style.display='none', 300); }
    },
    "hLoginOpen": function(event){
      var overlay = document.getElementById('authModalOverlay');
      if (!overlay) return;
      overlay.style.display='flex';
      requestAnimationFrame(function(){ overlay.classList.add('is-open'); });
    }
  };
  var eventMap = {
    "h1": "mouseover",
    "h2": "mouseout",
    "h3": "click",
    "h4": "click",
    "h5": "click",
    "h6": "click",
    "h7": "click",
    "h8": "click",
    "h9": "click",
    "h10": "click",
    "h11": "click",
    "h12": "mouseover",
    "h13": "mouseout",
    "h14": "mouseover",
    "h15": "mouseout",
    "h16": "mouseover",
    "h17": "mouseout",
    "h18": "mouseover",
    "h19": "mouseout",
    "h20": "mouseover",
    "h21": "mouseout",
    "hLoginOpen": "click",
    "h22": "click",
    "h23": "mouseover",
    "h24": "mouseout",
    "h25": "mouseover",
    "h26": "mouseout",
    "h27": "mouseover",
    "h28": "mouseout",
    "h29": "mouseover",
    "h30": "mouseout",
    "h31": "mouseover",
    "h32": "mouseout",
    "h33": "mouseover",
    "h34": "mouseout",
    "h35": "mouseover",
    "h36": "mouseout",
    "h37": "mouseover",
    "h38": "mouseout",
    "h39": "mouseover",
    "h40": "mouseout",
    "h41": "mouseover",
    "h42": "mouseout",
    "h43": "mouseover",
    "h44": "mouseout",
    "h45": "mouseover",
    "h46": "mouseout",
    "h47": "mouseover",
    "h48": "mouseout",
    "h49": "mouseover",
    "h50": "mouseout",
    "h51": "mouseover",
    "h52": "mouseout",
    "h53": "mouseover",
    "h54": "mouseout",
    "h55": "mouseover",
    "h56": "mouseout",
    "h57": "mouseover",
    "h58": "mouseout",
    "h59": "mouseover",
    "h60": "mouseout",
    "h61": "mouseover",
    "h62": "mouseout",
    "h63": "mouseover",
    "h64": "mouseout",
    "h65": "mouseover",
    "h66": "mouseout",
    "h67": "mouseover",
    "h68": "mouseout",
    "h69": "mouseover",
    "h70": "mouseout",
    "h71": "mouseover",
    "h72": "mouseout",
    "h73": "mouseover",
    "h74": "mouseout",
    "h75": "click",
    "h76": "click",
    "h77": "click",
    "h78": "click",
    "h79": "click",
    "h80": "click",
    "h81": "click",
    "h82": "click",
    "h83": "input",
    "h84": "mouseover",
    "h85": "mouseout",
    "h86": "mouseover",
    "h87": "mouseout",
    "h88": "mouseover",
    "h89": "mouseout",
    "h90": "mouseover",
    "h91": "mouseout",
    "h92": "click",
    "h93": "mouseover",
    "h94": "mouseout",
    "h95": "click",
    "h96": "click",
    "h97": "click",
    "h98": "click",
    "h99": "click",
    "h100": "mouseover",
    "h101": "mouseout",
    "h102": "mouseover",
    "h103": "mouseout",
    "h104": "click",
    "h105": "mouseover",
    "h106": "mouseout",
    "h107": "click",
    "h108": "mouseover",
    "h109": "mouseout",
    "h110": "click",
    "h111": "click",
    "h112": "mouseover",
    "h113": "mouseout",
    "h114": "click",
    "h115": "mouseover",
    "h116": "mouseout",
    "h117": "input",
    "h118": "keydown",
    "h119": "mouseover",
    "h120": "mouseout",
    "h121": "mouseover",
    "h122": "mouseout",
    "h123": "mouseover",
    "h124": "mouseout",
    "h125": "mouseover",
    "h126": "mouseout",
    "h127": "click",
    "h128": "mouseover",
    "h129": "mouseout",
    "h130": "click",
    "h131": "mouseover",
    "h132": "mouseout",
    "hAuthOverlayClose": "click"
  };
  document.addEventListener('DOMContentLoaded', function(){
    Object.keys(eventMap).forEach(function(id){
      document.querySelectorAll('[data-on' + eventMap[id] + '=\"' + id + '\"]').forEach(function(el){
        el.addEventListener(eventMap[id], function(event){
          var result = handlers[id].call(el, event);
          if (result === false) { event.preventDefault(); event.stopPropagation(); }
        });
      });
    });
  });
})();
