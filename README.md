# Word Template Filler

Desktop application สำหรับสร้างเอกสารจาก Microsoft Word (`.docx`) Template โดยผู้ใช้สามารถจัดการ Template และนำข้อมูลมาแทนค่าในเอกสารได้

โปรเจกต์นี้พัฒนาด้วย **Electron + Vite + SQLite** โดยแยก Database ออกจาก Renderer Process เพื่อให้โครงสร้างปลอดภัยและดูแลต่อได้ง่าย

---

## Tech Stack

* **Electron** — Desktop Application
* **Vite** — Frontend Development & Build Tool
* **JavaScript** — Application Language
* **SQLite** — Local Database
* **better-sqlite3** — SQLite driver
* **Worker Threads** — แยกงาน Database ออกจาก Main Process
* **IPC** — Communication ระหว่าง Renderer และ Main Process

---

## Architecture

โครงสร้างหลักของ Application:

```text
┌──────────────────────────────┐
│          Electron            │
│                              │
│  ┌────────────────────────┐  │
│  │     Renderer Process    │  │
│  │                         │  │
│  │       Vite + UI         │  │
│  └────────────┬───────────┘  │
│               │ IPC           │
│               ▼               │
│  ┌────────────────────────┐  │
│  │      Main Process      │  │
│  │                         │  │
│  │    Electron Main       │  │
│  └────────────┬───────────┘  │
│               │               │
│               ▼               │
│  ┌────────────────────────┐  │
│  │       DB Worker        │  │
│  │                         │  │
│  │     better-sqlite3     │  │
│  └────────────┬───────────┘  │
│               │               │
│               ▼               │
│  ┌────────────────────────┐  │
│  │        SQLite          │  │
│  │       templates.db     │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

### ทำไม Database ถึงอยู่ใน Worker?

Database ไม่ควรถูกจัดการโดย Renderer โดยตรง

Renderer มีหน้าที่เกี่ยวกับ UI ส่วน Database และ File System จะถูกจัดการโดยฝั่ง Electron

โครงสร้างจึงเป็น:

```text
Renderer
   ↓
Preload
   ↓
IPC
   ↓
Main Process
   ↓
DB Worker
   ↓
SQLite
```

ทำให้ UI ไม่ต้องรู้รายละเอียดของ SQLite และสามารถควบคุมการเข้าถึง Database จากฝั่ง Electron ได้

---

## Project Structure

โครงสร้างปัจจุบัน:

```text
word-template-filler/
│
├── src/
│   │
│   ├── main/
│   │   ├── main.cjs
│   │   ├── preload.cjs
│   │   │
│   │   └── db/
│   │       └── db-worker.cjs
│   │
│   └── renderer/          # Vite root
│       ├── index.html
│       └── style.css
│
├── public/                # Renderer scripts (เสิร์ฟตรง ๆ ไม่ผ่าน bundler)
│   ├── app.js
│   ├── db.js
│   ├── extract.js
│   ├── fieldTypes.js
│   ├── replace.js
│   ├── xlsx.js            # สร้าง/อ่าน .xlsx ด้วย JSZip (นำเข้า-ส่งออก Master Data)
│   └── components/
│
├── data/                  # SQLite (ตอน development)
│   └── templates.db
│
├── dist/                  # Vite build output (ถูก package เข้า .exe)
│
├── vite.config.js
├── package.json
├── package-lock.json
└── README.md
```

> ไฟล์ Renderer (`.js`/`.css`/`.svg`) อยู่ใน `public/` ที่เดียว
> ถ้าเพิ่มไฟล์ใหม่ให้ใส่ที่นี่ ห้ามคัดลอกไปไว้ใน `src/renderer`
> เพราะจะทำให้ dev กับ .exe โหลดคนละไฟล์

---

## Development Environment

### Node.js

โปรเจกต์นี้พัฒนาบน Node.js 22 (ต้องเป็น **22.12 ขึ้นไป**)

ถ้าใช้ Node ต่ำกว่านี้ `vite build` จะเตือน และ `electron-builder` จะล้มเหลว
ด้วย error `ERR_REQUIRE_ESM`

ตรวจสอบ Version:

```powershell
node -v
```

ควรได้:

```text
v22.x.x
```

### npm

```powershell
npm -v
```

---

## Dependencies

ตรวจสอบ Package หลัก:

```powershell
npm list electron better-sqlite3 vite concurrently wait-on --depth=0
```

Dependencies ที่ใช้ในปัจจุบัน:

```text
Electron       44.3.0
Vite           8.3.0
better-sqlite3 13.0.3
concurrently   9.2.4
wait-on        9.1.0
jszip          3.10.2
```

> `jszip` ใช้ตอน build เท่านั้น (Vite คัดลอกไฟล์ไปที่ `dist/vendor/`)
> Renderer จึงโหลด jszip จากในแอปได้ ไม่ต้องต่ออินเทอร์เน็ต

---

## Installation

Clone หรือเปิด Project แล้วติดตั้ง Dependencies:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm list electron better-sqlite3 concurrently wait-on --depth=0
npm install
```

