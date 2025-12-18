// tts_from_csv.mjs
// Node >= 18（自带 fetch）
// 读取 phrases.csv（Thai,Chinese_Pinyin,TTS_Key）
// 输出 audio/<TTS_Key>.mp3

import fs from "fs";
import path from "path";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("❌ 缺少环境变量 OPENAI_API_KEY");
  process.exit(1);
}

const CSV_PATH = path.resolve("./phrases.csv");
const OUT_DIR = path.resolve("./audio");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ENDPOINT = "https://api.openai.com/v1/audio/speech";

// 你可以按需调整
const MODEL = "gpt-4o-mini-tts";
const VOICE = "alloy";
const RESPONSE_FORMAT = "mp3";
const SPEED = 0.95;
const INSTRUCTIONS = "请用标准普通话，发音清晰，语速稍慢，适合泰国初学者跟读。";

// 并发与间隔（避免打太快）
const CONCURRENCY = 2;
const SLEEP_MS = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 从“中文+拼音”里提取纯中文（遇到英文字母/拼音符号就停止）
function extractChinese(zhpy) {
  const s = (zhpy || "").trim();
  if (!s) return "";
  const latinOrTone = /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
  let out = "";
  for (const ch of s) {
    if (latinOrTone.test(ch)) break;
    out += ch;
  }
  // 去掉末尾空格/标点多余空格
  return out.trim();
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let cur = "";
    let inQ = false;
    const row = [];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        row.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    rows.push(row.map(x => (x || "").trim()));
  }
  return rows;
}

async function ttsToFile(key, text) {
  const outPath = path.join(OUT_DIR, `${key}.${RESPONSE_FORMAT}`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    console.log(`✅ skip ${key} (exists)`);
    return;
  }

  const body = {
    model: MODEL,
    voice: VOICE,
    input: text,
    response_format: RESPONSE_FORMAT,
    speed: SPEED,
    instructions: INSTRUCTIONS
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${err}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`🎧 saved ${outPath}`);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("❌ 找不到 phrases.csv（请把 CSV 放在当前目录）");
    process.exit(1);
  }

  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  let rows = parseCSV(csvText);

  // 可选：自动跳过表头
  const head = (rows[0] || []).map(x => x.toLowerCase());
  const hasHeader = head.includes("thai") || head.includes("chinese_pinyin") || head.includes("tts_key");
  if (hasHeader) rows = rows.slice(1);

  const tasks = [];
  for (const r of rows) {
    const thai = r[0] || "";
    const zhpy = r[1] || "";
    const key = r[2] || "";
    if (!zhpy || !key) continue;
    const zh = extractChinese(zhpy);
    if (!zh) {
      console.warn(`⚠️ 跳过（无法提取中文）：${key} / ${thai} / ${zhpy}`);
      continue;
    }
    tasks.push({ key, zh, thai, zhpy });
  }

  console.log(`Start: ${tasks.length} items -> ${OUT_DIR}`);

  // 并发 worker
  const queue = tasks.slice();
  async function worker(id) {
    while (queue.length) {
      const t = queue.shift();
      try {
        await ttsToFile(t.key, t.zh);
      } catch (e) {
        console.error(`❌ worker${id} ${t.key} failed:`, e.message || e);
        // 简单重试一次
        await sleep(500);
        try {
          await ttsToFile(t.key, t.zh);
        } catch (e2) {
          console.error(`❌ worker${id} ${t.key} retry failed:`, e2.message || e2);
        }
      }
      await sleep(SLEEP_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  console.log("✅ Done.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
