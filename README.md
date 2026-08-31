# 2434 Squadron Training Hub — handoff

## What this is

A working training portal for 2434 (Church Fenton) Squadron, Air Training Corps,
covering the First Class **Basic Navigation** syllabus (five learning outcomes).

It is **live software, not a design mock.** Real accounts, real password auth,
real shared data via Supabase (Postgres). Deployed as static files on Netlify.

Two audiences:

- **Cadets** — work through the five lessons, answer a handout as they go.
- **Staff** — put cadets on the roster, grant staff access, watch live progress
  during a lesson, read what each cadet has written.

## Current state

| | |
|---|---|
| Hosting | Netlify (drag-and-drop deploys, and a GitHub-connected site) |
| Repo | `domjsut-cyber/2434traininghub` — **near-empty, nothing pushed yet** |
| Database | Supabase, free tier, London (eu-west-2) |
| Auth | Supabase email + password |
| Build step | **None.** Plain static files, no bundler, no npm |

**The repo is the first thing to sort out.** It contains only a 1-byte
`read.md`. Everything in this bundle has been delivered as zip downloads so far,
which is why the connected Netlify site 404s. First job: push this folder's
contents to the repo root so `index.html` sits at top level.

## Architecture

```
index.html          the entire app — one file, ~900 lines
support.js          runtime the app is built on (see the warning below)
hub-config.js       Supabase URL + publishable key. Fill in once, applies site-wide
hub-data.js         THE ONLY FILE THAT TALKS TO THE DATABASE
hub-schema.sql      Postgres schema + row-level security. Run in Supabase SQL editor
lessons/LO1..5.json slides (extracted from the PowerPoints) + handout prompts
anim/*.html         18 self-contained animations, embedded in lessons via iframe
anim/index.html     standalone animation library
media/              squadron crest
```

### `hub-data.js` is the seam

Every database call goes through it. Nothing else in the app knows whether it is
talking to Supabase or to the in-browser demo store. Two modes:

- **live** — `hub-config.js` (or a per-device localStorage override) has a URL
  and publishable key.
- **demo** — no config. Sample squadron, data in localStorage, every screen
  works. Any email/password signs you in as staff.

Keep that boundary. If you migrate to a different backend, `hub-data.js` is the
only file that should need rewriting.

### ⚠ The `index.html` format is unusual

`index.html` is a **Design Component** — an authoring format from the tool this
was built in. It has a `<x-dc>` template with `{{ hole }}` interpolation and a
`class Component extends DCLogic` logic class, both interpreted at runtime by
`support.js`.

**This is not a normal React app and `support.js` is not a library you can
`npm install`.** It works, and it is what is deployed, but it is a dead end for
long-term maintenance in Claude Code.

**Recommendation:** port `index.html` to plain React + Vite (or your preference)
as an early task. The mapping is mechanical:

| DC concept | React equivalent |
|---|---|
| `renderVals()` return object | values computed in the component body |
| `{{ value }}` in template | `{value}` in JSX |
| `<sc-if value="{{ x }}">` | `{x && (...)}` |
| `<sc-for list="{{ xs }}" as="x">` | `{xs.map(x => ...)}` |
| `this.state` / `this.setState` | `useState` |
| `componentDidMount` | `useEffect(fn, [])` |
| inline `style="..."` strings | style objects, or your CSS solution |

`hub-data.js`, `hub-config.js`, the lesson JSON, the animations and the SQL all
carry over untouched. Only `index.html` needs the port.

## Database

Full schema in `hub-schema.sql`. Five tables, all with row-level security:

- **`roster`** — staff pre-load cadets here before they sign up. Staff-only.
- **`profiles`** — the account record. Deliberately minimal: service number,
  display name, `is_staff`, flight. No email, no date of birth.
- **`lesson_progress`** — one row per cadet per LO, tracks slide position.
- **`handout_responses`** — one row per cadet per LO per prompt.
- **`check_results`** — quiz scores. Table exists; **no UI yet** (see Outstanding).

### Sign-up flow

Staff add a cadet to `roster` with service number, surname and email. The cadet
signs up with those three, and `claim_account()` (a `SECURITY DEFINER` function)
verifies all three match an unclaimed roster row, creates their profile, and
**nulls the stored email**.

That last part is deliberate. Cadets are often under 18, so the design stores as
little as possible: email exists only long enough to prove identity at sign-up,
then it is erased. It survives in `auth.users` because Supabase needs it for
password resets, and nowhere else.

### Staff access

A tickbox on the People screen. The rule that matters is a **database trigger**
(`guard_is_staff`), not the UI:

- a cadet cannot promote themselves
- nobody can change their own `is_staff`
- only staff can change anyone's `is_staff`

Hiding a control in the UI is not security. Keep the enforcement in the database.

## Lessons

`lessons/LO*.json` holds, per LO:

