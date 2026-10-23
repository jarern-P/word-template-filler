// จับคู่หน้า OCR กับ "ผังหน้า" ที่เคยอ่านไว้ (ตาราง ocr_blueprints)
//
// ทำไมต้องมี:
//   หน้าเอกสารรูปแบบเดิม (ฟอร์มราชการ/ตารางหลายคอลัมน์) ถูกอ่านซ้ำทุกวัน
//   tesseract อ่านคำของแต่ละคอลัมน์ปนกัน จึงต้องมีคนสอนลำดับการอ่านทุกครั้ง
//   ผังหน้าที่เก็บไว้จำ "ลำดับบรรทัดที่ถูกต้อง" ของหน้านั้นไว้แล้ว
//   หน้าใหม่ที่หน้าตาเหมือนเดิมจึงใช้ลำดับนั้นได้ทันที — โดยไม่ต้องใช้ AI
//
// หลักการ:
//   1. จับคู่ด้วยสัดส่วนหน้า (aspect) ก่อน — ต้องใกล้กันมากพอ
//   2. เทียบกล่องบรรทัดทีละกล่อง (พิกัดสัดส่วน 0-1) ว่าตำแหน่งตรงกับผังเดิม
//      ต้องตรงกันมากพอทั้งจำนวนและตำแหน่ง จึงถือว่าเป็นหน้าแบบเดียวกัน
//   3. เรียงบรรทัดใหม่ตามลำดับในผัง (คอลัมน์ซ้ายบน → ล่าง → คอลัมน์ถัดไป)
//      บรรทัดที่ผังไม่มี (เช่น ตราประทับ/ค่าที่เพิ่งเพิ่ม) แทรกตามตำแหน่งใกล้เคียง
//
// ถ้าหน้าไหนไม่คล้ายผังใดเลย จะคืน null — ผู้เรียกใช้ลำดับเดิมของ tesseract ต่อ
// (ไม่มีทางทำให้หน้าที่ไม่รู้จักอ่านแย่ลง)
'use strict';

// จำนวนบรรทัดน้อยสุดที่ยอมให้จับคู่ (หน้าน้อยบรรทัดจับคู่ผิดง่าย)
const MIN_LINES = 4;

// สัดส่วนหน้าต้องต่างกันไม่เกิน 6% (เท่าเกณฑ์จับคู่ลำดับคอลัมน์ที่ฝึกไว้)
const MAX_ASPECT_DIFF = 0.06;

// ระยะห่างสูงสุดระหว่างจุดกลางกล่อง (หน่วยสัดส่วนของหน้า)
const MAX_CENTER_DISTANCE = 0.06;

// จำนวนบรรทัดที่ต้องตรงกัน (เทียบกับบรรทัดของหน้าใหม่)
const MIN_COVERAGE = 0.7;

// จำนวนบรรทัดสองฝั่งต้องไม่ต่างกันเกินสัดส่วนนี้
const MIN_LINE_RATIO = 0.55;

function round4(value) {
    return Math.round(Number(value) * 10000) / 10000;
}

// แปลงผังเป็นกล่องครั้งเดียวต่อการอ่านไฟล์หนึ่งครั้ง
// (ผังชุดเดียวกันถูกใช้ซ้ำทุกหน้า — ไม่ต้องสร้างกล่องใหม่ 500 รอบต่อหน้า)
const entryCache = new WeakMap();

// กล่องจากผังที่เก็บไว้ (x/y/w/h เป็นสัดส่วนของหน้าแล้ว)
function blueprintEntries(blueprint) {
    if (blueprint && typeof blueprint === "object") {
        const cached = entryCache.get(blueprint);

        if (cached) return cached;
    }

    const lines = Array.isArray(blueprint && blueprint.lines)
        ? blueprint.lines
        : [];

    const entries = [];

    lines.forEach(function (line, index) {
        const x = Number(line && line.x);
        const y = Number(line && line.y);
        const w = Number(line && line.w);
        const h = Number(line && line.h);

        if (![x, y, w, h].every(isFinite)) return;
        if (!(w > 0) || !(h > 0)) return;

        entries.push({
            order: index,
            x: x,
            y: y,
            w: w,
            h: h,
            cx: x + w / 2,
            cy: y + h / 2
        });
    });

    if (blueprint && typeof blueprint === "object") {
        entryCache.set(blueprint, entries);
    }

    return entries;
}

