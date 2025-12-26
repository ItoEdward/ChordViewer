// Chord Viewer (clean + scan songs folder)
//
// Important:
// - This can NOT enumerate local folders in file:// mode.
// - Works when served via HTTP and the server provides a directory listing for /songs/
//   (e.g., python -m http.server).

const el = (id) => document.getElementById(id);

const sheet = el("sheet");
const btnPlay = el("btnPlay");
const playState = el("playState");

const speed = el("speed");
const speedVal = el("speedVal");

const fontSize = el("fontSize");
const fontVal = el("fontVal");

const btnDown = el("btnDown");
const btnUp = el("btnUp");
const btnReset = el("btnReset");
const semiVal = el("semiVal");

const songSelect = el("songSelect");
const btnRescan = el("btnRescan");
const songStatus = el("songStatus");

// ===== song text source (in-memory) =====
let currentSongText = ""; // loaded from songs/*.txt

const SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

let isPlaying = false;
let speedPxPerSec = 60;
let semitoneShift = 0;
let lastTs = null;

// ---------- transpose helpers ----------
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
      out += "/" + (bIdx >= 0 ? indexToNote(bIdx + semitone, preferFlat) + pb.rest : bass);
    } else {
      out += "/" + bass;
    }
  }
  return out;
}

function transposeLine(line, semitone, preferFlat) {
  return line.replace(/\[([^\]]+)\]/g, (_, chord) => {
    const t = transposeChordToken(chord.trim(), semitone, preferFlat);
    return "[" + t + "]";
  });
}

// ---------- render helpers ----------
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

function render() {
  const raw = currentSongText || "";
  if (!raw) { sheet.innerHTML = ""; semiVal.textContent = String(semitoneShift); return; }

  const preferFlat = autoPreferFlatFromSource(raw);
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  sheet.innerHTML = lines.map((line) => {
    const t = transposeLine(line, semitoneShift, preferFlat);
    const rendered = renderInlineChords(t);
    return `<div class="line">${rendered || "&nbsp;"}</div>`;
  }).join("");

  semiVal.textContent = String(semitoneShift);
}

// ---------- auto scroll ----------
function updatePlayUi() {
  btnPlay.textContent = isPlaying ? "⏸" : "▶︎";
  playState.textContent = isPlaying ? "Playing" : "Paused";
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

// ---------- UI ----------
function setSpeed(v) {
  speedPxPerSec = Math.max(0, Number(v) || 0);
  speed.value = String(speedPxPerSec);
  speedVal.textContent = String(speedPxPerSec);
}

function setFont(v) {
  const fp = Math.min(80, Math.max(10, Number(v) || 18));
  fontSize.value = String(fp);
  fontVal.textContent = String(fp);
  document.documentElement.style.setProperty("--fontSize", fp + "px");
}

// ---------- songs scanning (directory listing) ----------
const ALLOWED_EXT = [".txt", ".pro", ".chord", ".md"];

function looksLikeSongFile(name) {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some(ext => lower.endsWith(ext));
}

function setSongStatus(msg) {
  songStatus.textContent = msg || "";
}

async function scanSongsFolder() {
  // Reset UI
  songSelect.innerHTML = "";
  setSongStatus("掃描 songs/ ...");

  // IMPORTANT:
  // - python http.server returns an HTML directory listing for /songs/
  // - many hosts (like GitHub Pages) do NOT. In that case, this will fail or return 404.
  let html = "";
  try {
    const res = await fetch("./songs/?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    html = await res.text();

    // If not HTML, still try parse as html (some servers omit header)
    // but if it's obviously not listing, we'll treat as unsupported.
    if (!ct.includes("text/html") && !html.includes("<a")) {
      throw new Error("No directory listing");
    }
  } catch (e) {
    setSongStatus("讀不到 songs/（file:// 不行；或伺服器不提供目錄列表）");
    // Keep select empty
    return;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(doc.querySelectorAll("a"))
    .map(a => a.getAttribute("href") || "")
    .filter(Boolean);

  // python listing uses href like "song.txt"
  // sometimes it's "song.txt/" or absolute; we normalize.
  const files = links
    .map(href => href.split("?")[0])
    .map(href => href.replace(/^\.\/+/, ""))
    .map(href => decodeURIComponent(href))
    .filter(name => name && !name.endsWith("/") && looksLikeSongFile(name));

  // unique + sort
  const uniq = Array.from(new Set(files)).sort((a,b)=>a.localeCompare(b, "zh-Hant"));

  if (uniq.length === 0) {
    setSongStatus("songs/ 存在，但沒找到可用歌曲檔");
    return;
  }

  // Build select
  for (const f of uniq) {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    songSelect.appendChild(opt);
  }

  setSongStatus(`找到 ${uniq.length} 首`);
  // Auto load first
  await loadSong(uniq[0]);
}

async function loadSong(fileName) {
  if (!fileName) return;
  setSongStatus(`載入 ${fileName}...`);

  try {
    const res = await fetch(`./songs/${encodeURIComponent(fileName)}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentSongText = await res.text();
    semitoneShift = 0;
    render();
    setSongStatus(`已載入：${fileName}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  } catch (e) {
    setSongStatus(`載入失敗：${fileName}`);
  }
}

// ---------- events ----------
sheet.addEventListener("click", togglePlay);
btnPlay.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });

speed.addEventListener("input", () => setSpeed(speed.value));
fontSize.addEventListener("input", () => setFont(fontSize.value));

btnUp.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift += 1; render(); });
btnDown.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift -= 1; render(); });
btnReset.addEventListener("click", (e) => { e.stopPropagation(); semitoneShift = 0; render(); });

songSelect.addEventListener("change", async () => {
  await loadSong(songSelect.value);
});

btnRescan.addEventListener("click", async (e) => {
  e.stopPropagation();
  await scanSongsFolder();
});

document.addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  if (e.key === "ArrowUp") { e.preventDefault(); setSpeed(speedPxPerSec + 5); }
  if (e.key === "ArrowDown") { e.preventDefault(); setSpeed(speedPxPerSec - 5); }
  if (e.key === "+" || e.key === "=") { e.preventDefault(); semitoneShift += 1; render(); }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); semitoneShift -= 1; render(); }
});

// ---------- init ----------
setSpeed(speed.value);
setFont(fontSize.value);
updatePlayUi();
render();          // starts empty
scanSongsFolder(); // try to discover songs