---

## Development

### Start Vite

สำหรับทดสอบ Renderer อย่างเดียว:

```powershell
npm run dev
```

Vite จะเปิด Development Server ที่:

```text
http://localhost:5173/
```

---

### Start Electron

ถ้า Vite Server เปิดอยู่แล้ว สามารถเปิด Electron ได้ด้วย:

```powershell
npm run electron
```

---

### Start Full Development Environment

แนะนำให้ใช้คำสั่งนี้สำหรับ Development:

```powershell
npm run dev:electron
```

คำสั่งนี้จะทำงาน 2 ส่วนพร้อมกัน:

```text
concurrently
│
├── npm run dev
│     └── Vite :5173
│
└── wait-on :5173
      └── npm run electron
```

Electron จะรอจนกว่า Vite จะพร้อมก่อนจึงเปิด Application

### แก้โค้ด Renderer ตอน dev

ไฟล์ `.js` ของ Renderer อยู่ใน `public/` ซึ่งเป็นที่เดียวที่ทั้ง dev และ `.exe` ใช้

```text
public/app.js  ->  dev: Vite เสิร์ฟที่ http://localhost:5173/app.js
               ->  build: ถูกคัดลอกไป dist/app.js แล้วเข้า app.asar
```

- แก้ไฟล์ใน `public/` แล้วบันทึก → หน้าต่าง Electron รีเฟรชเอง
  (มี plugin `public-dir-reload` ใน `vite.config.js` ช่วย reload ให้)
- ไม่ต้องคัดลอกไฟล์ไปที่อื่น และ **ห้ามแก้ใน `dist/`** เพราะจะถูกลบทุกครั้งที่ build
- ถ้าแก้ `vite.config.js` ต้องปิด dev server แล้วเปิดใหม่

---

## Current Status

### Phase 1 — Application Infrastructure

สถานะ: **Completed**

สิ่งที่ทำสำเร็จแล้ว:

* [x] สร้าง Vite Project
* [x] ติดตั้ง Electron
* [x] สร้าง Electron Main Process
* [x] สร้าง Preload
* [x] เปิดใช้งาน `contextIsolation`
* [x] ปิด `nodeIntegration` ใน Renderer
* [x] สร้าง IPC ระหว่าง Renderer และ Main
* [x] สร้าง Database Worker
* [x] ติดตั้ง `better-sqlite3`
* [x] Rebuild `better-sqlite3` สำหรับ Electron
* [x] เชื่อมต่อ SQLite จาก DB Worker
* [x] ทดสอบ SQLite Query
* [x] ตรวจสอบ SQLite Version สำเร็จ

การทดสอบล่าสุด:

```text
SQLite Version: 3.53.4
```

ผลลัพธ์นี้ยืนยันว่า:

```text
Renderer
    ↓
IPC
    ↓
Electron Main
    ↓
DB Worker
    ↓
better-sqlite3
    ↓
SQLite
```

ทำงานครบแล้ว

---

## Database

Database จะถูกจัดการโดย DB Worker

แนวทางที่ต้องการ:

```text
DB Worker
    │
    ├── Open SQLite
    ├── Initialize Database
    ├── Create Tables
    ├── Insert
    ├── Update
    ├── Delete
    └── Query
```

