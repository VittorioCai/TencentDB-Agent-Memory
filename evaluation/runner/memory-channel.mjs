/**
 * The memory channel: what the product's memory bridge handed the model.
 *
 * run-once.sh snapshots and restores `profiles/` (L2 scene blocks, L3 persona)
 * around each session. That is not the only memory the consumer has. The
 * memory pipeline also writes atomic items (work_fact / work_task /
 * work_method / work_artifact) within seconds of a session's turns, into a
 * store that is not under `profiles/` (vectors.db, records/, skill_buffer/),
 * and the model can read them back through `memory-bridge/v3/atomic/search`
 * (batch 3's leak went through `memory-bridge/v3/scenario/read`, the L2
 * read). The session transcripts themselves live in `conversations/` and come
 * back through `conversation/search` (messages with a timestamp) and
 * `conversation/query` (messages with a session id). Batch 4, 2026-09-10: two
 * gate-off runs did exactly that and received conclusions written by earlier
 * sessions of the same consumer in the same batch — "endpoint-a … times out
 * and conflicts with the working endpoint-b address" — before they dialled
 * anything; one of them got a whole earlier session back, final report included.
 *
 * This module reads the capture and answers two questions the checkpoints
 * did not ask: which memory items reached the model, and were any of them
 * created before this run started or written by another session. It judges
 * nothing else; the caller decides what a residue item means for the run.
 */

const MEMORY_READ = /memory-bridge\/v3\/([a-z_]+(?:\/[a-z_-]+)*)/;

function requestsOf(rows) {
  return (rows ?? [])
    .filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
}

function envelopeOf(text) {
  const s = String(text ?? "");
  const start = s.indexOf('{"code"');
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(s.slice(start, end + 1));
}

// Every list shape the memory bridge has been seen to return: atomic/search →
// data.items; conversation/search and conversation/query → data.messages;
// scenario/ls → data.entries; scenario/read → data.scene_blocks or one block.
function itemsOf(envelope) {
  const d = envelope?.data;
  if (Array.isArray(d)) return d;
  for (const key of ["items", "results", "messages", "entries", "scene_blocks", "scenes"]) {
    if (Array.isArray(d?.[key])) return d[key].map((it) => (key === "messages" && it && typeof it === "object" && !it.type ? { ...it, type: "message" } : it));
  }
  if (d && typeof d === "object" && (d.id || d.created_at || d.createdAt || d.timestamp)) return [d];
  return [];
}

/**
 * Every memory read the model made, every item it got back, and every read
 * whose result could not be read. Messages accumulate across requests, so a
 * call is counted once by its id.
 *
 * @returns {{reads: Array<{call_id:string, message_index:number, endpoint:string}>,
 *            items: Array<{id:string|null, type:string|null, content:string, created_at:string|null,
 *                          agent_id:string|null, endpoint:string, call_id:string, message_index:number}>,
 *            problems: string[]}}
 */
export function memoryItemsFromCapture(rows) {
  const reads = new Map();   // call_id -> read
  const results = new Map(); // call_id -> { text, message_index }

  for (const event of requestsOf(rows)) {
    event.body.json.messages.forEach((message, index) => {
      for (const tc of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const args = String(tc?.function?.arguments ?? JSON.stringify(tc?.input ?? ""));
        const m = MEMORY_READ.exec(args);
        if (!m) continue;
        const id = String(tc?.id ?? "");
        if (!reads.has(id)) reads.set(id, { call_id: id, message_index: index, endpoint: m[1] });
      }
      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        if (block?.type === "tool_use") {
          const args = JSON.stringify(block.input ?? "");
          const m = MEMORY_READ.exec(args);
          if (!m) continue;
          const id = String(block.id ?? "");
          if (!reads.has(id)) reads.set(id, { call_id: id, message_index: index, endpoint: m[1] });
        } else if (block?.type === "tool_result") {
          const id = String(block.tool_use_id ?? "");
          if (!results.has(id)) results.set(id, { text: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""), message_index: index });
        }
      }
      if (message?.role === "tool") {
        const id = String(message.tool_call_id ?? "");
        if (!results.has(id)) results.set(id, { text: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""), message_index: index });
      }
    });
  }

  const items = [], problems = [];
  for (const read of [...reads.values()].sort((a, b) => a.message_index - b.message_index)) {
    const r = results.get(read.call_id);
    if (!r) { problems.push(`${read.call_id} (msg ${read.message_index}, ${read.endpoint}): no result was captured for this memory read`); continue; }
    let env;
    try { env = envelopeOf(r.text); } catch (e) { problems.push(`${read.call_id} (msg ${read.message_index}, ${read.endpoint}): result not parsable — ${e.message}`); continue; }
    if (!env) { problems.push(`${read.call_id} (msg ${read.message_index}, ${read.endpoint}): result carries no envelope`); continue; }
    for (const it of itemsOf(env)) {
      items.push({
        id: it?.id ?? it?.scene_id ?? null,
        type: it?.type ?? it?.kind ?? null,
        content: String(it?.content ?? it?.text ?? ""),
        created_at: it?.created_at ?? it?.createdAt ?? it?.timestamp ?? it?.updated_at ?? null,
        agent_id: it?.agent_id ?? it?.agentId ?? it?.source_agent_id ?? null,
        session_id: it?.session_id ?? it?.sessionId ?? it?.session_key ?? it?.sessionKey ?? null,
        role: it?.role ?? null,
        endpoint: read.endpoint, call_id: read.call_id, message_index: r.message_index,
      });
    }
  }
  return { reads: [...reads.values()].sort((a, b) => a.message_index - b.message_index), items, problems };
}

