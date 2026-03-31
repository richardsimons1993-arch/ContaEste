// Estado del Sistema
const rawState = {
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
    lastDeleted: null,
    projects: [],
    invoicedContractsCurrent: [],
    availables: [],
    inventory: [],
    locations: [],
    operationalExpenses: [],
    selectedYear: new Date().getFullYear()
};

// --- Store Reactivo ---
// El Store usa un Proxy para detectar cambios en el estado y disparar re-renders automáticos.
const Store = new Proxy(rawState, {
    set(target, property, value) {
        if (target[property] === value) return true;
        target[property] = value;

        // Mapeo de propiedades a funciones de renderizado
        const renderMap = {
            'transactions': () => UI.renderTransactionsList(),
            'concepts': () => { UI.renderConcepts(); UI.renderTransactionFormOptions(); },
            'clients': () => { UI.renderClients(); UI.renderTransactionFormOptions(); },
            'debts': () => UI.renderDebts(),
            'debtors': () => UI.renderDebtors(),
            'suppliers': () => { UI.renderSuppliers(); UI.renderTransactionFormOptions(); UI.populateDebtSupplierSelect(); },
            'contracts': () => UI.renderContracts(),
            'pendingContracts': () => UI.checkPendingContracts(),
            'users': () => UI.renderUsers(),
            'projects': () => UI.renderProjects(),
            'availables': () => UI.renderAvailables(),
            'inventory': () => UI.renderInventory(),
            'locations': () => UI.renderLocations(),
            'operationalExpenses': () => { UI.renderOperationalExpenses(); UI.checkOperationalExpensesAlerts(); },
            'currentView': (val) => UI.switchView(val),
            'selectedYear': () => UI.renderDashboard()
        };

        if (renderMap[property]) {
            console.log(`Store: Cambio detectado en '${property}', actualizando UI...`);
            try {
                renderMap[property](value);
            } catch (err) {
                console.error(`Error en renderizador para '${property}':`, err);
            }
        }

        return true;
    }
});

// Alias para mantener compatibilidad con el código existente que usa 'state'
const state = Store;

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

// Ayudante para Fecha Local (Evita desfase de zona horaria)
const getLocalISODate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

// Ayudante de Formateo de Moneda
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

