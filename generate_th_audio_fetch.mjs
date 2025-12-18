import fs from "fs";
import path from "path";

const CSV_PATH = "phrases.csv";
const OUT_DIR = "audio_th";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in env.");
  console.error('Set it like:  export OPENAI_API_KEY="sk-xxxx"');
  process.exit(1);
}

// 可改参数
const MODEL = "gpt-4o-mini-tts"; // 也可用 tts-1 / tts-1-hd（看你账号支持）
const VOICE = "alloy";
const FORMAT = "mp3";
const SPEED = 1.0;

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function parseCSV(csv) {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        row.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    rows.push(row.map(s => (s || "").trim()));
  }
  return rows;
}

function looksLikeHeader(row) {
  const head = row.map(x => (x || "").toLowerCase());
  return head.includes("thai") || head.includes("tts_key") || head.includes("chinese_pinyin");
}

async function ttsThaiToMp3(thaiText, key) {
  const outPath = path.join(OUT_DIR, `${key}.mp3`);
  if (fs.existsSync(outPath)) {
    console.log("SKIP (exists):", outPath);
    return;
  }

  // ✅ 强制让模型用泰语读（更稳）
  //const input = `พูดประโยคนี้เป็นภาษาไทยอย่างเป็นธรรมชาติ: ${thaiText}`;
  const input = thaiText;

  const body = {
    model: MODEL,
    voice: VOICE,
    format: FORMAT,
    speed: SPEED,
    input: input,
  };

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`TTS API error ${resp.status}: ${text.slice(0, 500)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  console.log("OK:", outPath);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Not found: ${CSV_PATH}`);
  }

  ensureDir(OUT_DIR);

  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  let rows = parseCSV(csv);
  if (!rows.length) throw new Error("CSV is empty");

  if (looksLikeHeader(rows[0])) rows = rows.slice(1);

  // ✅ 按 CSV 顺序生成
  for (let i = 0; i < rows.length; i++) {
    const [thai, _zhpy, key] = rows[i];

    if (!thai || !key) {
      console.log("SKIP (missing): line", i + 1);
      continue;
    }

    try {
      await ttsThaiToMp3(thai, key);
    } catch (e) {
      console.error("FAIL:", key, e?.message || e);
      // 不退出：继续下一个
    }
  }

  console.log("✅ Done. Output folder:", OUT_DIR);
}

main().catch(err => {
  console.error("❌ Fatal:", err?.message || err);
  process.exit(1);
});
