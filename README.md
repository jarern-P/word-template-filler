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
│   └── renderer/
│       ├── index.html
│       ├── app.js
│       └── style.css
│
├── vite.config.js
├── package.json
├── package-lock.json
└── README.md
```

---

## Development Environment

### Node.js

โปรเจกต์นี้พัฒนาบน Node.js 22

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
```

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

Build Renderer สำหรับ Production

---

## License

Private / Internal Project
