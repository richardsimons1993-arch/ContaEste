console.log("Cargando componente KeepApp (v-fa)...");

const { useState, useEffect, useCallback, useRef } = React;

const KeepApp = () => {
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('contaeste_notas');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeNote, setActiveNote] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Persistencia automática
  useEffect(() => {
    localStorage.setItem('contaeste_notas', JSON.stringify(notes));
  }, [notes]);

  const addNote = (type) => {
    const newNote = {
      id: Date.now(),
      title: '',
      content: type === 'list' ? [] : '',
      type: type,
      pinned: false,
      color: 'white',
      lastModified: new Date().toISOString()
    };
    setNotes([newNote, ...notes]);
    setActiveNote(newNote);
    setIsModalOpen(true);
  };

  const updateNote = (id, updates) => {
    setNotes(notes.map(note => note.id === id ? { ...note, ...updates, lastModified: new Date().toISOString() } : note));
  };

  const deleteNote = (id, e) => {
    if (e) e.stopPropagation();
    setNotes(notes.filter(note => note.id !== id));
    if (activeNote?.id === id) setIsModalOpen(false);
  };

  const togglePin = (id, e) => {
    if (e) e.stopPropagation();
    const note = notes.find(n => n.id === id);
    updateNote(id, { pinned: !note.pinned });
  };

  const filteredNotes = notes.filter(note => 
    note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (typeof note.content === 'string' ? note.content : note.content.map(i => i.text).join(' '))
      .toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedNotes = filteredNotes.filter(n => n.pinned);
  const otherNotes = filteredNotes.filter(n => !n.pinned);

  return (
    <div className="tw-min-h-full tw-bg-googleGray tw-p-4 md:tw-p-8 tw-font-sans">
      {/* Barra de Búsqueda y Herramientas */}
      <div className="tw-max-w-3xl tw-mx-auto tw-mb-8 tw-flex tw-flex-col md:tw-flex-row tw-gap-4">
        <div className="tw-flex-1 tw-bg-white tw-rounded-lg tw-shadow-sm tw-flex tw-items-center tw-px-4 tw-py-2 tw-border tw-border-gray-200 focus-within:tw-shadow-md tw-transition-shadow">
          <i className="fa-solid fa-magnifying-glass tw-text-gray-400 tw-mr-3"></i>
          <input 
            type="text" 
            placeholder="Buscar notas..." 
            className="tw-w-full tw-border-none focus:tw-ring-0 tw-text-gray-700 tw-bg-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="tw-flex tw-gap-2">
          <button 
            onClick={() => addNote('text')}
            className="tw-bg-googleBlue tw-text-white tw-px-4 tw-py-2 tw-rounded-full tw-flex tw-items-center tw-gap-2 hover:tw-shadow-lg tw-transition-all active:tw-scale-95"
          >
            <i className="fa-solid fa-plus"></i> <span className="tw-hidden sm:tw-inline">Nueva Nota</span>
          </button>
          <button 
            onClick={() => addNote('list')}
            className="tw-bg-white tw-text-googleBlue tw-border tw-border-googleBlue tw-px-4 tw-py-2 tw-rounded-full tw-flex tw-items-center tw-gap-2 hover:tw-bg-blue-50 tw-transition-all active:tw-scale-95"
          >
            <i className="fa-solid fa-square-check"></i> <span className="tw-hidden sm:tw-inline">Lista</span>
          </button>
        </div>
      </div>

      {/* Secciones de Notas */}
      <div className="tw-max-w-6xl tw-mx-auto">
        {pinnedNotes.length > 0 && (
          <div className="tw-mb-8">
            <h3 className="tw-text-xs tw-font-bold tw-text-gray-500 tw-uppercase tw-tracking-wider tw-mb-4">Fijadas</h3>
            <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 lg:tw-grid-cols-3 xl:tw-grid-cols-4 tw-gap-4">
              {pinnedNotes.map(note => (
                <NoteCard key={note.id} note={note} onClick={() => { setActiveNote(note); setIsModalOpen(true); }} onDelete={deleteNote} onTogglePin={togglePin} />
              ))}
            </div>
          </div>
        )}

        {otherNotes.length > 0 ? (
          <div>
            {pinnedNotes.length > 0 && <h3 className="tw-text-xs tw-font-bold tw-text-gray-500 tw-uppercase tw-tracking-wider tw-mb-4">Otras</h3>}
            <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 lg:tw-grid-cols-3 xl:tw-grid-cols-4 tw-gap-4">
              {otherNotes.map(note => (
                <NoteCard key={note.id} note={note} onClick={() => { setActiveNote(note); setIsModalOpen(true); }} onDelete={deleteNote} onTogglePin={togglePin} />
              ))}
            </div>
          </div>
        ) : (
          searchQuery && <div className="tw-text-center tw-py-20 tw-text-gray-500">No se encontraron notas que coincidan con "{searchQuery}"</div>
        )}
      </div>

      {/* Modal de Edición */}
      {isModalOpen && activeNote && (
        <NoteModal 
          note={activeNote} 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onUpdate={(updates) => updateNote(activeNote.id, updates)}
          onDelete={() => deleteNote(activeNote.id)}
        />
      )}
    </div>
  );
};