Renderer จะไม่เรียก `better-sqlite3` โดยตรง

---

## Word Template

เป้าหมายหลักของ Application คือการจัดการ Word Template (`.docx`)

ตัวอย่าง Template:

```text
เรียน {{customer_name}}

ตามที่บริษัท {{company_name}}
ได้ดำเนินการเมื่อวันที่ {{document_date}}

ยอดเงินทั้งหมด {{amount}} บาท
```

เมื่อผู้ใช้กรอกข้อมูล:

```text
customer_name = บริษัท ABC จำกัด
company_name  = XYZ Corporation
document_date = 13/09/2026
amount        = 150,000
```

ระบบจะสร้างเอกสาร:

```text
เรียน บริษัท ABC จำกัด

ตามที่บริษัท XYZ Corporation
ได้ดำเนินการเมื่อวันที่ 13/09/2026

ยอดเงินทั้งหมด 150,000 บาท
```

### ล็อกตำแหน่ง (คอลัมน์) ของ Field

ใน template ที่มีหลาย field อยู่บรรทัดเดียวกัน (จัดคอลัมน์ เช่น `ชื่อ {{name}}     ตำแหน่ง {{position}}`)
ติ๊ก **ล็อกตำแหน่ง** ที่หน้า Template Configuration เพื่อให้ field นั้นเริ่มที่**ตำแหน่งเดิมของ template**
ตามแนวไม้บรรทัด (ความกว้างจริง) ไม่ใช่ตามจำนวนตัวอักษร

กลไกที่ใช้:

```text
1. แทนค่า placeholder ด้วยค่าที่ผู้ใช้กรอก (ไม่ตัดข้อความและไม่เติมข้อความท้ายค่า)
2. วัดความกว้างจริงของข้อความ (ตามฟอนต์/ขนาดในเอกสาร) ด้วย canvas แล้วเทียบเป็น cm
3. ด้านหน้า: ถ้าค่าของ field ก่อนหน้ายาวกว่า placeholder -> ลบช่องว่างด้านหน้า
             ถ้าสั้นกว่า                            -> เติมช่องว่างด้านหน้า
   ด้านหลัง: รักษาช่องของ field ที่ล็อกให้กว้างเท่า {{field}} เดิม
             (ความกว้างนี้รวมปีกกา {{ }} เพราะในไฟล์ .docx มีตัวอักษรนั้นจริง)
             ค่าสั้นกว่า -> เติมช่องว่างหลังค่า, ค่ายาวกว่า -> ลบช่องว่างหลังค่า
4. ถ้าช่องว่างไม่พอให้ลบ (ค่าที่กรอกยาวเกินที่ template เตรียมไว้)
   จะไม่ตัดข้อความทิ้ง แต่จะขึ้นคำเตือนบนหน้ารายงาน
```

หมายเหตุ: ความกว้างที่ใช้อ้างอิงคือความกว้างของ `{{field}}` **รวมปีกกา** เพราะนั่นคือ
ข้อความที่อยู่ใน template จริง ถ้าไม่นับปีกกา ตำแหน่งจะเพี้ยนไปประมาณ 4 ตัวอักษรต่อ field

หน้ารายงานจะแสดงผลการล็อกให้ตรวจสอบทุกครั้ง เช่น

```text
ล็อกตำแหน่งแล้ว: position (ด้านหน้า -9 ช่อง ≈ 0.95 ซม.)
ล็อกตำแหน่งไม่สมบูรณ์: subject (ช่องว่างด้านหน้าต้องลบ 47 ช่อง แต่มี 30 ช่อง …)
```

เพราะตำแหน่งถูกชดเชยที่ช่องว่างใน template จึงต้องมีช่องว่างด้านหน้า field ที่ล็อก
มากพอสำหรับค่าที่ยาวที่สุดที่คาดว่าจะกรอก โดยนับในหน่วยช่องอักษร
(อักษรไทยและอักษรละตินกว้างไม่เท่ากัน — ตัววัดจริงใช้ความกว้างฟอนต์ของเอกสาร)

