console.log("Cargando componente KeepApp (v-premium)...");

const { useState, useEffect, useCallback, useRef, useMemo } = React;

const KeepApp = () => {
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState('notes'); // 'notes', 'archive', 'trash'
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);

  // Intentar obtener el ID del usuario desde varias fuentes
  const getUserId = () => {
    if (window.Store?.currentUser?.id) return window.Store.currentUser.id;
    if (window.rawState?.currentUser?.id) return window.rawState.currentUser.id;
    try {
        const session = JSON.parse(localStorage.getItem('contabilidad_session') || '{}');
        return session.id;
    } catch(e) { return null; }
  };

  const currentUserId = getUserId();

  // Cargar notas
  useEffect(() => {
    if (!currentUserId) return;

    const loadNotes = async () => {
      try {
        setIsLoading(true);
        const serverNotes = await StorageAPI.async.getNotes(currentUserId);
        
        const processedNotes = serverNotes.map(n => ({
            ...n,
            content: n.type === 'list' ? (typeof n.content === 'string' ? JSON.parse(n.content || '[]') : n.content) : n.content
        }));

        setNotes(processedNotes);
      } catch (err) {
        console.error("Error cargando notas:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadNotes();
  }, [currentUserId]);

  const addNote = async (type) => {
    const newNote = {
      id: 'N' + Date.now(),
      userId: currentUserId,
      title: '',
      content: type === 'list' ? [] : '',
      type: type,
      pinned: false,
      archived: false,
      deleted: false,
      lastModified: new Date().toISOString()
    };

    try {
        await StorageAPI.async.saveNote({
            ...newNote,
            content: type === 'list' ? JSON.stringify(newNote.content) : newNote.content
        });
        setNotes([newNote, ...notes]);
        setActiveNote(newNote);
        setIsModalOpen(true);
    } catch (err) {
        console.error("Error al crear nota:", err);
    }
  };

  const updateNote = async (id, updates) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const updatedNote = { ...note, ...updates, lastModified: new Date().toISOString() };
    
    try {
        await StorageAPI.async.saveNote({
            ...updatedNote,
            content: updatedNote.type === 'list' ? JSON.stringify(updatedNote.content) : updatedNote.content
        });
        setNotes(notes.map(n => n.id === id ? updatedNote : n));
    } catch (err) {
        console.error("Error al actualizar nota:", err);
    }
  };

  const deleteNote = async (id, e) => {
    if (e) e.stopPropagation();
    try {
        const result = await StorageAPI.async.deleteNote(id);
        if (result && result.permanent) {
            setNotes(notes.filter(note => note.id !== id));
        } else {
            // Soft delete en el cliente
            setNotes(notes.map(n => n.id === id ? { ...n, deleted: true, pinned: false, archived: false, deletedAt: new Date().toISOString() } : n));
        }
        if (activeNote?.id === id) setIsModalOpen(false);
    } catch (err) {
        console.error("Error al eliminar nota:", err);
    }
  };

  const archiveNote = async (id, e) => {
    if (e) e.stopPropagation();
    const note = notes.find(n => n.id === id);
    if (!note) return;
    await updateNote(id, { archived: !note.archived, pinned: false });
  };

  const restoreNote = async (id, e) => {
    if (e) e.stopPropagation();
    await updateNote(id, { deleted: false, deletedAt: null });
  };

  const togglePin = async (id, e) => {
    if (e) e.stopPropagation();
    const note = notes.find(n => n.id === id);
    if (!note) return;
    await updateNote(id, { pinned: !note.pinned });
  };

  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
        // Filtro por vista
        if (currentView === 'trash') return note.deleted;
        if (note.deleted) return false;
        if (currentView === 'archive') return note.archived;
        if (note.archived) return false;
        
        // Filtro por búsqueda
        const searchMatch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
              (typeof note.content === 'string' ? note.content : note.content.map(i => i.text).join(' '))
              .toLowerCase().includes(searchQuery.toLowerCase());
        
        return searchMatch && currentView === 'notes';
    });
  }, [notes, currentView, searchQuery]);

  const pinnedNotes = filteredNotes.filter(n => n.pinned);
  const otherNotes = filteredNotes.filter(n => !n.pinned);

  const getTitle = () => {
    switch(currentView) {
        case 'archive': return 'Notas Archivadas';
        case 'trash': return 'Papelera';
        default: return 'Notas';
    }
  };

  const emptyTrash = async () => {
    if (!confirm("¿Deseas vaciar la papelera para siempre?")) return;
    const trashIds = notes.filter(n => n.deleted).map(n => n.id);
    for (const id of trashIds) {
        await StorageAPI.async.deleteNote(id);
    }
    setNotes(notes.filter(n => !n.deleted));
  };

  return (
    <div className="tw-flex tw-min-h-[calc(100vh-100px)] tw-bg-googleGray tw-font-sans tw-relative tw-overflow-hidden">
      
      {/* Sidebar / Drawer */}
      <Sidebar 
        currentView={currentView} 
        setView={(v) => { setCurrentView(v); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
        isOpen={isSidebarOpen}
        toggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content Area */}
      <div className={`tw-flex-1 tw-transition-all tw-duration-300 ${isSidebarOpen ? 'md:tw-ml-64' : 'md:tw-ml-20 lg:tw-ml-64'}`}>
        <div className="tw-p-4 md:tw-p-8">
            
            {/* Top Toolbar */}
            <div className="tw-max-w-4xl tw-mx-auto tw-mb-8">
                <div className="tw-flex tw-flex-col md:tw-flex-row tw-gap-4 tw-items-center">
                    
                    {/* Botón Menu Móvil */}
                    <button 
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="md:tw-hidden tw-self-start tw-p-2 tw-text-gray-600 hover:tw-bg-gray-200 tw-rounded-full"
                    >
                        <i className="fa-solid fa-bars tw-text-xl"></i>
                    </button>

                    {/* Search Bar */}
                    <div className="tw-flex-1 tw-w-full tw-bg-white tw-rounded-xl tw-shadow-sm tw-flex tw-items-center tw-px-4 tw-py-2.5 tw-border tw-border-gray-200 focus-within:tw-shadow-md tw-transition-all">
                        <i className="fa-solid fa-magnifying-glass tw-text-gray-400 tw-mr-3"></i>
                        <input 
                            type="text" 
                            placeholder="Buscar..." 
                            className="tw-w-full tw-border-none focus:tw-ring-0 tw-text-gray-700 tw-bg-transparent tw-text-[16px]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Action Buttons (Solo en vista principal) */}
                    {currentView === 'notes' && (
                        <div className="tw-flex tw-gap-2 tw-w-full md:tw-w-auto">
                            <button 
                                onClick={() => addNote('text')}
                                className="tw-flex-1 md:tw-flex-none tw-bg-googleBlue tw-text-white tw-px-5 tw-py-2.5 tw-rounded-xl tw-flex tw-items-center tw-justify-center tw-gap-2 hover:tw-shadow-lg tw-transition-all active:tw-scale-95"
                            >
                                <i className="fa-solid fa-plus"></i> <span>Nota</span>
                            </button>
                            <button 
                                onClick={() => addNote('list')}
                                className="tw-flex-1 md:tw-flex-none tw-bg-white tw-text-googleBlue tw-border tw-border-googleBlue tw-px-5 tw-py-2.5 tw-rounded-xl tw-flex tw-items-center tw-justify-center tw-gap-2 hover:tw-bg-blue-50 tw-transition-all active:tw-scale-95"
                            >
                                <i className="fa-solid fa-square-check"></i> <span>Lista</span>
                            </button>
                        </div>
                    )}

                    {currentView === 'trash' && notes.some(n => n.deleted) && (
                        <button 
                            onClick={emptyTrash}
                            className="tw-w-full md:tw-w-auto tw-text-red-600 hover:tw-bg-red-50 tw-px-4 tw-py-2 tw-rounded-lg tw-font-bold tw-transition-all"
                        >
                            Vaciar papelera
                        </button>
                    )}
                </div>
            </div>

            {/* View Header */}
            <div className="tw-max-w-6xl tw-mx-auto tw-mb-6">
                <h2 className="tw-text-xl tw-font-bold tw-text-gray-700">{getTitle()}</h2>
            </div>

            {/* Note Grid */}
            <div className="tw-max-w-6xl tw-mx-auto tw-pb-24">
                
                {isLoading && (
                    <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-20">
                        <i className="fa-solid fa-circle-notch fa-spin tw-text-4xl tw-text-googleBlue tw-mb-4"></i>
                        <p className="tw-text-gray-500">Sincronizando notas...</p>
                    </div>
                )}

                {pinnedNotes.length > 0 && (
                  <div className="tw-mb-10">
                    <h3 className="tw-text-xs tw-font-bold tw-text-gray-500 tw-uppercase tw-tracking-wider tw-mb-4">Fijadas</h3>
                    <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 lg:tw-grid-cols-3 xl:tw-grid-cols-4 tw-gap-4">
                      {pinnedNotes.map(note => (
                        <NoteCard 
                            key={note.id} 
                            note={note} 
                            view={currentView}
                            onClick={() => { if (!note.deleted) { setActiveNote(note); setIsModalOpen(true); } }} 
                            onDelete={deleteNote} 
                            onArchive={archiveNote}
                            onRestore={restoreNote}
                            onTogglePin={togglePin} 
                        />
                      ))}
                    </div>
                  </div>
                )}

                {otherNotes.length > 0 ? (
                  <div>
                    {(pinnedNotes.length > 0 || currentView !== 'notes') && <h3 className="tw-text-xs tw-font-bold tw-text-gray-500 tw-uppercase tw-tracking-wider tw-mb-4">{currentView === 'notes' ? 'Otras' : ''}</h3>}
                    <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 lg:tw-grid-cols-3 xl:tw-grid-cols-4 tw-gap-4">
                      {otherNotes.map(note => (
                        <NoteCard 
                            key={note.id} 
                            note={note} 
                            view={currentView}
                            onClick={() => { if (!note.deleted) { setActiveNote(note); setIsModalOpen(true); } }} 
                            onDelete={deleteNote} 
                            onArchive={archiveNote}
                            onRestore={restoreNote}
                            onTogglePin={togglePin} 
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  !isLoading && (
                    <EmptyState view={currentView} isSearching={!!searchQuery} />
                  )
                )}
            </div>
        </div>
      </div>

      {/* Floating Action Button (Móvil) - Solo en vista principal */}
      {currentView === 'notes' && (
        <button 
            onClick={() => addNote('text')}
            className="md:tw-hidden tw-fixed tw-bottom-24 tw-right-6 tw-w-16 tw-h-16 tw-bg-googleBlue tw-text-white tw-rounded-full tw-shadow-2xl tw-flex tw-items-center tw-justify-center tw-text-3xl tw-z-[50] active:tw-scale-90 tw-transition-transform"
        >
            <i className="fa-solid fa-plus"></i>
        </button>
      )}

      {/* Modal de Edición */}
      {isModalOpen && activeNote && (
        <NoteModal 
          note={activeNote} 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onUpdate={(updates) => updateNote(activeNote.id, updates)}
          onDelete={() => deleteNote(activeNote.id)}
          onArchive={() => archiveNote(activeNote.id)}
        />
      )}
    </div>
  );
};

const Sidebar = ({ currentView, setView, isOpen, toggle }) => {
    const items = [
        { id: 'notes', icon: 'fa-lightbulb', label: 'Notas' },
        { id: 'archive', icon: 'fa-box-archive', label: 'Archivados' },
        { id: 'trash', icon: 'fa-trash-can', label: 'Papelera' }
    ];

    return (
        <>
            {/* Overlay para móvil */}
            {isOpen && (
                <div 
                    className="md:tw-hidden tw-fixed tw-inset-0 tw-bg-black/20 tw-backdrop-blur-[2px] tw-z-[100]" 
                    onClick={toggle}
                ></div>
            )}
            
            <div className={`tw-absolute tw-left-0 tw-top-0 tw-h-full tw-bg-white tw-border-r tw-z-[101] tw-transition-transform tw-duration-300 tw-w-64 ${isOpen ? 'tw-translate-x-0' : 'tw--translate-x-full md:tw-translate-x-0 md:tw-w-20 lg:tw-w-64'}`}>
                <div className="tw-flex tw-flex-col tw-h-full tw-py-4">
                    <div className="tw-px-6 tw-mb-8 tw-flex tw-items-center tw-gap-4">
                        <i className="fa-solid fa-note-sticky tw-text-googleBlue tw-text-2xl"></i>
                        <span className={`tw-font-bold tw-text-xl tw-text-gray-800 ${!isOpen && 'md:tw-hidden lg:tw-block'}`}>Mis Notas</span>
                    </div>
                    
                    <nav className="tw-flex-1">
                        {items.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setView(item.id)}
                                className={`tw-w-full tw-flex tw-items-center tw-gap-4 tw-px-6 tw-py-4 tw-transition-colors ${currentView === item.id ? 'tw-bg-blue-50 tw-text-googleBlue tw-rounded-r-full' : 'tw-text-gray-600 hover:tw-bg-gray-100 tw-rounded-r-full'}`}
                            >
                                <i className={`fa-solid ${item.icon} tw-text-lg tw-w-6`}></i>
                                <span className={`tw-font-medium ${!isOpen && 'md:tw-hidden lg:tw-block'}`}>{item.label}</span>
                            </button>
                        ))}
                    </nav>
                    
                    <div className="tw-px-6 tw-py-4 tw-text-xs tw-text-gray-400">
                        <p className={!isOpen && 'md:tw-hidden lg:tw-block'}>ContaEste Notes v2.0</p>
                    </div>
                </div>
            </div>
        </>
    );
};

