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

                return fn(...args);

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

    };

})(window);