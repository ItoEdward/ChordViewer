// =====================
// Chord Viewer (v4)
// - No import/export
// - Auto load songs from ./songs/index.json
// =====================

const SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

const LS = {
  SRC: "cv_src_v4",
  SPEED: "cv_speed_v4",
  FONT: "cv_font_v4",
  SEMI: "cv_semi_v4",
  SCROLL: "cv_scroll_v4",
  LAST_SONG: "cv_last_song_v4"
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

const songSelect = el("songSelect");
const btnReloadSongs = el("btnReloadSongs");

const btnTop = el("btnTop");
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

function autoPreferFlatFromSource(raw) {
  const tokens = raw.match(/\[([^\]]+)\]/g) || [];
  let flats = 0, sharps = 0;
  for (const t of tokens) {
    flats += (t.match(/b/g) || []).length;
    sharps += (t.match(/#/g) || []).length;
  }
  return flats >= sharps;
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

function isMetaLine(line) {
  if (/^\s*(title|artist|key|capo|bpm)\s*:/i.test(line)) return true;
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
  const raw = src.value || "";
  const preferFlat = autoPreferFlatFromSource(raw);

  if (!raw.trim()) {
    sheet.innerHTML = `<div class="line" style="color:#9aa4b2;">（未載入歌曲：請確認有 songs/index.json 與歌曲檔案，且用 http(s) 開啟）</div>`;
  } else {
    sheet.innerHTML = parseTextToHtml(raw, semitoneShift, preferFlat);
  }

  semiVal.textContent = String(semitoneShift);
  statusSemi.textContent = String(semitoneShift);

  localStorage.setItem(LS.SRC, raw);
  localStorage.setItem(LS.SEMI, String(semitoneShift));
}

// ----- Songs loader -----
async function loadSongsList() {
  songSelect.innerHTML = `<option value="">（讀取 songs/index.json…）</option>`;

  // cache busting
  const url = `./songs/index.json?_=${Date.now()}`;
  let data;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    songSelect.innerHTML = `<option value="">（找不到 songs/index.json 或不能用 file:// 開啟）</option>`;
    // 給你更明確的提示
    src.value = localStorage.getItem(LS.SRC) ?? "";
    semitoneShift = Number(localStorage.getItem(LS.SEMI) ?? 0);
    render();
    statusMsg.textContent = "請用 GitHub Pages 或本機 http server 開啟，並建立 songs/index.json";
    return;
  }

  // 支援 ["a.txt"] 或 [{file,title}]
  const items = Array.isArray(data) ? data : [];
  const normalized = items.map((x) => {
    if (typeof x === "string") return { file: x, title: x };
    if (x && typeof x === "object") return { file: x.file, title: x.title || x.file };
    return null;
  }).filter(Boolean);

  if (normalized.length === 0) {
    songSelect.innerHTML = `<option value="">（songs/index.json 內容為空）</option>`;
    return;
  }

  songSelect.innerHTML = `<option value="">（選擇歌曲）</option>`;
  for (const it of normalized) {
    const opt = document.createElement("option");
    opt.value = it.file;
    opt.textContent = it.title;
    songSelect.appendChild(opt);
  }

  // 自動載入上次開的歌，否則第一首
  const last = localStorage.getItem(LS.LAST_SONG);
  const toLoad = normalized.some(x => x.file === last) ? last : normalized[0].file;
  songSelect.value = toLoad;
  await loadSongFile(toLoad);
}

async function loadSongFile(file) {
  if (!file) return;
  const url = `./songs/${encodeURIComponent(file)}?_=${Date.now()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    src.value = text;
    semitoneShift = 0; // 換歌清零轉調（你要保留也行，但通常換歌清零比較合理）
    localStorage.setItem(LS.LAST_SONG, file);
    render();
    statusMsg.textContent = `已載入：${file}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  } catch (err) {
    statusMsg.textContent = `讀取失敗：${file}（請確認 songs/ 底下有此檔案）`;
  }
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

btnTop.addEventListener("click", (e) => {
  e.stopPropagation();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

btnClear.addEventListener("click", (e) => {
  e.stopPropagation();
  src.value = "";
  semitoneShift = 0;
  render();
});

songSelect.addEventListener("change", async () => {
  const file = songSelect.value;
  if (!file) return;
  await loadSongFile(file);
});

btnReloadSongs.addEventListener("click", async (e) => {
  e.stopPropagation();
  await loadSongsList();
});

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
(async function init() {
  src.value = localStorage.getItem(LS.SRC) ?? "";
  setSpeed(localStorage.getItem(LS.SPEED) ?? 60);
  setFont(localStorage.getItem(LS.FONT) ?? 18);
  semitoneShift = Number(localStorage.getItem(LS.SEMI) ?? 0);

  render();
  updatePlayUi();

  requestAnimationFrame(() => {
    const y = Number(localStorage.getItem(LS.SCROLL) ?? 0);
    if (!Number.isNaN(y) && y > 0) window.scrollTo(0, y);
  });

  await loadSongsList();
})();
