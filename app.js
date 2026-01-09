// State
const state = {
    currentView: 'dashboard',
    transactions: [],
    concepts: [],
    clients: []
};

// Formatting Helper
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
};

// UI Controller
const UI = {
    init() {
        try {
            console.log("App initializing...");
            if (!window.StorageAPI) {
                alert("Critical Error: StorageAPI not found!");
                return;
            }
            this.loadData();
            this.setupEventListeners();
            this.renderDashboard(); // Initial render
            this.renderConcepts();
            this.renderClients();
            this.renderTransactionFormOptions();

            // Set date input to today
            const dateInput = document.getElementById('date');
            if (dateInput) dateInput.valueAsDate = new Date();
        } catch (error) {
            alert("Error in UI.init: " + error.message);
            console.error(error);
        }
    },

    loadData() {
        state.transactions = window.StorageAPI.getTransactions();
        state.concepts = window.StorageAPI.getConcepts();
        state.clients = window.StorageAPI.getClients();
    },

    setupEventListeners() {
        console.log("Setting up event listeners...");
        // Navigation
        const buttons = document.querySelectorAll('.nav-btn');
        if (buttons.length === 0) console.warn("No navigation buttons found!");

        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Use currentTarget to ensure we get the button, not the icon inside
                const target = e.currentTarget.dataset.target;
                console.log("Nav button clicked. Target:", target);
                if (target) {
                    this.switchView(target);
                } else {
                    console.error("Button has no data-target:", btn);
                }
            });
        });

        // Forms
        const txForm = document.getElementById('add-transaction-form');
        if (txForm) txForm.addEventListener('submit', (e) => this.handleTransactionSubmit(e));

        const conceptForm = document.getElementById('add-concept-form');
        if (conceptForm) conceptForm.addEventListener('submit', (e) => this.handleConceptSubmit(e));

        const clientForm = document.getElementById('add-client-form');
        if (clientForm) clientForm.addEventListener('submit', (e) => this.handleClientSubmit(e));
    },

    switchView(viewName) {
        console.log("Switching view to:", viewName);

        // Update Sidebar
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.target === viewName);
        });

        // Update Sections
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.toggle('active', section.id === viewName);
        });

        // Update Title
        const titles = {
            'dashboard': 'Dashboard',
            'transaction-form': 'Registrar Movimiento',
            'transactions': 'Movimientos',
            'concepts': 'Conceptos',
            'clients': 'Clientes'
        };
        const titleEl = document.getElementById('page-title');
        if (titleEl) titleEl.textContent = titles[viewName] || 'Contabilidad';

        // Refresh specific view data if needed
        if (viewName === 'dashboard') this.renderDashboard();
        if (viewName === 'transactions') this.renderTransactionsList();
    },

    // --- RENDERERS ---

    renderDashboard() {
        const transactions = state.transactions;
        let income = 0;
        let expense = 0;
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');

            if (tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear) {
                if (t.type === 'income') income += parseFloat(t.amount);
                if (t.type === 'expense') expense += parseFloat(t.amount);
            }
        });

        let totalIncome = 0;
        let totalExpense = 0;
        transactions.forEach(t => {
            if (t.type === 'income') totalIncome += parseFloat(t.amount);
            if (t.type === 'expense') totalExpense += parseFloat(t.amount);
        });
        const totalBalance = totalIncome - totalExpense;

        const elBalance = document.getElementById('total-balance');
        const elIncome = document.getElementById('month-income');
        const elExpense = document.getElementById('month-expense');

        if (elBalance) elBalance.textContent = formatCurrency(totalBalance);
        if (elIncome) elIncome.textContent = formatCurrency(income);
        if (elExpense) elExpense.textContent = formatCurrency(expense);

        // --- Annual Summary Table ---
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        // Initialize Year Data
        const yearData = Array(12).fill(null).map(() => ({ income: 0, expense: 0 }));

        // Calculate Previous Years Balance (Opening Balance)
        let accumulatedBalance = 0;
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() < currentYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        // Aggregate Current Year Data
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() === currentYear) {
                const m = tDate.getMonth(); // 0-11
                if (t.type === 'income') yearData[m].income += parseFloat(t.amount);
                if (t.type === 'expense') yearData[m].expense += parseFloat(t.amount);
            }
        });

        // Render Table
        const summaryTableBody = document.getElementById('monthly-summary-body');
        if (summaryTableBody) {
            summaryTableBody.innerHTML = '';

            yearData.forEach((data, index) => {
                const monthlyNet = data.income - data.expense;
                accumulatedBalance += monthlyNet; // Running Total

                const row = document.createElement('tr');

                row.innerHTML = `
                    <td>${monthNames[index]}</td>
                    <td class="text-success">+ ${formatCurrency(data.income)}</td>
                    <td class="text-danger">- ${formatCurrency(data.expense)}</td>
                    <td style="font-weight:bold">${formatCurrency(monthlyNet)}</td>
                    <td style="font-weight:bold; color: var(--primary-color)">${formatCurrency(accumulatedBalance)}</td>
                `;
                summaryTableBody.appendChild(row);
            });
        }
    },

    renderTransactionsList() {
        const tbody = document.getElementById('transactions-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Sort by date desc
        const sorted = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        sorted.forEach(t => {
            const row = document.createElement('tr');
            const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';
            const clientName = state.clients.find(c => c.id === t.clientId)?.name || '-';

            row.innerHTML = `
                <td>${t.date}</td>
                <td><span class="tag ${t.type}">${t.type === 'income' ? 'Ingreso' : 'Egreso'}</span></td>
                <td>${conceptName}</td>
                <td>${clientName}</td>
                <td>${t.observation || '-'}</td>
                <td style="font-weight: bold; color: ${t.type === 'income' ? 'var(--secondary-color)' : 'var(--danger-color)'}">
                    ${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}
                </td>
                <td>
                    <!-- Future: Edit/Delete -->
                </td>
            `;
            tbody.appendChild(row);
        });
    },

    renderTransactionFormOptions() {
        const conceptSelect = document.getElementById('concept');
        const clientSelect = document.getElementById('client');

        if (conceptSelect) {
            conceptSelect.innerHTML = '<option value="">Seleccionar Concepto</option>';
            state.concepts.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = `${c.name} (${c.type === 'income' ? '+' : '-'})`;
                conceptSelect.appendChild(option);
            });
        }

        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccionar Cliente</option>';
            state.clients.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.name;
                clientSelect.appendChild(option);
            });
        }
    },

    renderConcepts() {
        const list = document.getElementById('concepts-list');
        if (!list) return;
        list.innerHTML = '';
        state.concepts.forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${c.name}</span>
                <span class="tag ${c.type}">${c.type === 'income' ? 'Ingreso' : 'Egreso'}</span>
            `;
            list.appendChild(li);
        });

        // Also update the form dropdown
        this.renderTransactionFormOptions();
    },

    renderClients() {
        const list = document.getElementById('clients-list');
        if (!list) return;
        list.innerHTML = '';
        state.clients.forEach(c => {
            const li = document.createElement('li');
            li.textContent = c.name;
            list.appendChild(li);
        });
        this.renderTransactionFormOptions(); // Update transaction form
    },

    // --- HANDLERS ---

    handleTransactionSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const transaction = {
            id: Date.now().toString(),
            type: formData.get('type'),
            amount: parseFloat(formData.get('amount')),
            conceptId: formData.get('concept'),
            clientId: formData.get('client') || null,
            date: formData.get('date'),
            observation: formData.get('observation')
        };

        window.StorageAPI.saveTransaction(transaction);
        state.transactions.push(transaction); // Update local state

        e.target.reset();
        const dateInput = document.getElementById('date');
        if (dateInput) dateInput.valueAsDate = new Date();

        alert('Movimiento registrado con éxito');
        this.renderDashboard(); // Update stats background
    },

    handleConceptSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const concept = {
            id: Date.now().toString(),
            name: formData.get('name'),
            type: formData.get('type')
        };

        window.StorageAPI.saveConcept(concept);
        state.concepts.push(concept);

        e.target.reset();
        this.renderConcepts();
        alert('Concepto agregado');
    },

    handleClientSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const client = {
            id: Date.now().toString(),
            name: formData.get('name')
        };

        window.StorageAPI.saveClient(client);
        state.clients.push(client);

        e.target.reset();
        this.renderClients();
        alert('Cliente agregado');
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => UI.init());
