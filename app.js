// =====================
// Minimal Chord Viewer
// - No key-apply UI
// - Ignore meta lines: title/artist/key/capo/bpm
// =====================

const SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

const LS = {
  SRC: "cv_src_v2",
  SPEED: "cv_speed_v2",
  FONT: "cv_font_v2",
  SEMI: "cv_semi_v2",
  ACC: "cv_acc_v2",
  SCROLL: "cv_scroll_v2"
};

const el = (id) => document.getElementById(id);
const src = el("src");
const sheet = el("sheet");

const speed = el("speed");
const speedVal = el("speedVal");
const fontSize = el("fontSize");
const fontVal = el("fontVal");

const btnPlay = el("btnPlay");
const playState = el("playState");
const btnUp = el("btnUp");
const btnDown = el("btnDown");
const btnReset = el("btnReset");
const semiVal = el("semiVal");

const accidental = el("accidental");
const btnTop = el("btnTop");
const btnSample = el("btnSample");
const btnClear = el("btnClear");

const statusSemi = el("statusSemi");
const statusSpeed = el("statusSpeed");
const statusMsg = el("statusMsg");

// ----- State -----
let isPlaying = false;
let speedPxPerSec = 60;
let fontPx = 18;
let semitoneShift = 0;
let lastTs = null;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function noteToIndex(note) {
  let i = SHARP.indexOf(note);
  if (i >= 0) return i;
  i = FLAT.indexOf(note);
  if (i >= 0) return i;
  return -1;
}

function indexToNote(i, preferFlat) {
  i = (i % 12 + 12) % 12;
  return preferFlat ? FLAT[i] : SHARP[i];
}

function parseRoot(s) {
  const m = s.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1] + (m[2] || ""), rest: m[3] || "" };
}

// auto(#/b): 看你貼的譜本身偏好（和弦 token 內 b 的數量 vs #）
function autoPreferFlatFromSource(raw) {
  const tokens = raw.match(/\[([^\]]+)\]/g) || [];
  let flats = 0, sharps = 0;
  for (const t of tokens) {
    flats += (t.match(/b/g) || []).length;
    sharps += (t.match(/#/g) || []).length;
  }
  return flats >= sharps;
}

function choosePreferFlat(mode, raw) {
  if (mode === "flat") return true;
  if (mode === "sharp") return false;
  return autoPreferFlatFromSource(raw);
}

function transposeChordToken(chord, semitone, preferFlat) {
  const parts = chord.split("/");
  const main = parts[0];
  const bass = parts[1];

  const pm = parseRoot(main);
  if (!pm) return chord;

  const idx = noteToIndex(pm.root);
  if (idx < 0) return chord;

  let out = indexToNote(idx + semitone, preferFlat) + pm.rest;

  if (bass) {
    const pb = parseRoot(bass);
    if (pb) {
      const bIdx = noteToIndex(pb.root);
      if (bIdx >= 0) out += "/" + indexToNote(bIdx + semitone, preferFlat) + pb.rest;
      else out += "/" + bass;
    } else out += "/" + bass;
  }
  return out;
}

function transposeLine(line, semitone, preferFlat) {
  return line.replace(/\[([^\]]+)\]/g, (_, chord) => {
    const t = transposeChordToken(chord.trim(), semitone, preferFlat);
    return "[" + t + "]";
  });
}

function escapeHtml(s) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineChords(text) {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    if (open === -1) { result += escapeHtml(text.slice(i)); break; }
    const close = text.indexOf("]", open + 1);
    if (close === -1) { result += escapeHtml(text.slice(i)); break; }

    result += escapeHtml(text.slice(i, open));
    const chord = text.slice(open + 1, close).trim();
    result += `<span class="chord">${escapeHtml(chord)}</span>`;
    i = close + 1;
  }
  return result;
}

// 忽略你說用不到的 meta 行（不顯示）
function isMetaLine(line) {
  // e.g. "key: Db" / "capo: 0" / "bpm: 148" / "title:" / "artist:"
  if (/^\s*(title|artist|key|capo|bpm)\s*:/i.test(line)) return true;
  // e.g. "{title: ...}" "{artist: ...}" etc
  if (/^\s*\{(title|artist|key|capo|bpm)\s*:/i.test(line)) return true;
  return false;
}

function parseTextToHtml(raw, semitone, preferFlat) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out = [];

  for (let line of lines) {
    if (isMetaLine(line)) continue;

    const tLine = transposeLine(line, semitone, preferFlat);

    const sec = tLine.match(/^\s*\{section:\s*(.+?)\s*\}\s*$/i);
    if (sec) {
      out.push(`<div class="line section">${escapeHtml(sec[1])}</div>`);
      continue;
    }

    let time = "";
    let rest = tLine;
    const tm = tLine.match(/^\s*\{t:\s*([0-9]{1,2}:[0-9]{2})\s*\}\s*(.*)$/i);
    if (tm) {
      time = tm[1];
      rest = tm[2];
    }

    const html = renderInlineChords(rest);

    if (time) out.push(`<div class="line"><span class="time">${escapeHtml(time)}</span>${html}</div>`);
    else out.push(`<div class="line">${html || "&nbsp;"}</div>`);
  }

  return out.join("");
}

// ----- Auto Scroll -----
function updatePlayUi() {
  btnPlay.textContent = isPlaying ? "⏸" : "▶︎";
  playState.textContent = isPlaying ? "Playing" : "Paused";
  statusMsg.textContent = isPlaying ? "自動下拉中（點譜面/Space 暫停）" : "已暫停（點譜面/Space 播放）";
}

