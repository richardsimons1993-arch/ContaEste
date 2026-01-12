// Estado del Sistema
const state = {
    currentView: 'transaction-form',
    transactions: [],
    concepts: [],
    clients: [],
    logs: [],
    users: [],
    currentUser: null,
    lastDeleted: null // Para el sistema de Deshacer
};

// Roles y Permisos
const ROLES = {
    ADMIN: 'administrador',
    OPERATOR: 'operador',
    VIEWER: 'visualización'
};

const DEFAULT_USERS = [
    { id: '1', username: 'administrador', password: 'S0p0rt3!!2025', role: ROLES.ADMIN, name: 'Admin Simons' },
    { id: '2', username: 'operador', password: 'operador123', role: ROLES.OPERATOR, name: 'Operador Ventas' },
    { id: '3', username: 'lector', password: 'lector123', role: ROLES.VIEWER, name: 'Invitado' }
];

// Ayudante de Formateo de Moneda
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
};

// Controlador de la Interfaz de Usuario (UI)
const UI = {
    init() {
        try {
            console.log("Inicializando aplicación...");
            if (!window.StorageAPI) {
                console.error("Error Crítico: ¡StorageAPI no encontrado!");
                return;
            }
            this.loadData();
            this.checkSession(); // Verificar si ya hay una sesión
            this.initTheme(); // Inicializar tema (claro/oscuro)
            this.setupEventListeners();
            this.renderConcepts();
            this.renderClients();
            this.setupCustomDropdowns(); // Inicializar oyentes para menús desplegables
            this.renderTransactionFormOptions(); // Rellenar formulario y filtros

            // Si hay sesión, cargar la UI normal
            if (state.currentUser) {
                this.applyPrivileges();
                this.switchView(state.currentView);
            }

            // Establecer fecha por defecto a hoy
            const dateInput = document.getElementById('date');
            if (dateInput) dateInput.valueAsDate = new Date();
        } catch (error) {
            console.error("Error en UI.init: " + error.message);
        }
    },

    loadData() {
        state.transactions = window.StorageAPI.getTransactions();
        state.concepts = window.StorageAPI.getConcepts();
        state.clients = window.StorageAPI.getClients();
        state.logs = window.StorageAPI.getLogs();

        // Cargar usuarios o inicializar con por defecto
        state.users = window.StorageAPI.getUsers();
        if (state.users.length === 0) {
            state.users = [...DEFAULT_USERS];
            window.StorageAPI.saveUsers(state.users);
        } else {
            // Asegurar que el admin siempre tenga la contraseña solicitada si existe
            const admin = state.users.find(u => u.username === 'administrador');
            if (admin && admin.password !== 'S0p0rt3!!2025') {
                admin.password = 'S0p0rt3!!2025';
                window.StorageAPI.saveUsers(state.users);
            }
        }
    },

    setupEventListeners() {
        console.log("Configurando oyentes de eventos...");
        // Navegación
        const buttons = document.querySelectorAll('.nav-btn');
        if (buttons.length === 0) console.warn("¡No se encontraron botones de navegación!");

        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Usar currentTarget para asegurar el botón y no el icono interior
                const target = e.currentTarget.dataset.target;
                console.log("Botón de navegación pulsado. Destino:", target);
                if (target) {
                    this.switchView(target);
                } else {
                    console.error("El botón no tiene data-target:", btn);
                }
            });
        });

        // Formularios
        const txForm = document.getElementById('add-transaction-form');
        if (txForm) txForm.addEventListener('submit', (e) => this.handleTransactionSubmit(e));

        const conceptForm = document.getElementById('add-concept-form');
        if (conceptForm) conceptForm.addEventListener('submit', (e) => this.handleConceptSubmit(e));

        const clientForm = document.getElementById('add-client-form');
        if (clientForm) clientForm.addEventListener('submit', (e) => this.handleClientSubmit(e));

        const cancelClientEditBtn = document.getElementById('cancel-client-edit');
        if (cancelClientEditBtn) {
            cancelClientEditBtn.addEventListener('click', () => {
                const form = document.getElementById('add-client-form');
                form.reset();
                document.getElementById('client-id').value = '';
                document.getElementById('client-form-title').textContent = 'Crear Cliente';
                cancelClientEditBtn.style.display = 'none';
            });
        }

        // Filtros (Oyentes nativos eliminados, usando lógica personalizada)

        // --- LOGIN ---
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', (e) => this.handleLogin(e));

        // --- USUARIO ---
        const userMenuBtn = document.getElementById('user-menu-btn');
        if (userMenuBtn) {
            userMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('user-dropdown-menu').classList.toggle('active');
            });
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout());

        // --- TEMA (MODO OSCURO) ---
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => this.toggleTheme());
        }

        // --- GESTIÓN DE USUARIOS ---
        const userForm = document.getElementById('add-user-form');
        if (userForm) userForm.addEventListener('submit', (e) => this.handleUserSubmit(e));

        const cancelUserEditBtn = document.getElementById('cancel-user-edit');
        if (cancelUserEditBtn) {
            cancelUserEditBtn.addEventListener('click', () => this.resetUserForm());
        }

        // Cerrar dropdown de usuario al hacer clic fuera
        document.addEventListener('click', () => {
            const menu = document.getElementById('user-dropdown-menu');
            if (menu) menu.classList.remove('active');
        });
    },

    // --- AUTENTICACIÓN ---

    checkSession() {
        const savedUser = localStorage.getItem('contabilidad_session');
        if (savedUser) {
            state.currentUser = JSON.parse(savedUser);
            document.body.classList.remove('login-pending');
            this.updateUserUI();
        } else {
            document.body.classList.add('login-pending');
        }
    },

    handleLogin(e) {
        e.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const username = usernameInput.value.trim().toLowerCase();
        const pass = passwordInput.value.trim();
        const errorEl = document.getElementById('login-error');

        // Debug: Verificar si hay usuarios
        if (!state.users || state.users.length === 0) {
            errorEl.textContent = "Error: Sistema no inicializado. Recargue la página.";
            errorEl.style.display = 'block';
            return;
        }

        const user = state.users.find(u => u.username === username);

        if (!user) {
            errorEl.textContent = "Usuario no encontrado.";
            errorEl.style.display = 'block';
            usernameInput.focus();
            return;
        }

        if (user.password !== pass) {
            errorEl.textContent = "Contraseña incorrecta.";
            errorEl.style.display = 'block';
            passwordInput.value = ''; // Solo borrar la contraseña si el usuario es correcto
            passwordInput.focus();
            return;
        }

        // Si llega aquí, es exitoso
        state.currentUser = {
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name
        };
        localStorage.setItem('contabilidad_session', JSON.stringify(state.currentUser));
        document.body.classList.remove('login-pending');
        errorEl.style.display = 'none';
        e.target.reset();

        this.updateUserUI();
        this.applyPrivileges();
        this.switchView('transaction-form');
        this.recordActivity('Login', 'Sistema', `Usuario ${username} inició sesión`);
    },

    handleLogout() {
        this.recordActivity('Logout', 'Sistema', `Usuario ${state.currentUser?.username} cerró sesión`);
        state.currentUser = null;
        localStorage.removeItem('contabilidad_session');
        document.body.classList.add('login-pending');
    },

    updateUserUI() {
        const displayEl = document.getElementById('display-username');
        const headerName = document.getElementById('header-user-name');
        const headerRole = document.getElementById('header-user-role');

        if (displayEl) displayEl.textContent = state.currentUser?.name;
        if (headerName) headerName.textContent = state.currentUser?.name;
        if (headerRole) headerRole.textContent = state.currentUser?.role;
    },

    // --- TEMA ---

    initTheme() {
        const savedTheme = localStorage.getItem('contabilidad_theme') || 'light';
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            this.updateThemeIcon(true);
        }
    },

    toggleTheme() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('contabilidad_theme', isDark ? 'dark' : 'light');
        this.updateThemeIcon(isDark);
        this.recordActivity('Ajuste', 'Sistema', `Tema cambiado a ${isDark ? 'oscuro' : 'claro'}`);
    },

    updateThemeIcon(isDark) {
        const icon = document.querySelector('#theme-toggle i');
        if (icon) {
            icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }
    },

    applyPrivileges() {
        const role = state.currentUser?.role;
        console.log("Aplicando privilegios para rol:", role);

        // 1. Ocultar botones de borrar si no es ADMIN
        const deleteButtons = document.querySelectorAll('.btn-icon.text-danger');
        deleteButtons.forEach(btn => {
            btn.style.display = (role === ROLES.ADMIN) ? 'inline-flex' : 'none';
        });

        // 2. Deshabilitar formularios si es VIEWER
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            const inputs = form.querySelectorAll('input, select, textarea, button[type="submit"]');
            inputs.forEach(input => {
                if (role === ROLES.VIEWER) {
                    input.disabled = true;
                    if (input.tagName === 'BUTTON') input.style.opacity = '0.5';
                } else {
                    input.disabled = false;
                    if (input.tagName === 'BUTTON') input.style.opacity = '1';
                }
            });
        });

        // 3. Mostrar/Ocultar botón Usuarios
        const navUsersBtn = document.getElementById('nav-users-btn');
        if (navUsersBtn) {
            navUsersBtn.style.display = (role === ROLES.ADMIN) ? 'flex' : 'none';
        }
    },

    switchView(viewName) {
        if (!state.currentUser) return; // No permitir navegar sin login

        // Proteger vista usuarios
        if (viewName === 'users' && state.currentUser.role !== ROLES.ADMIN) {
            this.switchView('transaction-form');
            return;
        }

        console.log("Cambiando vista a:", viewName);

        // Actualizar Barra Lateral
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.target === viewName);
        });

        // Actualizar Secciones
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.toggle('active', section.id === viewName);
        });

        // Update Title
        const titles = {
            'dashboard': 'Balance',
            'transaction-form': 'Registrar',
            'transactions': 'Movimientos',
            'concepts': 'Conceptos',
            'clients': 'Clientes',
            'activity': 'Actividad',
            'users': 'Usuarios'
        };

        const pageTitle = document.getElementById('page-title');
        if (pageTitle && titles[viewName]) {
            pageTitle.textContent = titles[viewName];
        }

        if (viewName === 'dashboard') this.renderDashboard();
        if (viewName === 'transactions') this.renderTransactionsList();
        if (viewName === 'concepts') this.renderConcepts();
        if (viewName === 'clients') this.renderClients();
        if (viewName === 'activity') this.renderActivity();
        if (viewName === 'users') this.renderUsers();

        // Resetear formularios si se sale de la sección
        if (viewName !== 'transaction-form') this.cancelTransactionEdit();
        if (viewName !== 'clients') this.resetClientForm();
        if (viewName !== 'users') this.resetUserForm();

        // Re-aplicar privilegios (por si se renderizaron botones nuevos)
        this.applyPrivileges();
    },

    // --- RENDERIZADORES ---

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

        // Actualizar Año en la UI
        const yearEl = document.getElementById('current-year');
        if (yearEl) yearEl.textContent = currentYear;

        // --- Tabla Resumen Anual ---
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        // Inicializar datos del año
        const yearData = Array(12).fill(null).map(() => ({ income: 0, expense: 0 }));

        // Calcular balance de años anteriores (Saldo Inicial)
        let accumulatedBalance = 0;
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() < currentYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        // Agregar datos del año actual
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() === currentYear) {
                const m = tDate.getMonth(); // 0-11
                if (t.type === 'income') yearData[m].income += parseFloat(t.amount);
                if (t.type === 'expense') yearData[m].expense += parseFloat(t.amount);
            }
        });

        // Renderizar Tabla
        const summaryTableBody = document.getElementById('monthly-summary-body');
        const summaryTableFooter = document.getElementById('monthly-summary-footer');

        if (summaryTableBody) {
            summaryTableBody.innerHTML = '';
            let totalYearIncome = 0;
            let totalYearExpense = 0;
            let totalYearNet = 0;

            yearData.forEach((data, index) => {
                const monthlyNet = data.income - data.expense;
                accumulatedBalance += monthlyNet; // Saldo Acumulado

                totalYearIncome += data.income;
                totalYearExpense += data.expense;
                totalYearNet += monthlyNet;

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

            if (summaryTableFooter) {
                summaryTableFooter.innerHTML = `
                    <tr style="background: rgba(var(--primary-rgb), 0.05); border-top: 2px solid var(--border-color)">
                        <td style="font-weight:bold">TOTAL ANUAL</td>
                        <td class="text-success" style="font-weight:bold">+ ${formatCurrency(totalYearIncome)}</td>
                        <td class="text-danger" style="font-weight:bold">- ${formatCurrency(totalYearExpense)}</td>
                        <td style="font-weight:bold">${formatCurrency(totalYearNet)}</td>
                        <td style="font-weight:bold; color: var(--primary-color)">${formatCurrency(accumulatedBalance)}</td>
                    </tr>
                `;
            }
        }
    },

    renderTransactionsList() {
        const tbody = document.getElementById('transactions-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Obtener valores de filtros (Desplegables personalizados)
        const selectedConcepts = Array.from(document.querySelectorAll('#menu-dropdown-concept input:checked')).map(cb => cb.value);
        const selectedClients = Array.from(document.querySelectorAll('#menu-dropdown-client input:checked')).map(cb => cb.value);

        // Filtrar y Ordenar
        let displayedTransactions = state.transactions;

        if (selectedConcepts.length > 0) {
            displayedTransactions = displayedTransactions.filter(t => selectedConcepts.includes(t.conceptId));
        }

        if (selectedClients.length > 0) {
            displayedTransactions = displayedTransactions.filter(t => t.clientId && selectedClients.includes(t.clientId));
        }

        const sorted = [...displayedTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        let totalSum = 0;

        sorted.forEach(t => {
            const amount = parseFloat(t.amount);
            if (t.type === 'income') totalSum += amount;
            else totalSum -= amount;

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
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editTransaction('${t.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.handleTransactionDelete('${t.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Renderizar Total en el Pie de Tabla
        const tfoot = document.getElementById('transactions-list-footer');
        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: right; font-weight: bold; color: var(--text-muted); padding-right: 1rem;">Total:</td>
                    <td style="font-weight: bold; font-size: 1.1rem; color: ${totalSum >= 0 ? 'var(--secondary-color)' : 'var(--danger-color)'}">
                        ${formatCurrency(Math.abs(totalSum))}
                    </td>
                </tr>
            `;
        }
        this.applyPrivileges();
    },

    renderTransactionFormOptions() {
        // 1. Desplegables del Formulario (Nativos)
        const conceptSelect = document.getElementById('concept');
        const clientSelect = document.getElementById('client');

        // --- Conceptos en el Formulario ---
        if (conceptSelect) {
            conceptSelect.innerHTML = '<option value="">Seleccionar Concepto</option>';
            state.concepts.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = `${c.name} (${c.type === 'income' ? '+' : '-'})`;
                conceptSelect.appendChild(option);
            });
        }

        // --- Clientes en el Formulario ---
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccionar Cliente</option>';
            state.clients.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.name;
                clientSelect.appendChild(option);
            });
        }

        // 2. Desplegables de Filtros Personalizados
        this.renderCustomDropdownOptions('concept', state.concepts, 'name');
        this.renderCustomDropdownOptions('client', state.clients, 'name');
    },

    // --- AYUDANTES DE DESPLEGABLES PERSONALIZADOS ---

    setupCustomDropdowns() {
        // Oyentes de alternancia
        ['concept', 'client'].forEach(type => {
            const btn = document.getElementById(`btn-dropdown-${type}`);
            const menu = document.getElementById(`menu-dropdown-${type}`);

            if (btn && menu) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Cerrar otros
                    document.querySelectorAll('.dropdown-menu').forEach(m => {
                        if (m !== menu) m.classList.remove('active');
                    });
                    menu.classList.toggle('active');
                });
            }
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('active'));
        });

        // Evitar cierre al hacer clic dentro del menú
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.addEventListener('click', (e) => e.stopPropagation());
        });
    },

    renderCustomDropdownOptions(type, data, displayField) {
        const menu = document.getElementById(`menu-dropdown-${type}`);
        const btn = document.getElementById(`btn-dropdown-${type}`);
        if (!menu || !btn) return;

        // Preservar selección
        const checkedValues = Array.from(menu.querySelectorAll('input:checked')).map(cb => cb.value);

        menu.innerHTML = '';

        if (data.length === 0) {
            menu.innerHTML = '<div style="padding:0.5rem; color:var(--text-muted)">No hay opciones</div>';
            return;
        }

        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = item.id;
            checkbox.id = `cb-${type}-${item.id}`;
            if (checkedValues.includes(item.id)) checkbox.checked = true;

            // Disparar renderizado al cambiar
            checkbox.addEventListener('change', () => {
                this.updateDropdownButtonText(type);
                this.renderTransactionsList();
            });

            const label = document.createElement('label');
            label.htmlFor = `cb-${type}-${item.id}`;
            label.style.flex = '1';
            label.style.cursor = 'pointer';
            label.textContent = item[displayField];

            div.appendChild(checkbox);
            div.appendChild(label);
            menu.appendChild(div);
        });

        this.updateDropdownButtonText(type);
    },

    updateDropdownButtonText(type) {
        const btn = document.getElementById(`btn-dropdown-${type}`);
        const menu = document.getElementById(`menu-dropdown-${type}`);
        if (!btn || !menu) return;

        const count = menu.querySelectorAll('input:checked').length;
        const baseTitle = type === 'concept' ? 'Conceptos' : 'Clientes';

        if (count === 0) {
            btn.innerHTML = baseTitle; // Resetear al valor por defecto
        } else {
            btn.innerHTML = `${baseTitle} (${count})`;
        }
    },

    renderConcepts() {
        const tbody = document.getElementById('concepts-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.concepts.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${c.name}</td>
                <td><span class="tag ${c.type}">${c.type === 'income' ? 'Ingreso' : 'Egreso'}</span></td>
                <td class="actions">
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.handleConceptDelete('${c.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // También actualizar el desplegable del formulario
        this.renderTransactionFormOptions();
        this.applyPrivileges();
    },

    handleConceptDelete(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;

        const concept = state.concepts.find(c => c.id === id);

        // Guardar para Deshacer
        state.lastDeleted = { type: 'concept', data: { ...concept } };

        window.StorageAPI.deleteConcept(id);
        state.concepts = state.concepts.filter(c => c.id !== id);

        this.recordActivity('Baja', 'Concepto', `Eliminado: ${concept?.name}`, { type: 'concept', item: concept });
        this.showUndoToast(`Concepto "${concept?.name}" eliminado`);
        this.renderConcepts();
    },

    renderClients() {
        const tbody = document.getElementById('clients-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.clients.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${c.razonSocial || '---'}</td>
                <td>${c.nombreFantasia || '---'}</td>
                <td>${c.rut || '---'}</td>
                <td>${c.encargado || '---'}</td>
                <td>${c.telefono || '---'}</td>
                <td>${c.correo || '---'}</td>
                <td>${c.direccion || '---'}</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editClient('${c.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteClient('${c.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.renderTransactionFormOptions(); // Actualizar formulario de movimientos
        this.applyPrivileges();
    },

    editClient(id) {
        const client = state.clients.find(c => c.id === id);
        if (!client) return;

        const form = document.getElementById('add-client-form');
        document.getElementById('client-id').value = client.id;
        form.elements['razonSocial'].value = client.razonSocial || '';
        form.elements['nombreFantasia'].value = client.nombreFantasia || '';
        form.elements['rut'].value = client.rut || '';
        form.elements['encargado'].value = client.encargado || '';
        form.elements['telefono'].value = client.telefono || '';
        form.elements['correo'].value = client.correo || '';
        form.elements['direccion'].value = client.direccion || '';

        document.getElementById('client-form-title').textContent = 'Editar Cliente';
        const cancelBtn = document.getElementById('cancel-client-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    resetClientForm() {
        const form = document.getElementById('add-client-form');
        if (form) {
            form.reset();
            document.getElementById('client-id').value = '';
            document.getElementById('client-form-title').textContent = 'Crear Cliente';
            const cancelBtn = document.getElementById('cancel-client-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    },

    deleteClient(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;

        const client = state.clients.find(c => c.id === id);

        // Guardar para Deshacer
        state.lastDeleted = { type: 'client', data: { ...client } };

        window.StorageAPI.deleteClient(id);
        state.clients = state.clients.filter(c => c.id !== id);

        this.recordActivity('Baja', 'Cliente', `Eliminado: ${client?.razonSocial}`, { type: 'client', item: client });
        this.showUndoToast(`Cliente "${client?.razonSocial}" eliminado`);
        this.renderClients();
    },

    recordActivity(action, category, details, extraData = null) {
        const log = { action, category, details, extraData };
        window.StorageAPI.saveLog(log);
        state.logs = window.StorageAPI.getLogs(); // Refrescar estado
    },

    renderActivity() {
        const container = document.getElementById('activity-log-container');
        if (!container) return;

        if (state.logs.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay actividad registrada aún.</div>';
            return;
        }

        container.innerHTML = '';
        state.logs.forEach(log => {
            const date = new Date(log.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();

            const logEntry = document.createElement('div');
            logEntry.className = 'activity-item';

            let icon = 'fa-circle-info';
            let color = '#70a0a0';

            if (log.action === 'Alta') { icon = 'fa-circle-plus'; color = '#10b981'; }
            if (log.action === 'Baja') { icon = 'fa-trash-can'; color = '#ef4444'; }
            if (log.action === 'Modificación') { icon = 'fa-pen-to-square'; color = '#008080'; }

            logEntry.innerHTML = `
                <div class="activity-icon" style="color: ${color}">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-header">
                        <span class="activity-action">${log.action}</span>
                        <span class="activity-category">${log.category}</span>
                        <span class="activity-time">${dateStr} ${timeStr}</span>
                    </div>
                    <div class="activity-details">${log.details}</div>
                    ${log.action === 'Baja' && log.extraData && state.currentUser.role === ROLES.ADMIN ? `
                        <button class="btn-text text-primary mt-2" onclick="UI.handleUndoFromLog('${log.id}')">
                            <i class="fa-solid fa-rotate-left"></i> Deshacer Eliminación
                        </button>
                    ` : ''}
                </div>
            `;
            container.appendChild(logEntry);
        });
    },

    // --- MANEJADORES ---

    handleTransactionSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const transaction = {
            id: id || Date.now().toString(),
            type: formData.get('type'),
            amount: parseFloat(formData.get('amount')),
            conceptId: formData.get('concept'),
            clientId: formData.get('client') || null,
            date: formData.get('date'),
            observation: formData.get('observation')
        };

        window.StorageAPI.saveTransaction(transaction); // Debería actualizar si el ID ya existe

        if (id) {
            const index = state.transactions.findIndex(t => t.id === id);
            state.transactions[index] = transaction;
            const concept = state.concepts.find(c => c.id === transaction.conceptId);
            this.recordActivity('Modificación', 'Movimiento', `Actualizado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
        } else {
            state.transactions.push(transaction);
            const concept = state.concepts.find(c => c.id === transaction.conceptId);
            this.recordActivity('Alta', 'Movimiento', `Registrado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
        }

        this.cancelTransactionEdit();
        this.renderDashboard();
    },

    editTransaction(id) {
        const transaction = state.transactions.find(t => t.id === id);
        if (!transaction) return;

        const form = document.getElementById('add-transaction-form');
        document.getElementById('transaction-id').value = transaction.id;

        // Encontrar el radio button correcto
        const radios = form.querySelectorAll('input[name="type"]');
        radios.forEach(r => r.checked = r.value === transaction.type);

        form.elements['amount'].value = transaction.amount;
        form.elements['concept'].value = transaction.conceptId;
        form.elements['client'].value = transaction.clientId || '';
        form.elements['date'].value = transaction.date;
        form.elements['observation'].value = transaction.observation || '';

        document.getElementById('transaction-form-title').textContent = 'Editar Movimiento';
        document.getElementById('btn-save-transaction').textContent = 'Actualizar Movimiento';
        document.getElementById('cancel-transaction-edit').style.display = 'inline-block';

        this.switchView('transaction-form');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    cancelTransactionEdit() {
        const form = document.getElementById('add-transaction-form');
        if (form) {
            form.reset();
            document.getElementById('transaction-form-title').textContent = 'Registrar Movimiento';
            document.getElementById('btn-save-transaction').textContent = 'Guardar Movimiento';
            document.getElementById('cancel-transaction-edit').style.display = 'none';
            // Volver a poner la fecha de hoy
            const dateInput = document.getElementById('date');
            if (dateInput) dateInput.valueAsDate = new Date();
        }
    },

    handleTransactionDelete(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;

        const tx = state.transactions.find(t => t.id === id);
        const concept = state.concepts.find(c => c.id === tx?.conceptId);

        // Guardar para Deshacer
        state.lastDeleted = { type: 'transaction', data: { ...tx } };

        window.StorageAPI.deleteTransaction(id);
        state.transactions = state.transactions.filter(t => t.id !== id);

        this.recordActivity('Baja', 'Movimiento', `Eliminado: ${concept?.name || 'Varios'} por ${formatCurrency(tx?.amount || 0)}`, { type: 'transaction', item: tx });
        this.showUndoToast(`Movimiento de ${formatCurrency(tx?.amount || 0)} eliminado`);

        this.renderTransactionsList();
        this.renderDashboard();
    },

    // --- SISTEMA DE DESHACER (UNDO) ---

    showUndoToast(message) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="btn-undo" onclick="UI.handleUndo()">Deshacer</button>
        `;

        container.appendChild(toast);

        // Auto-eliminar después de 6 segundos
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    },

    handleUndo() {
        if (!state.lastDeleted) return;

        const { type, data } = state.lastDeleted;
        console.log("Deshaciendo eliminación de:", type, data);

        if (type === 'transaction') {
            window.StorageAPI.saveTransaction(data);
            state.transactions.push(data);
            this.renderDashboard();
            this.renderTransactionsList();
        } else if (type === 'concept') {
            window.StorageAPI.saveConcept(data);
            state.concepts.push(data);
            this.renderConcepts();
        } else if (type === 'client') {
            window.StorageAPI.saveClient(data);
            state.clients.push(data);
            this.renderClients();
        }

        this.recordActivity('Restauración', type.charAt(0).toUpperCase() + type.slice(1), `Restaurado ítem eliminado anteriormente`);
        state.lastDeleted = null;

        // Quitar todos los toasts activos
        document.querySelectorAll('.toast').forEach(t => t.remove());
    },

    handleUndoFromLog(logId) {
        const log = state.logs.find(l => l.id === logId);
        if (!log || !log.extraData || log.action !== 'Baja') return;

        const { type, item } = log.extraData;
        console.log("Restaurando desde log:", type, item);

        if (type === 'transaction') {
            window.StorageAPI.saveTransaction(item);
            state.transactions.push(item);
            this.renderDashboard();
            this.renderTransactionsList();
        } else if (type === 'concept') {
            window.StorageAPI.saveConcept(item);
            state.concepts.push(item);
            this.renderConcepts();
            this.renderTransactionFormOptions();
        } else if (type === 'client') {
            window.StorageAPI.saveClient(item);
            state.clients.push(item);
            this.renderClients();
            this.renderTransactionFormOptions();
        }

        this.recordActivity('Restauración', log.category, `Restaurado desde historial: ${log.details}`);

        // Actualizar la vista de actividad para reflejar el cambio
        this.renderActivity();

        // Mostrar confirmación
        this.showUndoToast("Elemento restaurado exitosamente");
    },

    // --- GESTIÓN DE USUARIOS ---

    renderUsers() {
        const tbody = document.getElementById('users-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.name}</td>
                <td>${u.username}</td>
                <td><span class="tag ${u.role === 'administrador' ? 'income' : 'expense'}">${u.role}</span></td>
                <td>
                    <button class="btn-icon" onclick="UI.editUser('${u.id}')"><i class="fa-solid fa-pen"></i></button>
                    ${u.username !== 'administrador' ? `<button class="btn-icon text-danger" onclick="UI.deleteUser('${u.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    handleUserSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = document.getElementById('edit-user-id').value; // Obtener directamente del campo
        const username = formData.get('username').toLowerCase();

        // Evitar duplicados (solo al crear o si se cambia el username)
        const existingUser = state.users.find(u => u.username === username);
        if (existingUser && existingUser.id !== id) {
            this.showUndoToast("Error: El nombre de usuario ya existe");
            return;
        }

        const user = {
            id: id || Date.now().toString(),
            name: formData.get('name'),
            username: username,
            password: formData.get('password'),
            role: formData.get('role')
        };

        if (id) {
            const index = state.users.findIndex(u => u.id === id);
            state.users[index] = user;
            this.recordActivity('Modificación', 'Usuario', `Actualizado: ${user.username}`);
        } else {
            state.users.push(user);
            this.recordActivity('Alta', 'Usuario', `Creado: ${user.username}`);
        }

        window.StorageAPI.saveUsers(state.users);
        this.resetUserForm();
        this.renderUsers();
    },

    editUser(id) {
        const user = state.users.find(u => u.id === id);
        if (!user) return;

        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('user-real-name').value = user.name;
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-password').value = user.password;
        document.getElementById('user-role').value = user.role;

        document.getElementById('btn-save-user').textContent = 'Actualizar Usuario';
        document.getElementById('cancel-user-edit').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    deleteUser(id) {
        const user = state.users.find(u => u.id === id);
        if (user.username === 'administrador') return; // No borrar admin principal

        state.users = state.users.filter(u => u.id !== id);
        window.StorageAPI.saveUsers(state.users);
        this.recordActivity('Baja', 'Usuario', `Eliminado: ${user.username}`);
        this.renderUsers();
    },

    resetUserForm() {
        const form = document.getElementById('add-user-form');
        if (form) {
            form.reset();
            document.getElementById('edit-user-id').value = '';
            document.getElementById('btn-save-user').textContent = 'Crear Usuario';
            document.getElementById('cancel-user-edit').style.display = 'none';
        }
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

        this.recordActivity('Alta', 'Concepto', `Creado concepto: ${concept.name}`);

        e.target.reset();
        this.renderConcepts();
    },

    handleClientSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const client = {
            id: id || Date.now().toString(),
            razonSocial: formData.get('razonSocial'),
            nombreFantasia: formData.get('nombreFantasia'),
            rut: formData.get('rut'),
            encargado: formData.get('encargado'),
            telefono: formData.get('telefono'),
            correo: formData.get('correo'),
            direccion: formData.get('direccion')
        };

        window.StorageAPI.saveClient(client);

        if (id) {
            const index = state.clients.findIndex(c => c.id === id);
            state.clients[index] = client;
            this.recordActivity('Modificación', 'Cliente', `Actualizado: ${client.razonSocial}`);
        } else {
            state.clients.push(client);
            this.recordActivity('Alta', 'Cliente', `Registrado: ${client.razonSocial}`);
        }

        e.target.reset();
        document.getElementById('client-id').value = '';
        document.getElementById('client-form-title').textContent = 'Crear Cliente';
        const cancelBtn = document.getElementById('cancel-client-edit');
        if (cancelBtn) cancelBtn.style.display = 'none';

        this.renderClients();
    }
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => UI.init());
