async function testDatabaseCRUD() {

    try {

        // ====================================================
        // Initialize
        // ====================================================

        const db =
            await window.electronAPI.dbInit();

        console.log(
            "Database:",
            db
        );


        // ====================================================
        // Save
        // ====================================================

        const saveResult =
            await window.electronAPI.dbSave({

                name: "Test Template " + Date.now(),

                fileName: "test.docx",

                docx: new Uint8Array([
                    1,
                    2,
                    3,
                    4,
                    5
                ]),

                fields: [
                    "test_name",
                    "test_date"
                ],

                types: {
                    test_name: "text",
                    test_date: "date"
                }

            });


        console.log(
            "Save:",
            saveResult
        );


        const templateId =
            saveResult.result.id;


        // ====================================================
        // List
        // ====================================================

        const listResult =
            await window.electronAPI.dbList();


        console.log(
            "List:",
            listResult
        );


        // ====================================================
        // Get
        // ====================================================

        const getResult =
            await window.electronAPI.dbGet(
                templateId
            );


        console.log(
            "Get:",
            getResult
        );


        // ====================================================
        // Delete
        // ====================================================

        const deleteResult =
            await window.electronAPI.dbRemove(
                templateId
            );


        console.log(
            "Delete:",
            deleteResult
        );


        // ====================================================
        // UI
        // ====================================================

        document.querySelector(
            "#app"
        ).innerHTML = `

            <h1>
                Database CRUD Test
            </h1>

            <p>
                Database:
                <strong>OK</strong>
            </p>

            <p>
                Save:
                <strong>
                    ID ${templateId}
                </strong>
            </p>

            <p>
                List:
                <strong>
                    ${listResult.ok ? "OK" : "ERROR"}
                </strong>
            </p>

            <p>
                Get:
                <strong>
                    ${getResult.ok ? "OK" : "ERROR"}
                </strong>
            </p>

            <p>
                Delete:
                <strong>
                    ${deleteResult.ok ? "OK" : "ERROR"}
                </strong>
            </p>

        `;

    } catch (error) {

        console.error(
            "Database CRUD Error:",
            error
        );


        document.querySelector(
            "#app"
        ).innerHTML = `

            <h1>
                Database Error
            </h1>

            <pre>
${error.message}
            </pre>

        `;

    }

}


testDatabaseCRUD();