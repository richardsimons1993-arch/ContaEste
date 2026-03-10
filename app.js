// Estado del Sistema
const state = {
    currentView: 'transaction-form',
    transactions: [],
    concepts: [],
    clients: [],
    debts: [],
    debtors: [],
    suppliers: [],
    contracts: [],
    pendingContracts: [],
    logs: [],
    users: [],
    currentUser: null,
    lastDeleted: null
};

// Roles y Permisos
const ROLES = {
    ADMIN: 'administrador',
    OPERATOR: 'operador',
    VIEWER: 'visualización'
};

const DEFAULT_USERS = [
    { id: '1', username: 'administrador', password: 'S0p0rt3!!2025', role: ROLES.ADMIN, name: 'Admin Simons', modules: ['finanzas', 'usuarios'] },
    { id: '2', username: 'operador', password: 'operador123', role: ROLES.OPERATOR, name: 'Operador Ventas', modules: ['finanzas'] },
    { id: '3', username: 'lector', password: 'lector123', role: ROLES.VIEWER, name: 'Invitado', modules: ['finanzas'] }
];

// Ayudante de Formateo de Moneda
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

// Ayudante de Formateo de Fecha (DD/MM/YYYY)
const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    // Tomar solo la parte de la fecha (YYYY-MM-DD) si viene con hora
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = cleanDate.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

// Formatear monto con puntos mientras se escribe
const formatAmountInput = (input) => {
    let value = input.value.replace(/\D/g, '');
    if (value === "") {
        input.value = "";
        return;
    }
    input.value = new Intl.NumberFormat('es-CL').format(value);
};