const ms = (t) => { const v = Date.parse(String(t ?? "")); return Number.isFinite(v) ? v : null; };

/**
 * Split the items a run received into residue and own.
 *
 * An item that names its session is judged by it: another session ⇒ residue,
 * this session ⇒ own, whatever the timestamps say (a concurrent pipeline write
 * can carry a later timestamp). Otherwise by creation time: created before the
 * run started ⇒ residue — written by an earlier session of this consumer,
 * inside this batch when `batch_started_at` is given and the item is not older
 * than it, before the batch otherwise. An item with neither is `undated`,
 * never assumed own.
 */
export function memoryResidue(items, startedAt, { batch_started_at = null, own_session = null } = {}) {
  const start = ms(startedAt);
  if (start === null) return { residue: null, own: null, from_this_batch: null, from_before_batch: null, undated: null, why: "run start time not recorded" };
  const batchStart = ms(batch_started_at);
  const residue = [], own = [], undated = [];
  for (const it of items ?? []) {
    const sid = it?.session_id ?? null;
    const c = ms(it?.created_at);
    if (sid && own_session) { (sid === own_session ? own : residue).push(it); continue; }
    if (c === null) undated.push(it);
    else if (c < start) residue.push(it);
    else own.push(it);
  }
  const at = (it) => ms(it.created_at);
  const from_this_batch = batchStart === null ? null : residue.filter((it) => at(it) !== null && at(it) >= batchStart);
  const from_before_batch = batchStart === null ? null : residue.filter((it) => at(it) !== null && at(it) < batchStart);
  return { residue, own, from_this_batch, from_before_batch, undated, why: null };
}

/**
 * One run's memory-channel record: what the model read back through the
 * memory bridge, and whether any of it was borrowed — created before this
 * run started, written by another session, or owned by another agent than
 * this run's consumer (a fresh consumer per run must read nothing but its
 * own). `ok` is null when the record cannot decide (undated items, unreadable
 * results), never a default.
 */
export function memoryChannelRecord(rows, { started_at, own_session = null, consumer = null, batch_started_at = null } = {}) {
  let read = { reads: [], items: [], problems: [] };
  try { read = memoryItemsFromCapture(rows); } catch (e) { read.problems.push(e.message); }
  const res = memoryResidue(read.items, started_at ?? null, { batch_started_at, own_session });
  const borrowed = consumer ? read.items.filter((it) => it.agent_id && it.agent_id !== consumer) : null;
  const nRes = res.residue?.length ?? null;
  const ok = read.problems.length ? null
    : nRes === null ? null
    : nRes > 0 || (borrowed?.length ?? 0) > 0 ? false
    : (res.undated?.length ?? 0) > 0 ? null : true;
  const brief = (it) => ({ id: it.id, type: it.type, created_at: it.created_at, agent_id: it.agent_id, session_id: it.session_id, endpoint: it.endpoint, call_id: it.call_id, content_head: String(it.content ?? "").slice(0, 120) });
  return {
    consumer, started_at: started_at ?? null, own_session,
    reads: read.reads.length, endpoints: [...new Set(read.reads.map((r) => r.endpoint))],
    items: read.items.length,
    residue: nRes, from_this_batch: res.from_this_batch?.length ?? null, from_before_batch: res.from_before_batch?.length ?? null,
    undated: res.undated?.length ?? null,
    borrowed_from_other_agents: borrowed ? borrowed.length : null,
    problems: read.problems,
    ok, why: res.why,
    residue_items: (res.residue ?? []).slice(0, 20).map(brief),
    borrowed_items: (borrowed ?? []).slice(0, 20).map(brief),
    undated_items: (res.undated ?? []).slice(0, 20).map(brief),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const args = process.argv.slice(2);
  const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
  if (!opt("capture") || !opt("started")) { console.error("usage: node memory-channel.mjs --capture=F --started=<iso> [--session=<conversation id>] [--consumer=<agent id>] [--batch-started=<iso>] [--out=F]"); process.exit(2); }
  const rows = readFileSync(opt("capture"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rec = memoryChannelRecord(rows, { started_at: opt("started"), own_session: opt("session"), consumer: opt("consumer"), batch_started_at: opt("batch-started") });
  if (opt("out")) writeFileSync(opt("out"), JSON.stringify(rec, null, 2) + "\n");
  console.log(`memory channel: ${rec.reads} read(s) over ${rec.endpoints.join(", ") || "no endpoint"}, ${rec.items} item(s) back; residue ${rec.residue ?? "?"}, borrowed from other agents ${rec.borrowed_from_other_agents ?? "?"}, undated ${rec.undated ?? "?"}; ok=${rec.ok}${rec.problems.length ? `; problems: ${rec.problems.slice(0, 2).join("; ")}` : ""}`);
  process.exit(rec.ok === false ? 1 : 0);
}