const NoteCard = ({ note, view, onClick, onDelete, onArchive, onRestore, onTogglePin }) => {
  return (
    <div 
      onClick={onClick}
      className={`tw-group tw-bg-white tw-rounded-2xl tw-p-5 tw-border tw-border-gray-200 tw-shadow-sm hover:tw-shadow-md tw-transition-all tw-cursor-pointer tw-relative tw-flex tw-flex-col tw-h-fit tw-min-h-[160px] ${note.deleted && 'tw-opacity-80'}`}
    >
      {!note.deleted && (
        <button 
            onClick={(e) => onTogglePin(note.id, e)}
            className={`tw-absolute tw-top-2 tw-right-2 tw-p-3 tw-rounded-full hover:tw-bg-gray-100 tw-transition-colors tw-min-w-[44px] tw-min-h-[44px] tw-flex tw-items-center tw-justify-center ${note.pinned ? 'tw-text-googleBlue' : 'tw-text-gray-400 tw-opacity-0 md:group-hover:tw-opacity-100 md:tw-opacity-0'}`}
        >
            <i className="fa-solid fa-thumbtack"></i>
        </button>
      )}

      {note.title && <h4 className="tw-font-bold tw-text-gray-800 tw-mb-3 tw-pr-6 tw-line-clamp-2 tw-text-[17px]">{note.title}</h4>}
      
      <div className="tw-text-gray-600 tw-text-sm tw-flex-1 tw-overflow-hidden">
        {note.type === 'text' ? (
          <p className="tw-whitespace-pre-wrap tw-line-clamp-6 tw-leading-relaxed">{note.content || 'Nota vacía'}</p>
        ) : (
          <div className="tw-space-y-1.5">
            {(note.content || []).slice(0, 5).map((item, idx) => (
              <div key={idx} className="tw-flex tw-items-center tw-gap-2.5">
                <i className={item.completed ? "fa-solid fa-square-check tw-text-googleBlue" : "fa-regular fa-square tw-text-gray-400"}></i>
                <span className={`tw-truncate ${item.completed ? 'tw-line-through tw-text-gray-400' : ''}`}>{item.text}</span>
              </div>
            ))}
            {note.content?.length > 5 && <div className="tw-text-xs tw-text-gray-400 tw-mt-2">+{note.content.length - 5} elementos más</div>}
            {(!note.content || note.content.length === 0) && <span className="tw-italic tw-text-gray-400">Lista vacía</span>}
          </div>
        )}
      </div>

      <div className="tw-mt-5 tw-pt-3 tw-border-t tw-border-gray-50 tw-flex tw-justify-end tw-gap-1 md:tw-opacity-0 group-hover:tw-opacity-100 tw-transition-opacity">
        {note.deleted ? (
            <>
                <button 
                    onClick={(e) => onRestore(note.id, e)}
                    className="tw-p-3 tw-text-googleBlue hover:tw-bg-blue-50 tw-rounded-full tw-transition-colors tw-min-w-[44px] tw-min-h-[44px] tw-flex tw-items-center tw-justify-center"
                    title="Restaurar"
                >
                    <i className="fa-solid fa-rotate-left"></i>
                </button>
                <button 
                    onClick={(e) => onDelete(note.id, e)}
                    className="tw-p-3 tw-text-red-500 hover:tw-bg-red-50 tw-rounded-full tw-transition-colors tw-min-w-[44px] tw-min-h-[44px] tw-flex tw-items-center tw-justify-center"
                    title="Eliminar definitivamente"
                >
                    <i className="fa-solid fa-trash-can"></i>
                </button>
            </>
        ) : (
            <>
                <button 
                    onClick={(e) => onArchive(note.id, e)}
                    className="tw-p-3 tw-text-gray-400 hover:tw-text-googleBlue tw-rounded-full hover:tw-bg-gray-100 tw-transition-colors tw-min-w-[44px] tw-min-h-[44px] tw-flex tw-items-center tw-justify-center"
                    title={note.archived ? "Desarchivar" : "Archivar"}
                >
                    <i className={`fa-solid ${note.archived ? 'fa-box-open' : 'fa-box-archive'}`}></i>
                </button>
                <button 
                    onClick={(e) => onDelete(note.id, e)}
                    className="tw-p-3 tw-text-gray-400 hover:tw-text-red-500 tw-rounded-full hover:tw-bg-red-50 tw-transition-colors tw-min-w-[44px] tw-min-h-[44px] tw-flex tw-items-center tw-justify-center"
                    title="Mover a la papelera"
                >
                    <i className="fa-solid fa-trash-can"></i>
                </button>
            </>
        )}
      </div>
    </div>
  );
};