```jsonc
{
  "lo": "LO3",
  "title": "Using a lightweight compass",
  "slides": [
    { "label": "...", "notes": "instructor notes",
      "bg": "#ffffff",
      "anim": "Nav LO3 - Taking a Bearing.html",  // or null
      "html": "<div style=...>"                    // 1920x1080 slide markup
    }
  ],
  "prompts": [ { "key": "lo3-p1", "afterSlide": 8, "text": "What is the index line for?" } ]
}
```

Slides were extracted from the five PowerPoint decks, so the portal and the
projector show the same thing. Each slide's `html` is authored at 1920×1080 and
scaled to fit by the `SlideFrame` component. Slides with `anim` set render the
animation in an iframe instead.

Prompt `text` is rendered through an **escaping** template hole, so it must
contain literal Unicode (`°`, `'`), never HTML entities. Slide `html` goes
through `dangerouslySetInnerHTML` and can contain markup.

## Gotchas — each of these cost real debugging time

**1. The staff trigger blocks the SQL editor too.**
`guard_is_staff` fires for every caller including the Supabase SQL editor, where
`auth.uid()` is null, so `is_staff()` is false and a plain `UPDATE ... SET
is_staff = true` is refused. To fix a locked-out account:

```sql
begin;
alter table public.profiles disable trigger trg_guard_is_staff;
update public.profiles set is_staff = true where service_number = '...';
alter table public.profiles enable trigger trg_guard_is_staff;
commit;
```

**2. RLS errors are ambiguous.** "new row violates row-level security policy"
means *either* "you are not staff" *or* "no policy exists for this action". A
table with RLS on and no matching policy refuses everything. Check
`pg_policies` before assuming it is a permissions problem.

**3. The SQL editor bypasses RLS.** It runs as the owner, so everything looks
healthy from in there. To reproduce what the app sees, impersonate the user:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where service_number='...'),
                    'role','authenticated')::text, true);
set local role authenticated;
-- now run the failing query
rollback;
```

**4. Expired tokens masquerade as permission errors.** The original bug: a
lapsed access token made reads fail silently while the screen kept showing stale
data, so only writes broke — looking exactly like a permissions fault on a valid
staff account. Fixed by enabling `autoRefreshToken`, checking the session before
writes, and **never swallowing load errors**. Keep that last one.

**5. `transform: scale()` does not shrink the layout box.** The 1080px slide
still claimed 1080px of flow, pushing the nav and slide rail off-screen. The
scaled slide is now absolutely positioned out of flow. Do not undo this.

**6. Animations must stay self-contained.** They were originally multi-file
(`.jsx` siblings). Browsers refuse to load those from a local folder, so
double-clicking one appeared to "just download" instead of running. Each is now
a single inlined ~1.8 MB `.html`. Do not split them back out — staff use them
offline from a USB stick.

**7. Publishable key, never secret key.** Supabase renamed "anon public" to
"publishable". The publishable key is safe in client code — it names the project
and grants nothing; the RLS policies do the protecting. A **secret** key bypasses
every policy, so putting one in a web page would expose every cadet record.
`hub-data.js` refuses one, and that check should stay.

**8. Per-device config vs site config.** The in-app setup screen writes to
localStorage — that browser only. `hub-config.js` applies to everyone. A device
setting deliberately overrides the file. The setup screen is hidden once the site
is configured; reach it with `?setup=1`.

## Deploying

```
# Netlify build settings: all four fields empty.
# No build command, no publish directory (= repo root), no base directory.
```

`index.html` must be at the top level of whatever is deployed. Redeploying never
touches accounts or cadet work — that lives in Supabase.

Test in a private window before sharing. That catches the Netlify SSO wall, the
empty-repo 404, and a missing Supabase config in one go.

## Outstanding

1. **Push to the repo.** Nothing is in it. Highest priority.
2. **Port `index.html` off the DC format** (see above).
3. **`check_results` has no UI.** Table and policies exist; nothing writes to it.
   The recap slides at the end of each LO are the natural place for a quiz.
4. **Live view needs manual refresh.** Staff press a button. Supabase realtime
   subscriptions would make it genuinely live.
5. **No attendance.** Staff asked about it in passing; never specified.
6. **Only Basic Navigation exists.** The structure generalises to other syllabus
   subjects, but the LO codes are hardcoded as `LO1..LO5` in several places —
   worth making data-driven before adding a second subject.
7. **No tests.** Nothing automated. The RLS policies in particular deserve
   coverage: a cadet must not be able to read another cadet's handout, and must
   not be able to set `is_staff`.

## Conventions worth keeping

- **Cadet data minimalism.** Do not add fields without a clear need. No DOB, no
  addresses, no photos.
- **Security in the database.** RLS and triggers, not UI checks.
- **Plain language in the UI.** Cadets are 12–18 and staff are volunteers. No
  jargon, no raw error codes — errors say what to do next.
- **44px minimum touch targets.** It is used on tablets in a classroom.
- **Offline matters.** The squadron hut WiFi is unreliable. The PowerPoints and
  animations work with no connection at all; keep that true.