// Limpiar formato para guardar (quitar puntos)
const parseAmount = (formattedValue) => {
    return parseFloat(formattedValue.replace(/\./g, '')) || 0;
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
            this.initDatePickers(); // Inicializar Flatpickr
            this.checkPendingContracts(); // Verificar contratos pendientes
            this.renderSuppliers();
            this.renderDebts();
            this.renderDebtors();
            this.populateDebtSupplierSelect();
            this.populateDebtConceptSelect();
            this.populateDebtorClientSelect();

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
        const cleanDate = (d) => (d && d.includes('T')) ? d.split('T')[0] : d;

        state.transactions = (window.StorageAPI.getTransactions() || []).map(t => ({ ...t, date: cleanDate(t.date) }));
        state.concepts = window.StorageAPI.getConcepts() || [];
        state.clients = window.StorageAPI.getClients() || [];
        state.debts = (window.StorageAPI.getDebts() || []).map(d => ({ ...d, dueDate: cleanDate(d.dueDate || d.date), date: cleanDate(d.date) }));
        state.debtors = (window.StorageAPI.getDebtors() || []).map(d => ({ ...d, date: cleanDate(d.date) }));
        state.contracts = (window.StorageAPI.getContracts() || []).map(c => ({ ...c, startDate: cleanDate(c.startDate), endDate: cleanDate(c.endDate) }));
        state.pendingContracts = window.StorageAPI.getPendingContracts() || [];
        state.logs = window.StorageAPI.getLogs() || [];
        state.suppliers = window.StorageAPI.getSuppliers() || [];

        // Cargar usuarios o inicializar con por defecto
        state.users = window.StorageAPI.getUsers() || [];
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

            // Migración: añadir módulos a usuarios existentes que no los tengan
            let needsSave = false;
            state.users.forEach(user => {
                if (!user.modules) {
                    if (user.role === ROLES.ADMIN) {
                        user.modules = ['finanzas', 'usuarios'];
                    } else if (user.role === ROLES.OPERATOR) {
                        user.modules = ['finanzas'];
                    } else {
                        user.modules = ['finanzas'];
                    }
                    needsSave = true;
                }
            });
            if (needsSave) {
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
        if (txForm) {
            txForm.addEventListener('submit', (e) => this.handleTransactionSubmit(e));

            // Sincronizar Tipo (Ingreso/Egreso) según concepto seleccionado
            const conceptSelect = txForm.querySelector('#concept');
            if (conceptSelect) {
                conceptSelect.addEventListener('change', (e) => {
                    const conceptId = e.target.value;
                    if (!conceptId) return;

                    const concept = state.concepts.find(c => c.id === conceptId);
                    if (concept) {
                        const typeRadio = txForm.querySelector(`input[name="type"][value="${concept.type}"]`);
                        if (typeRadio) typeRadio.checked = true;
                    }
                });
            }
        }

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

        // --- DEUDAS & DEUDORES ---
        const debtForm = document.getElementById('add-debt-form');
        if (debtForm) debtForm.addEventListener('submit', (e) => this.handleDebtSubmit(e));

        const cancelDebtEditBtn = document.getElementById('cancel-debt-edit');
        if (cancelDebtEditBtn) {
            cancelDebtEditBtn.addEventListener('click', () => this.resetDebtForm());
        }

        const debtorForm = document.getElementById('add-debtor-form');
        if (debtorForm) debtorForm.addEventListener('submit', (e) => this.handleDebtorSubmit(e));

        const cancelDebtorEditBtn = document.getElementById('cancel-debtor-edit');
        if (cancelDebtorEditBtn) {
            cancelDebtorEditBtn.addEventListener('click', () => this.resetDebtorForm());
        }

        // Suppliers
        const supplierForm = document.getElementById('add-supplier-form');
        if (supplierForm) supplierForm.addEventListener('submit', (e) => this.handleSupplierSubmit(e));

        const cancelSupplierEditBtn = document.getElementById('cancel-supplier-edit');
        if (cancelSupplierEditBtn) cancelSupplierEditBtn.addEventListener('click', () => this.resetSupplierForm());

        // --- CONTRATOS ---
        const contractForm = document.getElementById('add-contract-form');
        if (contractForm) contractForm.addEventListener('submit', (e) => this.handleContractSubmit(e));

        const cancelContractEditBtn = document.getElementById('cancel-contract-edit');
        if (cancelContractEditBtn) cancelContractEditBtn.addEventListener('click', () => this.resetContractForm());

        const contractsReminderBtn = document.getElementById('contracts-reminder-btn');
        if (contractsReminderBtn) contractsReminderBtn.addEventListener('click', () => {
            UI.switchView('alerts');
        });

        const alertTabBtns = document.querySelectorAll('.alert-tab-btn');
        alertTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;
                document.querySelectorAll('.alert-tab-content').forEach(c => c.style.display = 'none');
                document.querySelectorAll('.alert-tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.fontWeight = 'normal';
                    b.style.borderBottom = 'none';
                });
                document.getElementById(targetTab).style.display = 'block';
                e.target.classList.add('active');
                e.target.style.fontWeight = 'bold';
                e.target.style.borderBottom = '2px solid var(--primary-color)';
            });
        });

        // Exportar Deudas
        const btnExportDebtExcel = document.getElementById('btn-export-debts-excel');
        if (btnExportDebtExcel) btnExportDebtExcel.addEventListener('click', () => this.exportDebtsToExcel());

        const btnExportDebtPDF = document.getElementById('btn-export-debts-pdf');
        if (btnExportDebtPDF) btnExportDebtPDF.addEventListener('click', () => this.exportDebtsToPDF());

        // Exportar Deudores
        const btnExportDebtorExcel = document.getElementById('btn-export-debtors-excel');
        if (btnExportDebtorExcel) btnExportDebtorExcel.addEventListener('click', () => this.exportDebtorsToExcel());

        const btnExportDebtorPDF = document.getElementById('btn-export-debtors-pdf');
        if (btnExportDebtorPDF) btnExportDebtorPDF.addEventListener('click', () => this.exportDebtorsToPDF());



        // --- FILTROS ADICIONALES ---
        const filterType = document.getElementById('filter-type');
        const filterDateStart = document.getElementById('filter-date-start');
        const filterDateEnd = document.getElementById('filter-date-end');

        if (filterType) filterType.addEventListener('change', () => this.renderTransactionsList());
        if (filterDateStart) filterDateStart.addEventListener('change', () => this.renderTransactionsList());
        if (filterDateEnd) filterDateEnd.addEventListener('change', () => this.renderTransactionsList());

        // --- EXPORTAR ---
        const btnExportTxExcel = document.getElementById('btn-export-transactions-excel');
        if (btnExportTxExcel) {
            console.log("Botón exportar excel encontrado, agregando listener");
            btnExportTxExcel.addEventListener('click', () => {
                try {
                    UI.exportTransactionsToExcel();
                } catch (err) {
                    console.error("Error al invocar exportación:", err);
                    alert("Error interno al intentar exportar: " + err.message);
                }
            });
        } else {
            console.error("Botón exportar excel NO encontrado en el DOM");
        }

        const btnExportTxPDF = document.getElementById('btn-export-transactions-pdf');
        if (btnExportTxPDF) btnExportTxPDF.addEventListener('click', () => this.exportTransactionsToPDF());

        const btnExportBalExcel = document.getElementById('btn-export-balance-excel');
        if (btnExportBalExcel) btnExportBalExcel.addEventListener('click', () => this.exportBalanceToExcel());

        const btnExportBalPDF = document.getElementById('btn-export-balance-pdf');
        if (btnExportBalPDF) btnExportBalPDF.addEventListener('click', () => this.exportBalanceToPDF());

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

        // Listener para cambio de rol (deshabilitar módulo usuarios si no es admin)
        const roleSelect = document.getElementById('user-role');
        if (roleSelect) {
            roleSelect.addEventListener('change', (e) => {
                const moduleUsuariosCheckbox = document.getElementById('module-usuarios');
                if (moduleUsuariosCheckbox) {
                    if (e.target.value !== ROLES.ADMIN) {
                        moduleUsuariosCheckbox.checked = false;
                        moduleUsuariosCheckbox.disabled = true;
                    } else {
                        moduleUsuariosCheckbox.disabled = false;
                    }
                }
            });
        }

        // Cerrar dropdown de usuario al hacer clic fuera
        document.addEventListener('click', () => {
            const menu = document.getElementById('user-dropdown-menu');
            if (menu) menu.classList.remove('active');
        });

        // --- FORMATEO DE MONTOS EN TIEMPO REAL ---
        document.querySelectorAll('.amount-input').forEach(input => {
            input.addEventListener('input', (e) => formatAmountInput(e.target));
        });
    },

    // --- AUTENTICACIÓN ---

    checkSession() {
        const savedSession = localStorage.getItem('contabilidad_session');
        if (savedSession) {
            const sessionUser = JSON.parse(savedSession);
            // Sincronizar con datos actuales para obtener módulos actualizados
            const freshUser = state.users.find(u => u.id === sessionUser.id);

            if (freshUser) {
                state.currentUser = freshUser;
                // Actualizar sesión almacenada
                localStorage.setItem('contabilidad_session', JSON.stringify(freshUser));
            } else {
                state.currentUser = sessionUser;
            }

            document.body.classList.remove('login-pending');
            this.updateUserUI();
            this.applyModuleAccess(); // Aplicar acceso por módulos al cargar sesión
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
            name: user.name,
            modules: user.modules || []
        };
        localStorage.setItem('contabilidad_session', JSON.stringify(state.currentUser));
        document.body.classList.remove('login-pending');
        errorEl.style.display = 'none';
        e.target.reset();

        this.updateUserUI();
        this.applyPrivileges();
        this.applyModuleAccess(); // Aplicar acceso por módulos
        const firstView = this.getFirstAvailableView(state.currentUser.modules);
        this.switchView(firstView);
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

        // 3. Mostrar/Ocultar botón Usuarios (deprecated - ahora se maneja por módulos)
        // La visibilidad se controla en applyModuleAccess()
    },

    applyModuleAccess() {
        const userModules = state.currentUser?.modules || [];
        console.log("Aplicando acceso a módulos:", userModules);

        // Ocultar/mostrar secciones de navegación según módulos
        document.querySelectorAll('.nav-section').forEach(section => {
            const module = section.dataset.module;
            if (module) {
                if (userModules.includes(module)) {
                    section.style.display = 'block';
                } else {
                    section.style.display = 'none';
                }
            }
        });

        // Proteger vistas: si el usuario intenta acceder a una vista no permitida
        const currentView = state.currentView;
        const viewModuleMap = {
            'transaction-form': 'finanzas',
            'concepts': 'finanzas',
            'clients': 'finanzas',
            'transactions': 'finanzas',
            'debts': 'finanzas',
            'debtors': 'finanzas',
            'contracts': 'finanzas',
            'suppliers': 'finanzas',
            'dashboard': 'finanzas',
            'activity': 'finanzas',
            'users': 'usuarios'
        };

        const requiredModule = viewModuleMap[currentView];
        if (requiredModule && !userModules.includes(requiredModule)) {
            // Redirigir a la primera vista disponible
            const firstAvailableView = this.getFirstAvailableView(userModules);
            this.switchView(firstAvailableView);
        }
    },

    getFirstAvailableView(modules) {
        if (modules.includes('finanzas')) return 'transaction-form';
        if (modules.includes('usuarios')) return 'users';
        return 'transaction-form'; // Fallback
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
            'suppliers': 'Proveedores',
            'debts': 'Deudas',
            'debtors': 'Deudores',
            'contracts': 'Contratos',
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
        if (viewName === 'debts') this.renderDebts();
        if (viewName === 'debtors') this.renderDebtors();
        if (viewName === 'contracts') this.renderContracts();
        if (viewName === 'activity') this.renderActivity();
        if (viewName === 'users') this.renderUsers();

        // Resetear formularios si se sale de la sección
        if (viewName !== 'transaction-form') this.cancelTransactionEdit();
        if (viewName !== 'clients') this.resetClientForm();
        if (viewName !== 'debts') this.resetDebtForm();
        if (viewName !== 'debtors') this.resetDebtorForm();
        if (viewName !== 'contracts') this.resetContractForm();
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
            // Asegurar que solo tomamos la parte de fecha antes de añadir T00:00:00
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');

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
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');
            if (tDate.getFullYear() < currentYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        // Agregar datos del año actual
        transactions.forEach(t => {
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');
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

    getFilteredTransactions() {
        let displayedTransactions = state.transactions;

        // 1. Filtro Tipo
        const filterType = document.getElementById('filter-type');
        if (filterType && filterType.value !== 'all') {
            displayedTransactions = displayedTransactions.filter(t => t.type === filterType.value);
        }

        // 2. Filtro Fechas
        const filterDateStart = document.getElementById('filter-date-start');
        const filterDateEnd = document.getElementById('filter-date-end');

        if (filterDateStart && filterDateStart.value) {
            displayedTransactions = displayedTransactions.filter(t => t.date >= filterDateStart.value);
        }
        if (filterDateEnd && filterDateEnd.value) {
            displayedTransactions = displayedTransactions.filter(t => t.date <= filterDateEnd.value);
        }

        // 3. Filtro Conceptos (Checkboxes)
        const selectedConcepts = Array.from(document.querySelectorAll('#menu-dropdown-concept input:checked')).map(cb => cb.value);
        if (selectedConcepts.length > 0) {
            displayedTransactions = displayedTransactions.filter(t => selectedConcepts.includes(t.conceptId));
        }

        // 4. Filtro Clientes (Checkboxes)
        const selectedClients = Array.from(document.querySelectorAll('#menu-dropdown-client input:checked')).map(cb => cb.value);
        if (selectedClients.length > 0) {
            displayedTransactions = displayedTransactions.filter(t => t.clientId && selectedClients.includes(t.clientId));
        }

        return displayedTransactions;
    },

    renderTransactionsList() {
        const tbody = document.getElementById('transactions-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Obtener Transacciones Filtradas
        const displayedTransactions = this.getFilteredTransactions();

        // Ordenar
        const sorted = [...displayedTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        let totalSum = 0;

        sorted.forEach(t => {
            const amount = parseFloat(t.amount);
            if (t.type === 'income') totalSum += amount;
            else totalSum -= amount;

            const row = document.createElement('tr');
            const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';
            const client = state.clients.find(c => c.id === t.clientId);
            const clientName = client ? (client.razonSocial || client.name) : '-';

            row.innerHTML = `
                <td>${formatDate(t.date)}</td>
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
        const contractClientSelect = document.getElementById('contract-client');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccionar Cliente</option>';
            if (contractClientSelect) contractClientSelect.innerHTML = '<option value="">Seleccionar Cliente</option>';
            state.clients.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.razonSocial || c.name || 'Sin Nombre';
                clientSelect.appendChild(option);

                if (contractClientSelect) {
                    const opt = option.cloneNode(true);
                    contractClientSelect.appendChild(opt);
                }
            });
        }

        // 2. Desplegables de Filtros Personalizados
        this.renderCustomDropdownOptions('concept', state.concepts, 'name');
        this.renderCustomDropdownOptions('client', state.clients, 'razonSocial');
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
                    <button class="btn-icon text-info" title="Ver Historial" onclick="UI.viewClientHistory('${c.id}')">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
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

        this.switchView('clients');
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

    viewClientHistory(id) {
        const client = state.clients.find(c => c.id === id);
        if (!client) return;

        const historyModal = document.getElementById('contract-history-modal');
        const clientNameSpan = document.getElementById('history-client-name');
        const historyBody = document.getElementById('history-contract-body');

        if (clientNameSpan) clientNameSpan.textContent = client.razonSocial || client.name;
        if (historyBody) historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando...</td></tr>';

        if (historyModal) historyModal.style.display = 'flex';

        // Fix missing listener attaching conditionally (since this can run multiple times, doing it once in setupEventListeners is better, but doing it on click is safer if missing)
        const closeBtn = document.getElementById('close-history-modal');
        if (closeBtn && !closeBtn.hasAttribute('data-bound')) {
            closeBtn.setAttribute('data-bound', 'true');
            closeBtn.addEventListener('click', () => { historyModal.style.display = 'none'; });
        }

        const historyData = window.StorageAPI.getContractHistory(id);

        if (historyBody) {
            historyBody.innerHTML = '';
            if (historyData.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay historial de facturación para este cliente.</td></tr>';
            } else {
                historyData.forEach(h => {
                    const tr = document.createElement('tr');

                    let debtStatusTag = '';
                    if (h.debtStatus === 'pending') {
                        debtStatusTag = '<span class="tag expense">Pendiente</span>';
                    } else if (h.debtStatus === 'paid') {
                        debtStatusTag = '<span class="tag income">Pagada</span>';
                    } else {
                        debtStatusTag = '<span class="tag">Desconocido</span>';
                    }

                    tr.innerHTML = `
                        <td>${h.periodName}</td>
                        <td>${formatDate(h.issueDate)}</td>
                        <td>${formatCurrency(h.amount)}</td>
                        <td>${debtStatusTag} (${h.debtorId || '-'})</td>
                    `;
                    historyBody.appendChild(tr);
                });
            }
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

    // --- LOGICA DEUDAS ---

    renderDebts() {
        const tbody = document.getElementById('debts-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.debts.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(d.date)}</td>
                <td>${d.titular}</td>
                <td>${d.description || '-'}</td>
                <td style="font-weight:bold; color: var(--danger-color)">${formatCurrency(d.amount)}</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editDebt('${d.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteDebt('${d.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
    },

    renderDebts() {
        const tbody = document.getElementById('debts-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.debts.forEach(d => {
            const tr = document.createElement('tr');
            // Mapear IDs a nombres para mostrar
            const supplier = state.suppliers.find(s => s.id === d.supplierId);
            const concept = state.concepts.find(c => c.id === d.conceptId);
            const supplierTitle = supplier ? supplier.name : (d.titular || d.creditor || '-');
            const conceptTitle = concept ? concept.name : '-';

            tr.innerHTML = `
                <td>${formatDate(d.dueDate || d.date)}</td>
                <td>${supplierTitle}</td>
                <td>${conceptTitle}</td>
                <td style="font-weight:bold; color: var(--danger-color)">${formatCurrency(d.amount)}</td>
                <td>${d.description || '-'}</td>
                <td class="actions">
                    <button class="btn-icon text-success" title="Marcar como Pagada" onclick="UI.payDebt('${d.id}')">
                        <i class="fa-solid fa-check-double"></i>
                    </button>
                    <button class="btn-icon" title="Editar" onclick="UI.editDebt('${d.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteDebt('${d.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
    },

    handleDebtSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        // Obtener nombre del proveedor seleccionado para guardar en 'titular' como fallback
        const supplierSelect = document.getElementById('debt-supplier-select');
        const supplierName = supplierSelect && supplierSelect.options[supplierSelect.selectedIndex] ? supplierSelect.options[supplierSelect.selectedIndex].text : '';

        const debt = {
            id: id || Date.now().toString(),
            supplierId: formData.get('supplierId'),
            titular: supplierName, // Fallback para compatibilidad
            amount: parseAmount(formData.get('amount')),
            dueDate: formData.get('dueDate'),
            conceptId: formData.get('conceptId'),
            description: formData.get('description'),
            status: 'pending'
        };

        window.StorageAPI.saveDebt(debt);

        if (id) {
            this.recordActivity('Modificación', 'Deuda', `Actualizada deuda de ${debt.titular}`);
        } else {
            this.recordActivity('Alta', 'Deuda', `Registrada deuda de ${debt.titular}`);
        }

        this.loadData();
        this.switchView('debts');
    },

    editDebt(id) {
        const debt = state.debts.find(d => d.id === id);
        if (!debt) return;

        const form = document.getElementById('add-debt-form');
        document.getElementById('debt-id').value = debt.id;
        form.elements['supplierId'].value = debt.supplierId || '';
        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(debt.amount);
        form.elements['dueDate'].value = debt.dueDate || debt.date;
        form.elements['conceptId'].value = debt.conceptId || '';
        form.elements['description'].value = debt.description || '';

        document.getElementById('debt-form-title').textContent = 'Editar Deuda';
        const cancelBtn = document.getElementById('cancel-debt-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    payDebt(id) {
        if (!confirm('¿Estás seguro de que quieres marcar esta deuda como pagada? Se eliminará de Deudas y se creará un egreso en Movimientos.')) return;

        window.StorageAPI.payDebt(id);
        this.showToast('Deuda pagada. Movimiento de egreso registrado.', 'success');
        this.loadData();
        this.renderDebts();
    },

    populateDebtSupplierSelect() {
        const sel = document.getElementById('debt-supplier-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar Proveedor</option>';
        state.suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            sel.appendChild(opt);
        });
    },

    populateDebtConceptSelect() {
        const sel = document.getElementById('debt-concept-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar Concepto</option>';
        state.concepts.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });
    },

    // --- LOGICA PROVEEDORES ---

    renderSuppliers() {
        const tbody = document.getElementById('suppliers-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.suppliers.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.name}</td>
                <td>${s.rut || '-'}</td>
                <td>${s.encargado || '-'}</td>
                <td>${s.phone || '-'}</td>
                <td>${s.email || '-'}</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editSupplier('${s.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteSupplier('${s.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
    },

    handleSupplierSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const supplier = {
            id: id || Date.now().toString(),
            name: formData.get('name'),
            rut: formData.get('rut'),
            encargado: formData.get('encargado'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            address: formData.get('address')
        };

        window.StorageAPI.saveSupplier(supplier);

        if (id) {
            this.recordActivity('Modificación', 'Proveedor', `Actualizado proveedor ${supplier.name}`);
        } else {
            this.recordActivity('Alta', 'Proveedor', `Registrado proveedor ${supplier.name}`);
        }

        this.loadData();
        this.resetSupplierForm();
        this.renderSuppliers();
        this.populateDebtSupplierSelect();
    },

    editSupplier(id) {
        const supplier = state.suppliers.find(s => s.id === id);
        if (!supplier) return;

        const form = document.getElementById('add-supplier-form');
        document.getElementById('supplier-id').value = supplier.id;
        form.elements['name'].value = supplier.name;
        form.elements['rut'].value = supplier.rut || '';
        form.elements['encargado'].value = supplier.encargado || '';
        form.elements['phone'].value = supplier.phone || '';
        form.elements['email'].value = supplier.email || '';
        form.elements['address'].value = supplier.address || '';

        document.getElementById('supplier-form-title').textContent = 'Editar Proveedor';
        const cancelBtn = document.getElementById('cancel-supplier-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    resetSupplierForm() {
        const form = document.getElementById('add-supplier-form');
        if (form) {
            form.reset();
            document.getElementById('supplier-id').value = '';
            document.getElementById('supplier-form-title').textContent = 'Registrar Proveedor';
            const cancelBtn = document.getElementById('cancel-supplier-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    },

    deleteSupplier(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        if (!confirm('¿Estás seguro de que quieres eliminar este proveedor?')) return;

        const supplier = state.suppliers.find(s => s.id === id);
        window.StorageAPI.deleteSupplier(id);
        state.suppliers = state.suppliers.filter(s => s.id !== id);
        this.recordActivity('Baja', 'Proveedor', `Eliminado proveedor ${supplier?.name}`);
        this.renderSuppliers();
        this.populateDebtSupplierSelect();
    },

    resetDebtForm() {
        const form = document.getElementById('add-debt-form');
        if (form) {
            form.reset();
            document.getElementById('debt-id').value = '';
            document.getElementById('debt-form-title').textContent = 'Registrar Deuda';
            const cancelBtn = document.getElementById('cancel-debt-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    },

    deleteDebt(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        const debt = state.debts.find(d => d.id === id);
        window.StorageAPI.deleteDebt(id);
        state.debts = state.debts.filter(d => d.id !== id);
        this.recordActivity('Baja', 'Deuda', `Eliminada deuda a ${debt?.titular}`);
        this.renderDebts();
    },

    // --- LOGICA DEUDORES ---

    renderDebtors() {
        const tbody = document.getElementById('debtors-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.debtors.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(d.date)}</td>
                <td>${d.titular}</td>
                <td>${d.description || '-'}</td>
                <td style="font-weight:bold; color: var(--secondary-color)">${formatCurrency(d.amount)}</td>
                <td class="actions">
                    <button class="btn-icon text-success" title="Marcar como Pagado" onclick="UI.payDebtor('${d.id}')">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button class="btn-icon" title="Editar" onclick="UI.editDebtor('${d.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteDebtor('${d.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
        this.populateDebtorClientSelect();
    },

    handleDebtorSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const debtor = {
            id: id || Date.now().toString(),
            titular: formData.get('titular'),
            amount: parseAmount(formData.get('amount')),
            date: formData.get('date'),
            description: formData.get('description')
        };

        window.StorageAPI.saveDebtor(debtor);

        if (id) {
            this.recordActivity('Modificación', 'Deudor', `Actualizado deudor ${debtor.titular}`);
        } else {
            this.recordActivity('Alta', 'Deudor', `Registrado deudor ${debtor.titular}`);
        }

        this.loadData();
        this.switchView('debtors');
    },

    editDebtor(id) {
        const debtor = state.debtors.find(d => d.id === id);
        if (!debtor) return;

        this.populateDebtorClientSelect(debtor.titular);

        const form = document.getElementById('add-debtor-form');
        document.getElementById('debtor-id').value = debtor.id;
        form.elements['titular'].value = debtor.titular;
        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(debtor.amount);
        form.elements['date'].value = debtor.date;
        form.elements['description'].value = debtor.description || '';

        document.getElementById('debtor-form-title').textContent = 'Editar Deudor';
        const cancelBtn = document.getElementById('cancel-debtor-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    resetDebtorForm() {
        const form = document.getElementById('add-debtor-form');
        if (form) {
            form.reset();
            document.getElementById('debtor-id').value = '';
            document.getElementById('debtor-form-title').textContent = 'Registrar Deudor';
            const cancelBtn = document.getElementById('cancel-debtor-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
        // Poblar select de clientes
        this.populateDebtorClientSelect();
    },

    populateDebtorClientSelect(selectedName) {
        const sel = document.getElementById('debtor-client-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar Cliente</option>';
        state.clients.forEach(c => {
            const name = c.razonSocial || c.name;
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (selectedName && selectedName === name) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    deleteDebtor(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        const debtor = state.debtors.find(d => d.id === id);
        window.StorageAPI.deleteDebtor(id);
        state.debtors = state.debtors.filter(d => d.id !== id);
        this.recordActivity('Baja', 'Deudor', `Eliminado deudor ${debtor?.titular}`);
        this.renderDebtors();
    },

    payDebtor(id) {
        if (!confirm('¿Estás seguro de que quieres marcar esta deuda como pagada? Esto la eliminará de Deudores y creará un ingreso en Movimientos.')) return;

        window.StorageAPI.payDebtor(id);
        this.showToast('Deuda liquidada. Movimiento creado.', 'success');

        this.loadData();
    },

    recordActivity(action, module, details, extraData = null) {
        const log = {
            action,
            module,
            details,
            extraData,
            userName: state.currentUser?.name || state.currentUser?.username || 'Sistema'
        };
        window.StorageAPI.saveLog(log);
        state.logs = window.StorageAPI.getLogs() || []; // Refrescar estado
        // Si estamos en la vista de actividad, re-renderizar
        if (state.currentView === 'activity') this.renderActivity();
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
            // Formato DD/MM/YYYY manual para coherencia
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const dateStr = `${day}/${month}/${year}`;

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
                        <span class="activity-category">${log.module || log.category || 'Varios'}</span>
                        <span class="activity-user" style="color: var(--text-muted); font-size: 0.85rem; margin-right: auto; margin-left: 10px;">
                            <i class="fa-solid fa-user"></i> ${log.userName || 'Sistema'}
                        </span>
                        <span class="activity-time">${dateStr} ${timeStr}</span>
                    </div>
                    <div class="activity-details">${log.details}</div>
                    ${log.action === 'Baja' && log.extraData && state.currentUser.role === 'administrador' ? `
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

        let type = formData.get('type');
        const conceptId = formData.get('concept');
        const concept = state.concepts.find(c => c.id === conceptId);

        // Seguridad: Si el concepto tiene un tipo definido, forzar ese tipo
        if (concept && concept.type) {
            type = concept.type;
        }

        const transaction = {
            id: id || Date.now().toString(),
            type: type,
            amount: parseAmount(formData.get('amount')),
            conceptId: conceptId,
            clientId: formData.get('client') || null,
            date: formData.get('date'),
            observation: formData.get('observation')
        };

        window.StorageAPI.saveTransaction(transaction); // Debería actualizar si el ID ya existe

        if (id) {
            this.recordActivity('Modificación', 'Movimiento', `Actualizado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
        } else {
            this.recordActivity('Alta', 'Movimiento', `Registrado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
        }

        this.loadData();
        this.switchView('transactions');
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

        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(transaction.amount);
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
            const idInput = document.getElementById('transaction-id');
            if (idInput) idInput.value = '';
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

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '';
        if (type === 'success') icon = '<i class="fa-solid fa-check-circle"></i>';
        if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation"></i>';
        if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

        toast.innerHTML = `
            ${icon}
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        // Auto-eliminar
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

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
        const log = state.logs.find(l => l.id == logId);
        if (!log || !log.extraData || log.action !== 'Baja') {
            console.warn("No se puede deshacer: log inválido o sin datos extra", log);
            return;
        }

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

        this.recordActivity('Restauración', log.module || log.category || 'Varios', `Restaurado desde historial: ${log.details}`);

        this.renderActivity();
        this.showUndoToast("Elemento restaurado exitosamente");
    },

    // --- GESTIÓN DE USUARIOS ---

    renderUsers() {
        const tbody = document.getElementById('users-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.users.forEach(u => {
            const tr = document.createElement('tr');
            const modulesDisplay = (u.modules || []).join(', ') || 'Ninguno';
            tr.innerHTML = `
                <td>${u.name}</td>
                <td>${u.username}</td>
                <td><span class="tag ${u.role === 'administrador' ? 'income' : 'expense'}">${u.role}</span></td>
                <td><small style="color: var(--text-muted);">${modulesDisplay}</small></td>
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

        // Capturar módulos seleccionados
        const selectedModules = Array.from(
            document.querySelectorAll('.module-checkbox:checked')
        ).map(cb => cb.value);

        const user = {
            id: id || Date.now().toString(),
            name: formData.get('name'),
            username: username,
            password: formData.get('password'),
            role: formData.get('role'),
            modules: selectedModules
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

        // Marcar módulos
        document.querySelectorAll('.module-checkbox').forEach(cb => {
            cb.checked = (user.modules || []).includes(cb.value);
            // Deshabilitar "usuarios" si no es admin
            if (cb.id === 'module-usuarios' && user.role !== ROLES.ADMIN) {
                cb.disabled = true;
            }
        });

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
        if (form) form.reset();
        document.getElementById('edit-user-id').value = '';
        document.getElementById('btn-save-user').textContent = 'Crear Usuario';
        document.getElementById('cancel-user-edit').style.display = 'none';

        // Re-habilitar selector de rol si estaba deshabilitado (no debería, pero por si acaso)
        // Y resetear checkboxes
        const roleSelect = document.getElementById('user-role');
        if (roleSelect) roleSelect.dispatchEvent(new Event('change'));
    },

    // --- EXPORTACIÓN ---

    exportTransactionsToExcel() {
        if (!window.XLSX) {
            this.showToast('Error: Librería Excel no cargada. Verifique su conexión internet.', 'error');
            return;
        }

        try {
            // Usar método centralizado de filtrado
            const dataToExport = this.getFilteredTransactions();

            if (dataToExport.length === 0) {
                this.showToast('No hay movimientos visibles para exportar (verifique los filtros)', 'warning');
                return;
            }

            // Mapear datos a formato amigable
            const exportData = dataToExport.map(t => {
                const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';
                const client = state.clients.find(c => c.id === t.clientId);
                const clientName = client ? (client.razonSocial || client.name) : '-';
                return {
                    Fecha: t.date,
                    Tipo: t.type === 'income' ? 'Ingreso' : 'Egreso',
                    Concepto: conceptName,
                    Cliente: clientName,
                    Observacion: t.observation || '',
                    Monto: parseFloat(t.amount)
                };
            });

            // Crear Libro de Excel
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(exportData);

            // Ajustar ancho de columnas
            const wscols = [
                { wch: 12 }, // Fecha
                { wch: 10 }, // Tipo
                { wch: 25 }, // Concepto
                { wch: 25 }, // Cliente
                { wch: 30 }, // Obs
                { wch: 15 }  // Monto
            ];
            ws['!cols'] = wscols;

            XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
            XLSX.writeFile(wb, "Movimientos.xlsx");
            this.showToast('Exportación a Excel completada', 'success');
        } catch (error) {
            console.error(error);
            this.showToast('Error al exportar Excel: ' + error.message, 'error');
        }
    },

    exportTransactionsToPDF() {
        if (!window.jspdf) {
            this.showToast('Error cargando librería PDF', 'error');
            return;
        }

        // Usar método centralizado de filtrado
        const dataToExport = this.getFilteredTransactions();

        // Ordenar por fecha
        dataToExport.sort((a, b) => new Date(b.date) - new Date(a.date));

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Título
        doc.setFontSize(18);
        doc.text("Reporte de Movimientos", 14, 22);
        doc.setFontSize(11);
        doc.text(`Fecha de emisión: ${new Date().toLocaleDateString()}`, 14, 30);

        // Datos para tabla
        const tableBody = dataToExport.map(t => {
            const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';
            const client = state.clients.find(c => c.id === t.clientId);
            const clientName = client ? (client.razonSocial || client.name) : '-';
            return [
                t.date,
                t.type === 'income' ? 'Ingreso' : 'Egreso',
                conceptName,
                clientName,
                formatCurrency(t.amount)
            ];
        });

        doc.autoTable({
            startY: 40,
            head: [['Fecha', 'Tipo', 'Concepto', 'Cliente', 'Monto']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66] },
        });

        doc.save("Movimientos.pdf");
        this.showToast('Exportación a PDF completada', 'success');
    },

    exportBalanceToExcel() {
        if (!window.XLSX) {
            this.showToast('Error: Librería Excel no cargada. Verifique su conexión internet.', 'error');
            return;
        }

        // Recalcular datos del Resumen Anual (logica duplicada de renderDashboard por necesidad de datos puros)
        const transactions = state.transactions;
        const currentYear = new Date().getFullYear();
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const yearData = Array(12).fill(null).map(() => ({ income: 0, expense: 0 }));

        // Saldo Inicial
        let accumulatedBalance = 0;
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() < currentYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        // Datos del año
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() === currentYear) {
                const m = tDate.getMonth();
                if (t.type === 'income') yearData[m].income += parseFloat(t.amount);
                if (t.type === 'expense') yearData[m].expense += parseFloat(t.amount);
            }
        });

        // Construir array para Excel
        const exportData = [];
        // Fila inicial de saldo anterior si se desea (opcional, aqui pondremos solo la tabla anual)

        yearData.forEach((data, index) => {
            const monthlyNet = data.income - data.expense;
            accumulatedBalance += monthlyNet;

            exportData.push({
                Mes: monthNames[index],
                Ingresos: data.income,
                Egresos: data.expense,
                Saldo_Mensual: monthlyNet,
                Saldo_Acumulado: accumulatedBalance
            });
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);

        // Anchos
        ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }];

        XLSX.utils.book_append_sheet(wb, ws, `Balance ${currentYear}`);
        XLSX.writeFile(wb, `Balance_${currentYear}.xlsx`);
        this.showToast('Exportación a Excel completada', 'success');
    },

    exportBalanceToPDF() {
        if (!window.jspdf) {
            this.showToast('Error cargando librería PDF', 'error');
            return;
        }

        const transactions = state.transactions;
        const currentYear = new Date().getFullYear();
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const yearData = Array(12).fill(null).map(() => ({ income: 0, expense: 0 }));

        let accumulatedBalance = 0;
        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() < currentYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        transactions.forEach(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            if (tDate.getFullYear() === currentYear) {
                const m = tDate.getMonth();
                if (t.type === 'income') yearData[m].income += parseFloat(t.amount);
                if (t.type === 'expense') yearData[m].expense += parseFloat(t.amount);
            }
        });

        const tableBody = yearData.map((data, index) => {
            const monthlyNet = data.income - data.expense;
            accumulatedBalance += monthlyNet;
            return [
                monthNames[index],
                formatCurrency(data.income),
                formatCurrency(data.expense),
                formatCurrency(monthlyNet),
                formatCurrency(accumulatedBalance)
            ];
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text(`Balance Anual - ${currentYear}`, 14, 22);
        doc.setFontSize(11);
        doc.text(`Fecha de emisión: ${new Date().toLocaleDateString()}`, 14, 30);

        doc.autoTable({
            startY: 40,
            head: [['Mes', 'Ingresos', 'Egresos', 'Saldo Mes', 'Acumulado']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
        });

        doc.save(`Balance_${currentYear}.pdf`);
        this.showToast('Exportación a PDF completada', 'success');
    },

    // --- EXPORTAR DEUDAS ---

    exportDebtsToExcel() {
        if (!window.XLSX) return this.showToast('Librería Excel no disponible', 'error');

        if (state.debts.length === 0) return this.showToast('No hay deudas para exportar', 'warning');

        const exportData = state.debts.map(d => ({
            Fecha: d.date,
            Titular: d.titular,
            Descripcion: d.description || '',
            Monto: d.amount
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        ws['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 15 }];

        XLSX.utils.book_append_sheet(wb, ws, "Deudas");
        XLSX.writeFile(wb, "Deudas.xlsx");
        this.showToast('Deudas exportadas a Excel', 'success');
    },

    exportDebtsToPDF() {
        if (!window.jspdf) return this.showToast('Librería PDF no disponible', 'error');
        if (state.debts.length === 0) return this.showToast('No hay deudas para exportar', 'warning');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text("Listado de Deudas", 14, 22);
        doc.setFontSize(11);
        doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 30);

        const tableBody = state.debts.map(d => [
            d.date,
            d.titular,
            d.description || '',
            formatCurrency(d.amount)
        ]);

        doc.autoTable({
            startY: 40,
            head: [['Fecha', 'Titular', 'Descripción', 'Monto']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 53, 69] } // Danger Colorish
        });

        doc.save("Deudas.pdf");
        this.showToast('Deudas exportadas a PDF', 'success');
    },

    // --- EXPORTAR DEUDORES ---

    exportDebtorsToExcel() {
        if (!window.XLSX) return this.showToast('Librería Excel no disponible', 'error');

        if (state.debtors.length === 0) return this.showToast('No hay deudores para exportar', 'warning');

        const exportData = state.debtors.map(d => ({
            Fecha: d.date,
            Titular: d.titular,
            Descripcion: d.description || '',
            Monto: d.amount
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        ws['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 15 }];

        XLSX.utils.book_append_sheet(wb, ws, "Deudores");
        XLSX.writeFile(wb, "Deudores.xlsx");
        this.showToast('Deudores exportados a Excel', 'success');
    },

    exportDebtorsToPDF() {
        if (!window.jspdf) return this.showToast('Librería PDF no disponible', 'error');
        if (state.debtors.length === 0) return this.showToast('No hay deudores para exportar', 'warning');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text("Listado de Deudores", 14, 22);
        doc.setFontSize(11);
        doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 30);

        const tableBody = state.debtors.map(d => [
            d.date,
            d.titular,
            d.description || '',
            formatCurrency(d.amount)
        ]);

        doc.autoTable({
            startY: 40,
            head: [['Fecha', 'Titular', 'Descripción', 'Monto']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [25, 135, 84] } // Success Colorish
        });

        doc.save("Deudores.pdf");
        this.showToast('Deudores exportados a PDF', 'success');
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

        this.loadData();
        this.switchView('clients');
        this.renderClients();
    },

    // --- LOGICA CONTRATOS RECURRENTES ---

    renderContracts() {
        const tbody = document.getElementById('contracts-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.contracts.forEach(c => {
            const tr = document.createElement('tr');
            const client = state.clients.find(cl => cl.id === c.clientId);
            const clientName = client ? (client.razonSocial || client.name) : '-';

            tr.innerHTML = `
                <td>${clientName}</td>
                <td style="font-weight:bold; color: var(--secondary-color)">${formatCurrency(c.amount)}</td>
                <td>${formatDate(c.startDate)} al ${formatDate(c.endDate)}</td>
                <td>Día ${c.billingDay} (${c.frequency})</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editContract('${c.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteContract('${c.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
    },

    handleContractSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const contract = {
            id: id || Date.now().toString(),
            clientId: formData.get('clientId'),
            amount: parseAmount(formData.get('amount')),
            startDate: formData.get('startDate'),
            endDate: formData.get('endDate'),
            billingDay: parseInt(formData.get('billingDay')),
            frequency: formData.get('frequency')
        };

        window.StorageAPI.saveContract(contract);

        if (id) {
            this.recordActivity('Modificación', 'Contrato', `Actualizado contrato`);
        } else {
            this.recordActivity('Alta', 'Contrato', `Registrado contrato`);
        }

        this.loadData();
        this.switchView('contracts');
        this.checkPendingContracts();
    },

    editContract(id) {
        const contract = state.contracts.find(c => c.id === id);
        if (!contract) return;

        const form = document.getElementById('add-contract-form');
        document.getElementById('contract-id').value = contract.id;
        form.elements['clientId'].value = contract.clientId;
        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(contract.amount);
        form.elements['startDate'].value = contract.startDate;
        form.elements['endDate'].value = contract.endDate;
        form.elements['billingDay'].value = contract.billingDay;
        form.elements['frequency'].value = contract.frequency || 'mensual';

        document.getElementById('contract-form-title').textContent = 'Editar Contrato';
        const cancelBtn = document.getElementById('cancel-contract-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    resetContractForm() {
        const form = document.getElementById('add-contract-form');
        if (form) {
            form.reset();
            document.getElementById('contract-id').value = '';
            document.getElementById('contract-form-title').textContent = 'Registrar Contrato';
            const cancelBtn = document.getElementById('cancel-contract-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    },

    deleteContract(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        window.StorageAPI.deleteContract(id);
        this.recordActivity('Baja', 'Contrato', `Eliminado contrato`);
        this.loadData();
        this.renderContracts();
        this.checkPendingContracts();
    },

    checkPendingContracts() {
        const pendingBadge = document.getElementById('contracts-badge');
        const reminderBtn = document.getElementById('contracts-reminder-btn');
        const pendingBody = document.getElementById('alerts-pending-body');
        const invoicedBody = document.getElementById('alerts-invoiced-body');
        const overdueBody = document.getElementById('alerts-overdue-body');

        if (!pendingBadge || !reminderBtn) return;

        // Fetch fresh
        state.pendingContracts = window.StorageAPI.getPendingContracts() || [];

        if (state.pendingContracts.length > 0) {
            reminderBtn.style.display = 'inline-block';
            pendingBadge.style.display = 'inline-block';
            pendingBadge.textContent = state.pendingContracts.length;
        } else {
            reminderBtn.style.display = 'inline-block';
            pendingBadge.style.display = 'none';
        }

        if (pendingBody) {
            pendingBody.innerHTML = '';
            state.pendingContracts.forEach(c => {
                const client = state.clients.find(cl => cl.id === c.clientId);
                const clientName = client ? (client.razonSocial || client.name) : '-';
                const conceptText = `Mensualidad Contrato - ${clientName}`;

                const tr = document.createElement('tr');
                tr.id = `pending-row-${c.id}`;
                tr.innerHTML = `
                    <td>${clientName}</td>
                    <td style="font-weight:bold; color: var(--danger-color);">${formatCurrency(c.amount)}</td>
                    <td>${conceptText}</td>
                    <td>
                        <button class="btn-sm btn-outline-success" onclick="UI.markContractInvoiced('${c.id}')">
                            <i class="fa-solid fa-check"></i> Factura Emitida
                        </button>
                    </td>
                `;
                pendingBody.appendChild(tr);
            });
        }

        if (invoicedBody) {
            invoicedBody.innerHTML = '';
            const now = new Date();
            const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const invoicedThisMonth = state.contracts.filter(c => c.lastInvoicedPeriod === currentPeriod);
            invoicedThisMonth.forEach(c => {
                const client = state.clients.find(cl => cl.id === c.clientId);
                const clientName = client ? (client.razonSocial || client.name) : '-';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${clientName}</td>
                    <td style="font-weight:bold; color: var(--secondary-color);">${formatCurrency(c.amount)}</td>
                    <td>${currentPeriod}</td>
                    <td class="actions">
                        <button class="btn-icon text-danger" title="Revertir Emisión" onclick="UI.undoContractInvoice('${c.id}')">
                            <i class="fa-solid fa-clock-rotate-left"></i> Revertir
                        </button>
                    </td>
                `;
                invoicedBody.appendChild(tr);
            });
        }
    },

    markContractInvoiced(id) {
        // Actualización optimista de UI (Tiempo Real)
        const row = document.getElementById(`pending-row-${id}`);
        if (row) row.style.display = 'none';

        const badge = document.getElementById('contracts-badge');
        if (badge) {
            let count = parseInt(badge.textContent) || 0;
            if (count > 1) {
                badge.textContent = count - 1;
            } else {
                badge.style.display = 'none';
            }
        }

        // Llamada síncrona al backend para actualizar estado en Contratos y Deudores
        window.StorageAPI.invoiceContract(id);
        this.showToast('Factura Emitida', 'success');

        // Refrescar data subyacente de forma que los tabs al navegar estén full actualizados
        this.checkPendingContracts();
        this.loadData();
    },

    undoContractInvoice(id) {
        if (!confirm('¿Estás seguro de que quieres revertir la emisión de esta factura? Se eliminará la deuda asociada.')) return;

        window.StorageAPI.undoInvoiceContract(id);
        this.showToast('Emisión revertida con éxito', 'info');

        this.loadData();
        this.checkPendingContracts();
    },

    initDatePickers() {
        if (typeof flatpickr !== 'undefined') {
            flatpickr('input[type="date"]', {
                locale: 'es',
                dateFormat: 'Y-m-d',
                allowInput: true
            });
        } else {
            console.warn("Flatpickr no está cargado.");
        }
    }
};

// Inicialización
window.UI = UI;
document.addEventListener('DOMContentLoaded', () => UI.init());
