import Busboy from "busboy";
import wawoff2 from "wawoff2";
import { inflateSync, deflateSync } from "zlib";

/**
 * Detect font format from buffer magic bytes.
 * @param {Buffer} buffer
 * @returns {"ttf"|"woff"|"woff2"|null}
 */
function detectFormat(buffer) {
  if (buffer.length < 4) return null;
  const tag = buffer.slice(0, 4).toString("ascii");
  const hex = buffer.slice(0, 4).toString("hex");
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (hex === "00010000" || tag === "OTTO" || hex === "00020000") return "ttf";
  return null;
}

/**
 * Convert any supported font buffer to raw TTF/sfnt bytes.
 */
async function toTTF(buffer, format) {
  if (format === "ttf") return buffer;
  if (format === "woff2") {
    const result = await wawoff2.decompress(buffer);
    return Buffer.from(result);
  }
  if (format === "woff") {
    return woffToSfnt(buffer);
  }
  throw new Error("Unsupported format: " + format);
}

/**
 * Minimal WOFF to sfnt (TTF) converter.
 */
function woffToSfnt(woffBuf) {
  const flavor = woffBuf.readUInt32BE(4);
  const numTables = woffBuf.readUInt16BE(12);

  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const base = 44 + i * 20;
    entries.push({
      tag:        woffBuf.slice(base, base + 4).toString("ascii"),
      offset:     woffBuf.readUInt32BE(base + 4),
      compLength: woffBuf.readUInt32BE(base + 8),
      origLength: woffBuf.readUInt32BE(base + 12),
      checksum:   woffBuf.readUInt32BE(base + 16),
    });
  }

  entries.sort((a, b) => (a.tag < b.tag ? -1 : 1));

  const tables = entries.map((e) => {
    const raw = woffBuf.slice(e.offset, e.offset + e.compLength);
    let data = e.compLength < e.origLength ? inflateSync(raw) : raw;
    const padLen = (4 - (data.length % 4)) % 4;
    if (padLen > 0) {
      const padded = Buffer.alloc(data.length + padLen);
      data.copy(padded);
      data = padded;
    }
    return { tag: e.tag, checksum: e.checksum, origLength: e.origLength, data };
  });

  const sfntHeaderSize = 12;
  const tableDirSize = numTables * 16;
  const totalSize = sfntHeaderSize + tableDirSize + tables.reduce((s, t) => s + t.data.length, 0);
  const out = Buffer.alloc(totalSize);

  const log2 = Math.floor(Math.log2(numTables));
  const searchRange = Math.pow(2, log2) * 16;
  const entrySelector = log2;
  const rangeShift = numTables * 16 - searchRange;

  let pos = 0;
  out.writeUInt32BE(flavor, pos); pos += 4;
  out.writeUInt16BE(numTables, pos); pos += 2;
  out.writeUInt16BE(searchRange, pos); pos += 2;
  out.writeUInt16BE(entrySelector, pos); pos += 2;
  out.writeUInt16BE(rangeShift, pos); pos += 2;

  let currentOffset = sfntHeaderSize + tableDirSize;
  for (const t of tables) {
    out.write(t.tag, pos, "ascii"); pos += 4;
    out.writeUInt32BE(t.checksum, pos); pos += 4;
    out.writeUInt32BE(currentOffset, pos); pos += 4;
    out.writeUInt32BE(t.origLength, pos); pos += 4;
    currentOffset += t.data.length;
  }

  for (const t of tables) {
    t.data.copy(out, pos);
    pos += t.data.length;
  }

  return out;
}

/**
 * Convert TTF/sfnt buffer to WOFF.
 */
