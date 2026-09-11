/**
 * The HTTP requests inside a shell command the model wrote.
 *
 * A tool call is one string; the requests in it are however many `curl`
 * invocations the shell would run, each with its own URL, headers and body,
 * and each sitting in a structure that says something about whether and when
 * it ran: `;` and a newline are an order, `&&` / `||` / `if` are a condition,
 * `for` / `while` are an unknown count, `&` is no order at all. Reading "the
 * first URL in the text" as "the request" gave batch 4 an attempt that never
 * existed (2026-09-11); this module reads the shell instead.
 *
 * Scope: POSIX-ish shell as the models write it — quotes, backslashes,
 * continuations, `$(…)` and backticks (kept as one unexpanded word), `#`
 * comments, heredoc bodies (skipped), redirections, the control keywords. Not
 * a shell: nothing is expanded or executed; a word that contains `$…` is
 * reported as not literal and its value is not guessed.
 */

const OPS = new Set([";", ";;", "\n", "&&", "||", "|", "|&", "&", "(", ")"]);

/** Strip heredoc bodies: `cmd <<'EOF' … EOF` keeps the `<<EOF` word, drops the lines. */
function stripHeredocs(s) {
  const lines = String(s).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(lines[i]);
    if (!m) continue;
    const delim = m[2];
    let j = i + 1;
    while (j < lines.length && lines[j].replace(/^\t+/, "") !== delim) j++;
    i = j; // skip body and the delimiter line
  }
  return out.join("\n");
}

/**
 * Tokenize into words and operators.
 * @returns {Array<{type:"word", value:string, raw:string, literal:boolean} | {type:"op", value:string}>}
 */
export function tokenizeShell(cmd) {
  const s = stripHeredocs(cmd ?? "");
  const out = [];
  let i = 0;
  let cur = null;
  const start = () => { if (!cur) cur = { value: "", raw: "", literal: true }; };
  const push = () => { if (cur) out.push({ type: "word", ...cur }); cur = null; };
  const op = (v) => { push(); out.push({ type: "op", value: v }); };

  while (i < s.length) {
    const ch = s[i], nx = s[i + 1];
    if (ch === "\\" && nx === "\n") { i += 2; continue; }                       // continuation
    if (ch === "'") {                                                            // single quotes: literal
      start(); let j = s.indexOf("'", i + 1); if (j < 0) j = s.length;
      cur.value += s.slice(i + 1, j); cur.raw += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '"') {                                                            // double quotes: expansions inside
      start(); i++; let v = "", raw = '"';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) {
          if (s[i + 1] !== "\n") v += s[i + 1];
          raw += s.slice(i, i + 2); i += 2; continue;
        }
        if (s[i] === "$" || s[i] === "`") cur.literal = false;
        v += s[i]; raw += s[i]; i++;
      }
      cur.value += v; cur.raw += raw + '"'; i++; continue;
    }
    if (ch === "\\") { start(); if (i + 1 < s.length) { cur.value += s[i + 1]; cur.raw += s.slice(i, i + 2); i += 2; } else i++; continue; }
    if (ch === "#" && !cur) { const j = s.indexOf("\n", i); i = j < 0 ? s.length : j; continue; }   // comment
    if (ch === "\n") { op("\n"); i++; continue; }
    if (/\s/.test(ch)) { push(); i++; continue; }
    if (ch === ";") { if (nx === ";") { op(";;"); i += 2; } else { op(";"); i++; } continue; }
    if (ch === "&") {
      // redirections `>&`, `&>`, `2>&1` are word text, not the background operator
      if (cur && /[<>]$/.test(cur.value)) { cur.value += ch; cur.raw += ch; i++; continue; }
      if (nx === ">") { start(); cur.value += "&>"; cur.raw += "&>"; i += 2; continue; }
      if (nx === "&") { op("&&"); i += 2; } else { op("&"); i++; }
      continue;
    }
    if (ch === "|") { if (nx === "|") { op("||"); i += 2; } else if (nx === "&") { op("|&"); i += 2; } else { op("|"); i++; } continue; }
    if (ch === "(" || ch === ")") { if (cur && cur.value.endsWith("$")) { cur.value += ch; cur.raw += ch; i++; continue; } op(ch); i++; continue; }
    if (ch === "$" && nx === "(") {                                              // $(…) kept whole, not literal
      start(); cur.literal = false; let depth = 0, j = i + 1;
      for (; j < s.length; j++) { if (s[j] === "(") depth++; else if (s[j] === ")") { depth--; if (depth === 0) break; } }
      cur.value += s.slice(i, j + 1); cur.raw += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "`") { start(); cur.literal = false; let j = s.indexOf("`", i + 1); if (j < 0) j = s.length; cur.value += s.slice(i, j + 1); cur.raw += s.slice(i, j + 1); i = j + 1; continue; }
    start();
    if (ch === "$") cur.literal = false;
    cur.value += ch; cur.raw += ch; i++;
  }
  push();
  return out;
}