const NoteModal = ({ note, isOpen, onClose, onUpdate, onDelete, onArchive }) => {
  const [localTitle, setLocalTitle] = useState(note.title);
  const [localContent, setLocalContent] = useState(note.content);
  const [newItem, setNewItem] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
        setTimeout(() => inputRef.current.focus(), 150);
    }
  }, [isOpen]);

  const handleClose = () => {
    onUpdate({ title: localTitle, content: localContent });
    onClose();
  };

  const addItem = (e) => {
    if (e) e.preventDefault();
    if (!newItem.trim()) return;
    setLocalContent([...(localContent || []), { text: newItem, completed: false }]);
    setNewItem('');
  };

  const toggleItem = (idx) => {
    const newItems = [...localContent];
    newItems[idx].completed = !newItems[idx].completed;
    setLocalContent(newItems);
  };

  const removeItem = (idx) => {
    setLocalContent(localContent.filter((_, i) => i !== idx));
  };

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[9999] tw-flex tw-items-center tw-justify-center md:tw-p-4 tw-bg-black/50 tw-backdrop-blur-sm" onClick={handleClose}>
      <div 
        className="tw-bg-white tw-w-full tw-max-w-2xl md:tw-rounded-3xl tw-shadow-2xl tw-flex tw-flex-col tw-h-full md:tw-h-auto md:tw-max-h-[85vh] tw-animate-in tw-fade-in tw-zoom-in tw-duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header para Móvil */}
        <div className="md:tw-hidden tw-px-6 tw-py-4 tw-border-b tw-flex tw-justify-between tw-items-center">
            <button onClick={handleClose} className="tw-text-googleBlue tw-font-bold tw-text-lg">
                <i className="fa-solid fa-chevron-left tw-mr-2"></i> Listo
            </button>
            <div className="tw-flex tw-gap-1">
                <button onClick={() => { onArchive(); onClose(); }} className="tw-p-3 tw-text-gray-500">
                    <i className={`fa-solid ${note.archived ? 'fa-box-open' : 'fa-box-archive'}`}></i>
                </button>
                <button onClick={() => { onDelete(); onClose(); }} className="tw-p-3 tw-text-gray-500">
                    <i className="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>

        <div className="tw-p-8 tw-flex-1 tw-overflow-y-auto">
          <div className="tw-flex tw-justify-between tw-items-start tw-mb-6">
            <input 
              type="text" 
              placeholder="Título" 
              className="tw-w-full tw-text-2xl tw-font-bold tw-border-none focus:tw-ring-0 tw-p-0 tw-text-gray-800"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
            />
          </div>

          {note.type === 'text' ? (
            <textarea 
              ref={inputRef}
              placeholder="Escribe una nota..." 
              className="tw-w-full tw-h-full md:tw-h-72 tw-resize-none tw-border-none focus:tw-ring-0 tw-p-0 tw-text-gray-700 tw-text-[17px] tw-leading-relaxed"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
            />
          ) : (
            <div className="tw-space-y-1">
              <div className="tw-mb-4">
                {(localContent || []).map((item, idx) => (
                  <div key={idx} className="tw-flex tw-items-center tw-gap-3 tw-py-1.5 tw-group">
                    <button onClick={() => toggleItem(idx)} className="tw-text-gray-400 hover:tw-text-googleBlue tw-min-w-[40px] tw-flex tw-items-center tw-justify-center">
                      <i className={item.completed ? "fa-solid fa-square-check tw-text-googleBlue tw-text-xl" : "fa-regular fa-square tw-text-xl"}></i>
                    </button>
                    <input 
                      type="text" 
                      value={item.text} 
                      onChange={(e) => {
                        const newItems = [...localContent];
                        newItems[idx].text = e.target.value;
                        setLocalContent(newItems);
                      }}
                      className={`tw-flex-1 tw-border-none tw-p-0 focus:tw-ring-0 tw-text-[17px] ${item.completed ? 'tw-line-through tw-text-gray-400' : ''}`}
                    />
                    <button onClick={() => removeItem(idx)} className="md:tw-opacity-0 group-hover:tw-opacity-100 tw-text-gray-300 hover:tw-text-red-400 tw-min-w-[40px] tw-flex tw-items-center tw-justify-center">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
              <form onSubmit={addItem} className="tw-flex tw-items-center tw-gap-3 tw-border-t tw-pt-5">
                <i className="fa-solid fa-plus tw-text-gray-400 tw-ml-2"></i>
                <input 
                  ref={inputRef}
                  type="text" 
                  placeholder="Añadir elemento" 
                  className="tw-flex-1 tw-border-none tw-p-0 focus:tw-ring-0 tw-text-[17px]"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                />
              </form>
            </div>
          )}
        </div>

        {/* Footer para Escritorio */}
        <div className="tw-hidden md:tw-flex tw-px-8 tw-py-5 tw-bg-gray-50/50 tw-rounded-b-3xl tw-justify-between tw-items-center tw-border-t">
          <div className="tw-flex tw-gap-2">
             <button onClick={() => { onArchive(); onClose(); }} className="tw-p-3 tw-text-gray-500 hover:tw-text-googleBlue tw-transition-colors" title="Archivar">
               <i className={`fa-solid ${note.archived ? 'fa-box-open' : 'fa-box-archive'}`}></i>
             </button>
             <button onClick={() => { onDelete(); onClose(); }} className="tw-p-3 tw-text-gray-500 hover:tw-text-red-500 tw-transition-colors" title="Eliminar">
               <i className="fa-solid fa-trash-can"></i>
             </button>
          </div>
          <button 
            onClick={handleClose}
            className="tw-bg-googleBlue tw-text-white tw-px-8 tw-py-2.5 tw-rounded-xl tw-font-bold hover:tw-shadow-lg tw-transition-all active:tw-scale-95"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ view, isSearching }) => {
    const getContent = () => {
        if (isSearching) return { icon: 'fa-magnifying-glass', text: 'No se encontraron resultados' };
        switch(view) {
            case 'archive': return { icon: 'fa-box-archive', text: 'Aquí aparecerán tus notas archivadas' };
            case 'trash': return { icon: 'fa-trash-can', text: 'No hay notas en la papelera' };
            default: return { icon: 'fa-lightbulb', text: 'Las notas que añadas aparecerán aquí' };
        }
    };
    
    const content = getContent();
    return (
        <div className="tw-text-center tw-py-32 tw-text-gray-400">
            <i className={`fa-solid ${content.icon} tw-text-7xl tw-mb-6 tw-opacity-10`}></i>
            <p className="tw-text-xl tw-font-medium">{content.text}</p>
        </div>
    );
};

// Exportar para que app.js lo encuentre
window.KeepModule = {
    root: null,
    render: (containerId) => {
        const container = document.getElementById(containerId);
        if (container) {
            if (!window.KeepModule.root) {
                window.KeepModule.root = ReactDOM.createRoot(container);
            }
            window.KeepModule.root.render(<KeepApp />);
        }
    }
};
