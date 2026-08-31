# CLAUDE.md — 2434 Squadron Training Hub

Read `README.md` first. It has the architecture, the schema, and eight hard-won
gotchas that will each cost you an hour if you rediscover them.

## What this is

A live training portal for an Air Training Corps squadron. Real accounts, real
cadet data, deployed. Not a prototype — treat changes accordingly.

## Rules

**Security lives in the database, not the UI.** Row-level security policies and
triggers in `hub-schema.sql` are the enforcement. Never move an access rule into
a component. A cadet must not be able to read another cadet's handout or set
their own `is_staff`, no matter what they send.

**`hub-data.js` is the only file that talks to the database.** Keep it that way.
It is what makes the backend swappable and the demo mode possible.

**Cadet data minimalism.** Service number and display name. No email on
`profiles`, no date of birth, no addresses. Cadets are often under 18. Do not add
fields without a clear, stated need — and if you think you need one, ask.

**Never swallow errors.** The worst bug in this project's history was a `catch (e)
{}` that hid failing reads, leaving the screen showing hour-old data while writes
were refused. Surface failures.

**Publishable key only in client code.** A secret key bypasses every RLS policy.
`hub-data.js` refuses one; keep that check.

## Conventions

- Plain language in the UI. Users are 12–18 year olds and volunteer staff. Errors
  say what to do next, never a raw code.
- 44px minimum touch targets — used on tablets in a classroom.
- Offline must keep working: the PowerPoints and the 18 animations need no
  connection. Each animation is one self-contained file; do not split them.
- Slide HTML is authored at 1920×1080 and scaled. Prompt text is escaped, so it
  needs literal Unicode (`°`), not HTML entities.

## First tasks, in order

1. Push to `domjsut-cyber/2434traininghub` — the repo is empty, which is why the
   connected Netlify site 404s.
2. Port `index.html` off the Design Component format to React + Vite. The mapping
   table is in `README.md`. Everything else carries over untouched.
3. Add tests for the RLS policies before changing them.

## Don't

- Don't undo the absolute positioning on the scaled slide (`transform: scale()`
  does not shrink the layout box — nav ends up off-screen).
- Don't re-split the animations into `.jsx` siblings (browsers block local file
  loads; they stop working from a USB stick).
- Don't add a debugging UI to a cadet-facing screen. Query the database instead.