function tick(ts) {
  if (!isPlaying) { lastTs = null; return; }
  if (lastTs == null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  window.scrollBy(0, speedPxPerSec * dt);
  requestAnimationFrame(tick);
}

function togglePlay() {
  isPlaying = !isPlaying;
  updatePlayUi();
  if (isPlaying) requestAnimationFrame(tick);
}

// ----- UI -----
function setSpeed(v) {
  speedPxPerSec = clamp(Number(v), 0, 9999);
  speed.value = String(speedPxPerSec);
  speedVal.textContent = String(speedPxPerSec);
  statusSpeed.textContent = String(speedPxPerSec);
  localStorage.setItem(LS.SPEED, String(speedPxPerSec));
}

function setFont(v) {
  fontPx = clamp(Number(v), 10, 80);
  fontSize.value = String(fontPx);
  fontVal.textContent = String(fontPx);
  document.documentElement.style.setProperty("--fontSize", fontPx + "px");
  localStorage.setItem(LS.FONT, String(fontPx));
}

function render() {
  const preferFlat = choosePreferFlat(accidental.value, src.value);
  sheet.innerHTML = parseTextToHtml(src.value, semitoneShift, preferFlat);

  semiVal.textContent = String(semitoneShift);
  statusSemi.textContent = String(semitoneShift);

  localStorage.setItem(LS.SRC, src.value);
  localStorage.setItem(LS.SEMI, String(semitoneShift));
  localStorage.setItem(LS.ACC, accidental.value);
}

// 「整首歌」我不能貼完整歌詞給你，所以這裡提供：
// - 歌名/歌手行（會被 meta filter 忽略）
// - key/capo/bpm 行（也會被忽略）
// - 全段落骨架 + 你自己貼歌詞的位置
function loadTemplate() {
  src.value =
`青のすみか (Acoustic ver.)
キタニタツヤ
key: Db
capo: 0
bpm: 148

{section: Intro}
[Db] [Bbm7] [Gb] [Ab]

{section: Aメロ}
{t:00:07} [Db]（這行貼上你的歌詞…）
{t:00:10} [Bbm7]（這行貼上你的歌詞…）
{t:00:13} [Gb]（這行貼上你的歌詞…）
{t:00:16} [Ab]（這行貼上你的歌詞…）

{section: Bメロ}
{t:00:23} [Db]（貼歌詞…）
{t:00:27} [Bbm7]（貼歌詞…）
{t:00:31} [Gb]（貼歌詞…）
{t:00:35} [Ab]（貼歌詞…）

{section: サビ}
{t:00:55} [Bbm7]（貼歌詞…）
{t:00:59} [Gb]（貼歌詞…）
{t:01:03} [Db]（貼歌詞…）
{t:01:07} [Ab]（貼歌詞…）

{section: 間奏}
[Db] [Bbm7] [Gb] [Ab]

{section: 2Aメロ}
{t:01:30} [Db]（貼歌詞…）
...

{section: 2Bメロ}
{t:01:50} [Db]（貼歌詞…）
...

{section: 2サビ}
{t:02:20} [Bbm7]（貼歌詞…）
...

{section: ラストサビ}
{t:03:00} [Bbm7]（貼歌詞…）
...

{section: Outro}
[Db] [Bbm7] [Gb] [Ab]
`;
  semitoneShift = 0;
  render();
}

function clearAll() {
  src.value = "";
  semitoneShift = 0;
  render();
}

// Save scroll position
let scrollSaveTimer = null;
window.addEventListener("scroll", () => {
  if (scrollSaveTimer) return;
  scrollSaveTimer = setTimeout(() => {
    localStorage.setItem(LS.SCROLL, String(window.scrollY || 0));
    scrollSaveTimer = null;
  }, 200);
});

// Events
sheet.addEventListener("click", () => togglePlay());
btnPlay.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });

speed.addEventListener("input", () => setSpeed(speed.value));
fontSize.addEventListener("input", () => setFont(fontSize.value));

src.addEventListener("input", () => render());

btnUp.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift += 1; render(); });
btnDown.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift -= 1; render(); });
btnReset.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift = 0; render(); });

accidental.addEventListener("change", () => render());

btnTop.addEventListener("click", (e) => {
  e.stopPropagation();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

btnSample.addEventListener("click", (e) => { e.stopPropagation(); loadTemplate(); });
btnClear.addEventListener("click", (e) => { e.stopPropagation(); clearAll(); });

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) {
    if (e.ctrlKey && e.key === "Enter") togglePlay();
    return;
  }
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  if (e.key === "ArrowUp") { e.preventDefault(); setSpeed(speedPxPerSec + 5); }
  if (e.key === "ArrowDown") { e.preventDefault(); setSpeed(speedPxPerSec - 5); }
  if (e.key === "+" || e.key === "=") { e.preventDefault(); semitoneShift += 1; render(); }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); semitoneShift -= 1; render(); }
  if (e.key === "Home") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

// Init
(function init() {
  src.value = localStorage.getItem(LS.SRC) ?? "";
  setSpeed(localStorage.getItem(LS.SPEED) ?? 60);
  setFont(localStorage.getItem(LS.FONT) ?? 18);

  semitoneShift = Number(localStorage.getItem(LS.SEMI) ?? 0);
  accidental.value = localStorage.getItem(LS.ACC) ?? "auto";

  render();
  updatePlayUi();

  requestAnimationFrame(() => {
    const y = Number(localStorage.getItem(LS.SCROLL) ?? 0);
    if (!Number.isNaN(y) && y > 0) window.scrollTo(0, y);
  });

  if (!src.value.trim()) loadTemplate();
})();