// curl options that take a value (short and long), so they never swallow the URL
const ARG_OPTS = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii", "--json",
  "-o", "--output", "-w", "--write-out", "-m", "--max-time", "--connect-timeout", "--retry", "--retry-delay", "--retry-max-time",
  "-u", "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "-c", "--cookie-jar", "-T", "--upload-file",
  "-x", "--proxy", "-K", "--config", "--url", "-F", "--form", "--form-string", "--resolve", "--cacert", "--cert", "--key", "-E",
  "--interface", "--max-redirs", "--limit-rate", "--max-filesize", "-r", "--range", "-C", "--continue-at", "-D", "--dump-header",
  "-Q", "--quote", "-t", "--telnet-option", "-y", "--speed-time", "-Y", "--speed-limit", "-z", "--time-cond", "--unix-socket",
  "--proto", "--proto-default", "--proto-redir", "--tls-max", "--oauth2-bearer", "--proxy-user", "-U", "--socks5", "--socks4",
  "--noproxy", "--local-port", "--keepalive-time", "--output-dir", "--proxy-header", "--stderr", "--trace", "--trace-ascii",
  "--doh-url", "--etag-save", "--etag-compare", "--aws-sigv4", "--request-target", "--pinnedpubkey", "--ciphers", "--curves",
]);
const SHORT_ARG = new Set([...ARG_OPTS].filter((o) => /^-[A-Za-z]$/.test(o)).map((o) => o[1]));
const DATA_OPTS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii", "--json"]);
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "select", "function", "{", "}", "!", "time"]);
const LOOP_OPEN = new Set(["for", "while", "until", "select"]);
const COND_OPEN = new Set(["if", "case"]);