function sfntToWoff(ttfBuf) {
  const flavor = ttfBuf.readUInt32BE(0);
  const numTables = ttfBuf.readUInt16BE(4);

  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    entries.push({
      tag:      ttfBuf.slice(base, base + 4).toString("ascii"),
      checksum: ttfBuf.readUInt32BE(base + 4),
      offset:   ttfBuf.readUInt32BE(base + 8),
      length:   ttfBuf.readUInt32BE(base + 12),
    });
  }

  const compressed = entries.map((e) => {
    const data = ttfBuf.slice(e.offset, e.offset + e.length);
    let comp;
    try { comp = deflateSync(data, { level: 9 }); } catch (_) { comp = data; }
    if (comp.length >= data.length) comp = data;
    const padLen = (4 - (comp.length % 4)) % 4;
    const padded = Buffer.alloc(comp.length + padLen);
    comp.copy(padded);
    return { ...e, comp: padded, compLength: comp.length };
  });

  const woffHeaderSize = 44;
  const woffDirSize = numTables * 20;
  const dataSize = compressed.reduce((s, t) => s + t.comp.length, 0);
  const totalSize = woffHeaderSize + woffDirSize + dataSize;
  const out = Buffer.alloc(totalSize);

  let pos = 0;
  out.write("wOFF", pos, "ascii"); pos += 4;
  out.writeUInt32BE(flavor, pos); pos += 4;
  out.writeUInt32BE(totalSize, pos); pos += 4;
  out.writeUInt16BE(numTables, pos); pos += 2;
  out.writeUInt16BE(0, pos); pos += 2;
  out.writeUInt32BE(ttfBuf.length, pos); pos += 4;
  out.writeUInt16BE(1, pos); pos += 2;
  out.writeUInt16BE(0, pos); pos += 2;
  out.writeUInt32BE(0, pos); pos += 4;
  out.writeUInt32BE(0, pos); pos += 4;
  out.writeUInt32BE(0, pos); pos += 4;
  out.writeUInt32BE(0, pos); pos += 4;
  out.writeUInt32BE(0, pos); pos += 4;

  let tableDataOffset = woffHeaderSize + woffDirSize;
  for (const t of compressed) {
    out.write(t.tag, pos, "ascii"); pos += 4;
    out.writeUInt32BE(tableDataOffset, pos); pos += 4;
    out.writeUInt32BE(t.compLength, pos); pos += 4;
    out.writeUInt32BE(t.length, pos); pos += 4;
    out.writeUInt32BE(t.checksum, pos); pos += 4;
    tableDataOffset += t.comp.length;
  }

  for (const t of compressed) {
    t.comp.copy(out, pos);
    pos += t.comp.length;
  }

  return out;
}

/**
 * Parse multipart/form-data with busboy.
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let fileName = "font";

    bb.on("file", (_fieldname, file, info) => {
      fileName = info.filename || "font";
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on("finish", () => resolve({ fileBuffer, fileName }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const { fileBuffer, fileName } = await parseMultipart(req);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ error: "No font file uploaded." });
    }

    const format = detectFormat(fileBuffer);
    if (!format) {
      return res.status(400).json({
        error: "Unsupported font format. Upload a valid TTF, WOFF, or WOFF2 file.",
      });
    }

    const baseName = fileName.replace(/\.(ttf|woff2?)$/i, "");

    // Convert input to TTF first, then produce all three outputs
    const ttfBuffer = await toTTF(fileBuffer, format);
    const woff2Buffer = Buffer.from(await wawoff2.compress(ttfBuffer));
    const woffBuffer = sfntToWoff(ttfBuffer);

    // Build multipart/mixed response
    const boundary = "FontConverterBoundary" + Date.now();
    res.setHeader("Content-Type", `multipart/mixed; boundary=${boundary}`);

    const parts = [
      { name: `${baseName}.ttf`,   mime: "font/ttf",   data: ttfBuffer   },
      { name: `${baseName}.woff`,  mime: "font/woff",  data: woffBuffer  },
      { name: `${baseName}.woff2`, mime: "font/woff2", data: woff2Buffer },
    ];

    const chunks = [];
    for (const part of parts) {
      const header =
        `--${boundary}\r\n` +
        `Content-Type: ${part.mime}\r\n` +
        `Content-Disposition: attachment; filename="${part.name}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n`;
      chunks.push(Buffer.from(header));
      chunks.push(Buffer.from(part.data.toString("base64")));
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    return res.status(200).end(Buffer.concat(chunks));
  } catch (err) {
    console.error("[font-converter]", err);
    return res.status(500).json({ error: "Conversion failed: " + err.message });
  }
}