// กล่องของบรรทัดปัจจุบัน (พิกัด pixel ของภาพตัวอย่าง → สัดส่วนของหน้า)
function lineBox(line, width, height) {
    if (!(width > 0) || !(height > 0)) return null;

    const left = Number(line && line.left);
    const right = Number(line && line.right);
    const top = Number(line && line.top);
    const bottom = Number(line && line.bottom);

    if (![left, right, top, bottom].every(isFinite)) return null;

    const x = round4(left / width);
    const y = round4(top / height);
    const w = round4((right - left) / width);
    const h = round4((bottom - top) / height);

    if (!(w > 0) || !(h > 0)) return null;

    return {
        x: x,
        y: y,
        w: w,
        h: h,
        cx: x + w / 2,
        cy: y + h / 2
    };
}

function nearestEntry(entries, box) {
    let nearest = null;
    let best = Infinity;

    entries.forEach(function (entry) {
        const distance = Math.hypot(entry.cx - box.cx, entry.cy - box.cy);

        if (distance < best) {
            best = distance;
            nearest = entry;
        }
    });

    return { entry: nearest, distance: best };
}

/**
 * หาผังหน้าที่ตรงกับหน้านี้
 *
 * @param {Array} blueprints [{ aspect, lines: [{x,y,w,h}] }]
 * @param {number} width ความกว้างภาพตัวอย่าง (px)
 * @param {number} height ความสูงภาพตัวอย่าง (px)
 * @param {Array} lines บรรทัดที่ OCR ได้ (ต้องมี left/right/top/bottom)
 * @returns {Object|null} { blueprint, entries, boxes, coverage } สำหรับส่งต่อให้ orderLinesByBlueprint
 */
function findBlueprint(blueprints, width, height, lines) {
    if (!Array.isArray(blueprints) || blueprints.length === 0) return null;
    if (!(width > 0) || !(height > 0)) return null;

    const boxes = (Array.isArray(lines) ? lines : [])
        .map(function (line) {
            return lineBox(line, width, height);
        })
        .filter(Boolean);

    if (boxes.length < MIN_LINES) return null;

    const aspect = height / width;

    let best = null;

    blueprints.forEach(function (blueprint) {
        const storedAspect = Number(blueprint && blueprint.aspect);

        if (!isFinite(storedAspect) || storedAspect <= 0) return;
        if ((storedAspect > 1) !== (aspect > 1)) return;

        const aspectDiff = Math.abs(storedAspect - aspect) / storedAspect;

        if (aspectDiff > MAX_ASPECT_DIFF) return;

        // กรองด้วยจำนวนบรรทัดก่อนสร้างกล่อง — ผังที่ไม่ใกล้เคียงจะถูกข้ามเร็ว
        const rawLines = Array.isArray(blueprint.lines) ? blueprint.lines : [];

        if (rawLines.length < MIN_LINES) return;

        const rawRatio =
            Math.min(rawLines.length, boxes.length) /
            Math.max(rawLines.length, boxes.length);

        if (rawRatio < MIN_LINE_RATIO) return;

        const entries = blueprintEntries(blueprint);

        if (entries.length < MIN_LINES) return;

        let matched = 0;
        let distanceSum = 0;

        boxes.forEach(function (box) {
            const nearest = nearestEntry(entries, box);

            if (nearest.distance <= MAX_CENTER_DISTANCE) {
                matched += 1;
                distanceSum += nearest.distance;
            }
        });

        const coverage = boxes.length > 0 ? matched / boxes.length : 0;

        if (coverage < MIN_COVERAGE) return;

        // ตรงมากกว่า + ระยะใกล้กว่า = ดีกว่า (หักสัดส่วนหน้าที่ต่างกันเล็กน้อย)
        const score =
            coverage -
            (matched > 0 ? distanceSum / matched : 0) * 2 -
            aspectDiff;

        if (!best || score > best.score) {
            best = {
                blueprint: blueprint,
                entries: entries,
                boxes: boxes,
                coverage: coverage,
                score: score
            };
        }
    });

    return best ? {
        blueprint: best.blueprint,
        entries: best.entries,
        boxes: best.boxes,
        coverage: best.coverage
    } : null;
}