```text
{{name}}      = 8 ช่องอักษร
ชื่อไทย 20 ตัว = 40 ช่องอักษร -> ต้องมีช่องว่างด้านหน้าอย่างน้อย ~32 ช่อง
```

ถ้าช่องว่างไม่พอให้ลบ ระบบจะลบให้มากที่สุด (แต่ละช่วงเหลือ 1 ช่องเพื่อไม่ให้ข้อความติดกัน)
แล้วขึ้นคำเตือนบนหน้ารายงาน โดยไม่ตัดข้อความที่ผู้ใช้กรอก

ต้องติ๊ก **ล็อกตำแหน่ง** ให้ครบทุกคอลัมน์ที่ต้องการให้ตรง เพราะคอลัมน์ที่ไม่ได้ล็อก
จะเลื่อนตามความยาวของค่าที่อยู่ก่อนหน้า

```text
ชื่อ {{name}}                    ตำแหน่ง {{position}}                    วันที่ {{date}}
     └─ ล็อก "ตำแหน่ง" = ช่องนี้อยู่นิ่ง                                └─ ต้องล็อก "วันที่" ด้วย
```

---

### ตาราง (Field type = Table)

field ใดต้องการให้ออกมาเป็น "ตาราง Word" ให้ตั้ง type เป็น **Table** ในหน้า Template Configuration
และวาง `{{field}}` ไว้บรรทัดเดียวของมันเอง

```text
{{items}}
```

สิ่งที่ตั้งได้ในหน้า Template Configuration

* **จำนวนคอลัมน์** (1-12)
* **ชื่อหัวคอลัมน์** ของแต่ละคอลัมน์ (ข้อความยาวขึ้นบรรทัดใหม่ได้ทั้งในหน้าตั้งค่าและตารางของหน้ารายงาน)
* **สัดส่วนความกว้าง** ของแต่ละคอลัมน์ (ratio) — เช่น 2 กับ 1 = กว้างเป็นสองเท่าของคอลัมน์ถัดไป
  เว้นว่าง = แบ่งเท่ากันทุกคอลัมน์ และหากรวมกันไม่ครบ 100% ของความกว้างเนื้อเรื่อง
  ระบบย่อสัดส่วนทุกคอลัมน์ให้พอดีความกว้างหน้ากระดาษให้เอง
  (ปรับได้ทั้งพิมพ์ในช่อง และ **ลากขอบบนแถบตัวอย่างสัดส่วน** — ลากแล้วสัดส่วนรวมคงเดิม
  คอลัมน์ข้างเส้นสลับความกว้างกัน หรือคลิกขอบแล้วกด ← / → ทีละ 0.1)
<arg_value><b88a6f17>```text

สัดส่วน 2 : 1          สัดส่วน 1 : 2 : 1
┌──────────┬─────┐    ┌──────┬───────────┬──────┐
│ กว้าง 2  │  1  │    │  1   │     2     │  1   │
└──────────┴─────┘    └──────┴───────────┴──────┘
```

หน้ารายงานจะวาดตารางตามที่ตั้งไว้ เพิ่ม/ลบแถวได้ และพิมพ์ค่าในแต่ละช่อง
ตอนกด Download ระบบจะสร้าง `w:tbl` ไป**แทนที่ทั้งย่อหน้า**ที่มี `{{field}}`

### ผสานช่อง (Merge) และแถวรวมยอด

ช่องของแถวข้อมูลผสานกับช่องถัดไปได้ทีละคู่ ไม่จำกัดว่าต้องเริ่มจากช่องแรก
แถวรวมยอดทำได้ด้วยการผสานช่องของแถวนั้นแล้วพิมพ์ข้อความ/ยอดรวมเอง
(ไม่มี "แถวสรุป" ที่ตั้งไว้ล่วงหน้าแล้ว)

```text
[⇥ ผสาน]  ช่องนี้รวมกับช่องถัดไป   →  เขียนเป็น w:gridSpan
[แยก]      แยกช่องที่ผสานออกกลับเป็นช่องปกติ
```