// Ayudante de Formateo de Fecha (DD-MM-YYYY)
const formatDate = (date) => {
    if (!date) return '-';
    
    let dateStr = date;
    if (date instanceof Date) {
        if (isNaN(date.getTime())) return '-';
        // Formato local YYYY-MM-DD para evitar desfase de zona horaria
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
    }

    if (typeof dateStr !== 'string') return String(dateStr);

    // Si ya viene como DD-MM-YYYY (ej. parts[0] tiene 2 digitos y parts[2] tiene 4)
    // Usar regex para detectar DD-MM-YYYY o DD/MM/YYYY
    const dmyMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[1].padStart(2, '0')}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[3]}`;
    }

    // Tomar solo la parte de la fecha (YYYY-MM-DD) si viene con hora
    const cleanD = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = cleanD.split(/[-/]/);
    if (parts.length !== 3) return dateStr;
    
    // Si es YYYY-MM-DD
    if (parts[0].length === 4) {
        return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
    
    return cleanD;
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
    async init() {
        // Global Error Catcher
        window.addEventListener('error', (event) => {
            console.error('Error no capturado:', event.error);
            if (this.showToast) this.showToast(`Error Crítico: ${event.message}`, "error");
        });
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Promesa rechazada no capturada:', event.reason);
            if (this.showToast) this.showToast(`Error de Red: ${event.reason?.message || "Servidor no responde"}`, "error");
        });

        try {
            console.log("🚀 Inicializando aplicación...");
            if (!window.StorageAPI) {
                console.error("Error Crítico: ¡StorageAPI no encontrado!");
                return;
            }
            await this.loadData();
            this.checkSession(); // Verificar si ya hay una sesión
            this.initTheme(); // Inicializar tema (claro/oscuro)
            this.setupEventListeners();
            this.setupSpanishValidation();
            this.renderConcepts();
            this.renderClients();
            this.setupCustomDropdowns(); // Inicializar oyentes para menús desplegables
            this.renderTransactionFormOptions(); // Rellenar formulario y filtros
            this.renderSuppliers();
            this.renderDebts();
            this.renderDebtors();
            this.populateDebtSupplierSelect();
            this.populateDebtConceptSelect();
            this.populateDebtorClientSelect();
            this.populateProjectClientSelect();
            this.renderProjects();
            this.renderAvailables();
            this.renderInventory();
            this.renderLocations();

            // Establecer fecha por defecto a hoy (Hacerlo ANTES de Flatpickr)
            const dateInput = document.getElementById('date');
            if (dateInput) {
                if (dateInput.type === 'date') {
                    dateInput.valueAsDate = new Date();
                } else {
                    dateInput.value = getLocalISODate();
                }
            }

            this.initDatePickers(); // Inicializar Flatpickr después de poner el valor
            this.setupSpanishValidation(); // Asegurar mensajes de validación en español
            this.checkPendingContracts(); // Verificar contratos pendientes

            this.populateYearSelector(); // Poblar selector de años
            
            // Si hay sesión, cargar la UI normal
            if (state.currentUser) {
                this.applyPrivileges();
                this.switchView(state.currentView);
            }
            console.log("✅ UI.init() completado con éxito");
        } catch (error) {
            console.error("Error en UI.init: " + error.message);
        }
    },

    setupSpanishValidation() {
        // Usar delegación de eventos en fase de captura porque 'invalid' no burbujea
        document.addEventListener('invalid', (e) => {
            const el = e.target;
            if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
                if (el.validity.valueMissing) {
                    el.setCustomValidity('Por favor, complete este campo.');
                } else if (el.type === 'email' && el.validity.typeMismatch) {
                    el.setCustomValidity('Por favor, introduzca una dirección de correo válida.');
                } else {
                    el.setCustomValidity('');
                }
            }
        }, true);

        // Limpiar el mensaje de error cuando el usuario empieza a escribir
        document.addEventListener('input', (e) => {
            e.target.setCustomValidity('');
        }, true);
    },

    // --- Helpers de Carga (Spinners) ---
    // Muestra un spinner en el elemento (o su botón submit si es un formulario)
    showLoading(elementOrId) {
        let el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
        if (!el) return;

        if (el.tagName === 'FORM') {
            el = el.querySelector('button[type="submit"]');
        }

        if (el) {
            el.dataset.originalHtml = el.innerHTML;
            el.classList.add('btn-loading');
            el.disabled = true;
        }
    },

    hideLoading(elementOrId) {
        let el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
        if (!el) return;

        if (el.tagName === 'FORM') {
            el = el.querySelector('button[type="submit"]');
        }

        if (el && el.classList.contains('btn-loading')) {
            el.classList.remove('btn-loading');
            el.disabled = false;
            if (el.dataset.originalHtml) {
                el.innerHTML = el.dataset.originalHtml;
            }
        }
    },

    async loadData() {
        const cleanDate = (d) => {
            if (!d) return null;
            try {
                if (typeof d === 'string') {
                    if (d.includes('T')) return d.split('T')[0];
                    return d;
                }
                if (d instanceof Date) {
                    if (isNaN(d.getTime())) return null;
                    return d.toISOString().split('T')[0];
                }
            } catch (e) {
                console.warn('cleanDate error for:', d, e);
            }
            return d;
        };

        try {
            console.log('--- Iniciando Sincronización de Datos ---');
            
            // Paralelizar solicitudes de red para mejorar rendimiento
            // AHORA USAMOS EXCLUSIVAMENTE METODOS ASINCRONOS
            const results = await Promise.allSettled([
                window.StorageAPI.async.getTransactions(),
                window.StorageAPI.async.getConcepts(),
                window.StorageAPI.async.getClients(),
                window.StorageAPI.async.getDebts(),
                window.StorageAPI.async.getDebtors(),
                window.StorageAPI.async.getContracts(),
                window.StorageAPI.async.getPendingContracts(),
                window.StorageAPI.async.getInvoicedContractsCurrent(),
                window.StorageAPI.async.getLogs(),
                window.StorageAPI.async.getSuppliers(),
                window.StorageAPI.async.getProjects(),
                window.StorageAPI.async.getUsers(),
                window.StorageAPI.async.getAvailables(),
                window.StorageAPI.async.getInventory(),
                window.StorageAPI.async.getAppLocations(),
                window.StorageAPI.async.getOperationalExpenses()
            ]);

            // Mapear resultados al estado global (Proxy dispara renders automáticos)
            // Solo actualizamos si la promesa fue exitosa
            const setIfOk = (prop, resultIndex) => {
                if (results[resultIndex].status === 'fulfilled') {
                    state[prop] = results[resultIndex].value || [];
                } else {
                    console.error(`Error cargando ${prop}:`, results[resultIndex].reason);
                }
            };

            setIfOk('transactions', 0);
            setIfOk('concepts', 1);
            setIfOk('clients', 2);
            setIfOk('debts', 3);
            setIfOk('debtors', 4);
            setIfOk('contracts', 5);
            setIfOk('pendingContracts', 6);
            setIfOk('invoicedContractsCurrent', 7);
            setIfOk('logs', 8);
            setIfOk('suppliers', 9);
            setIfOk('projects', 10);
            setIfOk('users', 11);
            setIfOk('availables', 12);
            setIfOk('inventory', 13);
            setIfOk('locations', 14);
            setIfOk('operationalExpenses', 15);

            // Verificar si alguna falló y reportar
            let failedCount = 0;
            results.forEach((res, i) => {
                if (res.status === 'rejected') {
                    console.warn(`Fallo en carga de dato indice ${i}:`, res.reason);
                    failedCount++;
                }
            });

            if (failedCount > 0) {
                this.showToast(`Advertencia: ${failedCount} módulos no cargaron correctamente`, "warning");
            }

            const getData = (i) => {
                const val = results[i].status === 'fulfilled' ? results[i].value : null;
                return Array.isArray(val) ? val : [];
            };

            const assign = (prop, data) => {
                try {
                    state[prop] = data;
                } catch (e) {
                    console.error(`Error al asignar estado.${prop}:`, e);
                }
            };

            assign('transactions', (getData(0)).map(t => ({ ...t, date: cleanDate(t.date) })));
            assign('concepts', getData(1));
            assign('clients', getData(2));
            assign('debts', (getData(3)).map(d => ({ ...d, dueDate: cleanDate(d.dueDate || d.date), date: cleanDate(d.date) })));
            assign('debtors', (getData(4)).map(d => ({ ...d, date: cleanDate(d.date) })));
            assign('contracts', (getData(5)).map(c => ({ ...c, startDate: cleanDate(c.startDate), endDate: cleanDate(c.endDate) })));
            
            assign('pendingContracts', getData(6));
            assign('invoicedContractsCurrent', getData(7));
            
            assign('logs', getData(8));
            assign('suppliers', getData(9));
            assign('projects', getData(10));
            assign('users', getData(11));
            assign('availables', (getData(12)).map(a => ({ ...a, placementDate: cleanDate(a.placementDate), dueDate: cleanDate(a.dueDate) })));
            assign('inventory', getData(13));
            assign('locations', getData(14));

            // Actualización dinámica de permisos sin re-logueo
            try {
                if (state.currentUser && state.users) {
                    const updatedUser = state.users.find(u => u.id === state.currentUser.id);
                    if (updatedUser) {
                        const newModules = typeof updatedUser.modules === 'string' ? JSON.parse(updatedUser.modules) : updatedUser.modules;
                        if (JSON.stringify(newModules) !== JSON.stringify(state.currentUser.modules)) {
                            console.log("Detectado cambio en permisos, actualizando módulos...");
                            state.currentUser = { ...state.currentUser, modules: newModules };
                            // Persistir en localStorage
                            const savedSession = JSON.parse(localStorage.getItem('contabilidad_session') || '{}');
                            savedSession.modules = newModules;
                            localStorage.setItem('contabilidad_session', JSON.stringify(savedSession));
                            this.applyModuleAccess();
                        }
                    }
                }
            } catch (e) {
                console.error("Error al actualizar permisos dinámicos:", e);
            }
            
            console.log('✅ Sincronización completada');
            try {
                this.checkPendingContracts(); // Forzar renderizado inmediato
            } catch (e) {
                console.error('Error in checkPendingContracts:', e);
            }
        } catch (err) {
            console.error("Error crítico en loadData:", err);
            this.showToast(`Error de Sincronización: ${err.message}`, "error");
        }
    },


    setupEventListeners() {
        console.log("Configurando oyentes de eventos...");
        // Navegación
        const buttons = document.querySelectorAll('.nav-btn');
        if (buttons.length === 0) console.warn("¡No se encontraron botones de navegación!");

        // Mobile Sidebar Toggle
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const sidebar = document.querySelector('.sidebar');
        const sidebarOverlay = document.getElementById('sidebar-overlay');

        if (mobileMenuBtn && sidebar && sidebarOverlay) {
            mobileMenuBtn.addEventListener('click', () => {
                sidebar.classList.toggle('active');
                sidebarOverlay.classList.toggle('active');
            });

            sidebarOverlay.addEventListener('click', () => {
                sidebar.classList.remove('active');
                sidebarOverlay.classList.remove('active');
            });
        }

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

        const cancelConceptEditBtn = document.getElementById('cancel-concept-edit');
        if (cancelConceptEditBtn) {
            cancelConceptEditBtn.addEventListener('click', () => this.resetConceptForm());
        }

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

        const indefiniteCheckbox = document.getElementById('contract-indefinite');
        const endDateInput = document.getElementById('contract-end-date');
        if (indefiniteCheckbox && endDateInput) {
            indefiniteCheckbox.addEventListener('change', (e) => {
                endDateInput.disabled = e.target.checked;
                if (e.target.checked && endDateInput._flatpickr) {
                    endDateInput._flatpickr.clear();
                }
            });
        }
        
        // --- GASTOS OPERACIONALES ---
        const operationalForm = document.getElementById('add-operational-form');
        if (operationalForm) {
            operationalForm.addEventListener('submit', (e) => this.handleOperationalSubmit(e));
        }

        const cancelOpEditBtn = document.getElementById('cancel-operational-edit');
        if (cancelOpEditBtn) {
            cancelOpEditBtn.addEventListener('click', () => this.resetOperationalForm());
        }

        // --- PROYECTOS ---
        const projectForm = document.getElementById('add-project-form');
        if (projectForm) projectForm.addEventListener('submit', (e) => this.handleProjectSubmit(e));

        const cancelProjectEditBtn = document.getElementById('cancel-project-edit');
        if (cancelProjectEditBtn) {
            cancelProjectEditBtn.addEventListener('click', () => this.resetProjectForm());
        }

        const projectFilterStatus = document.getElementById('project-filter-status');
        if (projectFilterStatus) projectFilterStatus.addEventListener('change', () => this.renderProjects());

        const projectSearch = document.getElementById('project-search');
        if (projectSearch) projectSearch.addEventListener('input', () => this.renderProjects());

        const contractsReminderBtn = document.getElementById('contracts-reminder-btn');
        if (contractsReminderBtn) contractsReminderBtn.addEventListener('click', () => {
            UI.switchView('alerts');
        });

        // --- PROJECT DATE MODAL LISTENER ---
        const btnSaveProjectDate = document.getElementById('btn-save-project-date');
        if (btnSaveProjectDate) {
            btnSaveProjectDate.addEventListener('click', () => this.handleProjectDateUpdate());
        }

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
                btn.style.borderBottom = '2px solid var(--primary-color)';
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
        
        // --- DINAMISMO EN FORMULARIO DE TRANSACCIÓN ---
        const conceptSelect = document.getElementById('concept');
        if (conceptSelect) {
            conceptSelect.addEventListener('change', () => this.updateTransactionPersonDropdown());
        }

        // El filtro de mes ahora se maneja dentro de initDatePickers (onChange de Flatpickr)

        if (filterDateStart) filterDateStart.addEventListener('change', () => {
             // Si ponemos una fecha manual, limpiamos el filtro de mes
             const fm = document.getElementById('filter-month');
             if (fm && fm._flatpickr) fm._flatpickr.clear(false);
             else if (fm) fm.value = '';
             this.renderTransactionsList();
        });
        if (filterDateEnd) filterDateEnd.addEventListener('change', () => {
             const fm = document.getElementById('filter-month');
             if (fm && fm._flatpickr) fm._flatpickr.clear(false);
             else if (fm) fm.value = '';
             this.renderTransactionsList();
        });

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

        // --- SELECTOR DE AÑO (BALANCE) ---
        const yearSelector = document.getElementById('year-selector');
        if (yearSelector) {
            yearSelector.addEventListener('change', (e) => {
                state.selectedYear = parseInt(e.target.value);
            });
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

        // --- GESTIÓN DE DISPONIBLE ---
        const availableForm = document.getElementById('add-available-form');
        if (availableForm) availableForm.addEventListener('submit', (e) => this.handleAvailableSubmit(e));

        const classificationSelect = document.getElementById('available-classification');
        if (classificationSelect) {
            classificationSelect.addEventListener('change', () => this.updateAvailableFields());
        }

        const instrumentSelect = document.getElementById('available-instrument');
        if (instrumentSelect) {
            instrumentSelect.addEventListener('change', () => this.updateAvailableFields());
        }

        const cancelAvailableEditBtn = document.getElementById('cancel-available-edit');
        if (cancelAvailableEditBtn) {
            cancelAvailableEditBtn.addEventListener('click', () => this.resetAvailableForm());
        }

        // --- INVENTARIO ---
        const inventoryForm = document.getElementById('inventory-form');
        if (inventoryForm) inventoryForm.addEventListener('submit', (e) => this.handleInventorySubmit(e));

        const btnAddMaterial = document.getElementById('btn-add-material');
        if (btnAddMaterial) btnAddMaterial.addEventListener('click', () => this.handleAddMaterial());

        const inventorySearch = document.getElementById('inventory-search');
        if (inventorySearch) inventorySearch.addEventListener('input', () => this.renderInventory());

        const btnExportInvExcel = document.getElementById('btn-export-inventory-excel');
        if (btnExportInvExcel) btnExportInvExcel.addEventListener('click', () => this.exportInventoryToExcel());

        const btnExportInvPdf = document.getElementById('btn-export-inventory-pdf');
        if (btnExportInvPdf) btnExportInvPdf.addEventListener('click', () => this.exportInventoryToPDF());

        // Nuevos eventos
        const btnGlobalLocations = document.getElementById('btn-global-locations');
        if (btnGlobalLocations) btnGlobalLocations.addEventListener('click', () => this.openLocationManager());

        const addLocationForm = document.getElementById('add-location-form');
        if (addLocationForm) addLocationForm.addEventListener('submit', (e) => this.handleLocationSubmit(e));

        const inventoryTabs = document.querySelectorAll('.inventory-tab-btn');
        inventoryTabs.forEach(btn => {
            btn.addEventListener('click', () => {
                inventoryTabs.forEach(b => {
                    b.classList.remove('active');
                    b.style.fontWeight = 'normal';
                    b.style.borderBottom = 'none';
                });
                btn.classList.add('active');
                btn.style.fontWeight = 'bold';
                btn.style.borderBottom = '2px solid var(--primary-color)';

                const tabId = btn.getAttribute('data-tab');
                document.querySelectorAll('.inventory-tab-content').forEach(c => c.style.display = 'none');
                document.getElementById(tabId).style.display = 'block';

                if (tabId === 'inventory-history-tab') this.renderInventoryHistory();
            });
        });


        // --- FORMATEO DE MONTOS EN TIEMPO REAL ---
        document.querySelectorAll('.amount-input').forEach(input => {
            input.addEventListener('input', (e) => formatAmountInput(e.target));
        });

        // Global error handler
        window.onerror = function(message, source, lineno, colno, error) {
            console.error("Uncaught error:", { message, source, lineno, colno, error });
            UI.showToast(`Error inesperado: ${message}`, 'error');
            return true; // Prevent default error handling
        };
    },

    // --- AUTENTICACIÓN ---

    checkSession() {
        const savedSession = localStorage.getItem('contabilidad_session');
        console.log("Sesión guardada encontrada:", !!savedSession);
        if (savedSession) {
            try {
                const sessionData = JSON.parse(savedSession);
                console.log("Datos de sesión:", sessionData);

                // Validar que la sesión no haya expirado por inactividad (30 min)
                const TIMEOUT_MS = 30 * 60 * 1000;
                const lastActivity = sessionData.lastActivity || 0;
                if (Date.now() - lastActivity > TIMEOUT_MS) {
                    console.warn("Sesión expirada por inactividad");
                    localStorage.removeItem('contabilidad_session');
                    document.body.classList.add('login-pending');
                    const errorEl = document.getElementById('login-error');
                    if (errorEl) {
                        errorEl.textContent = 'Sesión expirada por inactividad. Por favor ingrese nuevamente.';
                        errorEl.style.display = 'block';
                    }
                    return;
                }

                state.currentUser = {
                    id: sessionData.id,
                    username: sessionData.username,
                    role: sessionData.role,
                    name: sessionData.name,
                    modules: sessionData.modules || []
                };

                // Renovar lastActivity
                sessionData.lastActivity = Date.now();
                localStorage.setItem('contabilidad_session', JSON.stringify(sessionData));

                document.body.classList.remove('login-pending');
                this.updateUserUI();
                this.applyModuleAccess();
                this.startInactivityTimer();
                console.log("Sesión validada y aplicada.");
            } catch (e) {
                console.error("Error al parsear sesión guardada:", e);
                localStorage.removeItem('contabilidad_session');
                document.body.classList.add('login-pending');
            }
        } else {
            console.log("No hay sesión guardada. Solicitando login...");
            document.body.classList.add('login-pending');
        }
    },

    async handleLogin(e) {
        e.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const username = usernameInput.value.trim().toLowerCase();
        const pass = passwordInput.value.trim();
        const errorEl = document.getElementById('login-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        if (!username || !pass) {
            errorEl.textContent = 'Por favor ingrese usuario y contraseña.';
            errorEl.style.display = 'block';
            return;
        }

        this.showLoading(submitBtn);
        errorEl.style.display = 'none';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password: pass })
            });

            if (!response.ok) {
                const err = await response.json();
                errorEl.textContent = err.error || 'Credenciales incorrectas.';
                errorEl.style.display = 'block';
                passwordInput.value = '';
                passwordInput.focus();
                this.hideLoading(submitBtn);
                return;
            }

            const user = await response.json();

            // Guardar sesión con timestamps
            const sessionData = {
                ...user,
                loginTime: Date.now(),
                lastActivity: Date.now()
            };
            state.currentUser = user;
            localStorage.setItem('contabilidad_session', JSON.stringify(sessionData));
            document.body.classList.remove('login-pending');
            errorEl.style.display = 'none';
            e.target.reset();

            this.updateUserUI();
            this.applyPrivileges();
            this.applyModuleAccess();
            this.startInactivityTimer();
            const firstView = this.getFirstAvailableView(state.currentUser.modules);
            this.switchView(firstView);
            this.recordActivity('Login', 'Sistema', `Usuario ${username} inició sesión`);
        } catch (err) {
            errorEl.textContent = 'Error de conexión con el servidor. Verifique que el servidor esté activo.';
            errorEl.style.display = 'block';
        } finally {
            this.hideLoading(submitBtn);
        }
    },

    handleLogout() {
        this.recordActivity('Logout', 'Sistema', `Usuario ${state.currentUser?.username} cerró sesión`);
        this.stopInactivityTimer();
        state.currentUser = null;
        localStorage.removeItem('contabilidad_session');
        document.body.classList.add('login-pending');
    },

    // --- CONTROL DE INACTIVIDAD ---
    _inactivityInterval: null,
    _inactivityListeners: null,
    _warningShown: false,
    _lastActivityTs: Date.now(),
    _resetDebounceTimer: null,

    startInactivityTimer() {
        this.stopInactivityTimer();
        this._warningShown = false;
        this._lastActivityTs = Date.now();

        // Debounce: actualizar sólo tras 2 segundos sin nuevos eventos
        const resetFn = () => {
            this._lastActivityTs = Date.now();
            if (this._resetDebounceTimer) clearTimeout(this._resetDebounceTimer);
            this._resetDebounceTimer = setTimeout(() => this.resetInactivityTimer(), 2000);
        };
        this._inactivityListeners = resetFn;

        ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
            document.addEventListener(evt, resetFn, { passive: true });
        });

        // Verificar cada 30 segundos
        this._inactivityInterval = setInterval(() => this.checkInactivity(), 30000);
    },

    resetInactivityTimer() {
        this._warningShown = false;
        const sessionData = JSON.parse(localStorage.getItem('contabilidad_session') || '{}');
        if (sessionData.id) {
            sessionData.lastActivity = Date.now();
            localStorage.setItem('contabilidad_session', JSON.stringify(sessionData));
        }
        // Cerrar el modal de advertencia si estaba abierto
        const warnModal = document.getElementById('inactivity-warning-modal');
        if (warnModal && warnModal.style.display === 'flex') {
            warnModal.style.display = 'none';
        }
    },

    stopInactivityTimer() {
        if (this._inactivityInterval) {
            clearInterval(this._inactivityInterval);
            this._inactivityInterval = null;
        }
        if (this._inactivityListeners) {
            ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
                document.removeEventListener(evt, this._inactivityListeners);
            });
            this._inactivityListeners = null;
        }
        // Cerrar modal si quedó abierto
        const warnModal = document.getElementById('inactivity-warning-modal');
        if (warnModal) warnModal.style.display = 'none';
    },

    checkInactivity() {
        if (!state.currentUser) return;

        // Usar el timestamp más reciente (en memoria o localStorage)
        const sessionData = JSON.parse(localStorage.getItem('contabilidad_session') || '{}');
        const storedActivity = sessionData.lastActivity || 0;
        const memoryActivity = this._lastActivityTs || 0;
        const lastActivity = Math.max(storedActivity, memoryActivity);
        const elapsed = Date.now() - lastActivity;

        const WARN_MS  = 28 * 60 * 1000; // 28 min → advertencia
        const LIMIT_MS = 30 * 60 * 1000; // 30 min → cerrar sesión

        if (elapsed >= LIMIT_MS) {
            this.forceLogout();
        } else if (elapsed >= WARN_MS && !this._warningShown) {
            this._warningShown = true;
            this.showInactivityWarning(Math.ceil((LIMIT_MS - elapsed) / 1000));
        }
    },

    showInactivityWarning(remainingSeconds) {
        let modal = document.getElementById('inactivity-warning-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'inactivity-warning-modal';
            modal.style.cssText = [
                'display:flex', 'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
                'background:rgba(0,0,0,0.65)', 'z-index:99999',
                'align-items:center', 'justify-content:center'
            ].join(';');
            modal.innerHTML = `
                <div style="background:var(--bg-color,#fff);border-radius:12px;padding:32px 40px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                    <div style="font-size:48px;margin-bottom:16px;">⏱️</div>
                    <h3 style="margin:0 0 12px;color:var(--text-color,#333);font-size:1.25rem;">Sesión por expirar</h3>
                    <p style="color:var(--text-muted,#666);margin:0 0 8px;">Por inactividad, su sesión se cerrará en:</p>
                    <p id="inactivity-countdown" style="font-size:2rem;font-weight:700;color:#e74c3c;margin:12px 0;">0:00</p>
                    <p style="color:var(--text-muted,#666);font-size:0.9rem;margin:0 0 24px;">Haga clic en continuar para mantener la sesión activa.</p>
                    <button id="inactivity-continue-btn" style="background:var(--primary-color,#3498db);color:#fff;border:none;border-radius:8px;padding:12px 32px;font-size:1rem;cursor:pointer;font-weight:600;">Continuar sesión</button>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('inactivity-continue-btn').addEventListener('click', () => {
                this.resetInactivityTimer();
                this._warningShown = false;
                modal.style.display = 'none';
            });
        } else {
            modal.style.display = 'flex';
        }

        // Countdown visual
        let secs = remainingSeconds;
        const countdownEl = document.getElementById('inactivity-countdown');
        if (countdownEl) {
            const updateCountdown = () => {
                const m = Math.floor(secs / 60);
                const s = secs % 60;
                countdownEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
                if (secs <= 0) return;
                secs--;
            };
            updateCountdown();
            const cInterval = setInterval(() => {
                if (!state.currentUser || secs <= 0 || modal.style.display === 'none') {
                    clearInterval(cInterval);
                    return;
                }
                updateCountdown();
            }, 1000);
        }
    },

    forceLogout() {
        this.recordActivity('Logout', 'Sistema', `Sesión cerrada por inactividad (usuario: ${state.currentUser?.username})`);
        this.stopInactivityTimer();
        state.currentUser = null;
        localStorage.removeItem('contabilidad_session');
        document.body.classList.add('login-pending');

        // Mostrar mensaje en el login
        setTimeout(() => {
            const errorEl = document.getElementById('login-error');
            if (errorEl) {
                errorEl.textContent = 'Su sesión fue cerrada automáticamente por 30 minutos de inactividad.';
                errorEl.style.display = 'block';
                errorEl.style.color = 'var(--warning-color, #e67e22)';
            }
        }, 100);
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
        const deleteButtons = document.querySelectorAll('.btn-icon.text-danger, .btn-mini-action.text-danger');
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

    // --- MODALES ---
    openModal(id) {
        console.log(`Abriendo modal: ${id}`);
        const modal = document.getElementById(id);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } else {
            console.error(`Modal no encontrado: ${id}`);
        }
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
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
            'suppliers': 'finanzas',
            'dashboard': 'finanzas',
            'available-funds': 'finanzas',
            'projects': 'ventas',
            'contracts': 'ventas',
            'inventory': 'inventario',
            'activity': 'finanzas',
            'users': 'usuarios',
            'operational-expenses': 'finanzas'
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
        console.log(`Intentando cambiar vista a: ${viewName}`);
        if (!state.currentUser) {
            console.warn("Bloqueado: Intento de navegación sin usuario activo.");
            return;
        }

        // Proteger vista usuarios
        if (viewName === 'users' && state.currentUser.role !== ROLES.ADMIN) {
            console.warn("Acceso denegado a Usuarios. Redirigiendo...");
            this.switchView('transaction-form');
            return;
        }

        // Actualizar estado (sin disparar el Proxy recursivamente si ya se está en esta vista)
        if (rawState.currentView !== viewName) {
            console.log(`Actualizando currentView a ${viewName}`);
            rawState.currentView = viewName;
        }

        // Actualizar Barra Lateral
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.target === viewName);
        });

        // Actualizar Secciones
        document.querySelectorAll('.view-section').forEach(section => {
            try {
                section.classList.toggle('active', section.id === viewName);
            } catch (err) {
                console.error(`Error toggling section ${section.id}:`, err);
            }
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
            'projects': 'Gestión de Proyectos',
            'activity': 'Actividad',
            'available-funds': 'Disponible',
            'users': 'Usuarios',
            'operational-expenses': 'Gastos Operacionales',
            'alerts': 'Centro de Alertas'
        };

        const pageTitle = document.getElementById('page-title');
        if (pageTitle && titles[viewName]) {
            pageTitle.textContent = titles[viewName];
            document.title = `${titles[viewName]} - Contabilidad Premium`;
        }
        
        // Auto-close sidebar on mobile after navigation
        if (window.innerWidth <= 992) {
            const sidebar = document.querySelector('.sidebar');
            const sidebarOverlay = document.getElementById('sidebar-overlay');
            if (sidebar && sidebarOverlay) {
                sidebar.classList.remove('active');
                sidebarOverlay.classList.remove('active');
            }
        }

        if (viewName === 'dashboard') this.renderDashboard();
        if (viewName === 'transactions') this.renderTransactionsList();
        if (viewName === 'concepts') this.renderConcepts();
        if (viewName === 'clients') this.renderClients();
        if (viewName === 'debts') this.renderDebts();
        if (viewName === 'debtors') this.renderDebtors();
        if (viewName === 'contracts') this.renderContracts();
        if (viewName === 'projects') this.renderProjects();
        if (viewName === 'activity') this.renderActivity();
        if (viewName === 'available-funds') this.renderAvailables();
        if (viewName === 'users') this.renderUsers();
        if (viewName === 'operational-expenses') this.renderOperationalExpenses();

        // Resetear formularios si se sale de la sección
        if (viewName !== 'transaction-form') this.cancelTransactionEdit();
        if (viewName !== 'concepts') this.resetConceptForm();
        if (viewName !== 'clients') this.resetClientForm();
        if (viewName !== 'debts') this.resetDebtForm();
        if (viewName !== 'debtors') this.resetDebtorForm();
        if (viewName !== 'contracts') this.resetContractForm();
        if (viewName !== 'projects') this.resetProjectForm();
        if (viewName !== 'users') this.resetUserForm();
        if (viewName !== 'operational-expenses') this.resetOperationalForm();

        // Re-aplicar privilegios (por si se renderizaron botones nuevos)
        this.applyPrivileges();
    },

    // --- RENDERIZADORES ---

    renderDashboard() {
        const transactions = state.transactions;
        let income = 0;
        let expense = 0;
        const selectedYear = parseInt(state.selectedYear);

        transactions.forEach(t => {
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');

            if (tDate.getFullYear() === selectedYear) {
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

        // Activos Disponibles (Módulo Disponible)
        let totalAvailableFunds = 0;
        state.availables.forEach(a => {
            totalAvailableFunds += parseFloat(a.amount || 0);
        });
        
        // Inventario (Total Inventario)
        let totalInventoryValue = 0;
        state.inventory.forEach(i => {
            totalInventoryValue += (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0);
        });

        // Deuda Total (Sumatoria del apartado de deudas)
        let totalDebts = 0;
        state.debts.forEach(d => {
            totalDebts += parseFloat(d.amount || 0);
        });

        // Total Deudores (Cuentas por Cobrar)
        let totalDebtors = 0;
        state.debtors.forEach(d => {
            totalDebtors += parseFloat(d.amount || 0);
        });

        const elBalance = document.getElementById('total-balance');
        const elIncome = document.getElementById('month-income');
        const elExpense = document.getElementById('month-expense');

        if (elBalance) elBalance.textContent = formatCurrency(totalDebts);
        if (elIncome) elIncome.textContent = formatCurrency(income);
        if (elExpense) elExpense.textContent = formatCurrency(expense);

        // Actualizar Activo Disponible en el Dashboard (si el elemento existe)
        const elAvailable = document.getElementById('dashboard-available-funds');
        if (elAvailable) elAvailable.textContent = formatCurrency(totalAvailableFunds);

        // Actualizar Inventario
        const elInventory = document.getElementById('dashboard-inventory-value');
        if (elInventory) elInventory.textContent = formatCurrency(totalInventoryValue);

        // Actualizar Total Deudores
        const elDebtors = document.getElementById('dashboard-total-debtors');
        if (elDebtors) elDebtors.textContent = formatCurrency(totalDebtors);

        // Actualizar Activo Circulante Total (Disponible + Deudores + Inventario)
        const totalCirculating = totalAvailableFunds + totalDebtors + totalInventoryValue;
        const elCirculating = document.getElementById('dashboard-total-circulating');
        if (elCirculating) elCirculating.textContent = formatCurrency(totalCirculating);

        // --- Gráfico de Torta: Composición del Activo Circulante ---
        if (window.circulatingChart) {
            window.circulatingChart.destroy();
        }

        const ctx = document.getElementById('circulating-chart');
        if (ctx && window.Chart) {
            window.circulatingChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Activo Disponible', 'Inventario', 'Deudores (Por Cobrar)'],
                    datasets: [{
                        data: [totalAvailableFunds, totalInventoryValue, totalDebtors],
                        backgroundColor: [
                            'rgba(46, 204, 113, 0.8)', // Verde (Disponible)
                            'rgba(52, 152, 219, 0.8)', // Azul (Inventario)
                            'rgba(241, 196, 15, 0.8)'  // Amarillo (Deudores)
                        ],
                        borderColor: [
                            'rgba(46, 204, 113, 1)',
                            'rgba(52, 152, 219, 1)',
                            'rgba(241, 196, 15, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    if (label) label += ': ';
                                    if (context.parsed !== null) {
                                        label += new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(context.parsed);
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                }
            });
        }

        // --- Tabla Resumen Anual ---
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        // Inicializar datos del año
        const yearData = Array(12).fill(null).map(() => ({ income: 0, expense: 0 }));

        // Calcular balance de años anteriores (Saldo Inicial)
        let accumulatedBalance = 0;
        transactions.forEach(t => {
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');
            if (tDate.getFullYear() < selectedYear) {
                if (t.type === 'income') accumulatedBalance += parseFloat(t.amount);
                if (t.type === 'expense') accumulatedBalance -= parseFloat(t.amount);
            }
        });

        // Agregar datos del año seleccionado
        transactions.forEach(t => {
            const cleanDate = t.date.split('T')[0];
            const tDate = new Date(cleanDate + 'T00:00:00');
            if (tDate.getFullYear() === selectedYear) {
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

            // --- Gráfico de Barras: Ingresos y Gastos por Mes ---
            if (window.incomeChart) {
                window.incomeChart.destroy();
            }

            const ctxIncome = document.getElementById('income-chart');
            if (ctxIncome && window.Chart) {
                window.incomeChart = new Chart(ctxIncome, {
                    type: 'bar',
                    data: {
                        labels: monthNames,
                        datasets: [
                            {
                                label: 'Ingresos',
                                data: yearData.map(d => d.income),
                                backgroundColor: 'rgba(46, 204, 113, 0.7)',
                                borderColor: 'rgba(46, 204, 113, 1)',
                                borderWidth: 1,
                                borderRadius: 4
                            },
                            {
                                label: 'Gastos',
                                data: yearData.map(d => d.expense),
                                backgroundColor: 'rgba(231, 76, 60, 0.7)',
                                borderColor: 'rgba(231, 76, 60, 1)',
                                borderWidth: 1,
                                borderRadius: 4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: true, position: 'bottom' },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        let label = context.dataset.label || '';
                                        if (label) label += ': ';
                                        if (context.parsed.y !== null) {
                                            label += new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(context.parsed.y);
                                        }
                                        return label;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumSignificantDigits: 3 }).format(value);
                                    }
                                }
                            }
                        }
                    }
                });
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

        // 2. Filtro Fechas o Mes
        const filterMonth = document.getElementById('filter-month');
        const filterDateStart = document.getElementById('filter-date-start');
        const filterDateEnd = document.getElementById('filter-date-end');

        if (filterMonth && filterMonth.value) {
            const filterVal = filterMonth.value; // ej: "2026-03"
            displayedTransactions = displayedTransactions.filter(t => {
                if (!t.date) return false;
                const tDate = String(t.date);
                return tDate.startsWith(filterVal);
            });
        } else {
            if (filterDateStart && filterDateStart.value) {
                displayedTransactions = displayedTransactions.filter(t => t.date >= filterDateStart.value);
            }
            if (filterDateEnd && filterDateEnd.value) {
                displayedTransactions = displayedTransactions.filter(t => t.date <= filterDateEnd.value);
            }
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

        // Ordenar: primero por fecha desc, y luego por orden de registro desc (ID)
        const sorted = [...displayedTransactions].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateB - dateA !== 0) return dateB - dateA;
            
            // Si son de la misma fecha, el más reciente registrado va arriba.
            // Los IDs de transacciones empiezan por 'T' seguido del timestamp.
            return String(b.id).localeCompare(String(a.id));
        });

        let totalSum = 0;

        sorted.forEach(t => {
            const amount = parseFloat(t.amount);
            if (t.type === 'income') totalSum += amount;
            else totalSum -= amount;

            const row = document.createElement('tr');
            const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';

            // Lógica para Titular (Cliente o Proveedor)
            let titularName = '-';
            if (t.clientId) {
                titularName = this.getClientName(t.clientId);
            } else if (t.supplierId) {
                const supplier = state.suppliers.find(s => s.id === t.supplierId);
                titularName = supplier ? supplier.name : '-';
            }

            row.innerHTML = `
                <td>${formatDate(t.date)}</td>
                <td><span class="tag ${t.type}">${t.type === 'income' ? 'Ingreso' : 'Egreso'}</span></td>
                <td>${conceptName}</td>
                <td>${titularName}</td>
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
                option.textContent = this.getClientName(c.id);
                clientSelect.appendChild(option);

                if (contractClientSelect) {
                    const opt = option.cloneNode(true);
                    contractClientSelect.appendChild(opt);
                }
            });
        }
 
        // Inicializar dropdown de personas (Clientes por defecto)
        this.updateTransactionPersonDropdown();
 
        // 2. Desplegables de Filtros Personalizados
        this.renderCustomDropdownOptions('concept', state.concepts, 'name');
        this.renderCustomDropdownOptions('client', state.clients, 'nombreFantasia');
    },

    updateTransactionPersonDropdown() {
        try {
            const conceptSelect = document.getElementById('concept');
            const clientSelect = document.getElementById('client');
            const label = document.getElementById('label-transaction-person');
            if (!conceptSelect || !clientSelect) return;

            const conceptId = conceptSelect.value;
            const concept = (state.concepts || []).find(c => String(c.id) === String(conceptId));

            // Normalización para comparaciones robustas (sin tildes, minúsculas)
            const normalize = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
            
            const conceptName = normalize(concept?.name);

            // Verificar si el concepto requiere proveedores en lugar de clientes
            const isSupplierConcept = conceptName && (
                conceptName.includes('mano de obra') || 
                conceptName.includes('materiales') ||
                conceptName.includes('proveedor')
            );

            console.log("updateTransactionPersonDropdown:", { conceptName, isSupplierConcept });

            if (label) {
                label.textContent = isSupplierConcept ? 'Proveedor' : 'Cliente (Opcional)';
            }

            // Preservar valor seleccionado si es posible
            const currentValue = clientSelect.value;

            // Rellenar con la lista correcta
            clientSelect.innerHTML = isSupplierConcept 
                ? '<option value="">Seleccionar Proveedor</option>' 
                : '<option value="">Seleccionar Cliente</option>';

            const list = isSupplierConcept ? (state.suppliers || []) : (state.clients || []);
            list.forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                // Usar razónSocial/name para proveedores, o el helper para clientes
                if (isSupplierConcept) {
                   option.textContent = item.razonSocial || item.name || 'Sin Nombre';
                } else {
                   option.textContent = this.getClientName(item.id);
                }
                clientSelect.appendChild(option);
            });

            // Intentar restaurar valor si es compatible
            if (currentValue) clientSelect.value = currentValue;
        } catch (err) {
            console.error("Error en updateTransactionPersonDropdown:", err);
        }
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

    populateYearSelector() {
        const yearSelector = document.getElementById('year-selector');
        if (!yearSelector) return;

        const currentYear = new Date().getFullYear();
        const startYear = 2024;
        const endYear = 2035; // Permitir hasta 2035 como solicitado ("superiores al 2026")

        yearSelector.innerHTML = '';
        for (let y = startYear; y <= endYear; y++) {
            const option = document.createElement('option');
            option.value = y;
            option.textContent = y;
            if (y === state.selectedYear) option.selected = true;
            yearSelector.appendChild(option);
        }
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
            label.textContent = item[displayField] || item.razonSocial || item.name || 'Sin Nombre';

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
                    <button class="btn-icon" title="Editar" onclick="UI.editConcept('${c.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
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

        if (clientNameSpan) clientNameSpan.textContent = this.getClientName(client.id);
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

        this.recordActivity('Baja', 'Cliente', `Eliminado: ${this.getClientName(client?.id)}`, { type: 'client', item: client });
        this.showUndoToast(`Cliente "${this.getClientName(client?.id)}" eliminado`);
        this.renderClients();
    },

    // --- LOGICA DEUDAS ---

    renderDebts() {
        const tbody = document.getElementById('debts-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        let totalAmount = 0;

        state.debts.forEach(d => {
            totalAmount += Number(d.amount) || 0;
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

        const tfoot = document.getElementById('debts-list-footer');
        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: right; font-weight: bold;">Total:</td>
                    <td style="font-weight: bold; color: var(--danger-color);">${formatCurrency(totalAmount)}</td>
                    <td colspan="2"></td>
                </tr>
            `;
        }

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
        const dateEl = form.elements['dueDate'];
        const dateVal = debt.dueDate || debt.date;
        if (dateEl._flatpickr) {
            dateEl._flatpickr.setDate(dateVal);
        } else {
            dateEl.value = dateVal;
        }
        form.elements['conceptId'].value = debt.conceptId || '';
        form.elements['description'].value = debt.description || '';

        document.getElementById('debt-form-title').textContent = 'Editar Deuda';
        const cancelBtn = document.getElementById('cancel-debt-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async payDebt(id) {
        if (!confirm('¿Estás seguro de que quieres marcar esta deuda como pagada? Se eliminará de Deudas y se creará un egreso en Movimientos.')) return;

        const originalDebts = [...state.debts];
        const originalTransactions = [...state.transactions];

        // --- Optimista: Mostrar Feedback Visual ---
        const rows = document.querySelectorAll(`[onclick="UI.payDebt('${id}')"]`);
        const row = rows.length > 0 ? rows[0].closest('tr') : null;
        if (row) row.classList.add('fade-out');

        try {
            await window.StorageAPI.async.payDebt(id);

            // Actualizar estado local reactivamente
            state.debts = state.debts.filter(d => d.id !== id);

            // Recargar transacciones para mostrar el nuevo egreso si es necesario
            // O podemos ser más optimistas y añadirlo manualmente
            const debt = originalDebts.find(d => d.id === id);
            if (debt) {
                const newTx = {
                    id: Date.now().toString(), // El server generará uno real, esto es para la UI
                    type: 'expense',
                    amount: debt.amount,
                    conceptId: debt.conceptId,
                    supplierId: debt.supplierId, // Incluir proveedor para que renderTransactionsList lo muestre
                    date: getLocalISODate(),
                    observation: `Pago deuda: ${debt.description || ''}`
                };
                state.transactions = [newTx, ...state.transactions];
            }

            this.showToast('Deuda pagada y movimiento registrado', 'success');
        } catch (error) {
            console.error("Error al pagar deuda:", error);
            if (row) row.classList.remove('fade-out');
            state.debts = originalDebts;
            state.transactions = originalTransactions;
            this.showToast('Error al procesar el pago en el servidor.', 'error');
        } finally {
            this.renderDashboard();
        }
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
                <td>${s.address || '-'}</td>
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

    async handleSupplierSubmit(e) {
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

        await this.loadData();
        this.resetSupplierForm();
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
        
        let totalAmount = 0;

        state.debtors.forEach(d => {
            totalAmount += Number(d.amount) || 0;
            const tr = document.createElement('tr');
            
            // Intentar encontrar si el titular es un cliente para mostrar nombre de fantasía
            let displayName = d.titular;
            const client = state.clients.find(c => c.name === d.titular || c.razonSocial === d.titular || c.nombreFantasia === d.titular);
            if (client) {
                displayName = this.getClientName(client.id);
            }

            tr.innerHTML = `
                <td>${formatDate(d.date)}</td>
                <td>${displayName}</td>
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

        const tfoot = document.getElementById('debtors-list-footer');
        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: right; font-weight: bold;">Total:</td>
                    <td style="font-weight: bold; color: var(--secondary-color);">${formatCurrency(totalAmount)}</td>
                    <td></td>
                </tr>
            `;
        }

        this.applyPrivileges();
        this.populateDebtorClientSelect();
    },

    handleDebtorSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const clientId = formData.get('titular');
        const client = state.clients.find(c => c.id === clientId);

        const debtor = {
            id: id || Date.now().toString(),
            titular: client ? (client.nombreFantasia || client.razonSocial || client.name) : 'Desconocido',
            clientId: clientId,
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

        this.populateDebtorClientSelect(debtor.clientId);

        const form = document.getElementById('add-debtor-form');
        document.getElementById('debtor-id').value = debtor.id;
        form.elements['titular'].value = debtor.titular;
        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(debtor.amount);
        const dateEl = form.elements['date'];
        if (dateEl._flatpickr) {
            dateEl._flatpickr.setDate(debtor.date);
        } else {
            dateEl.value = debtor.date;
        }
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

    populateDebtorClientSelect(selectedId) { // Changed parameter name to selectedId
        const sel = document.getElementById('debtor-client-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar Cliente</option>';
        state.clients.forEach(c => {
            const fantasyName = this.getClientName(c.id);
            const opt = document.createElement('option');
            opt.value = c.id; // Changed to c.id
            opt.textContent = fantasyName;
            
            // Changed selection logic
            if (c.id === selectedId) {
                opt.selected = true;
            }
            
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

    async payDebtor(id) {
        if (!confirm('¿Estás seguro de que quieres marcar esta deuda como pagada? Esto la eliminará de Deudores y creará un ingreso en Movimientos.')) return;

        const originalDebtors = [...state.debtors];
        const originalTransactions = [...state.transactions];

        const rows = document.querySelectorAll(`[onclick="UI.payDebtor('${id}')"]`);
        const row = rows.length > 0 ? rows[0].closest('tr') : null;
        if (row) row.classList.add('fade-out');

        try {
            await window.StorageAPI.async.payDebtor(id);

            state.debtors = state.debtors.filter(d => d.id !== id);

            const debtor = originalDebtors.find(d => d.id === id);
            if (debtor) {
                // Resolver nombre para la observación
                let displayName = debtor.titular;
                const client = state.clients.find(c => c.name === debtor.titular || c.razonSocial === debtor.titular || c.nombreFantasia === debtor.titular);
                if (client) {
                    displayName = this.getClientName(client.id);
                }

                const newTx = {
                    id: 'T' + Date.now().toString(),
                    type: 'income',
                    amount: debtor.amount,
                    conceptId: '1', // Concepto fijo "Ventas" (ID 1)
                    clientId: debtor.clientId,
                    date: getLocalISODate(),
                    observation: `Cobro a deudor: ${displayName}`
                };
                state.transactions = [newTx, ...state.transactions];
            }

            this.showToast('Deuda liquidada con éxito', 'success');
        } catch (error) {
            console.error("Error al cobrar deuda:", error);
            if (row) row.classList.remove('fade-out');
            state.debtors = originalDebtors;
            state.transactions = originalTransactions;
            this.showToast('Error al procesar el cobro.', 'error');
        } finally {
            this.renderDashboard();
        }
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
            // Usar formatDate para consistencia (DD-MM-YYYY)
            const dateStr = formatDate(log.timestamp);

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

    async handleTransactionSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const id = formData.get('id');

        let type = formData.get('type');
        const conceptId = formData.get('concept');
        const concept = (state.concepts || []).find(c => c.id === conceptId);
        const personId = formData.get('client'); // This is the 'client' select, which will now hold either client or supplier ID

        // Verificar si el concepto requiere proveedores en lugar de clientes
        const isSupplierConcept = concept && concept.name && (
            concept.name.toLowerCase().includes('mano de obra') || 
            concept.name.toLowerCase().includes('materiales')
        );

        const dateVal = formData.get('date');
        console.log('--- Intentando Guardar Movimiento ---');
        console.log('ID:', id || 'Nuevo');
        console.log('Concepto:', concept?.name || 'Varios');
        console.log('Entidad:', isSupplierConcept ? 'Proveedor' : 'Cliente');

        const transaction = {
            id: id || Date.now().toString(),
            type: type,
            amount: parseAmount(formData.get('amount')),
            conceptId: conceptId,
            clientId: !isSupplierConcept ? personId : null,
            supplierId: isSupplierConcept ? personId : null,
            date: dateVal,
            observation: formData.get('observation')
        };

        console.log('Objeto Transacción:', transaction);

        if (!transaction.date) {
            this.showToast('La fecha es obligatoria', 'warning');
            return;
        }

        UI.showLoading(form);

        try {
            // Guardado pesimista: Esperamos a que el backend confirme
            console.log('Enviando a StorageAPI...');
            const savedTx = await window.StorageAPI.async.saveTransaction(transaction);
            console.log('Respuesta Servidor:', savedTx);

            // Si llegamos aquí, se guardó correctamente en la DB
            if (id) {
                // Edición: Reemplazar en el estado local
                state.transactions = state.transactions.map(t => t.id === id ? transaction : t);
                this.recordActivity('Modificación', 'Movimiento', `Actualizado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
            } else {
                // Alta: Prepend al estado local para que aparezca arriba
                state.transactions = [transaction, ...state.transactions];
                this.recordActivity('Alta', 'Movimiento', `Registrado: ${concept?.name || 'Varios'} por ${formatCurrency(transaction.amount)}`);
            }

            this.showToast('Movimiento guardado y validado en la base de datos', 'success');
            this.cancelTransactionEdit();
            UI.switchView('transactions');
            this.renderDashboard(); // Asegurar balance o datos globales actualizados
        } catch (error) {
            console.error("Error al guardar transacción:", error);
            this.showToast('Error: ' + (error.message || 'No se pudo registrar el movimiento'), 'error');
        } finally {
            UI.hideLoading(form);
        }
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
        const dateEl = form.elements['date'];
        if (dateEl._flatpickr) {
            dateEl._flatpickr.setDate(transaction.date);
        } else {
            dateEl.value = transaction.date;
        }
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
            // Volver a poner la fecha de hoy
            const dateInput = document.getElementById('date');
            if (dateInput) {
                const today = getLocalISODate();
                if (dateInput._flatpickr) {
                    dateInput._flatpickr.setDate(today);
                } else {
                    dateInput.value = today;
                }
            }
        }
    },

    async handleTransactionDelete(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        if (!confirm('¿Estás seguro de que quieres eliminar este movimiento?')) return;

        const tx = state.transactions.find(t => t.id === id);
        const concept = state.concepts.find(c => c.id === tx?.conceptId);
        const originalTransactions = [...state.transactions];

        // --- Baja Optimista ---
        state.transactions = state.transactions.filter(t => t.id !== id);
        state.lastDeleted = { type: 'transaction', data: { ...tx } };

        try {
            await window.StorageAPI.async.deleteTransaction(id);
            this.recordActivity('Baja', 'Movimiento', `Eliminado: ${concept?.name || 'Varios'} por ${formatCurrency(tx?.amount || 0)}`, { type: 'transaction', item: tx });
            this.showUndoToast(`Movimiento de ${formatCurrency(tx?.amount || 0)} eliminado`);
        } catch (error) {
            console.error("Error al eliminar transacción:", error);
            state.transactions = originalTransactions;
            this.showToast('Error al eliminar en el servidor.', 'error');
        } finally {
            this.renderDashboard();
        }
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
        } else if (type === 'projectHistory') {
            window.StorageAPI.async.addProjectHistory(data.projectId, data.item);
            this.renderProjects();
        }

        this.recordActivity('Restauración', type.charAt(0).toUpperCase() + type.slice(1), `Restaurado ítem eliminado anteriormente`);

        state.lastDeleted = null;

        // Quitar todos los toasts activos
        document.querySelectorAll('.toast').forEach(t => t.remove());
    },

    async handleUndoFromLog(logId) {
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
        } else if (type === 'project') {
            try {
                // 1. Restaurar el proyecto principal
                await window.StorageAPI.async.saveProject(item);

                // 2. Restaurar cada entrada del historial
                const history = log.extraData.history || [];
                for (const h of history) {
                    await window.StorageAPI.async.addProjectHistory(item.id, {
                        previousStatus: h.previousStatus,
                        newStatus: h.newStatus,
                        note: h.note,
                        changeDate: h.changeDate
                    });
                }

                // 3. Recargar estado local
                const updatedProjects = await window.StorageAPI.async.getProjects();
                state.projects = updatedProjects;
                this.renderProjects();
                this.showToast(`Proyecto de ${this.getClientName(item.clientId)} restaurado con ${history.length} fase(s)`, 'success');
            } catch (err) {
                console.error('Error al restaurar proyecto:', err);
                this.showToast('Error al restaurar el proyecto', 'error');
                return;
            }
        } else if (type === 'projectHistory') {
            try {
                await window.StorageAPI.async.addProjectHistory(log.extraData.projectId, item);
                this.renderProjects();
                this.showToast(`Registro de historial restaurado`, 'success');
            } catch (err) {
                console.error('Error al restaurar historial:', err);
                this.showToast('Error al restaurar el registro', 'error');
                return;
            }
        }

        this.recordActivity('Restauración', log.module || log.category || 'Varios', `Restaurado desde historial: ${log.details}`);


        this.renderActivity();
        this.showToast('Elemento restaurado exitosamente', 'success');
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

    async handleUserSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = document.getElementById('edit-user-id').value;
        const username = formData.get('username').toLowerCase();
        const password = formData.get('password'); // Puede estar vacío en edición

        // Validar contraseña obligatoria en creación
        if (!id && (!password || password.trim() === '')) {
            this.showToast('La contraseña es obligatoria para usuarios nuevos', 'error');
            return;
        }

        // Evitar duplicados
        const existingUser = state.users.find(u => u.username === username);
        if (existingUser && existingUser.id !== id) {
            this.showToast('Error: El nombre de usuario ya existe', 'error');
            return;
        }

        // Capturar módulos seleccionados
        const selectedModules = Array.from(
            document.querySelectorAll('.module-checkbox:checked')
        ).map(cb => cb.value);

        const userId = id || Date.now().toString();
        const user = {
            id: userId,
            name: formData.get('name'),
            username: username,
            password: password || '', // Vacío = no cambiar en servidor
            role: formData.get('role'),
            modules: selectedModules
        };

        const submitBtn = document.getElementById('btn-save-user');
        this.showLoading(submitBtn);

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(user)
            });

            if (!response.ok) {
                const err = await response.json();
                this.showToast('Error: ' + (err.error || 'No se pudo guardar el usuario'), 'error');
                return;
            }

            const savedUser = await response.json(); // Sin contraseña

            // Actualizar estado local
            if (id) {
                const index = state.users.findIndex(u => u.id === id);
                if (index >= 0) state.users[index] = savedUser;
                this.recordActivity('Modificación', 'Usuario', `Actualizado: ${savedUser.username}`);
            } else {
                state.users.push(savedUser);
                this.recordActivity('Alta', 'Usuario', `Creado: ${savedUser.username}`);
            }

            this.showToast(id ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente', 'success');
            this.resetUserForm();
            this.renderUsers();
        } catch (err) {
            this.showToast('Error de conexión con el servidor', 'error');
        } finally {
            this.hideLoading(submitBtn);
        }
    },

    editUser(id) {
        const user = state.users.find(u => u.id === id);
        if (!user) return;

        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('user-real-name').value = user.name;
        document.getElementById('user-username').value = user.username;
        // No pre-rellenar la contraseña (buena práctica de seguridad)
        const pwdField = document.getElementById('user-password');
        if (pwdField) {
            pwdField.value = '';
            pwdField.placeholder = 'Dejar vacío para no cambiar';
        }
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

    async deleteUser(id) {
        const user = state.users.find(u => u.id === id);
        if (!user || user.username === 'administrador') return; // No borrar admin principal

        try {
            const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Error al eliminar');

            state.users = state.users.filter(u => u.id !== id);
            this.recordActivity('Baja', 'Usuario', `Eliminado: ${user.username}`);
            this.showToast('Usuario eliminado', 'info');
            this.renderUsers();
        } catch (err) {
            this.showToast('Error al eliminar usuario', 'error');
        }
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
                    Fecha: formatDate(t.date),
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
        doc.text(`Fecha de emisión: ${formatDate(new Date())}`, 14, 30);

        // Datos para tabla
        const tableBody = dataToExport.map(t => {
            const conceptName = state.concepts.find(c => c.id === t.conceptId)?.name || 'Desconocido';
            const client = state.clients.find(c => c.id === t.clientId);
            const clientName = client ? (client.razonSocial || client.name) : '-';
            return [
                formatDate(t.date),
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
        doc.text(`Fecha de emisión: ${formatDate(new Date())}`, 14, 30);

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
            Fecha: formatDate(d.date),
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
        doc.text(`Fecha: ${formatDate(new Date())}`, 14, 30);

        const tableBody = state.debts.map(d => [
            formatDate(d.date),
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
            Fecha: formatDate(d.date),
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
        doc.text(`Fecha: ${formatDate(new Date())}`, 14, 30);

        const tableBody = state.debtors.map(d => [
            formatDate(d.date),
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
        const id = formData.get('id');

        const concept = {
            id: id || Date.now().toString(),
            name: formData.get('name'),
            type: formData.get('type')
        };

        window.StorageAPI.saveConcept(concept);

        if (id) {
            const index = state.concepts.findIndex(c => c.id === id);
            if (index >= 0) state.concepts[index] = concept;
            this.recordActivity('Modificación', 'Concepto', `Actualizado concepto: ${concept.name}`);
        } else {
            state.concepts.push(concept);
            this.recordActivity('Alta', 'Concepto', `Creado concepto: ${concept.name}`);
        }

        this.resetConceptForm();
        // El renderizado está manejado por el Proxy de state, pero renderTransactionFormOptions podría no actualizarse sola si modificamos in-place
        // Para forzar la actualización en la UI global de conceptos y form de transacciones (aunque el proxy llama a UI.renderConcepts() y UI.renderTransactionFormOptions()):
        state.concepts = [...state.concepts]; // Trigger setter
    },

    editConcept(id) {
        const concept = state.concepts.find(c => c.id === id);
        if (!concept) return;

        const form = document.getElementById('add-concept-form');
        document.getElementById('concept-id').value = concept.id;
        form.elements['name'].value = concept.name || '';
        form.elements['type'].value = concept.type || 'expense';

        document.getElementById('concept-form-title').textContent = 'Editar Concepto';
        const btnSave = document.getElementById('btn-save-concept');
        if (btnSave) btnSave.textContent = 'Actualizar Concepto';
        const cancelBtn = document.getElementById('cancel-concept-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        this.switchView('concepts');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    resetConceptForm() {
        const form = document.getElementById('add-concept-form');
        if (form) {
            form.reset();
            document.getElementById('concept-id').value = '';
            document.getElementById('concept-form-title').textContent = 'Crear Concepto';
            const btnSave = document.getElementById('btn-save-concept');
            if (btnSave) btnSave.textContent = 'Agregar Concepto';
            const cancelBtn = document.getElementById('cancel-concept-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    },

    async handleClientSubmit(e) {
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

        await this.loadData();
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
            const amountText = c.currency?.toUpperCase() === 'UF' ? `${c.amount} UF` : formatCurrency(c.amount);
            tr.innerHTML = `
                <td>${this.getClientName(c.clientId)}</td>
                <td style="font-weight:bold;">${amountText}</td>
                <td>${formatDate(c.startDate)}</td>
                <td>${c.endDate ? formatDate(c.endDate) : '<span class="tag-status" style="background: var(--primary-light); color: var(--primary-color)">Indefinido</span>'}</td>
                <td>Día ${c.billingDay}</td>
                <td>${c.frequency || 'Mensual'}</td>
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

    async handleContractSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const id = formData.get('id');

        const isIndefinite = formData.get('indefinite') === 'on';
        const contract = {
            id: id || Date.now().toString(),
            clientId: formData.get('clientId'),
            amount: parseAmount(formData.get('amount')),
            startDate: formData.get('startDate'),
            endDate: isIndefinite ? null : formData.get('endDate'),
            billingDay: parseInt(formData.get('billingDay')),
            frequency: formData.get('frequency'),
            currency: formData.get('currency') || 'CLP'
        };

        window.StorageAPI.saveContract(contract);

        if (id) {
            this.recordActivity('Modificación', 'Contrato', `Actualizado contrato`);
        } else {
            this.recordActivity('Alta', 'Contrato', `Registrado contrato`);
        }

        await this.loadData();
        this.switchView('contracts');
    },

    editContract(id) {
        const contract = state.contracts.find(c => c.id === id);
        if (!contract) return;

        const form = document.getElementById('add-contract-form');
        document.getElementById('contract-id').value = contract.id;
        form.elements['clientId'].value = contract.clientId;
        form.elements['amount'].value = new Intl.NumberFormat('es-CL').format(contract.amount);
        
        const startEl = form.elements['startDate'];
        const endEl = form.elements['endDate'];
        if (startEl._flatpickr) startEl._flatpickr.setDate(contract.startDate);
        else startEl.value = contract.startDate;
        
        const isIndefinite = !contract.endDate;
        const indefiniteCheckbox = document.getElementById('contract-indefinite');
        if (indefiniteCheckbox) {
            indefiniteCheckbox.checked = isIndefinite;
            endEl.disabled = isIndefinite;
        }

        if (endEl._flatpickr) {
            if (isIndefinite) {
                endEl._flatpickr.clear();
            } else {
                endEl._flatpickr.setDate(contract.endDate);
            }
        } else {
            endEl.value = contract.endDate || '';
        }

        form.elements['billingDay'].value = contract.billingDay;
        form.elements['frequency'].value = contract.frequency || 'mensual';
        form.elements['currency'].value = contract.currency || 'CLP';

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
            
            const endDateInput = document.getElementById('contract-end-date');
            if (endDateInput) {
                endDateInput.disabled = false;
            }
        }
    },

    async deleteContract(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        await window.StorageAPI.async.deleteContract(id);
        this.recordActivity('Baja', 'Contrato', `Eliminado contrato`);
        await this.loadData();
        this.renderContracts();
    },

    checkPendingContracts() {
        const pendingBody = document.getElementById('alerts-pending-body');
        const invoicedBody = document.getElementById('alerts-invoiced-body');
        const overdueBody = document.getElementById('alerts-overdue-body');

        // Centralizar actualización de campana
        this.refreshAlertBadge();

        const contracts = state.pendingContracts;

        if (pendingBody) {
            pendingBody.innerHTML = '';
            contracts.forEach(c => {
                const clientName = this.getClientName(c.clientId);
                const conceptText = `Mensualidad Contrato - ${clientName}`;

                let amountHtml = '';
                let actionsHtml = '';

                if (c.currency?.toUpperCase() === 'UF') {
                    amountHtml = `<span style="font-weight:bold; color: var(--danger-color);">${c.amount} UF</span>`;
                    actionsHtml = `
                        <button class="btn-sm btn-outline-primary btn-convert" onclick="UI.convertContractUF('${c.id}')">
                            <i class="fa-solid fa-calculator"></i> Convertir a Pesos
                        </button>
                    `;
                } else {
                    amountHtml = `<span style="font-weight:bold; color: var(--danger-color);">${formatCurrency(c.amount)}</span>`;
                    actionsHtml = `
                        <button class="btn-sm btn-outline-success" onclick="UI.markContractInvoiced('${c.id}')">
                            <i class="fa-solid fa-check"></i> Factura Emitida
                        </button>
                    `;
                }

                const tr = document.createElement('tr');
                tr.id = `pending-row-${c.id}`;
                tr.innerHTML = `
                    <td>${clientName}</td>
                    <td class="amount-cell">${amountHtml}</td>
                    <td>${conceptText}</td>
                    <td class="action-cell">
                        ${actionsHtml}
                    </td>
                `;
                pendingBody.appendChild(tr);
            });
        }

        if (invoicedBody) {
            invoicedBody.innerHTML = '';
            const now = new Date();
            const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            
            // Usar datos del historial si están disponibles, si no fallback al estado local (menos preciso)
            const invoicedData = state.invoicedContractsCurrent || [];
            
            invoicedData.forEach(c => {
                const clientName = c.clientFantasyName || c.clientName || this.getClientName(c.clientId);
                const tr = document.createElement('tr');
                
                // El monto en la historia ya es el CLP neto. Agregamos el IVA.
                const amountWithIva = Math.round(c.amountCLP * 1.19);
                
                tr.innerHTML = `
                    <td>${clientName}</td>
                    <td style="font-weight:bold; color: var(--secondary-color);">${formatCurrency(amountWithIva)}</td>
                    <td>${c.periodName}</td>
                    <td class="action-cell">
                        <button class="btn-sm btn-outline-danger" title="Revertir Emisión" onclick="UI.undoContractInvoice('${c.contractId}')">
                            <i class="fa-solid fa-clock-rotate-left"></i> Revertir
                        </button>
                    </td>
                `;
                invoicedBody.appendChild(tr);
            });
        }
    },

    async markContractInvoiced(id, clpAmount = null) {
        const row = document.getElementById(`pending-row-${id}`);
        const contract = state.pendingContracts.find(c => c.id === id);
        if (!contract) return;

        // Feedback visual inmediato
        const btn = row?.querySelector('button');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
        }

        if (contract.currency === 'UF' && !clpAmount) {
            this.showToast('Debe convertir el monto UF a pesos primero.', 'info');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Convertir a Pesos';
            }
            return;
        }

        try {
            const response = await window.StorageAPI.async.invoiceContract(id);
            
            // Actualización optimista: mover el contrato de "pendiente" a "emitido" localmente
            // Esto permite que el cambio sea instantáneo en el DOM
            const invoicedItem = state.pendingContracts.find(c => c.id === id);
            if (invoicedItem) {
                state.pendingContracts = state.pendingContracts.filter(c => c.id !== id);
                // Si el servidor nos devuelve el periodo, lo usamos
                const now = new Date();
                const currentPeriod = response.period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                
                // Agregar al historial local temporal (esto ayuda a la actualización inmediata)
                // Usamos clpAmount si venía de una conversión UF, o el monto original en CLP
                const neto = clpAmount ? Math.round(clpAmount / 1.19) : invoicedItem.amount;
                
                state.invoicedContractsCurrent.unshift({
                    contractId: id,
                    clientId: invoicedItem.clientId,
                    periodName: currentPeriod,
                    amountCLP: neto,
                    issueDate: new Date().toISOString()
                });
            }

            this.showToast('Factura Emitida Correctamente', 'success');
            
            // Renderizamos inmediatamente sin esperar al servidor
            this.checkPendingContracts();
            
            // Luego actualizamos todo silenciosamente en segundo plano
            this.loadData(); 
        } catch (error) {
            console.error("Error al facturar contrato:", error);
            this.showToast('Error al procesar facturación.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Emitir Factura';
            }
            this.loadData();
        }
    },

    async convertContractUF(id) {
        const btn = document.querySelector(`#pending-row-${id} .btn-convert`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';
        }

        try {
            const data = await window.StorageAPI.async.getUF();
            const uf = data.valor;
            const contract = state.pendingContracts.find(c => c.id === id);
            const clpNeto = Math.round(contract.amount * uf);
            const clpTotal = Math.round(clpNeto * 1.19);

            const amountCell = document.querySelector(`#pending-row-${id} .amount-cell`);
            const actionCell = document.querySelector(`#pending-row-${id} .action-cell`);

            if (amountCell && actionCell) {
                amountCell.innerHTML = `
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight:bold; color: var(--danger-color);">${contract.amount} UF</span>
                        <small class="text-muted">Neto: ${formatCurrency(clpNeto)}</small>
                        <small class="text-success"><strong>Total c/IVA: ${formatCurrency(clpTotal)}</strong></small>
                        <small class="text-muted" style="font-size: 0.7rem;">Valor UF: ${formatCurrency(uf)}</small>
                    </div>
                `;

                actionCell.innerHTML = `
                    <button class="btn-sm btn-success" onclick="UI.markContractInvoiced('${id}', ${clpTotal})">
                        <i class="fa-solid fa-check"></i> Emitir por ${formatCurrency(clpTotal)}
                    </button>
                    <button class="btn-sm btn-text" onclick="UI.checkPendingContracts()" style="margin-top: 5px;">
                        Cancelar
                    </button>
                `;
            }
        } catch (error) {
            console.error("Error al convertir UF:", error);
            this.showToast('No se pudo obtener el valor de la UF.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Reintentar';
            }
        }
    },

    undoContractInvoice(id) {
        if (!confirm('¿Estás seguro de que quieres revertir la emisión de esta factura? Se eliminará la deuda asociada.')) return;

        window.StorageAPI.undoInvoiceContract(id);
        this.showToast('Emisión revertida con éxito', 'info');

        this.loadData();
        this.checkPendingContracts();
    },

    // --- LOGICA DE PROYECTOS ---

    renderProjects() {
        const tbody = document.getElementById('projects-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const statusFilter = document.getElementById('project-filter-status')?.value || 'all';
        const searchText = document.getElementById('project-search')?.value.toLowerCase() || '';

        let filtered = state.projects || [];
        
        // Por defecto, ocultar los finalizados del pipeline principal, 
        // a menos que se filtre específicamente por ellos.
        if (statusFilter === 'all') {
            filtered = filtered.filter(p => p.status !== 'Finalizado');
        } else {
            filtered = filtered.filter(p => p.status === statusFilter);
        }
        if (searchText) {
            filtered = filtered.filter(p => {
                const name = this.getClientName(p.clientId).toLowerCase();
                const projName = (p.projectName || '').toLowerCase();
                const obs = (p.observations || '').toLowerCase();
                return name.includes(searchText) || projName.includes(searchText) || obs.includes(searchText);
            });
        }

        filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        filtered.forEach(p => {
            const tr = document.createElement('tr');
            tr.id = `project-row-${p.id}`;
            const clientName = this.getClientName(p.clientId);

            const history = window.StorageAPI.getProjectHistory(p.id) || [];
            
            // Construir el contenedor horizontal de evolución
            const historyHtml = history.map(h => `
                <div class="history-evolution-card" onclick="if(!event.target.closest('button')){UI.toggleHistoryNote(this)}">
                    <div class="evolution-header">
                        <span class="status-badge status-${h.newStatus.replace(/\s+/g, '-')}" style="padding: 2px 8px; font-size: 0.75rem;">
                            ${h.newStatus}
                        </span>
                        <div class="evolution-actions">
                            <button class="btn-mini-action text-primary" title="Editar nota" onclick="event.stopPropagation(); UI.editProjectHistory('${h.id}', '${p.id}', event)">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="btn-mini-action text-danger" title="Borrar registro" onclick="event.stopPropagation(); UI.deleteProjectHistory('${h.id}', '${p.id}', event)">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="evolution-date" style="cursor:pointer;" onclick="UI.openProjectDateModal('${h.id}', '${p.id}', '${h.changeDate}', '${h.newStatus}')">${formatDate(h.changeDate)}</div>
                    <div class="evolution-note">${h.note || 'Sin observaciones'}</div>
                </div>
            `).join('');

            tr.innerHTML = `
                <td style="font-weight: 500;">
                    ${p.projectName || 'Sin nombre de proyecto'}
                    <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 400; margin-top: 2px;">
                        ${clientName}
                    </div>
                </td>
                <td>
                    <div class="history-horizontal-container">
                        ${historyHtml || '<span class="text-muted small">Sin historial</span>'}
                    </div>
                </td>
                <td style="font-weight: bold; color: var(--text-color);">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                        <span>${p.estimatedAmount ? formatCurrency(p.estimatedAmount) : '<span class="text-muted small">-</span>'}</span>
                        <button class="btn-icon text-primary" style="font-size: 0.8rem; padding: 2px;" title="Editar Monto Estimado" onclick="UI.quickEditEstimatedAmount('${p.id}')">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </div>
                </td>
                <td class="actions">
                    <button class="btn-icon text-success" title="Cerrar Proyecto (Listo)" onclick="UI.closeProject('${p.id}')">
                         <i class="fa-solid fa-check-circle"></i>
                    </button>
                    <button class="btn-icon text-primary" title="Actualizar Proyecto (Nueva Fase)" onclick="UI.editProject('${p.id}', true)">
                         <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar Proyecto" onclick="UI.deleteProject('${p.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.applyPrivileges();
    },

    async handleProjectSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const id = formData.get('id');
        const historyId = formData.get('historyId');
        const isNew = !id;
        
        console.log('handleProjectSubmit:', { id, historyId, isNew });

        try {
            if (historyId) {
                // Modo edición de historial
                await window.StorageAPI.async.updateProjectHistory(historyId, {
                    note: formData.get('observations'),
                    newStatus: formData.get('status'),
                    changeDate: formData.get('visitDate')
                });
                this.showToast('Registro de historial actualizado', 'success');
            } else {
                // Modo normal: Proyecto nuevo o actualización de estado (nueva fase)
                const project = {
                    id: id || 'P' + Date.now().toString(),
                    projectName: formData.get('projectName'),
                    clientId: formData.get('clientId'),
                    status: formData.get('status') || 'Evaluación',
                    observations: formData.get('observations'),
                    visitDate: formData.get('visitDate') || getLocalISODate(),
                    executionDate: id ? (state.projects.find(p => p.id === id)?.executionDate) : null,
                    estimatedAmount: formData.get('estimatedAmount') ? parseFloat(formData.get('estimatedAmount').replace(/\./g, '').replace(/,/g, '.')) : null,
                    createdAt: id ? (state.projects.find(p => p.id === id)?.createdAt) : new Date().toISOString()
                };

                // Log inicial en bitácora si el estado cambió o es nuevo
                const oldProject = isNew ? null : state.projects.find(proj => proj.id === project.id);
                const statusChanged = isNew || (oldProject && oldProject.status !== project.status);

                const isPhaseUpdate = document.getElementById('is-phase-update').value === 'true';
                const shouldAddHistory = statusChanged || isPhaseUpdate;

                await window.StorageAPI.async.saveProject(project);

                if (shouldAddHistory) {
                    await window.StorageAPI.async.addProjectHistory(project.id, {
                        previousStatus: oldProject ? oldProject.status : null,
                        newStatus: project.status,
                        note: project.observations || ''
                    });
                }

                // Reactividad inmediata
                if (isNew) {
                    state.projects = [project, ...state.projects];
                } else {
                    state.projects = state.projects.map(p => p.id === project.id ? project : p);
                }
                this.showToast(isNew ? 'Proyecto registrado' : 'Proyecto actualizado', 'success');
            }
            this.resetProjectForm();
            this.renderProjects();

        } catch (error) {
            console.error("Error al guardar proyecto:", error);
            const msg = error.message.includes('fetch') ? 'Error de conexión con el servidor' : (error.message || 'Error desconocido');
            this.showToast(`Error al guardar: ${msg}`, 'error');
        }
    },

    getClientName(id) {
        const c = state.clients.find(cl => cl.id === id);
        return c ? (c.nombreFantasia || c.razonSocial || c.name || 'Cliente') : 'Cliente';
    },

    async showProjectHistory(id) {
        const history = await window.StorageAPI.async.getProjectHistory(id);
        const container = document.getElementById('project-history-container');
        if (!container) return;

        container.innerHTML = history.length ? '' : '<div class="empty-state">No hay historial registrado.</div>';

        history.forEach(h => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <div class="activity-icon"><i class="fa-solid fa-history"></i></div>
                <div class="activity-content">
                    <div class="activity-header">
                        <span class="activity-action">${h.newStatus}</span>
                        <span class="activity-time">${formatDate(h.changeDate)}</span>
                        <button class="btn-icon text-danger" style="margin-left: auto; font-size: 0.8rem;" title="Eliminar registro" onclick="UI.deleteProjectHistory('${h.id}', '${id}')">

                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    ${h.previousStatus ? `<div class="activity-category">Anterior: ${h.previousStatus}</div>` : ''}
                    <div class="activity-details">${h.note || 'Sin comentarios.'}</div>
                </div>
            `;
            container.appendChild(item);
        });

        this.openModal('project-history-modal');
    },

    async deleteProjectHistory(historyId, projectId, e) {
        if (e) e.stopPropagation();
        console.log('UI.deleteProjectHistory llamado:', { historyId, projectId });
        if (!confirm('¿Estás seguro de que quieres eliminar este registro del historial?')) return;

        try {
            // Obtener el registro antes de borrar para el log/undo
            const history = await window.StorageAPI.async.getProjectHistory(projectId);
            const item = history.find(h => h.id.toString() === historyId.toString());
            
            console.log('Enviando petición de eliminación para id:', historyId);
            await window.StorageAPI.async.deleteProjectHistory(historyId);
            
            this.recordActivity(
                'Baja', 
                'Proyecto', 
                `Eliminado registro de evolución: ${item?.newStatus || 'Sin estado'}`, 
                { type: 'projectHistory', projectId: projectId, item: item }
            );

            state.lastDeleted = { 
                type: 'projectHistory', 
                data: { projectId: projectId, item: item } 
            };

            this.showUndoToast(`Registro de historial eliminado`);
            
            // Refrescar el pipeline si estamos en la vista de proyectos
            const projectsView = document.getElementById('projects');
            if (projectsView && projectsView.classList.contains('active')) {
                this.renderProjects();
            }
            
            // Refrescar el modal de historial si está abierto
            const historyModal = document.getElementById('project-history-modal');
            if (historyModal && historyModal.classList.contains('active')) {
                this.showProjectHistory(projectId);
            }
        } catch (error) {
            console.error("Error al eliminar historial:", error);
            this.showToast('Error al eliminar registro de historial', 'error');
        }

    },

    closeProject(id) {
        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        document.getElementById('close-project-id').value = id;
        document.getElementById('close-project-amount').value = '';
        this.openModal('close-project-modal');
    },

    async confirmCloseProject(e) {
        e.preventDefault();
        const form = e.target;
        const id = document.getElementById('close-project-id').value;
        const rawMonto = document.getElementById('close-project-amount').value || '0';
        const monto = parseFloat(rawMonto.replace(/\./g, '').replace(/,/g, '.')) || 0;
        
        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

        try {
            // 1. Crear Deuda en Deudores
            const debtor = {
                id: 'D' + Date.now().toString() + Math.floor(Math.random() * 1000),
                debtor: this.getClientName(p.clientId),
                amount: monto,
                dueDate: getLocalISODate(),
                description: p.projectName || 'Proyecto Cerrado',
                status: 'Pendiente',
                clientId: p.clientId
            };
            await window.StorageAPI.async.saveDebtor(debtor);

            // 2. Cerrar Proyecto
            const project = { ...p, status: 'Finalizado' };
            await window.StorageAPI.async.saveProject(project);
            await window.StorageAPI.async.addProjectHistory(id, {
                previousStatus: p.status,
                newStatus: 'Finalizado',
                note: 'Proyecto Cerrado / Facturado'
            });

            state.projects = state.projects.map(proj => proj.id === id ? project : proj);
            
            // 3. Atualizar UI
            this.closeModal('close-project-modal');
            this.showToast('Proyecto cerrado y deuda registrada', 'success');
            
            this.renderProjects();
            if (document.getElementById('projects-history-card') && document.getElementById('projects-history-card').style.display === 'block') {
                this.renderProjectHistory();
            }
            
            // Refrescar datos en segundo plano para que la vista de deudores se actualice si se navega allá
            this.loadData();
        } catch (error) {
            console.error("Error al cerrar proyecto y registrar deuda:", error);
            this.showToast('Error al cerrar proyecto', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },

    toggleProjectHistoryView() {
        const card = document.getElementById('projects-history-card');
        if (card.style.display === 'none') {
            card.style.display = 'block';
            this.renderProjectHistory();
            window.scrollTo({ top: card.offsetTop - 100, behavior: 'smooth' });
        } else {
            card.style.display = 'none';
        }
    },

    renderProjectHistory() {
        const tbody = document.getElementById('projects-history-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const finished = (state.projects || []).filter(p => p.status === 'Finalizado');
        finished.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (finished.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No hay proyectos finalizados aún.</td></tr>';
            return;
        }

        finished.forEach(p => {
            const tr = document.createElement('tr');
            const clientName = this.getClientName(p.clientId);
            const history = window.StorageAPI.getProjectHistory(p.id) || [];
            
            // Mostrar solo el último hito o un resumen
            const lastHistory = history[0];
            const evolutionHtml = lastHistory ? `
                <div class="history-evolution-card" style="margin: 0;">
                    <span class="status-badge status-Finalizado" style="padding: 2px 8px; font-size: 0.75rem;">Finalizado</span>
                    <div class="evolution-date">${formatDate(lastHistory.changeDate)}</div>
                    <div class="evolution-note">${lastHistory.note || 'Finalizado'}</div>
                </div>
            ` : '<span class="text-muted small">Sin historial</span>';

            tr.innerHTML = `
                <td style="font-weight: 500;">
                    ${p.projectName || 'Sin nombre'}
                    <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 400; margin-top: 2px;">${clientName}</div>
                </td>
                <td>${evolutionHtml}</td>
                <td class="actions">
                    <button class="btn-icon text-primary" title="Ver Detalle / Historial Completo" onclick="UI.showProjectHistory('${p.id}')">
                         <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="btn-icon text-warning" title="Re-abrir Proyecto" onclick="UI.reopenProject('${p.id}')">
                         <i class="fa-solid fa-undo"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    async reopenProject(id) {
        if (!confirm('¿Deseas re-abrir este proyecto? Volverá al pipeline principal.')) return;
        
        try {
            const p = state.projects.find(proj => proj.id === id);
            if (!p) return;

            const project = { ...p, status: 'Ejecución' }; // Re-abrir en fase Ejecución por defecto
            await window.StorageAPI.async.saveProject(project);
            await window.StorageAPI.async.addProjectHistory(id, {
                previousStatus: 'Finalizado',
                newStatus: 'Ejecución',
                note: 'Proyecto re-abierto para ajustes adicionales.'
            });

            state.projects = state.projects.map(proj => proj.id === id ? project : proj);
            this.showToast('Proyecto re-abierto', 'info');
            this.renderProjects();
            this.renderProjectHistory();
        } catch (error) {
            this.showToast('Error al re-abrir proyecto', 'error');
        }
    },

    async editProjectHistory(historyId, projectId, e) {
        if (e) e.stopPropagation();
        const history = await window.StorageAPI.async.getProjectHistory(projectId);
        const item = history.find(h => h.id.toString() === historyId.toString());
        if (!item) return;

        const p = state.projects.find(proj => proj.id === projectId);

        const form = document.getElementById('add-project-form');
        document.getElementById('project-id').value = projectId;
        document.getElementById('project-history-id').value = historyId;
        if (p) {
            document.getElementById('project-name').value = p.projectName || '';
            form.elements['clientId'].value = p.clientId;
        }
        form.elements['status'].value = item.newStatus;
        const visitEl = form.elements['visitDate'];
        const visitVal = item.changeDate ? item.changeDate.split('T')[0] : '';
        if (visitEl._flatpickr) visitEl._flatpickr.setDate(visitVal);
        else visitEl.value = visitVal;
        form.elements['observations'].value = item.note || '';

        document.getElementById('project-form-title').textContent = 'Editar Historial de Fase';
        document.querySelector('#add-project-form button[type="submit"]').textContent = 'Actualizar Registro';
        
        const cancelBtn = document.getElementById('cancel-project-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    editProject(id, quickUpdate = false) {
        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        const form = document.getElementById('add-project-form');
        document.getElementById('project-id').value = p.id;
        document.getElementById('project-name').value = p.projectName || '';
        form.elements['clientId'].value = p.clientId;

        // Reset status select and set value
        const statusSelect = form.elements['status'];
        statusSelect.innerHTML = `
            <option value="Evaluación">Evaluación</option>
            <option value="Espera Cliente">Espera Cliente</option>
            <option value="Espera Simons">Espera Simons</option>
            <option value="Cotizado">Cotizado</option>
            <option value="Coordinado">Coordinado</option>
            <option value="Aprobado">Aprobado</option>
            <option value="Materiales">Materiales</option>
            <option value="Ejecución">Ejecución</option>
            <option value="Finalizado">Finalizado</option>
        `;
        statusSelect.value = p.status;

        const visitEl = form.elements['visitDate'];
        if (visitEl._flatpickr) visitEl._flatpickr.setDate(p.visitDate || '');
        else visitEl.value = p.visitDate || '';

        form.elements['observations'].value = p.observations || '';
        
        const estAmountEl = form.elements['estimatedAmount'];
        if (estAmountEl) {
            estAmountEl.value = p.estimatedAmount || '';
            // Disparar evento para formato
            estAmountEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (quickUpdate) {
            document.getElementById('is-phase-update').value = 'true';
            document.getElementById('project-form-title').textContent = 'Actualización de Estado / Nueva Fase';
            document.querySelector('#add-project-form button[type="submit"]').textContent = 'Confirmar Actualización';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => statusSelect.focus(), 500);
        } else {
            document.getElementById('is-phase-update').value = 'false';
            document.getElementById('project-form-title').textContent = 'Editar Proyecto';
            document.querySelector('#add-project-form button[type="submit"]').textContent = 'Guardar Cambios';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        const cancelBtn = document.getElementById('cancel-project-edit');
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    },

    deleteProject(id) {
        if (state.currentUser.role !== ROLES.ADMIN) return;
        if (!confirm('¿Estás seguro de que quieres eliminar este registro de proyecto?')) return;

        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        // Guardar historial antes de eliminar para poder restaurar
        const history = window.StorageAPI.getProjectHistory(id) || [];

        window.StorageAPI.deleteProject(id);
        state.projects = state.projects.filter(proj => proj.id !== id);
        this.recordActivity(
            'Baja',
            'Proyecto',
            `Eliminado registro de ${this.getClientName(p?.clientId)}`,
            { type: 'project', item: { ...p }, history: history }
        );
        this.renderProjects();
    },

    resetProjectForm() {
        const form = document.getElementById('add-project-form');
        if (form) {
            form.reset();
            document.getElementById('project-id').value = '';
            document.getElementById('project-name').value = '';
            document.getElementById('project-history-id').value = '';
            if (document.getElementById('project-estimated-amount')) {
                document.getElementById('project-estimated-amount').value = '';
            }
            document.getElementById('is-phase-update').value = 'false';
            document.getElementById('project-form-title').textContent = 'Nueva Solicitud / Proyecto';
            document.querySelector('#add-project-form button[type="submit"]').textContent = 'Guardar Proyecto';

            // Restaurar select de estado inicial
            const statusSelect = form.elements['status'];
            if (statusSelect) {
                statusSelect.innerHTML = `
                    <option value="Evaluación">Evaluación</option>
                    <option value="Espera Cliente">Espera Cliente</option>
                    <option value="Espera Simons">Espera Simons</option>
                    <option value="Cotizado">Cotizado</option>
                    <option value="Coordinado">Coordinado</option>
                    <option value="Aprobado">Aprobado</option>
                    <option value="Materiales">Materiales</option>
                    <option value="Ejecución">Ejecución</option>
                `;
                statusSelect.value = 'Evaluación';
            }

            const cancelBtn = document.getElementById('cancel-project-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
        this.populateProjectClientSelect();
    },

    populateProjectClientSelect() {
        const sel = document.getElementById('project-client');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar Cliente</option>';
        state.clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = this.getClientName(c.id);
            sel.appendChild(opt);
        });
    },

    quickEditEstimatedAmount(id) {
        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        document.getElementById('edit-estimated-project-id').value = id;
        document.getElementById('edit-estimated-project-name').textContent = p.projectName || 'Sin nombre';
        
        const estAmountEl = document.getElementById('edit-estimated-amount-input');
        estAmountEl.value = p.estimatedAmount || '';
        if (typeof formatAmountInput === 'function') formatAmountInput(estAmountEl);

        UI.openModal('edit-estimated-amount-modal');
    },

    async confirmEditEstimatedAmount(e) {
        e.preventDefault();
        const id = document.getElementById('edit-estimated-project-id').value;
        const p = state.projects.find(proj => proj.id === id);
        if (!p) return;

        const input = document.getElementById('edit-estimated-amount-input').value;
        const raw = input.replace(/\./g, '').replace(/,/g, '.');
        const newAmount = raw ? parseFloat(raw) : null;
        
        p.estimatedAmount = newAmount;
        
        try {
            await window.StorageAPI.async.saveProject(p);
            this.recordActivity(
                'Modificación',
                'Proyecto',
                `Monto estimado actualizado (${this.getClientName(p.clientId)})`,
                { type: 'project', item: p }
            );
            this.showToast('Monto estimado actualizado', 'success');
            UI.closeModal('edit-estimated-amount-modal');
            this.renderProjects();
        } catch (err) {
            console.error("Error actualizando monto estimado:", err);
            this.showToast('Error al actualizar monto', 'error');
        }
    },

    initDatePickers() {
        if (typeof flatpickr !== 'undefined') {
            flatpickr('input[type="date"], .datepicker', {
                locale: 'es',
                dateFormat: 'Y-m-d',
                altInput: true,
                altFormat: 'd-m-Y',
                allowInput: true,
                parseDate: (datestr, format) => {
                    if (!datestr) return null;
                    // Limpiar y normalizar separadores
                    const normalized = datestr.replace(/\//g, '-');
                    const parts = normalized.split('-');
                    if (parts.length === 3) {
                        // Caso DD-MM-YYYY
                        if (parts[0].length <= 2 && parts[2].length === 4) {
                            return new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T00:00:00`);
                        }
                        // Caso YYYY-MM-DD
                        if (parts[0].length === 4) {
                            return new Date(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}T00:00:00`);
                        }
                    }
                    return flatpickr.parseDate(datestr, format) || flatpickr.parseDate(datestr, 'd-m-Y');
                },
                onReady: function(selectedDates, dateStr, instance) {
                    // Asegurar que si hay modal overlay, el calendario esté por encima
                    if (instance.calendarContainer) {
                        instance.calendarContainer.style.zIndex = "9999";
                    }
                }
            });

            // Month picker para filtros
            const filterMonthEl = document.getElementById('filter-month');
            if (filterMonthEl) {
                flatpickr(filterMonthEl, {
                    locale: 'es',
                    altInput: true,
                    altInputClass: "form-control",
                    plugins: [
                        new monthSelectPlugin({
                            shorthand: true,
                            dateFormat: "Y-m",
                            altFormat: "F Y",
                            theme: "light"
                        })
                    ],
                    onChange: (selectedDates, dateStr) => {
                        console.log("Month picker changed:", dateStr);
                        // Limpiar filtros específicos si se usa el mes
                        const start = document.getElementById('filter-date-start');
                        const end = document.getElementById('filter-date-end');
                        if (dateStr) {
                            if (start && start._flatpickr) start._flatpickr.clear(false);
                            else if (start) start.value = '';
                            
                            if (end && end._flatpickr) end._flatpickr.clear(false);
                            else if (end) end.value = '';
                        }
                        this.renderTransactionsList();
                    }
                });
            }
        } else {
            console.warn("Flatpickr no está cargado.");
        }
    },

    // --- GESTIÓN DE UBICACIONES ---

    renderLocations() {
        const tbody = document.getElementById('locations-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.locations.forEach(l => {
            console.log(`Rendering location: ${l.name}, type: ${l.type}`);
            const tr = document.createElement('tr');
            const typeLabel = l.type === 'finance' ? 'Disponible' : 'Inventario';
            tr.innerHTML = `
                <td>${l.name}</td>
                <td><span class="badge ${l.type === 'finance' ? 'badge-info' : 'badge-secondary'}">${typeLabel}</span></td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editLocation('${l.id}')">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteLocation('${l.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        this.updateLocationSelects();
    },

    updateLocationSelects() {
        const inventorySelect = document.getElementById('inventory-location-select');
        const availableSelect = document.getElementById('available-location-select');

        if (inventorySelect) {
            const currentVal = inventorySelect.value;
            inventorySelect.innerHTML = '<option value="">Seleccionar Ubicación</option>';
            state.locations.filter(l => l.type !== 'finance').forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.name;
                opt.textContent = l.name;
                inventorySelect.appendChild(opt);
            });
            if (currentVal) inventorySelect.value = currentVal;
        }

        if (availableSelect) {
            const currentVal = availableSelect.value;
            availableSelect.innerHTML = '<option value="">Seleccionar Ubicación</option>';
            state.locations.filter(l => l.type === 'finance').forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.name;
                opt.textContent = l.name;
                availableSelect.appendChild(opt);
            });
            if (currentVal) availableSelect.value = currentVal;
        }
    },

    openLocationManager() {
        this.resetLocationForm();
        this.renderLocations();
        this.openModal('locations-modal');
    },

    resetLocationForm() {
        const form = document.getElementById('add-location-form');
        if (form) {
            form.reset();
            document.getElementById('edit-location-id').value = '';
            const btn = document.getElementById('btn-save-location');
            if (btn) btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        }
    },

    async handleLocationSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const id = formData.get('id');
        const name = formData.get('name');
        const type = formData.get('type');

        const location = {
            id: id || 'L' + Date.now().toString(),
            name: name,
            type: type
        };
        console.log('DEBUG: Location object being sent:', JSON.stringify(location));
        console.log('Location object to be saved:', location);

        this.showLoading(form);
        try {
            await window.StorageAPI.async.saveAppLocation(location);
            // Actualización reactiva inmediata
            if (id) {
                state.locations = state.locations.map(l => l.id === id ? location : l);
            } else {
                state.locations = [...state.locations, location];
            }
            
            this.showToast(id ? 'Ubicación actualizada' : 'Ubicación creada', 'success');
            this.resetLocationForm();
            
            // Sincronización en segundo plano (opcional pero bueno para consistencia)
            await this.loadData();
            // renderLocations se llama automáticamente por el Proxy del Store al cambiar state.locations
        } catch (err) {
            console.error(err);
            this.showToast('Error al guardar ubicación: ' + err.message, 'error');
        } finally {
            this.hideLoading(form);
        }
    },

    editLocation(id) {
        const loc = state.locations.find(l => l.id === id);
        if (!loc) return;

        document.getElementById('edit-location-id').value = loc.id;
        document.getElementById('location-name').value = loc.name;
        if (document.getElementById('location-type')) {
            document.getElementById('location-type').value = loc.type || 'inventory';
        }
        const btn = document.getElementById('btn-save-location');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i> Actualizar';
        document.getElementById('location-name').focus();
    },

    async deleteLocation(id) {
        if (!confirm('¿Está seguro de eliminar esta ubicación?')) return;
        try {
            await window.StorageAPI.async.deleteAppLocation(id);
            this.showToast('Ubicación eliminada', 'success');
            // Actualización reactiva inmediata
            state.locations = state.locations.filter(l => l.id !== id);
            
            // Sincronización en segundo plano
            await this.loadData();
        } catch (err) {
            this.showToast('Error al eliminar: ' + err.message, 'error');
        }
    },

    toggleHistoryNote(card) {
        const obs = card.querySelector('.evolution-note');
        if (obs) {
            obs.classList.toggle('expanded');
            card.classList.toggle('expanded');
        }
    },

    // --- MÓDULO DISPONIBLE ---

    renderAvailables() {
        const tbody = document.getElementById('availables-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        let total = 0;
        state.availables.forEach(a => {
            total += parseFloat(a.amount || 0);
            const row = document.createElement('tr');
            
            let liquidityStatus = 'Inmediata';
            if (a.instrument === 'Depósito a Plazo') {
                const today = getLocalISODate();
                liquidityStatus = (a.dueDate && a.dueDate > today) ? `Vence: ${formatDate(a.dueDate)}` : 'Vencido / Disponible';
            } else if (a.instrument === 'Fondo Mutuo') {
                liquidityStatus = '48 hrs';
            }

            row.innerHTML = `
                <td>${a.location}</td>
                <td>${a.classification}</td>
                <td>${a.instrument || '-'}</td>
                <td style="font-weight: bold;">${formatCurrency(a.amount)}</td>
                <td><span class="tag ${liquidityStatus.includes('Vence') ? 'expense' : 'income'}">${liquidityStatus}</span></td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editAvailable('${a.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteAvailable('${a.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        const tfoot = document.getElementById('availables-list-footer');
        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: right; font-weight: bold; padding-right: 1rem;">Total Activo Disponible:</td>
                    <td colspan="3" style="font-weight: bold; font-size: 1.1rem; color: var(--primary-color)">
                        ${formatCurrency(total)}
                    </td>
                </tr>
            `;
        }
        this.applyPrivileges();
    },

    renderOperationalExpenses() {
        const tbody = document.getElementById('operational-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.operationalExpenses.forEach(e => {
            const row = document.createElement('tr');
            
            const lastPayment = e.lastPaymentDate ? formatDate(e.lastPaymentDate) : 'Nunca';
            const nextPayment = e.nextPaymentDate ? formatDate(e.nextPaymentDate) : 'No definida';
            const frequencyMap = {
                'monthly': 'Mensual',
                'quarterly': 'Trimestral',
                'semiannually': 'Semestral',
                'yearly': 'Anual'
            };

            row.innerHTML = `
                <td>${e.name}</td>
                <td>${frequencyMap[e.frequency] || e.frequency}</td>
                <td>${lastPayment}</td>
                <td>${nextPayment}</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editOperationalExpense('${e.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.handleOperationalDelete('${e.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
        this.applyPrivileges();
    },

    checkOperationalExpensesAlerts() {
        const alertsBody = document.getElementById('alerts-operational-body');
        if (!alertsBody) return;
        alertsBody.innerHTML = '';

        // Centralizar actualización de campana
        this.refreshAlertBadge();

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const warningLimit = new Date(today);
        warningLimit.setDate(today.getDate() + 5);

        const pendingExpenses = state.operationalExpenses.filter(e => {
            if (!e.nextPaymentDate) return false;
            const nextDate = new Date(e.nextPaymentDate);
            return nextDate <= warningLimit;
        });

        pendingExpenses.forEach(e => {
            const nextDate = new Date(e.nextPaymentDate);
            const isOverdue = nextDate < today;
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td>${e.name}</td>
                <td>
                    <span style="color: ${isOverdue ? 'var(--danger-color)' : 'var(--warning-color)'}; font-weight: bold;">
                        ${formatDate(e.nextPaymentDate)} ${isOverdue ? '(VENCIDO)' : ''}
                    </span>
                </td>
                <td class="action-cell">
                    <button class="btn-sm btn-outline-success" onclick="UI.handleOperationalPay('${e.id}')">
                        <i class="fa-solid fa-check"></i> Registrar Pago
                    </button>
                </td>
            `;
            alertsBody.appendChild(tr);
        });
    },

    refreshAlertBadge() {
        const pendingBadge = document.getElementById('contracts-badge');
        const reminderBtn = document.getElementById('contracts-reminder-btn');
        if (!pendingBadge || !reminderBtn) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const warningLimit = new Date(today);
        warningLimit.setDate(today.getDate() + 5);

        // 1. Contratos pendientes de facturar
        const contractsCount = state.pendingContracts ? state.pendingContracts.length : 0;

        // 2. Gastos operacionales próximos a vencer (vencidos o dentro de 5 días)
        const expensesCount = state.operationalExpenses ? state.operationalExpenses.filter(e => {
            if (!e.nextPaymentDate) return false;
            const nextDate = new Date(e.nextPaymentDate);
            return nextDate <= warningLimit;
        }).length : 0;

        // 3. Deudas pendientes (Removido del conteo por solicitud, pero mantiene la campana visible si existen)
        const debtsCount = state.debts ? state.debts.length : 0;

        const totalAlerts = contractsCount + expensesCount;
        const hasAnyAlert = totalAlerts > 0 || debtsCount > 0;

        if (hasAnyAlert) {
            reminderBtn.style.display = 'inline-block';
            if (totalAlerts > 0) {
                pendingBadge.style.display = 'inline-block';
                pendingBadge.textContent = totalAlerts;
            } else {
                pendingBadge.style.display = 'none';
            }
            // Actualizar tooltip para ser más descriptivo
            reminderBtn.title = `${totalAlerts} alertas urgentes ${debtsCount > 0 ? `+ ${debtsCount} deudas` : ''}`;
        }
    },
    async handleOperationalSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        
        const expenseData = {
            id: formData.get('id') || 'OE' + Date.now().toString(),
            name: formData.get('name'),
            amount: 0, // Monto por defecto (ya no se usa fijo)
            frequency: formData.get('frequency'),
            nextPaymentDate: formData.get('nextPaymentDate'),
            description: formData.get('description'),
            status: 'active'
        };

        try {
            await window.StorageAPI.async.saveOperationalExpense(expenseData);
            this.showToast(formData.get('id') ? 'Gasto actualizado' : 'Gasto registrado', 'success');
            form.reset();
            this.resetOperationalForm();
            await this.loadData();
        } catch (error) {
            console.error("Error al guardar gasto operacional:", error);
            this.showToast('Error al guardar: ' + error.message, 'error');
        }
    },

    handleOperationalPay(id) {
        const expense = state.operationalExpenses.find(e => e.id === id);
        if (!expense) return;

        document.getElementById('op-pay-id').value = id;
        document.getElementById('op-pay-name').textContent = expense.name;
        document.getElementById('op-pay-amount-input').value = '';

        this.openModal('operational-pay-confirm-modal');
        // Enfocar el input de monto automáticamente
        setTimeout(() => document.getElementById('op-pay-amount-input')?.focus(), 300);
    },

    async confirmOperationalPay() {
        const id = document.getElementById('op-pay-id').value;
        const amountStr = document.getElementById('op-pay-amount-input').value;
        
        if (!amountStr || amountStr.trim() === '') {
            this.showToast('Por favor, ingrese el monto pagado', 'warning');
            return;
        }

        const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
            this.showToast('Por favor, ingrese un monto válido', 'warning');
            return;
        }

        this.closeModal('operational-pay-confirm-modal');
        
        try {
            await window.StorageAPI.async.payOperationalExpense(id, amount);
            this.showToast('Pago registrado correctamente', 'success');
            await this.loadData();
        } catch (error) {
            console.error("Error al pagar gasto operacional:", error);
            this.showToast('Error al registrar el pago: ' + error.message, 'error');
        }
    },

    editOperationalExpense(id) {
        const expense = state.operationalExpenses.find(e => e.id === id);
        if (!expense) return;

        const form = document.getElementById('add-operational-form');
        form.elements['id'].value = expense.id;
        form.elements['name'].value = expense.name;
        form.elements['frequency'].value = expense.frequency;
        form.elements['nextPaymentDate'].value = expense.nextPaymentDate ? expense.nextPaymentDate.split('T')[0] : '';
        form.elements['description'].value = expense.description || '';

        document.getElementById('operational-form-title').textContent = 'Editar Gasto Recurrente';
        document.getElementById('cancel-operational-edit').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async handleOperationalDelete(id) {
        if (!confirm('¿Está seguro de eliminar este gasto recurrente?')) return;
        try {
            await window.StorageAPI.async.deleteOperationalExpense(id);
            this.showToast('Gasto eliminado', 'success');
            await this.loadData();
        } catch (error) {
            this.showToast('Error al eliminar', 'error');
        }
    },

    resetOperationalForm() {
        const form = document.getElementById('add-operational-form');
        if (form) {
            form.reset();
            form.elements['id'].value = '';
            document.getElementById('operational-form-title').textContent = 'Registrar Gasto Operacional Recurrente';
            document.getElementById('cancel-operational-edit').style.display = 'none';
        }
    },

    updateAvailableFields() {
        const classification = document.getElementById('available-classification').value;
        const instrument = document.getElementById('available-instrument').value;
        const investmentFields = document.getElementById('investment-fields');
        const nonInvestmentFields = document.getElementById('non-investment-fields');
        const termDepositFields = document.getElementById('term-deposit-fields');
        const mutualFundNote = document.getElementById('mutual-fund-note');

        const amtInv = document.getElementById('available-amount-investment');
        const amtSim = document.getElementById('available-amount-simple');
        const fCol = document.getElementById('available-placement-date');
        const fVenc = document.getElementById('available-due-date');

        // Reset requirements
        amtInv.required = false;
        amtSim.required = false;
        fCol.required = false;
        fVenc.required = false;

        if (classification === 'Inversiones') {
            investmentFields.style.display = 'block';
            nonInvestmentFields.style.display = 'none';
            amtInv.required = true;

            if (instrument === 'Depósito a Plazo') {
                termDepositFields.style.display = 'grid';
                mutualFundNote.style.display = 'none';
                fCol.required = true;
                fVenc.required = true;
            } else {
                termDepositFields.style.display = 'none';
                mutualFundNote.style.display = 'block';
            }
        } else {
            investmentFields.style.display = 'none';
            nonInvestmentFields.style.display = 'block';
            amtSim.required = true;
        }
    },

    resetAvailableForm() {
        const form = document.getElementById('add-available-form');
        if (form) {
            form.reset();
            document.getElementById('available-id').value = '';
            document.getElementById('available-form-title').textContent = 'Gestionar Activos Disponibles';
            const cancelBtn = document.getElementById('cancel-available-edit');
            if (cancelBtn) cancelBtn.style.display = 'none';
            this.updateAvailableFields();
        }
    },

    async handleAvailableSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const classification = formData.get('classification');
        
        // El monto puede venir de dos campos dependiendo de la clasificación
        let amountStr = classification === 'Inversiones' ? formData.get('amount') : formData.get('amount_simple');
        let amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;

        const available = {
            id: formData.get('id') || 'A' + Date.now().toString(),
            location: formData.get('location'),
            classification: classification,
            instrument: classification === 'Inversiones' ? formData.get('instrument') : null,
            amount: amount,
            placementDate: classification === 'Inversiones' && formData.get('instrument') === 'Depósito a Plazo' ? formData.get('placementDate') : null,
            dueDate: classification === 'Inversiones' && formData.get('instrument') === 'Depósito a Plazo' ? formData.get('dueDate') : null,
            observation: formData.get('observation')
        };

        this.showLoading(form);
        try {
            await window.StorageAPI.async.saveAvailable(available);
            this.showToast('Activo guardado exitosamente', 'success');
            this.resetAvailableForm();
            // Recargar datos y renderizar
            await this.loadData();
            this.renderAvailables();
            this.renderDashboard(); // Actualizar balance si fuera necesario
        } catch (err) {
            console.error(err);
            this.showToast('Error al guardar activo: ' + err.message, 'error');
        } finally {
            this.hideLoading(form);
        }
    },

    async deleteAvailable(id) {
        if (!confirm('¿Está seguro de eliminar este registro de activo disponible?')) return;
        try {
            await window.StorageAPI.async.deleteAvailable(id);
            this.showToast('Activo eliminado', 'success');
            await this.loadData();
            this.renderAvailables();
            this.renderDashboard();
        } catch (err) {
            this.showToast('Error al eliminar: ' + err.message, 'error');
        }
    },

    editAvailable(id) {
        const a = state.availables.find(item => item.id === id);
        if (!a) return;

        document.getElementById('available-id').value = a.id;
        document.querySelector('[name="location"]').value = a.location;
        document.getElementById('available-classification').value = a.classification;
        
        if (a.classification === 'Inversiones') {
            document.getElementById('available-instrument').value = a.instrument;
            document.querySelector('[name="amount"]').value = a.amount.toLocaleString('es-CL');
            if (a.instrument === 'Depósito a Plazo') {
                document.querySelector('[name="placementDate"]').value = a.placementDate || '';
                document.querySelector('[name="dueDate"]').value = a.dueDate || '';
            }
        } else {
            document.querySelector('[name="amount_simple"]').value = a.amount.toLocaleString('es-CL');
        }

        document.querySelector('[name="observation"]').value = a.observation || '';
        
        document.getElementById('available-form-title').textContent = 'Editar Activo Disponible';
        document.getElementById('cancel-available-edit').style.display = 'inline-block';
        
        this.updateAvailableFields();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // --- MÓDULO INVENTARIO ---

    renderInventory() {
        const tbody = document.getElementById('inventory-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const searchText = document.getElementById('inventory-search')?.value.toLowerCase() || '';
        let filtered = state.inventory || [];

        if (searchText) {
            filtered = filtered.filter(i => i.product.toLowerCase().includes(searchText));
        }

        let totalInventoryValue = 0;

        filtered.forEach(i => {
            const tr = document.createElement('tr');
            const total = (i.quantity || 0) * (i.unitPrice || 0);
            totalInventoryValue += total;

            tr.innerHTML = `
                <td>${i.product}</td>
                <td>${i.quantity}</td>
                <td>${formatCurrency(i.unitPrice)}</td>
                <td>${i.location}</td>
                <td style="font-weight: bold;">${formatCurrency(total)}</td>
                <td class="actions">
                    <button class="btn-icon" title="Editar" onclick="UI.editInventory('${i.id}')">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="UI.deleteInventory('${i.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        const totalValueEl = document.getElementById('inventory-total-value');
        if (totalValueEl) {
            totalValueEl.textContent = formatCurrency(totalInventoryValue);
        }
        this.applyPrivileges();
    },

    async handleInventorySubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const id = formData.get('id');
        const isNew = !id;
        const finalId = id || 'INV' + Date.now().toString();

        const newItem = {
            id: finalId,
            product: formData.get('product'),
            quantity: parseFloat(formData.get('quantity')) || 0,
            unitPrice: parseAmount(formData.get('unitPrice')),
            location: formData.get('location')
        };

        const oldItem = !isNew ? state.inventory.find(i => i.id === id) : null;

        this.showLoading(form);
        try {
            await window.StorageAPI.async.saveInventory(newItem);
            
            // Lógica de Historial
            if (isNew) {
                await this.logMovement(newItem, 'Entrada', newItem.quantity, null, newItem.location);
            } else if (oldItem) {
                // Cambio de cantidad
                if (oldItem.quantity !== newItem.quantity) {
                    const diff = newItem.quantity - oldItem.quantity;
                    const type = diff > 0 ? 'Entrada' : 'Salida';
                    await this.logMovement(newItem, type, diff, oldItem.location, newItem.location);
                }
                // Traslado (si cambió ubicación pero no cantidad, o ambos)
                if (oldItem.location !== newItem.location && oldItem.quantity === newItem.quantity) {
                    await this.logMovement(newItem, 'Traslado', 0, oldItem.location, newItem.location);
                }
            }

            this.showToast(isNew ? 'Material agregado' : 'Material actualizado', 'success');
            this.closeModal('inventory-modal');
            await this.loadData();
            this.renderInventory();
        } catch (err) {
            console.error(err);
            this.showToast('Error al guardar material: ' + err.message, 'error');
        } finally {
            this.hideLoading(form);
        }
    },

    async deleteInventory(id) {
        if (!confirm('¿Está seguro de eliminar este registro de inventario?')) return;
        const item = state.inventory.find(i => i.id === id);
        try {
            if (item) {
                await this.logMovement(item, 'Baja', -item.quantity, item.location, null);
            }
            await window.StorageAPI.async.deleteInventory(id);
            this.showToast('Registro eliminado', 'success');
            await this.loadData();
            this.renderInventory();
        } catch (err) {
            this.showToast('Error al eliminar: ' + err.message, 'error');
        }
    },

    editInventory(id) {
        const item = state.inventory.find(i => i.id === id);
        if (!item) return;

        const form = document.getElementById('inventory-form');
        form.elements['id'].value = item.id;
        form.elements['product'].value = item.product;
        form.elements['quantity'].value = item.quantity;
        form.elements['unitPrice'].value = item.unitPrice.toLocaleString('es-CL');
        form.elements['location'].value = item.location;

        document.getElementById('inventory-modal-title').textContent = 'Editar Material';
        this.openModal('inventory-modal');
    },

    resetInventoryForm() {
        const form = document.getElementById('inventory-form');
        if (form) {
            form.reset();
            const idEl = document.getElementById('inventory-id');
            const titleEl = document.getElementById('inventory-modal-title');
            if (idEl) idEl.value = '';
            if (titleEl) titleEl.textContent = 'Agregar Material';
        }
    },

    async logMovement(item, type, quantityChange, origin, destination) {
        const historyEntry = {
            id: 'H' + Date.now().toString() + Math.round(Math.random() * 1000),
            productId: item.id,
            productName: item.product,
            type: type, // 'Entrada', 'Salida', 'Traslado', 'Baja'
            origin: origin || '-',
            destination: destination || '-',
            quantityChange: quantityChange,
            userId: state.currentUser?.id || 'sys',
            userName: state.currentUser?.name || 'Sistema'
        };
        try {
            await window.StorageAPI.async.saveInventoryHistory(historyEntry);
        } catch (err) {
            console.error("Error al registrar movimiento de inventario:", err);
        }
    },

    async renderInventoryHistory() {
        const tbody = document.getElementById('inventory-history-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Cargando historial...</td></tr>';

        try {
            const history = await window.StorageAPI.async.getInventoryHistory();
            tbody.innerHTML = '';
            
            if (!history || history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No hay movimientos registrados en el historial de inventario.</td></tr>';
                return;
            }

            // Ordenar por fecha descendente (más reciente arriba)
            const sortedByDate = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            sortedByDate.forEach(h => {
                const tr = document.createElement('tr');
                const dateStr = h.timestamp ? formatDate(h.timestamp) : 'Sin fecha';
                const colorClass = h.quantityChange > 0 ? 'text-success' : (h.quantityChange < 0 ? 'text-danger' : '');
                const prefix = h.quantityChange > 0 ? '+' : '';

                tr.innerHTML = `
                    <td>${dateStr}</td>
                    <td style="font-weight: 500;">${h.productName || 'Producto desconocido'}</td>
                    <td><span class="status-badge status-${h.type.toLowerCase().replace(/\s+/g, '-')}">${h.type}</span></td>
                    <td style="font-size: 0.85rem;">${h.origin} ➔ ${h.destination}</td>
                    <td style="font-weight: bold;" class="${colorClass}">${prefix}${h.quantityChange}</td>
                    <td>${h.userName || 'Sistema'}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            console.error("Error al renderizar historial de inventario:", err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">Error al cargar historial: ' + err.message + '</td></tr>';
        }
    },

    handleAddMaterial() {
        try {
            this.resetInventoryForm();
            this.openModal('inventory-modal');
        } catch (err) {
            console.error("Error en handleAddMaterial:", err);
        }
    },

    // --- EXPORTAR INVENTARIO ---

    exportInventoryToExcel() {
        if (!window.XLSX) return this.showToast('Librería Excel no disponible', 'error');
        const inventory = state.inventory || [];
        if (inventory.length === 0) return this.showToast('No hay materiales para exportar', 'warning');

        const exportData = inventory.map(i => ({
            Producto: i.product,
            Cantidad: i.quantity,
            'Precio Unitario CLP': i.unitPrice,
            Ubicación: i.location,
            'Total CLP': (i.quantity || 0) * (i.unitPrice || 0)
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // Ajustar anchos de columna
        ws['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];

        XLSX.utils.book_append_sheet(wb, ws, "Inventario");
        XLSX.writeFile(wb, "Inventario_Materiales.xlsx");
        this.showToast('Inventario exportado a Excel', 'success');
    },

    exportInventoryToPDF() {
        if (!window.jspdf) return this.showToast('Librería PDF no disponible', 'error');
        const inventory = state.inventory || [];
        if (inventory.length === 0) return this.showToast('No hay materiales para exportar', 'warning');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text("Inventario de Materiales", 14, 22);
        doc.setFontSize(11);
        doc.text(`Fecha de reporte: ${formatDate(new Date())}`, 14, 30);

        const tableBody = inventory.map(i => [
            i.product,
            i.quantity,
            formatCurrency(i.unitPrice),
            i.location,
            formatCurrency((i.quantity || 0) * (i.unitPrice || 0))
        ]);

        doc.autoTable({
            startY: 40,
            head: [['Producto', 'Cant.', 'Precio Unit.', 'Ubicación', 'Total CLP']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [0, 121, 107] }, // Shade of teal/primary
        });

        doc.save("Inventario_Materiales.pdf");
        this.showToast('Inventario exportado a PDF', 'success');
    },

    openProjectDateModal(historyId, projectId, currentDate, status) {
        document.getElementById('date-modal-project-id').value = projectId;
        document.getElementById('date-modal-new-status').value = status;
        document.getElementById('date-modal-value').value = currentDate ? currentDate.split('T')[0] : '';
        this.openModal('project-date-modal');
        this.initDatePickers(); // Asegurar Flatpickr
    },

    async handleProjectDateUpdate() {
        const projectId = document.getElementById('date-modal-project-id').value;
        const newDate = document.getElementById('date-modal-value').value;
        const note = document.getElementById('date-modal-note').value;
        const status = document.getElementById('date-modal-new-status').value;

        if (!newDate) return this.showToast('La fecha es requerida', 'warning');

        try {
            await window.StorageAPI.async.addProjectHistory(projectId, {
                newStatus: status,
                changeDate: newDate,
                note: note
            });
            this.showToast('Fecha de proyecto actualizada', 'success');
            this.closeModal('project-date-modal');
            await this.loadData();
            this.renderProjects();
        } catch (err) {
            console.error(err);
            this.showToast('Error al actualizar fecha: ' + err.message, 'error');
        }
    }
};

// Inicialización
window.UI = UI;
document.addEventListener('DOMContentLoaded', () => UI.init());