const NoteCard = ({ note, onClick, onDelete, onTogglePin }) => {
  return (
    <div 
      onClick={onClick}
      className="tw-group tw-bg-white tw-rounded-xl tw-p-4 tw-border tw-border-gray-200 tw-shadow-sm hover:tw-shadow-md tw-transition-all tw-cursor-pointer tw-relative tw-flex tw-flex-col tw-h-fit tw-min-h-[140px]"
    >
      <button 
        onClick={(e) => onTogglePin(note.id, e)}
        className={`tw-absolute tw-top-2 tw-right-2 tw-p-1.5 tw-rounded-full hover:tw-bg-gray-100 tw-transition-colors ${note.pinned ? 'tw-text-googleBlue' : 'tw-text-gray-400 tw-opacity-0 group-hover:tw-opacity-100'}`}
      >
        <i className="fa-solid fa-thumbtack"></i>
      </button>

      {note.title && <h4 className="tw-font-bold tw-text-gray-800 tw-mb-2 tw-pr-6 tw-line-clamp-2">{note.title}</h4>}
      
      <div className="tw-text-gray-600 tw-text-sm tw-flex-1 tw-overflow-hidden">
        {note.type === 'text' ? (
          <p className="tw-whitespace-pre-wrap tw-line-clamp-6">{note.content || 'Nota vacía'}</p>
        ) : (
          <div className="tw-space-y-1">
            {(note.content || []).slice(0, 5).map((item, idx) => (
              <div key={idx} className="tw-flex tw-items-center tw-gap-2">
                <i className={item.completed ? "fa-solid fa-square-check tw-text-googleBlue" : "fa-regular fa-square tw-text-gray-400"}></i>
                <span className={`tw-truncate ${item.completed ? 'tw-line-through tw-text-gray-400' : ''}`}>{item.text}</span>
              </div>
            ))}
            {note.content?.length > 5 && <div className="tw-text-xs tw-text-gray-400 tw-mt-1">+{note.content.length - 5} elementos más</div>}
            {(!note.content || note.content.length === 0) && <span className="tw-italic tw-text-gray-400">Lista vacía</span>}
          </div>
        )}
      </div>

      <div className="tw-mt-4 tw-pt-2 tw-flex tw-justify-end tw-opacity-0 group-hover:tw-opacity-100 tw-transition-opacity">
        <button 
          onClick={(e) => onDelete(note.id, e)}
          className="tw-p-2 tw-text-gray-400 hover:tw-text-red-500 tw-rounded-full hover:tw-bg-red-50 tw-transition-colors"
        >
          <i className="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  );
};

const NoteModal = ({ note, isOpen, onClose, onUpdate, onDelete }) => {
  const [localTitle, setLocalTitle] = useState(note.title);
  const [localContent, setLocalContent] = useState(note.content);
  const [newItem, setNewItem] = useState('');

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
    <div className="tw-fixed tw-inset-0 tw-z-[9999] tw-flex tw-items-center tw-justify-center tw-p-4 tw-bg-black/40 tw-backdrop-blur-sm" onClick={handleClose}>
      <div 
        className="tw-bg-white tw-w-full tw-max-w-2xl tw-rounded-2xl tw-shadow-2xl tw-flex tw-flex-col tw-max-h-[85vh] tw-animate-in tw-fade-in tw-zoom-in tw-duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="tw-p-6 tw-flex-1 tw-overflow-y-auto">
          <div className="tw-flex tw-justify-between tw-items-start tw-mb-4">
            <input 
              type="text" 
              placeholder="Título" 
              className="tw-w-full tw-text-xl tw-font-bold tw-border-none focus:tw-ring-0 tw-p-0"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
            />
          </div>

          {note.type === 'text' ? (
            <textarea 
              placeholder="Escribe una nota..." 
              className="tw-w-full tw-h-60 tw-resize-none tw-border-none focus:tw-ring-0 tw-p-0 tw-text-gray-700"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              autoFocus
            />
          ) : (
            <div className="tw-space-y-2">
              <div className="tw-mb-4">
                {(localContent || []).map((item, idx) => (
                  <div key={idx} className="tw-flex tw-items-center tw-gap-3 tw-py-1 tw-group">
                    <button onClick={() => toggleItem(idx)} className="tw-text-gray-400 hover:tw-text-googleBlue">
                      <i className={item.completed ? "fa-solid fa-square-check tw-text-googleBlue" : "fa-regular fa-square"}></i>
                    </button>
                    <input 
                      type="text" 
                      value={item.text} 
                      onChange={(e) => {
                        const newItems = [...localContent];
                        newItems[idx].text = e.target.value;
                        setLocalContent(newItems);
                      }}
                      className={`tw-flex-1 tw-border-none tw-p-0 focus:tw-ring-0 ${item.completed ? 'tw-line-through tw-text-gray-400' : ''}`}
                    />
                    <button onClick={() => removeItem(idx)} className="tw-opacity-0 group-hover:tw-opacity-100 tw-text-gray-300 hover:tw-text-red-400">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
              <form onSubmit={addItem} className="tw-flex tw-items-center tw-gap-3 tw-border-t tw-pt-4">
                <i className="fa-solid fa-plus tw-text-gray-400"></i>
                <input 
                  type="text" 
                  placeholder="Añadir elemento" 
                  className="tw-flex-1 tw-border-none tw-p-0 focus:tw-ring-0"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                />
              </form>
            </div>
          )}
        </div>

        <div className="tw-px-6 tw-py-4 tw-bg-gray-50 tw-rounded-b-2xl tw-flex tw-justify-between tw-items-center">
          <div className="tw-flex tw-gap-4">
             <button onClick={onDelete} className="tw-text-gray-500 hover:tw-text-red-500 tw-transition-colors" title="Eliminar">
               <i className="fa-solid fa-trash-can"></i>
             </button>
          </div>
          <button 
            onClick={handleClose}
            className="tw-bg-googleBlue tw-text-white tw-px-6 tw-py-2 tw-rounded-lg tw-font-bold hover:tw-shadow-md tw-transition-all"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

// Exportar para que app.js lo encuentre
window.KeepModule = {
    render: (containerId) => {
        const container = document.getElementById(containerId);
        if (container) {
            const root = ReactDOM.createRoot(container);
            root.render(<KeepApp />);
        }
    }
};