* ผสานช่อง 2+3 ได้ (ไม่บังคับว่าต้องเป็นช่องแรก) และผสานต่อเนื่องหลายช่องก็ได้
* ข้อความของช่องที่ถูกกลืนย้ายมารวมกับช่องแรกของกลุ่ม (คั่นด้วยช่องว่าง) ไม่หายไป
* กด **แยก** = ข้อความที่รวมกันอยู่ไปอยู่ในช่องแรก ช่องที่เหลือว่าง
* ถ้าจำนวนคอลัมน์ถูกแก้จนขนาดกลุ่มไม่พอดี ระบบจะกลับไปเป็น "ไม่ผสาน" ให้เอง
  (ค่าที่ผสานไว้เดิมถูกเก็บในประวัติควบคู่ไปกับแถว)

```text
{{items}}        ->  <w:tbl> หัวตาราง + แถวข้อมูล (แถวไหนผสานช่องก็รวมให้)
รายการ {{items}}  ->  ย่อหน้าเดิมหายทั้งย่อหน้า (ต้องวาง {{items}} ไว้บรรทัดเดียว)
```

### จัดรูปแบบข้อความในช่อง (จัดตำแหน่ง / ตัวหนา / ตัวเอียง)

ในหน้ารายงาน ช่องข้อมูลของตาราง (แถวข้อมูล ไม่รวมแถวหัวตาราง) จัดรูปแบบได้ทีละช่อง

1. คลิกช่องที่ต้องการ — แถบ "จัดรูปแบบช่องที่เลือก" จะเปิดให้กด
2. กดปุ่ม ชิดซ้าย / กึ่งกลาง / ชิดขวา / **B** (ตัวหนา) / *I* (ตัวเอียง)
   หรือกด `Ctrl+B` / `Ctrl+I` ขณะพิมพ์อยู่ในช่อง

รูปแบบเป็นของ "ช่อง" ทั้งช่อง (ไม่ใช่บางคำในช่อง) และเลื่อนตามแถว/ช่องเสมอ

* เพิ่ม/ลบแถว → รูปแบบของแถวเดิมเลื่อนตาม ไม่หลุดช่อง
* ผสานช่อง → ใช้รูปแบบของช่องแรกของกลุ่ม (ช่องที่ถูกกลืนถูกล้างรูปแบบ)
* แยกช่อง → ช่องแรกคงรูปแบบเดิม ช่องที่เพิ่งแยกกลับไปเป็นรูปแบบตั้งต้น
* ประวัติการกรอก (กด "ใช้ซ้ำ") จำรูปแบบของทุกช่องไว้ด้วย

ตอนสร้างเอกสาร: ชิดซ้าย = ไม่ใส่อะไร, กึ่งกลาง = `w:jc val="center"`,
ชิดขวา = `w:jc val="right"`, ตัวหนา = `w:b`, ตัวเอียง = `w:i`
(แถวหัวตารางเป็นตัวหนาและชิดซ้ายตามเดิม)

### วาง {{field}} ของตารางไว้หลายที่

`{{field}}` ของตารางถูกวางไว้กี่ย่อหน้า เอกสารจะได้ตารางเท่านั้นอัน (ตั้งใจให้วางซ้ำได้
เพื่อทำสำเนา/แนบเอกสาร) แต่ `{{field}}{{field}}` ในย่อหน้าเดียวกันนับเป็นตารางเดียว

ระบบจะเตือนให้เห็นว่าวางไว้กี่ที่ เพื่อไม่ให้ได้ตารางเกินโดยไม่รู้ตัว

* หน้า Template Configuration — ใต้ช่องตั้งค่าตาราง (เมื่อเลือก type เป็น Table)
  ขึ้นว่า `วาง {{items}} ไว้ 4 ที่ในเอกสาร → ตอนสร้างเอกสารจะได้ตาราง 4 อัน`
* หน้าตัวอย่างเอกสาร (ก่อนดาวน์โหลด) — ขึ้นบรรทัดเตือนด้วยจำนวนเดียวกัน
  (จำนวนนับจาก `Extract.countFields()` = จำนวนย่อหน้าที่มี `{{field}}` นั้น)

กลไกที่ใช้

