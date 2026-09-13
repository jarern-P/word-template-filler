async function testElectronIPC() {
    const info = await window.electronAPI.getAppInfo();

    const db = await window.electronAPI.pingDatabase();

    const sqlite = await window.electronAPI.getSqliteVersion();

    console.log("App Info:", info);
    console.log("DB Worker:", db);
    console.log("SQLite:", sqlite);

    document.querySelector("#app").innerHTML = `
        <h1>${info.name}</h1>

        <p>${info.message}</p>

        <p>Version: ${info.version}</p>

        <hr>

        <h2>Database</h2>

        <p>${db.message}</p>

        <p>
            SQLite Version:
            <strong>${sqlite.version}</strong>
        </p>
    `;
}

testElectronIPC();