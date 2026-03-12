const API_BASE = `${window.location.origin}/api`;

// Función auxiliar para hacer peticiones síncronas. 
// Evita tener que reescribir todo app.js (1900 líneas) de síncrono a asíncrono.
function syncRequest(method, endpoint, body) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, API_BASE + endpoint, false); // false = Síncrono
        if (body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(body));
        } else {
            xhr.send(null);
        }
        if (xhr.status >= 200 && xhr.status < 300) {
            return xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } else if (xhr.status === 0 || xhr.status >= 500) {
            console.error("API o Base de Datos no disponible. Status:", xhr.status);
            if (!window.hasShownDbError) {
                alert("No se pudo conectar con la base de datos o el servidor.\nPor favor, espere unos momentos o reinicie la aplicación.");
                window.hasShownDbError = true;
            }
        }
        return null;
    } catch (e) {
        console.error("Sync API Error:", e);
        return null;
    }
}

// Nueva implementación Asíncrona para Reactividad y Optimismo
async function asyncRequest(method, endpoint, body) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(API_BASE + endpoint, options);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        console.error("Async API Error:", e);
        throw e;
    }
}

const Storage = {
    getTransactions() {
        return syncRequest('GET', '/transactions') || [];
    },

    saveTransaction(transaction) {
        syncRequest('POST', '/transactions', transaction);
        return this.getTransactions();
    },

    deleteTransaction(id) {
        syncRequest('DELETE', `/transactions/${id}`);
        return this.getTransactions();
    },

    getConcepts() {
        let concepts = syncRequest('GET', '/concepts') || [];
        if (concepts.length === 0) {
            return []; // backend manages defaults if needed, or we just rely on db state
        }
        return concepts;
    },

    saveConcept(concept) {
        syncRequest('POST', '/concepts', concept);
        return this.getConcepts();
    },

    deleteConcept(id) {
        syncRequest('DELETE', `/concepts/${id}`);
        return this.getConcepts();
    },

    getClients() {
        return syncRequest('GET', '/clients') || [];
    },

    saveClient(client) {
        syncRequest('POST', '/clients', client);
        return this.getClients();
    },

    deleteClient(id) {
        syncRequest('DELETE', `/clients/${id}`);
        return this.getClients();
    },

    getLogs() {
        return syncRequest('GET', '/logs') || [];
    },

    saveLog(log) {
        const logEntry = {
            ...log,
            id: Date.now().toString(),
            timestamp: new Date().toISOString()
        };
        syncRequest('POST', '/logs', logEntry);
        return this.getLogs();
    },

    getUsers() {
        const users = syncRequest('GET', '/users') || [];
        if (users.length === 0) {
            const DEFAULT_USERS = [
                { id: '1', username: 'administrador', password: 'S0p0rt3!!2025', role: 'administrador', name: 'Admin Simons', modules: ['finanzas', 'ventas', 'usuarios'] },
                { id: '2', username: 'operador', password: 'operador123', role: 'operador', name: 'Operador Ventas', modules: ['finanzas', 'ventas'] },
                { id: '3', username: 'lector', password: 'lector123', role: 'visualización', name: 'Invitado', modules: ['finanzas', 'ventas'] }
            ];
            this.saveUsers(DEFAULT_USERS);
            return DEFAULT_USERS;
        }
        return users;
    },

    saveUsers(usersArray) {
        syncRequest('POST', '/users/batch', usersArray);
    },

    getDebts() {
        return syncRequest('GET', '/debts') || [];
    },

    saveDebt(debt) {
        syncRequest('POST', '/debts', debt);
        return this.getDebts();
    },

    deleteDebt(id) {
        syncRequest('DELETE', `/debts/${id}`);
        return this.getDebts();
    },

    payDebt(id) {
        return syncRequest('POST', `/debts/${id}/pay`);
    },

    getSuppliers() {
        return syncRequest('GET', '/suppliers') || [];
    },

    saveSupplier(supplier) {
        syncRequest('POST', '/suppliers', supplier);
        return this.getSuppliers();
    },

    deleteSupplier(id) {
        syncRequest('DELETE', `/suppliers/${id}`);
        return this.getSuppliers();
    },

    getDebtors() {
        return syncRequest('GET', '/debtors') || [];
    },

    saveDebtor(debtor) {
        syncRequest('POST', '/debtors', debtor);
        return this.getDebtors();
    },

    deleteDebtor(id) {
        syncRequest('DELETE', `/debtors/${id}`);
        return this.getDebtors();
    },

    payDebtor(id) {
        syncRequest('POST', `/debtors/${id}/pay`);
        return this.getDebtors();
    },

    getContracts() {
        return syncRequest('GET', '/contracts') || [];
    },

    getPendingContracts() {
        return syncRequest('GET', '/contracts/pending') || [];
    },

    saveContract(contract) {
        syncRequest('POST', '/contracts', contract);
        return this.getContracts();
    },

    deleteContract(id) {
        syncRequest('DELETE', `/contracts/${id}`);
        return this.getContracts();
    },

    invoiceContract(id) {
        return syncRequest('POST', `/contracts/${id}/invoice`);
    },

    undoInvoiceContract(id) {
        return syncRequest('POST', `/contracts/${id}/undo`);
    },

    getContractHistory(clientId) {
        return syncRequest('GET', `/contracts/history/${clientId}`) || [];
    },

    getProjects() {
        return syncRequest('GET', '/projects') || [];
    },

    saveProject(project) {
        syncRequest('POST', '/projects', project);
        return this.getProjects();
    },

    deleteProject(id) {
        syncRequest('DELETE', `/projects/${id}`);
        return this.getProjects();
    },

    // --- Métodos Asíncronos (Nuevos para SPA Reactiva) ---
    async: {
        getTransactions: () => asyncRequest('GET', '/transactions'),
        saveTransaction: (t) => asyncRequest('POST', '/transactions', t),
        deleteTransaction: (id) => asyncRequest('DELETE', `/transactions/${id}`),

        getDebts: () => asyncRequest('GET', '/debts'),
        saveDebt: (d) => asyncRequest('POST', '/debts', d),
        deleteDebt: (id) => asyncRequest('DELETE', `/debts/${id}`),
        payDebt: (id) => asyncRequest('POST', `/debts/${id}/pay`),

        getDebtors: () => asyncRequest('GET', '/debtors'),
        saveDebtor: (d) => asyncRequest('POST', '/debtors', d),
        deleteDebtor: (id) => asyncRequest('DELETE', `/debtors/${id}`),
        payDebtor: (id) => asyncRequest('POST', `/debtors/${id}/pay`),

        getContracts: () => asyncRequest('GET', '/contracts'),
        getPendingContracts: () => asyncRequest('GET', '/contracts/pending'),
        saveContract: (c) => asyncRequest('POST', '/contracts', c),
        deleteContract: (id) => asyncRequest('DELETE', `/contracts/${id}`),
        invoiceContract: (id) => asyncRequest('POST', `/contracts/${id}/invoice`),

        saveLog: (log) => {
            const entry = { ...log, id: Date.now().toString(), timestamp: new Date().toISOString() };
            return asyncRequest('POST', '/logs', entry);
        },

        getProjects: () => asyncRequest('GET', '/projects'),
        saveProject: (p) => asyncRequest('POST', '/projects', p),
        deleteProject: (id) => asyncRequest('DELETE', `/projects/${id}`),
        getProjectHistory: (id) => asyncRequest('GET', `/projects/${id}/history`),
        addProjectHistory: (id, h) => asyncRequest('POST', `/projects/${id}/history`, h)
    }
};

window.StorageAPI = Storage;
console.log("Almacenamiento (Backend SQL Server - Híbrido Sync/Async) cargado");

