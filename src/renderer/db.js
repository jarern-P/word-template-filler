//
// DB Module
// สื่อสารกับ Electron Main Process ผ่าน IPC
// SQLite ทำงานใน DB Worker
//

(function (scope) {

    'use strict';


    // ============================================================
    // State
    // ============================================================

    let readyPromise = null;


    // ============================================================
    // Initialize
    // ============================================================

    function init() {

        if (readyPromise) {
            return readyPromise;
        }


        readyPromise = Promise.resolve()
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
                    persistent: true
                };
            })
            .catch(function (error) {

                // ให้ครั้งต่อไปสามารถลอง init ใหม่ได้
                readyPromise = null;

                throw error;
            });


        return readyPromise;
    }


    // ============================================================
    // Database Request
    // ============================================================

    function dbRequest(method, ...args) {

        return init()
            .then(function () {

                if (!window.electronAPI) {

                    throw new Error(
                        'Electron API not available'
                    );
                }


                return window.electronAPI[method](
                    ...args
                );
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

        // --------------------------------------------------------
        // Initialize
        // --------------------------------------------------------

        init: init,


        // --------------------------------------------------------
        // Save
        //
        // payload:
        //
        // {
        //     id?,
        //     name,
        //     fileName,
        //     docx,
        //     fields,
        //     types
        // }
        // --------------------------------------------------------

        save: function (payload) {

            return dbRequest(
                'dbSave',
                payload
            );
        },


        // --------------------------------------------------------
        // List
        // --------------------------------------------------------

        list: function () {

            return dbRequest(
                'dbList'
            );
        },


        // --------------------------------------------------------
        // Get
        // --------------------------------------------------------

        get: function (id) {

            return dbRequest(
                'dbGet',
                id
            );
        },


        // --------------------------------------------------------
        // Delete
        // --------------------------------------------------------

        remove: function (id) {

            return dbRequest(
                'dbRemove',
                id
            );
        }

    };

})(window);