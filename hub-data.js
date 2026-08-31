/* ============================================================================
   Training Hub - data layer
   ----------------------------------------------------------------------------
   Every call to the database goes through here. Nothing else in the app knows
   whether it is talking to Supabase or to the demo store, which is what makes
   swapping in the real backend a contained job.

   Two modes:
     LIVE  - a Supabase URL + anon key have been saved. Real accounts.
     DEMO  - no config yet. Sample squadron, data kept in this browser only.
              Every screen works so you can try it before setting up a database.
   ============================================================================ */
(function () {
  const CFG_KEY = 'hub.supabase.config.v1';
  const DEMO_KEY = 'hub.demo.state.v1';
  const SUPA_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  const LOS = ['LO1', 'LO2', 'LO3', 'LO4', 'LO5'];

  /* ---------------------------------------------------------------- config --
     Two sources, in order:
       1. hub-config.js  - set once, applies to everyone who opens the site
       2. localStorage   - set per-device via the Setup screen
     A device-level setting wins, so anyone can point their own browser at a
     test project without disturbing the squadron's.
     -------------------------------------------------------------------------- */
  /* hub-config.js is hand-edited, in Notepad, by whoever is setting the site up.
     If it has a syntax error the entire file fails to run, HUB_CONFIG is never
     assigned, and the hub would otherwise drop to demo data in total silence -
     which is exactly how the squadron once served a live sign-in page backed by
     sample cadets. hub-data.js is loaded BEFORE hub-config.js so that this
     listener is already installed when that file is parsed. Do not swap them. */
  let _fileError = '';
  window.addEventListener('error', function (ev) {
    if (ev && /hub-config\.js/i.test(String(ev.filename || '')))
      _fileError = 'hub-config.js could not be read - the browser reported: ' + ((ev && ev.message) || 'syntax error') + '.';
  }, true);

  /* The listener above only gets a useful filename when the page is served over
     http(s). Opened straight off a USB stick (file://) the browser hides script
     errors as a bare "Script error." with no filename, so we detect it by its
     footprint instead: the tag is on the page, but the file never got as far as
     assigning HUB_CONFIG.

     This also distinguishes the two cases that used to look identical:
       HUB_CONFIG missing entirely -> the file is broken            (say so)
       HUB_CONFIG present but blank -> nobody has filled it in yet  (normal) */
  function fileFailedToLoad() {
    try {
      if (window.HUB_CONFIG !== undefined) return false;
      return !!document.querySelector('script[src*="hub-config"]');
    } catch (e) { return false; }
  }

  /* Shared by the file and the setup screen, so a bad value is caught on both
     paths. Returns a plain-language reason, or '' when the pair is usable. */
  function configProblem(url, key) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
      return 'That does not look like a Supabase project URL. It should look like https://abcdefgh.supabase.co';
    // A secret key bypasses row-level security entirely, so it would hand every
    // cadet's record to anyone who viewed the page source.
    if (/^sb_secret_/i.test(key) || /service_role/i.test(key))
      return 'That is a SECRET key - never use it here. It bypasses all the security rules. Copy the publishable key instead (the one Supabase says is safe to share).';
    if (key.length < 40)
      return 'That key looks too short - copy the whole publishable key.';
    if (!/^sb_publishable_/i.test(key) && !/^eyJ/.test(key))
      return 'That does not look like a publishable key. It should start with sb_publishable_ (or eyJ if it is an older project).';
    return '';
  }

  let _siteError = '';
  function siteConfig() {
    const c = window.HUB_CONFIG;
    if (!c) return null;
    const url = (c.url || '').trim().replace(/\/+$/, '');
    const key = (c.publishableKey || c.anonKey || '').trim();
    if (!url || !key) return null;
    // The same checks the setup screen runs. Previously this path did none, so
    // a secret key pasted into the file - the route the instructions actually
    // tell staff to use - was accepted without a word.
    const bad = configProblem(url, key);
    if (bad) { _siteError = 'hub-config.js: ' + bad; return null; }
    _siteError = '';
    return { url, anonKey: key, fromSite: true };
  }
  function readConfig() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.url && c.anonKey) return c;
      }
    } catch (e) {}
    return siteConfig();
  }
  function writeConfig(url, anonKey) {
    url = (url || '').trim().replace(/\/+$/, '');
    anonKey = (anonKey || '').trim();
    const bad = configProblem(url, anonKey);
    if (bad) throw new Error(bad);
    localStorage.setItem(CFG_KEY, JSON.stringify({ url, anonKey }));
    _client = null;   // otherwise the next call reuses a client for the old project
  }
  function clearConfig() { localStorage.removeItem(CFG_KEY); _client = null; }

  /* ------------------------------------------------------------ demo store -- */
  const DEMO_NAMES = [
    ['Abbott', 'AC'], ['Bhandari', 'Cdt'], ['Clarke', 'Cdt'], ['Doyle', 'CWO'],
    ['Ellery', 'Cdt'], ['Fenwick', 'Sgt'], ['Grewal', 'Cdt'], ['Hassan', 'Cpl'],
    ['Iremonger', 'Cdt'], ['Jarvis', 'Cdt'], ['Kaur', 'Cdt'], ['Lowther', 'Cdt'],
    ['Mbeki', 'Cdt'], ['Nolan', 'Cpl'], ['Okafor', 'Cdt'], ['Pryce', 'Cdt'],
  ];
  function seedDemo() {
    const profiles = DEMO_NAMES.map((n, i) => ({
      id: 'demo-' + i,
      service_number: String(30411208 + i * 37),
      display_name: n[1] + ' ' + n[0],
      is_staff: i === 3,
      flight: ['Ash', 'Beech', 'Cedar'][i % 3],
    }));
    profiles.push({ id: 'demo-me', service_number: '30499001', display_name: 'Fg Off Whitaker', is_staff: true, flight: null });
    const progress = [], handouts = [], checks = [];
    profiles.forEach((p, i) => {
      if (p.id === 'demo-me') return;
      const reached = Math.max(0, Math.min(5, Math.round(((i * 7) % 11) / 2)));
      LOS.slice(0, reached).forEach(lo => {
        progress.push({ cadet_id: p.id, lo, slide_index: 99, slide_count: 99, completed_at: new Date(Date.now() - i * 864e5).toISOString(), updated_at: new Date().toISOString() });
        const sc = 3 + ((i * 3 + lo.charCodeAt(2)) % 3);
        checks.push({ cadet_id: p.id, lo, score: sc, total: 5, wrong: [], taken_at: new Date(Date.now() - i * 864e5).toISOString() });
      });
      if (reached < 5) {
        const lo = LOS[reached];
        progress.push({ cadet_id: p.id, lo, slide_index: (i * 5) % 30, slide_count: 40, completed_at: null, updated_at: new Date().toISOString() });
        for (let k = 0; k < (i % 4); k++)
          handouts.push({ cadet_id: p.id, lo, prompt_key: lo.toLowerCase() + '-p' + (k + 1), answer: 'Sample answer from the lesson.', updated_at: new Date().toISOString() });
      }
    });
    return { profiles, progress, handouts, checks, session: null };
  }
  function loadDemo() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const s = seedDemo();
    saveDemo(s);
    return s;
  }
  function saveDemo(s) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch (e) {} }

  /* ------------------------------------------------------------- live mode -- */
  let _client = null;
  async function client() {
    const cfg = readConfig();
    if (!cfg) return null;
    if (_client) return _client;
    const { createClient } = await import(SUPA_CDN);
    _client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,      // survive a page reload
        autoRefreshToken: true,    // renew the access token before it expires
        detectSessionInUrl: true,  // needed for the password-reset link
      },
    });
    return _client;
  }

  /* Is there still a usable session? Called before writes, so an expired token
     surfaces as "you have been signed out" rather than a confusing permissions
     error from the database. */
  async function requireSession() {
    const c = await client();
    if (!c) return null;
    const { data: { session } } = await c.auth.getSession();
    if (!session) {
      const e = new Error('Your session has expired. Sign in again and your work is still saved.');
      e.sessionExpired = true;
      throw e;
    }
    return c;
  }

  /* ------------------------------------------------------------------- API -- */
  const Hub = {
    LOS,
    mode() { return readConfig() ? 'live' : 'demo'; },
    isLive() { return !!readConfig(); },
    saveConfig: writeConfig,
    clearConfig,
    config: readConfig,

    /* Why the hub is in demo mode when it was meant to be live. '' means either
       genuinely unconfigured or working fine - the caller knows which from
       isLive(). Surfaced on the sign-in screen so a broken hub-config.js is
       visible on the page instead of only in the browser console. */
    configError() {
      if (readConfig()) return '';           // connected; nothing to report
      if (_siteError) return _siteError;     // file present, but the values are wrong
      if (fileFailedToLoad())
        return _fileError || 'hub-config.js is on the page but did not run, which almost always means a typo in it.' +
          ' Open it and check each value is wrapped in single quotes and each line ends with a comma, then publish the folder again.';
      return '';                             // genuinely not set up yet
    },

    async connectionTest() {
      const c = await client();
      if (!c) throw new Error('No configuration saved.');
      const { error } = await c.from('profiles').select('id', { count: 'exact', head: true });
      if (error && !/permission|row-level/i.test(error.message)) throw new Error(error.message);
      return true;
    },

    /* ---- session ---- */
    async currentUser() {
      if (!this.isLive()) {
        const d = loadDemo();
        if (!d.session) return null;
        return d.profiles.find(p => p.id === d.session) || null;
      }
      const c = await client();
      const { data: { user } } = await c.auth.getUser();
      if (!user) return null;
      const { data } = await c.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!data) return { id: user.id, unclaimed: true, email: user.email };
      return data;
    },

    async signIn(email, password) {
      if (!this.isLive()) {
        const d = loadDemo();
        const p = d.profiles.find(x => x.service_number === String(email).trim()) || d.profiles.find(x => x.id === 'demo-me');
        d.session = p.id; saveDemo(d);
        return p;
      }
      const c = await client();
      const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(friendly(error.message));
      return await this.currentUser();
    },

    async signUp(email, password, serviceNumber, surname, displayName) {
      if (!this.isLive()) {
        const d = loadDemo();
        const p = { id: 'demo-new-' + Date.now(), service_number: serviceNumber || '30499999',
                    display_name: displayName || ('Cdt ' + (surname || 'New')), is_staff: false, flight: null };
        d.profiles.push(p); d.session = p.id; saveDemo(d);
        return p;
      }
      const c = await client();
      const { error: sErr } = await c.auth.signUp({ email: email.trim(), password });
      if (sErr) throw new Error(friendly(sErr.message));
      // signUp may or may not return an active session depending on the project's
      // email-confirmation setting; make sure we have one before claiming.
      const { data: { session } } = await c.auth.getSession();
      if (!session) {
        const { error: iErr } = await c.auth.signInWithPassword({ email: email.trim(), password });
        if (iErr) throw new Error('Account created, but it needs email confirmation before you can sign in. Check your inbox.');
      }
      return await this.claim(serviceNumber, surname, displayName);
    },

    async claim(serviceNumber, surname, displayName) {
      const c = await client();
      const { data, error } = await c.rpc('claim_account', {
        p_service_number: serviceNumber, p_surname: surname, p_display_name: displayName || '',
      });
      if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''));
      return Array.isArray(data) ? data[0] : data;
    },

    async signOut() {
      if (!this.isLive()) { const d = loadDemo(); d.session = null; saveDemo(d); return; }
      const c = await client();
      await c.auth.signOut();
    },

    async resetPassword(email) {
      if (!this.isLive()) return true;
      const c = await client();
      const { error } = await c.auth.resetPasswordForEmail(email.trim());
      if (error) throw new Error(error.message);
      return true;
    },

    /* ---- people ---- */
    async listProfiles() {
      if (!this.isLive()) return loadDemo().profiles;
      const c = await client();
      const { data, error } = await c.from('profiles').select('*').order('display_name');
      if (error) throw new Error(error.message);
      return data || [];
    },

    async setStaff(cadetId, isStaff) {
      if (!this.isLive()) {
        const d = loadDemo();
        const p = d.profiles.find(x => x.id === cadetId);
        if (p) p.is_staff = !!isStaff;
        saveDemo(d); return p;
      }
      const c = await client();
      const { data, error } = await c.from('profiles').update({ is_staff: !!isStaff }).eq('id', cadetId).select().maybeSingle();
      if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''));
      return data;
    },

    async listRoster() {
      if (!this.isLive()) return [];
      const c = await client();
      const { data, error } = await c.from('roster').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },

    async addToRoster(row) {
      if (!this.isLive()) throw new Error('Set up the database first - in demo mode there is nothing to add to.');
      const c = await requireSession();
      const { data, error } = await c.from('roster').insert({
        service_number: (row.service_number || '').trim(),
        surname: (row.surname || '').trim(),
        email: (row.email || '').trim().toLowerCase() || null,
        flight: (row.flight || '').trim() || null,
        intended_staff: !!row.intended_staff,
      }).select().maybeSingle();
      if (error) throw new Error(
        /row-level security/i.test(error.message)
          ? 'The database refused this. Your sign-in may have lapsed - sign out and back in, then try again.'
          : /duplicate/i.test(error.message)
            ? 'That service number is already on the roster.'
            : error.message);
      return data;
    },

    async removeFromRoster(id) {
      // requireSession, as addToRoster already does: a lapsed token should read
      // as "you have been signed out", not as a raw row-level-security refusal.
      const c = await requireSession();
      const { error } = await c.from('roster').delete().eq('id', id);
      if (error) throw new Error(
        /row-level security/i.test(error.message)
          ? 'The database refused this. Your sign-in may have lapsed - sign out and back in, then try again.'
          : error.message);
    },

    /* ---- progress ---- */
    async listProgress() {
      if (!this.isLive()) return loadDemo().progress;
      const c = await client();
      const { data, error } = await c.from('lesson_progress').select('*');
      if (error) throw new Error(error.message);
      return data || [];
    },

    async saveProgress(cadetId, lo, slideIndex, slideCount, completed) {
      if (!this.isLive()) {
        const d = loadDemo();
        let r = d.progress.find(p => p.cadet_id === cadetId && p.lo === lo);
        if (!r) { r = { cadet_id: cadetId, lo, started_at: new Date().toISOString() }; d.progress.push(r); }
        r.slide_index = slideIndex; r.slide_count = slideCount;
        r.updated_at = new Date().toISOString();
        if (completed) r.completed_at = new Date().toISOString();
        saveDemo(d); return r;
      }
      const c = await client();
      const row = { cadet_id: cadetId, lo, slide_index: slideIndex, slide_count: slideCount, updated_at: new Date().toISOString() };
      if (completed) row.completed_at = new Date().toISOString();
      const { data, error } = await c.from('lesson_progress').upsert(row, { onConflict: 'cadet_id,lo' }).select().maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    /* ---- handout ---- */
    async listHandout(cadetId, lo) {
      if (!this.isLive())
        return loadDemo().handouts.filter(h => h.cadet_id === cadetId && (!lo || h.lo === lo));
      const c = await client();
      let q = c.from('handout_responses').select('*').eq('cadet_id', cadetId);
      if (lo) q = q.eq('lo', lo);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async listAllHandout(lo) {
      if (!this.isLive()) return loadDemo().handouts.filter(h => !lo || h.lo === lo);
      const c = await client();
      let q = c.from('handout_responses').select('*');
      if (lo) q = q.eq('lo', lo);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async saveAnswer(cadetId, lo, promptKey, answer) {
      if (!this.isLive()) {
        const d = loadDemo();
        let r = d.handouts.find(h => h.cadet_id === cadetId && h.lo === lo && h.prompt_key === promptKey);
        if (!r) { r = { cadet_id: cadetId, lo, prompt_key: promptKey }; d.handouts.push(r); }
        r.answer = answer; r.updated_at = new Date().toISOString();
        saveDemo(d); return r;
      }
      const c = await client();
      const { data, error } = await c.from('handout_responses').upsert(
        { cadet_id: cadetId, lo, prompt_key: promptKey, answer, updated_at: new Date().toISOString() },
        { onConflict: 'cadet_id,lo,prompt_key' }).select().maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    /* ---- checks ---- */
    async listChecks() {
      if (!this.isLive()) return loadDemo().checks;
      const c = await client();
      const { data, error } = await c.from('check_results').select('*');
      if (error) throw new Error(error.message);
      return data || [];
    },

    async saveCheck(cadetId, lo, score, total, wrong) {
      if (!this.isLive()) {
        const d = loadDemo();
        d.checks.push({ cadet_id: cadetId, lo, score, total, wrong: wrong || [], taken_at: new Date().toISOString() });
        saveDemo(d); return;
      }
      const c = await client();
      const { error } = await c.from('check_results').insert({ cadet_id: cadetId, lo, score, total, wrong: wrong || [] });
      if (error) throw new Error(error.message);
    },

    /* ---- demo helpers ---- */
    demoSignInAs(id) { const d = loadDemo(); d.session = id; saveDemo(d); },
    resetDemo() { localStorage.removeItem(DEMO_KEY); },
  };

  function friendly(msg) {
    if (/invalid login credentials/i.test(msg)) return 'That email or password is not right.';
    if (/already registered/i.test(msg)) return 'There is already an account for that email. Try signing in.';
    if (/password should be at least/i.test(msg)) return 'Password needs to be at least 6 characters.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
    return msg;
  }

  window.HubData = Hub;
})();