```text
1. โครงตาราง (จำนวนคอลัมน์ / ชื่อหัวคอลัมน์) เก็บไปกับ template ในฐานข้อมูล
   (คอลัมน์ tables) — ใช้ตั้งต้นให้หน้ารายงานวาดตาราง
2. ค่าที่กรอกของตารางไม่ใช่ข้อความ จึงส่งไปกับ getTableValues() แยกจาก values
   แล้ว replace.js สร้าง w:tbl เองทั้งหมด
3. ช่องที่ผสานในแถวข้อมูลเขียนเป็น w:gridSpan ให้ Word รวมช่องให้จริง
   ขนาดกลุ่มช่องของแต่ละแถวส่งไปกับ rowSpans (1 = ไม่ผสาน)
4. ความกว้างคอลัมน์คิดจากความกว้างเนื้อเรื่องของ section (อ่านจาก w:sectPr)
   แบ่งตามสัดส่วน (ratio) ที่ตั้งไว้ในหน้า Template Configuration — เว้นว่าง = แบ่งเท่ากัน
   (ช่องที่ผสานกว้างเท่าผลรวมของคอลัมน์ที่รวมกัน)
   หัวตารางเป็นตัวหนา และใช้ฟอนต์/ขนาดจาก run ของ {{field}} ใน template
5. ถ้าไม่มีแถวเลย ระบบจะไม่แตะ {{field}} (ยังเห็นว่า "ไม่ได้กรอก")
```

---

## Planned Database Structure

โครงสร้าง Database จะถูกออกแบบในขั้นตอนถัดไป

แนวคิดเบื้องต้น:

```text
templates
├── id
├── name
├── description
├── file_name
├── file_data
├── created_at
└── updated_at
```

> Schema นี้ยังเป็น Draft และจะถูกตรวจสอบก่อนสร้างจริง

---

## Planned Features

### Template Management

* [ ] เพิ่ม Word Template
* [ ] แก้ไข Template
* [ ] ลบ Template
* [ ] ดูรายการ Template
* [ ] Preview Template
* [ ] ค้นหา Template

### Template Fields

* [ ] ตรวจหา Placeholder ใน `.docx`
* [ ] แสดงรายการ Field
* [ ] กำหนด Type ของ Field
* [ ] รองรับ Text
* [ ] รองรับ Number
* [ ] รองรับ Date
* [ ] รองรับ Boolean

ตัวอย่าง:

```text
{{customer_name}}
{{company_name}}
{{document_date}}
{{amount}}
```

### Document Generation

* [ ] กรอกข้อมูลจาก Template
* [ ] Replace Placeholder
* [ ] Generate `.docx`
* [ ] Save Generated Document
* [ ] Download / Export Document

### Future Features

* [ ] Template Categories
* [ ] Template Versioning
* [ ] Field Validation
* [ ] Preview ก่อน Generate
* [ ] Export PDF
* [ ] Batch Document Generation

---

## Security

Renderer ไม่ควรมีสิทธิ์เข้าถึง Node.js API โดยตรง

จึงใช้:

```javascript
contextIsolation: true
nodeIntegration: false
```

Renderer จะเรียกความสามารถของ Electron ผ่าน API ที่เปิดให้ผ่าน `preload.cjs` เท่านั้น

ตัวอย่าง:

```javascript
window.electronAPI.getAppInfo();
```

และ:

```text
Renderer
   ↓
window.electronAPI
   ↓
preload.cjs
   ↓
ipcRenderer
   ↓
main.cjs
```

---

## Development Principle

โปรเจกต์นี้ตั้งใจแยก Responsibility ให้ชัดเจน:

### Renderer

รับผิดชอบ:

* UI
* Form
* User Interaction
* Display Data

### Preload

รับผิดชอบ:

* Expose API ที่อนุญาตให้ Renderer ใช้

### Main Process

รับผิดชอบ:

* Electron Window
* IPC
* Application-level operations
* ประสานงานกับ Worker

### DB Worker

รับผิดชอบ:

* SQLite
* Database Query
* Database Transaction
* Database Initialization

### File System

รับผิดชอบ:

* อ่าน/เขียน `.docx`
* จัดการไฟล์ Template
* จัดการไฟล์ Generated Document

