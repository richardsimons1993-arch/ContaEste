const DATA_KEYS = {
    TRANSACTIONS: 'contabilidad_transactions',
    CONCEPTS: 'contabilidad_concepts',
    CLIENTS: 'contabilidad_clients'
};

// Default Concepts
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

    getClients() {
        return this.getAll(DATA_KEYS.CLIENTS) || [];
    },

    saveClient(client) {
        const clients = this.getClients();
        clients.push(client);
        this.save(DATA_KEYS.CLIENTS, clients);
        return clients;
    }
};

window.StorageAPI = Storage;
console.log("Storage loaded");
