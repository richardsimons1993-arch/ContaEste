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
        }
        return null;
    } catch (e) {
        console.error("Sync API Error:", e);
        return null;
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
                { id: '1', username: 'administrador', password: 'S0p0rt3!!2025', role: 'administrador', name: 'Admin Simons', modules: ['finanzas', 'usuarios'] },
                { id: '2', username: 'operador', password: 'operador123', role: 'operador', name: 'Operador Ventas', modules: ['finanzas'] },
                { id: '3', username: 'lector', password: 'lector123', role: 'visualización', name: 'Invitado', modules: ['finanzas'] }
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
    }
};

window.StorageAPI = Storage;
console.log("Almacenamiento (Backend SQL Server - Síncrono) cargado");
