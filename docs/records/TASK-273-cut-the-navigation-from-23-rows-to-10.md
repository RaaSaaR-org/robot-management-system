# TASK-273 — Cut the navigation from 23 rows to 10

Grilled 2026-09-12 · owner huhn511 · task
[`.mc/tasks/todo/TASK-273-cut-the-navigation-from-23-rows-to-10.md`](../../.mc/tasks/todo/TASK-273-cut-the-navigation-from-23-rows-to-10.md)

Immutable once committed. Every decision carries the alternative it rejected.

## The question that opened it

The sidebar carried 23 entries and felt overloaded. Three things were open: how
many top-level entries there should be, whether Operate and Build should become
two applications, and whether the target groups behind them are one audience or
two.

## D1 — Two roles, one workspace

**Decided:** an operator and an ML engineer, same tenant, same login, different
default landing. The owner added that the two roles may converge into one person
later, which rules out any design where the split is a wall rather than a default.

**Rejected:** *two markets, two products* — `UserRole` is tenancy-shaped
(`super-admin | owner | member | viewer`), there is no persona axis in auth, no
separate billing, and the landing page's own thesis in
`app/src/components/landing/FullCircleSection.tsx` is "Connect the whole journey
in one workspace". Splitting would have sold the closed loop as two disconnected
halves. Also rejected: *one audience, one person* (premature) and *optimise for
the demo* (an argument for fewer, better-named groups, not for a 23-item map).

## D2 — No mode switch; one nav, genuinely fewer entries

**Decided:** one nav. Every user sees the whole loop, in fewer rows.

**Rejected:** an `Operate | Build` mode switch in the top bar. It is a wall down
the middle of the one claimed differentiator; D1 says the roles may converge, and
a mode is the most expensive thing to un-ship once deep links, notification URLs
and stores carry it; and the overload was real length, not the presence of the
other half. Also rejected: *collapsible groups over all 23 rows* — worth doing,
but as a consequence of the cut, not a substitute, since 23 entries in an
accordion is still not a map. Also rejected: *pinned favourites as the primary
structure* — undiscoverable for a new operator.

## D3 — Depth: hub and stages, ~10 rows

**Decided:** merge and demote until the top level is ~10, with `Deployments` kept
top-level because it is the seam where Build hands off to Operate and the one page
both roles open.

**Rejected:** *the lifecycle as six rows* (Collect · Train · Deploy · Evaluate ·
Operate · Comply) — it optimises for explaining the product, not using it: the
cockpit lands two clicks inside an entry called "Operate", which then needs its
own nav. Also rejected: *the haircut* (~17 rows, merging only the obvious twins) —
still not a map, and it spends the redesign budget on the cheap merges.

## D4 — Automate is one group with two rows, not one page with tabs

**Decided:** a group holding `Agent Mode` and `Missions` (Patrol · Guide ·
Automations as tabs). One extra row, bought deliberately.

**Rejected:** one page with `Live · Patrol · Guide · Automations` tabs. The live
console is left open for a shift; every glance at a route table would unmount the
telemetry connection and the `EstopBanner` with it. Also rejected: *robot-scoped
autonomy* — patrol routes are authored fleet-wide and reused across robots.

**Override recorded:** the assistant had proposed pairing the agent console with
the manual cockpit (`Control: Manual ⇄ Agent`) and keeping Missions separate. The
owner's grouping — the agent console belongs with Patrol and Guide — was taken
instead, and the code agrees: `AgentModePage` already renders a `TourStopChip`.

## D5 — In Build, the hub owns the stages

**Decided:** one `Skill Training` row with a rail over `Collect · Datasets ·
Train · Models · Learning`; `Deployments` and `Marketplace` keep rows. Build is
three rows.

**Rejected:** *stages own themselves, hub retires* — it moves the only screen
that shows the loop as a loop onto the Dashboard, which is the operator's morning
screen, and orphans the `FirstRunWizard`. Also rejected: *flat Build with the
obvious pairs merged* (14 rows total).

**Correction recorded:** the assistant first argued Models must keep a row so an
operator could answer "what is deployed?", and the owner was unsure for that
reason. The code settled it — `DeploymentsPage` already loads model versions,
`DeploymentDetailPage` renders `v{n}`, and `/models → Deploy` hands off to
`/deployments?new=<id>` — so that question is answered on the `Deployments` row
and the registry behind the rail costs the ML engineer, who is inside the pipeline
anyway. The assistant's earlier framing overstated the cost.

## D6 — A ⌘K palette over destinations, in scope

**Decided:** a client-side fuzzy find over every row, rail item and tab, built on
the nav model, sequenced after the cut. Ten pages lose a direct row and there is
no ⌘K or search anywhere in `app/src` today; deep links survive, muscle memory
does not.

