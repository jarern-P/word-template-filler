ได้ครับ อธิบายจากของจริงในโปรเจกต์นี้เลย

0) สิ่งที่ต้องมี

- Node.js 22.12+ (สำคัญ — ดูข้อ 1)
- อินเทอร์เน็ตครั้งแรก (electron-builder จะโหลด Electron zip มาแคชไว้ ครั้งต่อไปไม่ต้องโหลด)

1) เช็ค Node ก่อนทุกครั้ง

// bash
node -v

ถ้าได้  v20.18.0  (ซึ่งเป็นค่าเริ่มต้นในเครื่องคุณ) ให้สลับไป v22.23.2 ที่ติดตั้งอยู่แล้ว:

// bash
# Git Bash
export PATH="/c/Program Files/nodejs:$PATH"
node -v      # ต้องได้ v22.23.2

// powershell
# PowerShell
$env:Path = "C:\Program Files\nodejs;" + $env:Path

ถ้าใช้ nvm ให้  nvm use 22.23.2  (แต่ nvm ยังไม่อยู่ใน PATH ของ Git Bash บนเครื่องนี้)
> ถ้าใช้ Node ต่ำกว่า 22.12 →  vite build  จะเตือน และ  electron-builder  จะล้มด้วย  ERR_REQUIRE_ESM 


2) มี 2 คำสั่ง build คนละระดับ

┌───────────────────┬──────────────────────────────────┬────────────────────────────────────────┐
│ คำสั่ง               │ ทำอะไร                            │ ผลลัพธ์                                  │
├───────────────────┼──────────────────────────────────┼────────────────────────────────────────┤
│ npm run build     │ Vite build แค่ฝั่ง renderer         │ dist/                                  │
│ npm run build:exe │ npm run build + electron-builder │ release/Word Template Filler 1.0.0.exe │
└───────────────────┴──────────────────────────────────┴────────────────────────────────────────┘

⚠️  npm run build  อย่างเดียว ไม่ได้ .exe ครับ

3) เบื้องหลังตอนรัน  npm run build:exe 

