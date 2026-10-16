// Database Page - สำรอง / ย้ายฐานข้อมูลไปเครื่องอื่น (อยู่ในหมวด "ประวัติและการตั้งค่า")
//
// ข้อมูลทั้งหมดของแอป (แม่แบบ · ข้อมูลหลัก · คำที่เพิ่มเอง · ประวัติการกรอก)
// ถูกเก็บรวมไว้ในไฟล์ฐานข้อมูลไฟล์เดียวชื่อ templates.db
// ตำแหน่งไฟล์เป็นเรื่องของแอป (dev = <project>/data, .exe พกพา = <โฟลเดอร์ .exe>/data,
// ติดตั้งด้วย Setup = userData/data) ผู้ใช้จึงไม่ต้องไปยุ่งกับ path เอง
//
//   ดาวน์โหลดฐานข้อมูล = สำเนาฐานข้อมูลทั้งไฟล์ไปเก็บในโฟลเดอร์ Downloads
//                        (สำรองไว้ หรือเอาไฟล์ไปใส่ที่เครื่องอื่น)
//   อัปโหลดฐานข้อมูล   = เอาไฟล์จากเครื่องอื่นมาแทนที่ฐานข้อมูลเดิมทั้งไฟล์
//
// ตอนอัปโหลดจะตรวจไฟล์ก่อนทุกครั้ง (เป็น SQLite ของแอปนี้จริง + integrity_check ผ่าน)
// และไฟล์ที่เลือกจะถูกเปลี่ยนชื่อเป็น templates.db ให้เอง ไม่ว่าไฟล์ต้นทางจะชื่ออะไร
// เพราะแอปอ้างชื่อไฟล์นี้ตายตัว
//
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงประกาศ standalone = true (เหมือนหน้า Master Data)
(function (scope) {
    'use strict';

    // ป้ายกำกับของจำนวนข้อมูลแต่ละตาราง (คีย์มาจาก db-worker.cjs)
    const COUNT_LABELS = [
        { key: 'templates', label: 'แม่แบบ' },
        { key: 'master', label: 'ข้อมูลหลัก' },
        { key: 'words', label: 'คำที่เพิ่มเอง' },
        { key: 'history', label: 'ประวัติการกรอก' }
    ];

    const HTML = [
        '<h1>ฐานข้อมูล</h1>',

        '<section class="master-tools">',
        '    <h2>ไฟล์ฐานข้อมูลของแอป</h2>',

        '    <p class="hint">',
        '        ข้อมูลทั้งหมดของแอปถูกเก็บรวมไว้ในไฟล์เดียว (ฐานข้อมูล SQLite)',
        '        ไฟล์นี้คือสิ่งที่ต้องสำรองไว้ก่อนติดตั้งเครื่องใหม่ หรือตอนย้ายไปใช้ที่อื่น',
        '    </p>',

        '    <div class="db-file-info">',
        '        <p><span class="db-file-label">ตำแหน่งไฟล์</span>',
        '            <span id="databasePath">กำลังอ่าน...</span></p>',
        '        <p><span class="db-file-label">ขนาดไฟล์</span>',
        '            <span id="databaseSize">-</span></p>',
        '        <p><span class="db-file-label">ข้อมูลในไฟล์</span>',
        '            <span id="databaseCounts">-</span></p>',
        '    </div>',

        '    <p id="databaseStatus" class="db-status"></p>',
        '</section>',

        '<section class="master-tools">',
        '    <h2>สำรอง / ย้ายเครื่อง</h2>',

        '    <p class="hint">',
        '        <strong>ดาวน์โหลดฐานข้อมูล</strong> = ได้ไฟล์สำเนาฐานข้อมูลไปเก็บไว้',
        '        (เก็บสำรอง หรือเอาไปใช้ที่เครื่องอื่น)<br>',
        '        <strong>อัปโหลดฐานข้อมูล</strong> = เอาไฟล์ฐานข้อมูลจากเครื่องอื่น',
        '        มาแทนที่ข้อมูลเดิมทั้งหมด',
        '    </p>',

        '    <div class="form-actions page-actions">',
        '        <button id="databaseExportBtn" type="button">ดาวน์โหลดฐานข้อมูล</button>',
        '        <button id="databaseImportBtn" type="button" class="danger">',
        '            อัปโหลดฐานข้อมูล</button>',
        '        <input type="file" id="databaseImportInput" accept=".db,.sqlite,.sqlite3" hidden>',
        '    </div>',

        '    <p class="hint">',
        '        ตอนอัปโหลด ระบบจะตรวจว่าไฟล์เป็นฐานข้อมูลของแอปนี้จริง และถามยืนยันก่อนทุกครั้ง',
        '        — ข้อมูลเดิมทั้งหมด (แม่แบบ ข้อมูลหลัก คำที่เพิ่มเอง ประวัติ) จะถูกแทนที่ทันที',
        '        และไฟล์ที่เลือกจะถูกเปลี่ยนชื่อเป็น templates.db ให้เอง',
        '    </p>',

        '    <p id="databaseImportStatus" class="db-status"></p>',
        '</section>'
    ].join('\n');

    function el(id) {
        return document.getElementById(id);
    }

    // 1.5 MB / 2.8 MB / 512 KB
    function formatSize(bytes) {
        const value = Number(bytes) || 0;

        if (value < 1024) {
            return value + ' B';
        }

        if (value < 1024 * 1024) {
            return (value / 1024).toFixed(1) + ' KB';
        }

        return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function describeCounts(counts) {
        const data = counts || {};

        return COUNT_LABELS
            .map(function (item) {
                return item.label + ' ' + (Number(data[item.key]) || 0);
            })
            .join(' · ');
    }

    function setStatus(id, text, kind) {
        const status = el(id);
        if (!status) return;

        status.textContent = text || '';
        status.className =
            'db-status' +
            (kind ? ' ' + kind : '');
    }

    // ปิดปุ่มชั่วคราวระหว่างทำงาน (กันกดซ้ำ)
    function setBusy(busy) {
        ['databaseExportBtn', 'databaseImportBtn'].forEach(function (id) {
            const button = el(id);
            if (button) button.disabled = !!busy;
        });
    }

    // อ่านสถานะจริงของไฟล์ฐานข้อมูล (แสดงบนหัวหน้า)
    async function refresh() {
        if (!el('databasePath')) return;

        try {
            const info = await scope.Db.info();

            el('databasePath').textContent = info.dbPath || '-';
            el('databaseSize').textContent = formatSize(info.byteLength);
            el('databaseCounts').textContent = describeCounts(info.counts);

            return info;

        } catch (error) {
            el('databasePath').textContent = '-';
            el('databaseSize').textContent = '-';
            el('databaseCounts').textContent = '-';

            setStatus(
                'databaseStatus',
                'อ่านข้อมูลฐานข้อมูลไม่สำเร็จ: ' + error.message,
                'error'
            );

            return null;
        }
    }

    // ── ดาวน์โหลดฐานข้อมูล ──

    async function exportDatabase() {
        setBusy(true);
        setStatus('databaseStatus', 'กำลังเตรียมไฟล์ฐานข้อมูล...');

        try {
            const saved = await scope.Db.exportDatabase();

            setStatus(
                'databaseStatus',
                'บันทึกไฟล์ฐานข้อมูลแล้ว: ' + saved.fileName +
                ' (' + formatSize(saved.byteLength) + ') → ' + saved.filePath,
                'ok'
            );

            const success = el('databaseExportSuccess');
            if (success) {
                success.textContent = 'บันทึกไฟล์ฐานข้อมูลแล้ว: ' + saved.fileName +
                    ' (' + formatSize(saved.byteLength) + ') → ' + saved.filePath;
                success.className = 'db-status ok';
                success.style.display = 'block';
            }

            await refresh();

        } catch (error) {
            console.error(error);

            setStatus(
                'databaseStatus',
                'ดาวน์โหลดฐานข้อมูลไม่สำเร็จ: ' + error.message,
                'error'
            );

            const success = el('databaseExportSuccess');
            if (success) {
                success.textContent = '';
                success.className = 'db-status error';
                success.style.display = 'block';
            }

            await scope.AppDialog.alert(
                'ดาวน์โหลดฐานข้อมูลไม่สำเร็จ: ' + error.message
            );

        } finally {
            setBusy(false);
        }
    }

    // ── อัปโหลดฐานข้อมูล (แทนที่ของเดิม) ──

    function pickImportFile() {
        const input = el('databaseImportInput');
        if (input) input.click();
    }

    async function onImportFileChosen(event) {
        const input = event.target;
        const file = input.files && input.files[0];

        // ล้างค่า input ทันที เพื่อให้เลือกไฟล์เดิมซ้ำได้ (และเมื่อกดยกเลิก)
        input.value = '';

        if (!file) return;

        setBusy(true);
        setStatus(
            'databaseImportStatus',
            'กำลังตรวจไฟล์ ' + (file.name || '') + '...'
        );

        try {
            const bytes =
                new Uint8Array(
                    await file.arrayBuffer()
                );

            // ตรวจไฟล์ก่อนแตะฐานข้อมูลเดิม (ไฟล์ถูกเก็บชั่วคราวในโฟลเดอร์ data)
            const prepared = await scope.Db.prepareImport({ data: bytes });

            const current = await refresh();

            const confirmed = await scope.AppDialog.confirm(
                'นำเข้าฐานข้อมูลจากไฟล์ "' + (file.name || '') + '"' +
                ' (' + formatSize(prepared.byteLength) + ')?\n\n' +
                'ไฟล์ที่เลือกมี: ' + describeCounts(prepared.counts) + '\n' +
                'ข้อมูลปัจจุบัน: ' +
                describeCounts(current && current.counts) + '\n\n' +
                'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ทันที ' +
                '(กู้คืนจากในแอปไม่ได้)\n' +
                'ต้องการดำเนินการต่อหรือไม่?',
                {
                    title: 'ยืนยันการนำเข้าฐานข้อมูล',
                    okText: 'แทนที่ฐานข้อมูล',
                    danger: true
                }
            );

            if (!confirmed) {
                await scope.Db.discardImport();

            setStatus(
                'databaseImportStatus',
                'ยกเลิกการนำเข้าฐานข้อมูล — ข้อมูลเดิมไม่ถูกแตะ',
                'warn'
            );

                return;
            }

            const result = await scope.Db.applyImport();

            // ข้อมูลในหน่วยความจำ (รายการแม่แบบ/ข้อมูลหลัก/คำ/ประวัติ)
            // เป็นของฐานข้อมูลเก่า — ต้องล้างแล้วอ่านใหม่ทั้งหมด
            if (scope.App && scope.App.reloadAllData) {
                scope.App.reloadAllData();
            }

            await refresh();

            setStatus(
                'databaseImportStatus',
                'นำเข้าฐานข้อมูลแล้ว: ' + describeCounts(result.counts) +
                ' (' + formatSize(result.byteLength) + ')',
                'ok'
            );

        } catch (error) {
            console.error(error);

            setStatus(
                'databaseImportStatus',
                'นำเข้าฐานข้อมูลไม่สำเร็จ: ' + error.message,
                'error'
            );

            await scope.AppDialog.alert(
                'นำเข้าฐานข้อมูลไม่สำเร็จ: ' + error.message +
                '\n\nข้อมูลเดิมยังอยู่ครบ'
            );

            const success = el('databaseExportSuccess');
            if (success) {
                success.textContent = '';
                success.className = 'db-status';
                success.style.display = 'none';
            }

        } finally {
            setBusy(false);
        }
    }

    scope.DatabasePage = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับ state ของไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        refresh: refresh,
        exportDatabase: exportDatabase,
        pickImportFile: pickImportFile,
        onImportFileChosen: onImportFileChosen
    };
})(window);