---

## Development Roadmap

```text
Phase 1
Electron + Vite + IPC + Worker
        ↓
      DONE
        │
        ▼
Phase 2
SQLite Database
        │
        ├── Database Schema
        ├── Initialize DB
        ├── Template CRUD
        └── Template File Storage
        │
        ▼
Phase 3
DOCX Template Parser
        │
        ├── Read .docx
        ├── Find {{fields}}
        └── Validate Fields
        │
        ▼
Phase 4
Document Generator
        │
        ├── Input Data
        ├── Replace Fields
        └── Generate .docx
        │
        ▼
Phase 5
Desktop UI
        │
        ├── Template List
        ├── Template Editor
        ├── Data Form
        └── Document Preview
        │
        ▼
Phase 6
Production Build
        │
        ├── Windows Installer
        ├── Portable Version
        └── Application Data
```

---

## NPM Scripts

```text
npm run dev
```

Start Vite development server

```text
npm run electron
```

Start Electron

```text
npm run dev:electron
```

Start Vite และ Electron พร้อมกัน

```text
npm run build
```

Build Renderer สำหรับ Production (ออกไปที่ `dist/`)

```text
npm run build:exe
```

Build Renderer แล้ว package เป็น `.exe` (portable) ที่โฟลเดอร์ `release/`

---

## Production (.exe)

### ทางลัด: build script (PowerShell)

`scripts/build-exe.ps1` ทำงานแทนขั้นตอนทั้งหมดข้างบนให้อัตโนมัติ

```powershell
# build ปกติ -> release\Word Template Filler 1.0.0.exe
npm run build:exe:ps

# build ใหม่หมด (ลบ dist/ + โฟลเดอร์ปลายทางก่อน)
npm run build:exe:ps -- -Clean

# ปิดโปรแกรมที่รันอยู่อัตโนมัติก่อน build
npm run build:exe:ps -- -KillRunning

# build ทดสอบ ไปโฟลเดอร์อื่น (ไม่ทับ release/ ที่โปรแกรมกำลังเปิดอยู่)
npm run build:exe:ps -- -OutputDir release-test
```

สคริปต์ทําให้ 5 ขั้น:

```text
1. หา Node 22.12+ ที่ใช้ build ได้ (ถ้า node ใน PATH เก่า จะหาเวอร์ชันอื่นให้เอง)
2. เช็คว่าโปรแกรมไม่ได้รันอยู่ (ไฟล์ .exe ถูก lock)
3. npm run build        -> dist/
4. electron-builder     -> <output>/Word Template Filler 1.0.0.exe
5. ตรวจผลลัพธ์ (asar, native module, css path, jszip)
```

ข้อควรรู้: build ไม่ได้ถ้าเปิด `.exe` ค้างไว้ เพราะ Windows ล็อกไฟล์
ให้ปิดหน้าต่างโปรแกรมก่อน หรือใช้ `-KillRunning` หรือ `-OutputDir release-test`

### ตำแหน่งข้อมูล (SQLite)

```text
Development           -> <project>/data/templates.db
Portable .exe         -> <โฟลเดอร์ของ .exe>/data/templates.db
โฟลเดอร์เขียนไม่ได้    -> userData/data/templates.db
```

Renderer ไม่ต้องแก้อะไร ทั้ง dev และ .exe ใช้ `window.electronAPI` ชุดเดียวกัน
เพราะตำแหน่งไฟล์ถูกคำนวณจากฝั่ง Main Process แล้วส่งต่อให้ DB Worker

### หมายเหตุเรื่อง asar

`dist/` ถูก pack เข้า `app.asar` แต่ `.node` และ DB Worker จะโหลดจากใน asar
โดยตรงไม่ได้ จึงต้องมี `asarUnpack` ใน `package.json`

```json
"asarUnpack": [
  "**/*.node",
  "src/main/db/**"
]
```

และ `vite.config.js` ต้อง build ด้วย `base: "./"` เพื่อให้ path ของ CSS
เป็นแบบ relative เพราะหน้าเว็บถูกเปิดด้วย `file://` ไม่ใช่ http server

---

## License

Private / Internal Project
