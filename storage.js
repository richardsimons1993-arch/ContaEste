const DATA_KEYS = {
    TRANSACTIONS: 'contabilidad_transactions',
    CONCEPTS: 'contabilidad_concepts',
    CLIENTS: 'contabilidad_clients',
    LOGS: 'contabilidad_activity_logs',
    USERS: 'contabilidad_users'
};

// Conceptos por Defecto
const DEFAULT_CONCEPTS = [
    { id: '1', name: 'Ventas', type: 'income' },
    { id: '2', name: 'Servicios', type: 'income' },
    { id: '3', name: 'Alquiler', type: 'expense' },
    { id: '4', name: 'Servicios Públicos', type: 'expense' },
    { id: '5', name: 'Alimentos', type: 'expense' },
    { id: '6', name: 'Transporte', type: 'expense' }
];

const Storage = {
    getAll(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    },

    save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },

    getTransactions() {
        return this.getAll(DATA_KEYS.TRANSACTIONS) || [];
    },

    saveTransaction(transaction) {
        const transactions = this.getTransactions();
        transactions.push(transaction);
        this.save(DATA_KEYS.TRANSACTIONS, transactions);
        return transactions;
    },

    deleteTransaction(id) {
        let transactions = this.getTransactions();
        transactions = transactions.filter(t => t.id !== id);
        this.save(DATA_KEYS.TRANSACTIONS, transactions);
        return transactions;
    },

    getConcepts() {
        const concepts = this.getAll(DATA_KEYS.CONCEPTS);
        if (!concepts || concepts.length === 0) {
            this.save(DATA_KEYS.CONCEPTS, DEFAULT_CONCEPTS);
            return DEFAULT_CONCEPTS;
        }
        return concepts;
    },

    saveConcept(concept) {
        const concepts = this.getConcepts();
        concepts.push(concept);
        this.save(DATA_KEYS.CONCEPTS, concepts);
        return concepts;
    },

    deleteConcept(id) {
        let concepts = this.getConcepts();
        concepts = concepts.filter(c => c.id !== id);
        this.save(DATA_KEYS.CONCEPTS, concepts);
        return concepts;
    },

    getClients() {
        return this.getAll(DATA_KEYS.CLIENTS) || [];
    },

    saveClient(client) {
        const clients = this.getClients();
        const index = clients.findIndex(c => c.id === client.id);
        if (index > -1) {
            clients[index] = client;
        } else {
            clients.push(client);
        }
        this.save(DATA_KEYS.CLIENTS, clients);
        return clients;
    },

    deleteClient(id) {
        let clients = this.getClients();
        clients = clients.filter(c => c.id !== id);
        this.save(DATA_KEYS.CLIENTS, clients);
        return clients;
    },

    getLogs() {
        return this.getAll(DATA_KEYS.LOGS) || [];
    },

    saveLog(log) {
        const logs = this.getLogs();
        logs.unshift({
            ...log,
            id: Date.now().toString(),
            timestamp: new Date().toISOString()
        });
        // Mantener solo los últimos 100 registros para evitar sobrecarga
        this.save(DATA_KEYS.LOGS, logs.slice(0, 100));
        return logs;
    },

    getUsers() {
        return this.getAll(DATA_KEYS.USERS) || [];
    },

    saveUsers(users) {
        this.save(DATA_KEYS.USERS, users);
    }
};

window.StorageAPI = Storage;
console.log("Almacenamiento cargado");
