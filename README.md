# FontForge — Web Font Converter

Convert any web font (TTF, WOFF, WOFF2) to all three formats in one API call.

Powered by **[wawoff2](https://www.npmjs.com/package/wawoff2)** — Google's WOFF2 library compiled to WebAssembly (no native binaries, works perfectly on Vercel serverless).

---

## Quick Deploy

```bash
# 1. Clone / download this project
cd font-converter

# 2. Install dependencies
npm install

# 3. Deploy to Vercel
npx vercel deploy
```

---

## Project Structure

```
font-converter/
├── api/
│   └── convert.js      # POST /api/convert — font conversion endpoint
├── public/
│   └── index.html      # Frontend UI (drag & drop, Tailwind CSS)
├── package.json
├── vercel.json
└── README.md
```

---

## API Reference

### `POST /api/convert`

Upload a font file and receive back all three web font formats.

**Request:**
- Content-Type: `multipart/form-data`
- Field name: `font`
- Accepted formats: `.ttf`, `.woff`, `.woff2`

**Response:**
- Content-Type: `multipart/mixed; boundary=...`
- Returns three parts:
  - `{basename}.ttf`   — TrueType Font
  - `{basename}.woff`  — Web Open Font Format
  - `{basename}.woff2` — Web Open Font Format 2 (Google)

**Example with curl:**
```bash
curl -X POST https://your-project.vercel.app/api/convert \
  -F "font=@MyFont.ttf" \
  --output response.multipart
```

**Example with JavaScript:**
```js
const formData = new FormData();
formData.append('font', fontFile);

const res = await fetch('/api/convert', {
  method: 'POST',
  body: formData,
});

// Response is multipart/mixed with base64-encoded font files
const boundary = res.headers.get('Content-Type').split('boundary=')[1];
const buffer = await res.arrayBuffer();
// ... parse multipart parts
```

**Error responses:**
```json
{ "error": "No font file uploaded." }
{ "error": "Unsupported font format. Upload a valid TTF, WOFF, or WOFF2 file." }
{ "error": "Conversion failed: ..." }
```

---

## How It Works

```
Input (TTF / WOFF / WOFF2)
         │
         ▼
  Detect format (magic bytes)
         │
         ▼
  Convert → TTF/sfnt  ◄── wawoff2.decompress() for WOFF2
         │               woffToSfnt() for WOFF
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  WOFF2     WOFF
(wawoff2) (custom zlib)
    │         │
    └────┬────┘
         │
         ▼
  multipart/mixed response
  (TTF + WOFF + WOFF2, base64)
```

**Key dependency:**
- [`wawoff2`](https://www.npmjs.com/package/wawoff2) — Google's woff2 compiled to WebAssembly. Works on Vercel without native addons.

---

## Local Development

```bash
npm install
npx vercel dev
# Open http://localhost:3000
```

---

## Tech Stack

- **Runtime:** Node.js 18 (Vercel serverless)
- **WOFF2:** wawoff2 (Google woff2 via WebAssembly)
- **WOFF:** Custom zlib-based WOFF encoder/decoder
- **File parsing:** busboy (multipart form parsing)
- **Frontend:** Vanilla HTML + Tailwind CSS CDN + Google Fonts