1. Vite อ่าน  vite.config.js : root =  src/renderer , publicDir =  public ,  base: "./"  (เพื่อให้เปิดด้วย  file://  ได้)
→ ได้  dist/index.html ,  dist/assets/*.css ,  dist/vendor/jszip.min.js  และคัดลอก  public/*.js  ทั้งหมดลง  dist/ 
2. @electron/rebuild build  better-sqlite3  ให้ตรงกับ Electron 44
3. electron-builder อ่าน config ใน  package.json  ( "build" ) → ยัด  dist/ ,  src/main/ ,  package.json  เข้า  app.asar 
และย้าย  .node  +  src/main/db/  ออกมาเป็นไฟล์จริงที่  app.asar.unpacked/  (ใน asar โหลด native module กับ worker ไม่ได้)
4. ได้ 2 อย่าง:  release/win-unpacked/  (ไว้ debug) และ  release/Word Template Filler 1.0.0.exe  (portable ไฟล์เดียว)

4) ลองรัน + ดูว่าพังตรงไหน

// bash
# แบบ portable (ไฟล์เดียวจบ) ข้อมูลจะอยู่ข้างไฟล์ exe
"./release/Word Template Filler 1.0.0.exe"
 
# แบบ unpacked (เปิด log เห็น console.log ของ main process)
ELECTRON_ENABLE_LOGGING=1 "./release/win-unpacked/Word Template Filler.exe"

สิ่งที่ควรเห็นใน log = แปลว่า DB ทำงาน:

// text
Data path: ...\release\win-unpacked\data
DB data path: ...
SQLite database opened:
DB Worker: ready

5) Workflow ประจำวัน

// bash
npm run dev:electron   # ทำงาน/แก้ UI → ไม่ต้อง build, ไม่ต้องแตะ exe
npm run build:exe      # จะแจก/ทดสอบ .exe ค่อยรัน

- ข้อมูลตอน dev →  <project>/data/templates.db 
- ข้อมูลตอนรัน .exe →  <โฟลเดอร์ของ .exe>/data/templates.db  (คนละอันกัน ไม่ทับกัน)
- แก้โค้ด renderer ให้แก้ที่  public/  ( dist/  ถูกลบใหม่ทุกครั้งที่ build)

6) ปัญหาที่เจอบ่อย

┌─────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
│ อาการ                               │ สาเหตุ / วิธีแก้                                                                        │
├─────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ ERR_REQUIRE_ESM ตอน build exe       │ Node ต่ำกว่า 22.12 → ข้อ 1                                                              │
│ Port 5173 is already in use         │ มี dev server ค้าง ปิดตัวเก่าก่อน (config ตั้ง strictPort: true)                            │
│ อยากได้ build สะอาด ๆ                │ rm -rf dist release แล้ว npm run build:exe                                           │
│ exe เปิดแล้วไม่มี CSS                   │ เช็คว่า dist/index.html อ้าง ./assets/... ไม่ใช่ /assets/...                             │
│ แก้ "build" ใน package.json แล้วไม่มีผล │ ต้อง npm run build:exe ใหม่ (config ถูกอ่านตอน build)                                   │
│ อยากเปลี่ยนชื่อ/ไอคอน                   │ build.productName และ build.win.icon ใน package.json (ตอนนี้ยังใช้ไอคอน Electron เริ่มต้น) │
└─────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────┘

สรุปสั้น ๆ: เปิด terminal →  export PATH  ให้เป็น Node 22 →  npm run build:exe  → ได้ไฟล์ที่  release/  ครับ



เสร็จแล้วครับ ได้  scripts/build-exe.ps1  ที่ทำงานทั้ง 5 ขั้นให้ + เช็คให้ด้วยว่าอะไรทำให้ build ค้าง

วิธีใช้

// powershell
# build ปกติ -> release\Word Template Filler 1.0.0.exe
npm run build:exe:ps
 
# ลบ dist/ + โฟลเดอร์ปลายทางก่อน build
npm run build:exe:ps -- -Clean
 
# ปิดโปรแกรมที่รันอยู่อัตโนมัติก่อน build
npm run build:exe:ps -- -KillRunning
 
# build ทดสอบไปโฟลเดอร์อื่น (ไม่ทับ release/ ที่โปรแกรมกำลังเปิด)
npm run build:exe:ps -- -OutputDir release-test

สคริปต์ทำอะไร

┌───────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ขั้น    │ รายละเอียด                                                                                                                  │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [1/5] │ หา Node 22.12+ ให้เอง — สแกน PATH, Program Files\nodejs, nvm ทุกเวอร์ชัน แล้วเลือกตัวใหม่สุด (เครื่องคุณ: เลือก 22.23.2, ข้าม            │
│       │ 20.18.0/18.10.0)                                                                                                           │
│ [2/5] │ เช็คว่าโปรแกรมไม่ได้รันอยู่ (ไฟล์ .exe ถูก lock)                                                                                    │
│ [3/5] │ vite build → dist/                                                                                                         │
│ [4/5] │ electron-builder --win portable                                                                                            │
│ [5/5] │ ตรวจผล: app.asar, worker นอก asar, better-sqlite3, CSS path relative, jszip                                                │
└───────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

ขั้น  [5/5]  จะขึ้นแบบนี้:

// text
BUILD SUCCESS
  exe  : ...\release\Word Template Filler 1.0.0.exe
  size : 103.0 MB
  time : 2026-09-13 22:43:11

สาเหตุที่ build ค้าง 10 นาที (แก้แล้ว)

คุณเปิด  release\Word Template Filler 1.0.0.exe  ค้างไว้ทิ้ง (PID 5768, 7820, 13408, 15408) → Windows ล็อกไฟล์ → electron-builder เขียนทับไม่ได้แล้วรอเงียบ ๆ สคริปต์เลยเพิ่มการเช็คนี้:

// text
[2/5] checking for a running app instance
      locked : ...\release\Word Template Filler 1.0.0.exe
 
ERROR: the app is running, so the .exe cannot be overwritten.
       close the app window and run again, or pass -KillRunning
       test build without touching it: -OutputDir release-test

ตอนนี้คุณยังเปิดโปรแกรมค้างอยู่ → ปิดหน้าต่างโปรแกรมก่อน (หรือใช้  -KillRunning ) แล้ว  npm run build:exe:ps  จะผ่านทันที (ผมทดสอบ build เต็มไปที่  release-test  แล้วสำเร็จ ทุกอย่าง OK จึงลบโฟลเดอร์ทดสอบทิ้งแล้ว)

หมายเหตุ

1. ผมยังไม่ปิดโปรแกรมของคุณ เพราะกลัวข้อมูลในฟอร์มที่พิมพ์ค้างไว้หาย — ปิดเองหรือสั่ง  -KillRunning  ได้เลย
2.  .exe  ที่คุณเปิดอยู่สร้างตอน 22:11 (ก่อนผมลบโค้ดตายใน  app.js ) → build ใหม่จะได้ตัวล่าสุด
3. ข้อความในสคริปต์เป็นอังกฤษล้วน โดยตั้งใจ เพราะ PowerShell 5.1 อ่าน  .ps1  ด้วย codepage ANSI → ถ้าใส่ภาษาไทยจะกลายเป็นตัวขยะ
4. ใน  release\data\  คือ DB ของคุณจากการเปิด portable exe — ผมไม่แตะ
5. เจอไฟล์  public/ิmanual-build.md  (จากที่คุณเซฟคำตอบผมตอน 22:18) — ตอนนี้มันอยู่ใน  public/  เลยจะติดไปกับ  .exe  ด้วย