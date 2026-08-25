# HOF Case Manager Compliance

Audits the cases the 12 case managers worked, and posts a note on the case tagging
whoever needs to act. Runs on GitHub Actions.

---

## Scope

**Case managers (as deal owners):** Brenda Murowanidzwa · Yamina Sadi · Ali Tariq ·
Anwar Saeed · Tamjeed Zahid · Thushara M S · Rahima Nabili · Warda Badar ·
Umer Masaud · Hashim Tahir · Muhammad Zaryab · Maryam Chand.
Only email addresses are configured; owner IDs are resolved from HubSpot at run time.

**A case is audited when all of these are true:**
- it is owned by one of the 12
- it was **touched in the last 24 hours** (typed in the workflow)
- **a call was logged inside that window** — the call is the reason for the audit
- Client Status = **Active** (changeable in the workflow)
- Application Status = **In Progress** or **In Process** (both, because the portal
  genuinely has both values)

---

## The checks

Every case is read by the AI before anything is posted.

| Check | Rule |
|---|---|
| **Next task** | A call was logged but there is no **open** task for the next follow up. Completed tasks and our own `[Compliance]` tasks don't count. |
| **Follow-up email** | A call was logged and no email followed — **but only when the call actually needed one**. The call notes are read first: documents or information requested, a process or fee explained, something promised or agreed → email needed. No answer, wrong number, or a courtesy call → no email needed. |
| **Client waiting** | A client email that **needed a reply** and hasn't had one after 24h. Thank-yous, acknowledgements, auto-replies and plain document drops are never chased — the email is read to decide whether an answer was required. |
| **Our email tone** | Only genuinely rude, sarcastic, dismissive or aggressive wording. Blunt, firm or bad-news emails are not flagged. |
| **Tagged and no reply** | Someone was @mentioned on a note and never answered. See below. |

Only the **3 most important** issues go in a note: tagged-no-reply → client waiting →
tone → follow-up email → next task.

---

## Tagged and no reply — how it stays fair

This covers both directions: the case manager was tagged and hasn't answered, **and**
the case manager tagged someone else who hasn't answered. The note **tags the person
who owes the reply**, not the case owner.

**The blind spot, stated plainly:** HubSpot does **not** expose note **comments**
through its API — no script can read them, and there isn't even a comment count. So a
reply left as a comment is invisible here. Four guards keep this fair:

1. a note is only chased once it is **48 hours old** — nearly all comment replies
   happen within hours, so the wait removes most of the risk
2. only notes **written by, or tagging, one of the 12** are considered
3. **any later note by that person on the case counts as an answer**, because replies
   are often written as a fresh note rather than a comment
4. the AI must first agree the note is **actually asking that person for something** —
   CV write-ups, document drops, FYIs and summaries are never chased

The posted note also ends with *"If you have already replied in a comment, kindly
ignore this."*

---

## Running it

**Actions → Case Manager Compliance → Run workflow.**

| Input | Choices |
|---|---|
| Dry run | `true` = safe test, posts nothing · `false` = LIVE |
| Hours back | **Type any number** of hours. Default 24. |
| Client status | Active (default) · all · Inactive · On Hold · Refunded · Closed |
| Application status | In Progress + In Process (default) · all · or one value |
| How many cases | all / 25 / 50 / 100 / 250 |
| Case manager | all, or one of the 12 |

Scheduled daily at **10:40 AM PKT**.

## Secrets

`HUBSPOT_TOKEN` · `GEMINI_KEY`. No emails are sent by this agent, so no Resend key.

## Changing the rules

Every rule is a scenario in `selftest.js`. Run `node selftest.js` after any edit —
it reports `34 passed, 0 failed` and names anything that broke. The workflow runs it
before auditing, so a broken rule stops the run instead of posting wrong notes.

## Tuning (`config.js`)

`TOUCHED_WITHIN_HOURS` · `REQUIRE_CALL_IN_WINDOW` · `MENTION_MIN_AGE_HOURS` (48) ·
`MENTION_ONLY_OUR_TEAM` · `REPLY_DUE_HOURS` (24) · `MAX_ISSUES_PER_DEAL` ·
`MAX_AI_CALLS` · `CHECK_CALL_TASK` · `CHECK_CALL_EMAIL` · `CHECK_CLIENT_REPLY` ·
`CHECK_TONE` · `CHECK_MENTIONS`