/**
 * เรียงบรรทัดใหม่ตามลำดับในผัง
 *
 * บรรทัดที่ผังไม่มีจะถูกแทรกตามตำแหน่งใกล้เคียง (ก่อน/หลังกล่องที่ใกล้ที่สุด)
 * บรรทัดที่ไม่มีพิกัด (จับกล่องไม่ได้) ต่อท้ายตามลำดับเดิม
 *
 * @param {Object} match ผลจาก findBlueprint
 * @param {Array} lines บรรทัดเดียวกับที่ส่งให้ findBlueprint
 * @param {number} width
 * @param {number} height
 * @returns {{lines:Array, applied:boolean, matched:number}}
 */
function orderLinesByBlueprint(match, lines, width, height) {
    const source = Array.isArray(lines) ? lines : [];

    if (!match || !Array.isArray(match.entries)) {
        return { lines: source, applied: false, matched: 0 };
    }

    const anchors = [];
    const unmatched = [];

    source.forEach(function (line, index) {
        const box = lineBox(line, width, height);

        if (!box) return;

        const nearest = nearestEntry(match.entries, box);

        if (nearest.entry && nearest.distance <= MAX_CENTER_DISTANCE) {
            anchors.push({
                index: index,
                order: nearest.entry.order,
                box: box
            });
            return;
        }

        unmatched.push({ index: index, box: box });
    });

    if (anchors.length < MIN_LINES) {
        return { lines: source, applied: false, matched: anchors.length };
    }

    anchors.sort(function (a, b) {
        return a.order - b.order || a.box.cy - b.box.cy;
    });

    const keyed = anchors.map(function (anchor) {
        return {
            index: anchor.index,
            key: anchor.order,
            y: anchor.box.cy
        };
    });

    const firstOrder = anchors[0].order;
    const lastOrder = anchors[anchors.length - 1].order;
    const topY = Math.min.apply(null, anchors.map(a => a.box.cy));
    const bottomY = Math.max.apply(null, anchors.map(a => a.box.cy));

    unmatched.forEach(function (item) {

        // อยู่เหนือทุกกล่อง (หัวกระดาษ) หรือใต้ทุกกล่อง (ท้ายกระดาษ/ตราประทับ)
        // → ไปหัว/ท้ายสุด ไม่ต้องเดาจากคอลัมน์
        if (item.box.cy < topY) {
            keyed.push({
                index: item.index,
                key: firstOrder - 0.5,
                y: item.box.cy
            });
            return;
        }

        if (item.box.cy > bottomY) {
            keyed.push({
                index: item.index,
                key: lastOrder + 0.5,
                y: item.box.cy
            });
            return;
        }

        let nearest = null;
        let best = Infinity;

        anchors.forEach(function (anchor) {
            const distance = Math.hypot(
                anchor.box.cx - item.box.cx,
                anchor.box.cy - item.box.cy
            );

            if (distance < best) {
                best = distance;
                nearest = anchor;
            }
        });

        if (!nearest) return;

        // อยู่ใต้กล่องที่ใกล้ที่สุด = แทรกหลัง, อยู่เหนือ = แทรกก่อน
        const after = item.box.cy >= nearest.box.cy;

        keyed.push({
            index: item.index,
            key: nearest.order + (after ? 0.5 : -0.5),
            y: item.box.cy
        });
    });

    keyed.sort(function (a, b) {
        return a.key - b.key || a.y - b.y;
    });

    const ordered = keyed.map(function (item) {
        return item.index;
    });

    const used = new Set(ordered);

    // บรรทัดที่จับกล่องไม่ได้ — คงลำดับเดิมต่อท้าย (เหมือนก่อนมีผัง)
    source.forEach(function (line, index) {
        if (!used.has(index)) ordered.push(index);
    });

    const applied = ordered.some(function (value, index) {
        return value !== index;
    });

    return {
        lines: ordered.map(function (index) {
            return source[index];
        }),
        applied: applied,
        matched: anchors.length
    };
}

module.exports = {
    findBlueprint: findBlueprint,
    orderLinesByBlueprint: orderLinesByBlueprint,
    lineBox: lineBox,
    blueprintEntries: blueprintEntries,
    MIN_LINES: MIN_LINES,
    MAX_CENTER_DISTANCE: MAX_CENTER_DISTANCE
};
