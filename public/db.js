(function (scope) {
    'use strict';

    let readyPromise = null;

    // ============================================================
    // Initialize Database
    // ============================================================

    function init() {

        if (readyPromise) {
            return readyPromise;
        }

        readyPromise =
            Promise.resolve()
                .then(function () {

                    if (!window.electronAPI) {
                        throw new Error(
                            'Electron API not available'
                        );
                    }

                    return window.electronAPI.dbInit();

                })
                .then(function (result) {

                    if (!result || !result.ok) {

                        throw new Error(
                            result?.error ||
                            'เริ่มฐานข้อมูลไม่สำเร็จ'
                        );

                    }

                    return {
                        persistent:
                            result.persistent,

                        dbPath:
                            result.dbPath
                    };

                })
                .catch(function (error) {

                    readyPromise = null;

                    throw error;

                });

        return readyPromise;
    }

    // ============================================================
    // Common Request
    // ============================================================

    function dbRequest(method, ...args) {

        return init()

            .then(function () {

                if (!window.electronAPI) {
                    throw new Error(
                        'Electron API not available'
                    );
                }

                const fn =
                    window.electronAPI[method];

                if (typeof fn !== 'function') {

                    throw new Error(
                        `Electron API "${method}" ไม่มี`
                    );

                }

                // IPC handler ถูกลงทะเบียนตอน main process เปิด
                // ถ้าแก้ main.cjs แล้วไม่ได้ปิดแอป จะเจอ "No handler registered"
                // ซึ่งอ่านแล้วไม่รู้ว่าต้องทำอะไร จึงบอกวิธีแก้ให้ตรงจุด
                return fn(...args)

                    .catch(function (error) {

                        const message =
                            error && error.message
                                ? error.message
                                : String(error);

                        if (
                            /No handler registered/i.test(
                                message
                            )
                        ) {

                            throw new Error(
                                'แอปที่เปิดอยู่นี้เป็นเวอร์ชันก่อนอัปเดต ' +
                                `(ไม่พบคำสั่ง "${method}") — ` +
                                'กรุณาปิดหน้าต่างแอปให้หมดแล้วเปิดใหม่'
                            );

                        }

                        throw error;
                    });

            })

            .then(function (result) {

                if (!result || !result.ok) {

                    throw new Error(
                        result?.error ||
                        'คำสั่งฐานข้อมูลล้มเหลว'
                    );

                }

                return result.result;

            });
    }

    // ============================================================
    // Public API
    // ============================================================

    scope.Db = {

        init: init,

        save: function (payload) {
            return dbRequest(
                'dbSave',
                payload
            );
        },

        list: function () {
            return dbRequest(
                'dbList'
            );
        },

        get: function (id) {
            return dbRequest(
                'dbGet',
                id
            );
        },

        remove: function (id) {
            return dbRequest(
                'dbRemove',
                id
            );
        },

        masterSave: function (payload) {

            return dbRequest(
                'dbMasterSave',
                payload
            );

        },

        masterList: function () {

            return dbRequest(
                'dbMasterList'
            );

        },

        masterGet: function (id) {

            return dbRequest(
                'dbMasterGet',
                id
            );

        },

        masterDelete: function (id) {

            return dbRequest(
                'dbMasterDelete',
                id
            );

        },

        // นำเข้าข้อมูล master หลายรายการพร้อมกัน (จากไฟล์ Excel)
        // payload = { rows: [{ codeGroup, name }, ...] }
        masterImport: function (payload) {

            return dbRequest(
                'dbMasterImport',
                payload
            );

        },

        // ── คำที่เพิ่มเอง (ใช้แนะนำคำตอนพิมพ์) ──

        // payload = { id, word } — id = 0 คือเพิ่มใหม่
        wordSave: function (payload) {

            return dbRequest(
                'dbWordSave',
                payload
            );

        },

        wordList: function () {

            return dbRequest(
                'dbWordList'
            );

        },

        wordDelete: function (id) {

            return dbRequest(
                'dbWordDelete',
                id
            );

        },

        // ── ประวัติการกรอก (ใช้กดใช้ซ้ำในหน้ารายงาน) ──

        // payload = { templateId, templateName, values, modes, retentionDays }
        historyAdd: function (payload) {

            return dbRequest(
                'dbHistoryAdd',
                payload
            );

        },

        // payload = { retentionDays } — อ่านแล้วลบรายการที่เก่ากว่ากำหนดให้ด้วย
        historyList: function (payload) {

            return dbRequest(
                'dbHistoryList',
                payload
            );

        },

        historyPrune: function (payload) {

            return dbRequest(
                'dbHistoryPrune',
                payload
            );

        },

        historyDelete: function (id) {

            return dbRequest(
                'dbHistoryDelete',
                id
            );

        },

        historyClear: function () {

            return dbRequest(
                'dbHistoryClear'
            );

        },

    };

})(window);