**Rejected:** *destinations plus entities* (robots, datasets, models by name) — a
cross-entity search over 83 Prisma models is its own epic and cannot be scoped
before it is known which entities people hunt for. Also rejected: *pinning* —
invisible to new users and it regrows the sidebar one user at a time. Also
rejected: *nothing*, which would ship a known regression with a day's mitigation
left undone.

**Consequence:** the palette only works if rails and tabs live in
`navigation.ts` rather than in each page, so that is a design constraint on the
epic. It is also what makes the already-orphaned `/a2a` chat findable again.

## D7 — Sites becomes Fleet's third tab

**Decided:** `Fleet: Map · Robots · Sites`, with `/sites/:siteId` left as a full
route so the twin viewer is untouched. Tenth row saved.

**Rejected:** *unify `Zone` and `TwinZone` now* — the right end state, but a
schema migration in a nav costume that would risk the enforced geofence shipped
by TASK-200. Filed separately as TASK-274. Also rejected: *Sites under Automate* —
the Fleet map and the geofence both read places, so Automate would own something
three other areas depend on. Also rejected: *Sites keeps its row*, which buries
the duplication this exercise found.

## D8 — Verb groups, two unlabelled bookend rows

**Decided:** `Operate · Automate · Build` as group labels; `Dashboard` and
`Compliance` as plain rows with no label, since a label over a single row is the
pattern removed with the old `Overview` group.

**Override recorded:** the assistant proposed `Autonomy`; the owner's `Automate`
was taken instead, because it makes the whole set verbs and a verb tells a new
user what they do there.

**Rejected — `Train` instead of `Build`:** the group holds `Deployments` and
`Marketplace`, neither of which is training, and `CLAUDE.md` treats Train and
Deploy as different lifecycle stages, so the label would contradict the project's
own vocabulary.

**Rejected — `Reports` instead of `Comply`:** `CompliancePage` has seven tabs and
two of them, Oversight and Approvals, are queues with items waiting on a human
decision. "Reports" is the word people learn never to check, which is the opposite
of what an EU AI Act surface needs; `Comply` is also the project's own lifecycle
word and a landing-page differentiator. Dropping the label entirely avoids the
choice without weakening the word on the page.

## Directives taken as decided, not grilled

- `Updates` moves into `Settings` as a fourth tab.
- `Docs` becomes a help icon in the top bar; `/docs` and its `DocsSidebar` stay.
- No view may be lost. The owner named the LiDAR panel specifically; the audit in
  the task body lists every view of every demoted page, and
  `CockpitPerceptionPanel` keeps its G1-family/H1 gate.

## Planning addendum — 2026-09-12, `/plan`

The decisions above stand unchanged. Planning read the pages the epic describes
and had to settle two **mechanism** questions the spec left implicit. They are
recorded here rather than edited into D1–D8.

### D9: Missions is a rail, not a page with tabs

The target navigation called Missions a page with tabs `Patrol · Guide ·
Automations`. Reading the pages made that the wrong mechanism: `PatrolPage` owns
tabs `Routes · Runs` and `TourPage` owns `Tours · Visits`, so three Missions tabs
would stack two tab rows above each other — precisely what D3 rejected when it
chose "a rail one level above the page's own tab bar". Missions therefore uses
the same rail as Skill Training.

**Rejected — one Missions page with three tabs:** it forces the three pages to be
extracted from their routes, re-homed under one component, and to give up either
their own tab bars or a second tab row. It also puts three live subscriptions
(`usePatrolEvents`, `useTourEvents`, `useProcessWebSocket`) behind a tab click.

**Rejected — flattening to five tabs (`Routes · Runs · Tours · Visits ·
Automations`):** it loses the grouping that made the owner put the three
together in the first place.

The user-visible result is the one the directive asked for: one row for the three,
the three reachable one click below it.

### D10: `PipelineBreadcrumb` retires from the pages the Build rail covers

The rail's first stop is `Overview` (`/pipeline`) and it lists every sibling
stage, so the "3/5 · Train stage · Pipeline overview" chip says a weaker version
of the same thing directly underneath it. It is removed from the six rail-covered
pages and **kept on `Deployments`**, which is a row of its own with no rail above
it and therefore still needs a tie back to the pipeline.

**Rejected — keeping the chip everywhere:** two near-identical horizontal strips
stacked on the same page is the visual noise this epic exists to remove.

## Hand-off

`/plan` split TASK-273 into TASK-275 … TASK-280. TASK-275 is the only unblocked
child; the other five depend on it. `/implement` takes them in that order.