function parseUrl(u) {
  const m = /^(https?):\/\/([^/:?#\s]+)(?::(\d+))?(\/[^?#\s]*)?/.exec(String(u ?? ""));
  if (!m) return { host: "", port: "", path: "" };
  return { host: m[2], port: m[3] ?? (m[1] === "https" ? "443" : "80"), path: m[4] ?? "/" };
}

/** Parse one curl word list into its request. */
function parseCurl(words) {
  const inv = { url: "", url_literal: true, host: "", port: "", path: "", method: null, headers: {}, body: null, body_literal: true, out_file: null, write_out: null, max_time: null, connect_timeout: null, flags: [] };
  const bodies = [];
  let urlWord = null;
  const take = (opt, value, literal) => {
    if (opt === "-X" || opt === "--request") inv.method = value.toUpperCase();
    else if (opt === "-H" || opt === "--header") { const k = value.indexOf(":"); if (k > 0) inv.headers[value.slice(0, k).trim().toLowerCase()] = value.slice(k + 1).trim(); }
    else if (DATA_OPTS.has(opt)) { bodies.push(value); if (!literal) inv.body_literal = false; if (opt === "--json") inv.headers["content-type"] ??= "application/json"; }
    else if (opt === "-o" || opt === "--output") inv.out_file = value;
    else if (opt === "-w" || opt === "--write-out") inv.write_out = value;
    else if (opt === "-m" || opt === "--max-time") inv.max_time = Number(value);
    else if (opt === "--connect-timeout") inv.connect_timeout = Number(value);
    else if (opt === "--url") { urlWord = { value, literal }; }
  };
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const v = w.value;
    if (v.startsWith("--")) {
      const eq = v.indexOf("=");
      const name = eq > 0 ? v.slice(0, eq) : v;
      if (ARG_OPTS.has(name)) {
        if (eq > 0) take(name, v.slice(eq + 1), w.literal);
        else if (i + 1 < words.length) { take(name, words[i + 1].value, words[i + 1].literal); i++; }
      } else inv.flags.push(name);
      continue;
    }
    if (v.startsWith("-") && v.length > 1) {
      // short options, possibly combined (-sSk) or with an attached value (-o/tmp/x, -m20)
      let consumed = false;
      for (let k = 1; k < v.length; k++) {
        const c = v[k];
        if (SHORT_ARG.has(c)) {
          const rest = v.slice(k + 1);
          if (rest) take(`-${c}`, rest, w.literal);
          else if (i + 1 < words.length) { take(`-${c}`, words[i + 1].value, words[i + 1].literal); i++; }
          consumed = true; break;
        }
        if (c === "G") inv.method ??= "GET";
        inv.flags.push(`-${c}`);
      }
      if (consumed) continue;
      continue;
    }
    if (!urlWord) urlWord = { value: v, literal: w.literal };
  }
  if (urlWord) { inv.url = urlWord.value; inv.url_literal = urlWord.literal; Object.assign(inv, parseUrl(urlWord.value)); }
  if (bodies.length) inv.body = bodies.join("&");
  if (!inv.method) inv.method = bodies.length ? "POST" : "GET";
  return inv;
}

/**
 * Every curl invocation in the command, in shell order, with the structure
 * around it.
 *
 * @returns {Array<{url, url_literal, host, port, path, method, headers, body, body_literal, out_file, write_out, max_time,
 *   index, after_op, next_op, in_loop, conditional, background, piped, sequential, group}>}
 */
export function curlInvocations(cmd) {
  const tokens = tokenizeShell(cmd);
  const out = [];
  let loopDepth = 0, condDepth = 0, groupId = 0;
  const groups = [];          // stack of group ids for ( … )
  const groupInvs = new Map(); // group id -> invocations inside
  let prevOp = "";
  let cmdWords = [];
  let atStart = true;

  const flush = (nextOp) => {
    // drop leading reserved words / assignments / wrappers, adjusting depth
    let ws = cmdWords;
    while (ws.length) {
      const w = ws[0].value;
      if (LOOP_OPEN.has(w)) { loopDepth++; ws = []; break; }          // loop header: not a command
      if (w === "done") { loopDepth = Math.max(0, loopDepth - 1); ws = ws.slice(1); continue; }
      if (COND_OPEN.has(w)) { condDepth++; ws = ws.slice(1); continue; } // `if curl …` — the curl is the condition
      if (w === "fi" || w === "esac") { condDepth = Math.max(0, condDepth - 1); ws = ws.slice(1); continue; }
      if (RESERVED.has(w)) { ws = ws.slice(1); continue; }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { ws = ws.slice(1); continue; }  // VAR=… prefix
      if (w === "command" || w === "exec" || w === "nice" || w === "nohup" || w === "env" || w === "sudo") { ws = ws.slice(1); continue; }
      if (w === "timeout" && ws.length > 2) { ws = ws.slice(2); continue; }
      break;
    }
    if (ws.length && (ws[0].value === "curl" || /(^|\/)curl$/.test(ws[0].value))) {
      const inv = parseCurl(ws);
      inv.index = out.length;
      inv.after_op = prevOp;
      inv.next_op = nextOp;
      inv.in_loop = loopDepth > 0;
      inv.conditional = condDepth > 0 || prevOp === "&&" || prevOp === "||";
      inv.background = nextOp === "&";
      inv.piped = nextOp === "|" || nextOp === "|&";
      inv.group = groups.length ? groups[groups.length - 1] : null;
      inv.sequential = !inv.background && !inv.in_loop;
      out.push(inv);
      if (inv.group !== null) (groupInvs.get(inv.group) ?? groupInvs.set(inv.group, []).get(inv.group)).push(inv);
    }
    cmdWords = [];
    atStart = true;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "word") { cmdWords.push(t); atStart = false; continue; }
    const v = t.value;
    if (v === "(") { flush(""); groups.push(++groupId); prevOp = ""; continue; }
    if (v === ")") {
      flush("");
      const g = groups.pop();
      const nextOp = tokens[i + 1]?.type === "op" ? tokens[i + 1].value : "";
      if (nextOp === "&") for (const inv of groupInvs.get(g) ?? []) { inv.background = true; inv.sequential = false; }
      prevOp = "";
      continue;
    }
    flush(v);
    prevOp = v;
  }
  flush("");
  return out;
}
