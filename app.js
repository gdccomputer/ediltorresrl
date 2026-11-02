const PIN_PROTECTION = "78246";

// Impostazioni predefinite: 30gg passati, 100gg futuri, 10gg urgenti
let settings = {
  pastDays: 30,
  futureDays: 100,
  daysUrgent: 10
};

let loadedEvents = [];
let loadedNotes = [];
let editingNoteId = null;

function loadSettings() {
  try {
    const saved = localStorage.getItem('app_calendar_settings');
    if (saved) {
      settings = { ...settings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn("Impostazioni non leggibili, uso quelle predefinite:", e);
  }

  const inputPast = document.getElementById('days-past');
  const inputFuture = document.getElementById('days-future');
  const inputUrgent = document.getElementById('days-urgent');

  if (inputPast) inputPast.value = settings.pastDays;
  if (inputFuture) inputFuture.value = settings.futureDays;
  if (inputUrgent) inputUrgent.value = settings.daysUrgent;
}

function saveSettings() {
  const inputPast = document.getElementById('days-past');
  const inputFuture = document.getElementById('days-future');
  const inputUrgent = document.getElementById('days-urgent');

  settings.pastDays = parseInt(inputPast.value, 10) || 30;
  settings.futureDays = parseInt(inputFuture.value, 10) || 100;
  settings.daysUrgent = parseInt(inputUrgent.value, 10) || 10;

  localStorage.setItem('app_calendar_settings', JSON.stringify(settings));
  alert('Impostazioni salvate con successo!');
  document.getElementById('settings-modal').classList.remove('active');

  refreshAll();
}

/* ---------- Stato di accesso ---------- */

// Mostra l'interfaccia da utente connesso e carica appunti e scadenze
async function onLoggedIn() {
  document.getElementById('btn-login').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'inline-block';
  document.getElementById('btn-refresh').style.display = 'inline-block';
  document.getElementById('btn-settings').style.display = 'inline-block';
  document.getElementById('btn-add-note').style.display = 'block';
  document.getElementById('notes-section').style.display = 'block';
  await refreshAll();
}

// Torna alla schermata iniziale (non connesso)
function onLoggedOut(message) {
  document.getElementById('btn-login').style.display = 'inline-block';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('btn-refresh').style.display = 'none';
  document.getElementById('btn-settings').style.display = 'none';
  document.getElementById('btn-add-note').style.display = 'none';
  document.getElementById('notes-section').style.display = 'none';
  document.getElementById('note-modal').classList.remove('active');
  document.getElementById('task-list').innerHTML = '';
  document.getElementById('notes-list').innerHTML = '';
  document.getElementById('notes-done-list').innerHTML = '';
  loadedEvents = [];
  loadedNotes = [];
  showStatus(message || "Disconnesso. Clicca su 'Accedi'.", "#e3f2fd");
}

// Sessione scaduta: elimina il token e chiede di nuovo l'accesso
function handleSessionExpired() {
  clearToken();
  onLoggedOut("Sessione scaduta. Clicca su 'Accedi' per continuare.");
}

async function refreshAll() {
  await Promise.all([refreshNotes(), refreshTasksSilent()]);
}

async function refreshTasksSilent() {
  showStatus("Aggiornamento task in corso...", "#e3f2fd");
  try {
    loadedEvents = await fetchCalendarEvents(settings.pastDays, settings.futureDays);
    renderTasks(loadedEvents);
    showStatus("Connessione a Google riuscita! Caricamento completato.", "#d4edda");
  } catch (err) {
    console.error(err);
    if (isAuthError(err)) {
      handleSessionExpired();
      return;
    }
    showStatus("Errore durante il recupero dei dati da Google Calendar.", "#f8d7da");
  }
}

/* ---------- Appunti (Google Tasks) ---------- */

function setNotesMessage(text) {
  const el = document.getElementById('notes-message');
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
}

async function refreshNotes() {
  setNotesMessage('');
  try {
    loadedNotes = await fetchNotes(settings.pastDays);
    renderNotes();
  } catch (err) {
    console.error("Errore appunti:", err);
    if (isAuthError(err)) {
      handleSessionExpired();
      return;
    }
    setNotesMessage("Impossibile caricare gli appunti. Verifica che l'API Google Tasks sia abilitata e di aver concesso il permesso richiesto.");
  }
}

function buildNoteItem(note) {
  const done = note.status === 'completed';

  const li = document.createElement('li');
  li.className = 'note-item' + (done ? ' note-done' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-checkbox';
  checkbox.checked = done;
  checkbox.setAttribute('aria-label', 'Segna come completato');
  checkbox.addEventListener('change', (e) => {
    toggleNoteCompleted(note, e.target.checked);
  });

  const text = document.createElement('button');
  text.type = 'button';
  text.className = 'note-text';
  text.textContent = note.title || 'Senza titolo';
  text.addEventListener('click', () => openNoteModal(note));

  li.append(checkbox, text);
  return li;
}

function renderNotes() {
  const openList = document.getElementById('notes-list');
  const doneList = document.getElementById('notes-done-list');
  const doneWrap = document.getElementById('notes-done-wrap');
  const doneSummary = document.getElementById('notes-done-summary');
  const count = document.getElementById('notes-count');

  openList.innerHTML = '';
  doneList.innerHTML = '';

  const openNotes = loadedNotes.filter(n => n.status !== 'completed');
  const doneNotes = loadedNotes
    .filter(n => n.status === 'completed')
    .sort((a, b) => new Date(b.completed || 0) - new Date(a.completed || 0));

  count.textContent = openNotes.length > 0 ? openNotes.length : '';

  if (openNotes.length === 0) {
    const li = document.createElement('li');
    li.className = 'notes-empty';
    li.textContent = 'Nessun appunto da fare. Premi «Nuovo appunto» per aggiungerne uno.';
    openList.appendChild(li);
  } else {
    openNotes.forEach(n => openList.appendChild(buildNoteItem(n)));
  }

  if (doneNotes.length > 0) {
    doneWrap.style.display = 'block';
    doneSummary.textContent = `Completati (${doneNotes.length})`;
    doneNotes.forEach(n => doneList.appendChild(buildNoteItem(n)));
  } else {
    doneWrap.style.display = 'none';
  }
}

// Spunta / rimuove la spunta su un appunto
async function toggleNoteCompleted(note, isChecked) {
  const previous = { status: note.status, completed: note.completed };

  note.status = isChecked ? 'completed' : 'needsAction';
  note.completed = isChecked ? new Date().toISOString() : undefined;
  renderNotes();

  try {
    await updateNote(note.id, isChecked
      ? { status: 'completed' }
      : { status: 'needsAction', completed: null });
  } catch (err) {
    console.error("Errore aggiornamento appunto:", err);
    note.status = previous.status;
    note.completed = previous.completed;
    renderNotes();

    if (isAuthError(err)) {
      handleSessionExpired();
    } else {
      setNotesMessage("Impossibile salvare la modifica. Riprova.");
    }
  }
}

function openNoteModal(note) {
  editingNoteId = note ? note.id : null;

  document.getElementById('note-modal-title').textContent = note ? 'Modifica appunto' : 'Nuovo appunto';
  document.getElementById('btn-delete-note').style.display = note ? 'inline-block' : 'none';

  const input = document.getElementById('note-input');
  input.value = note ? (note.title || '') : '';

  document.getElementById('btn-save-note').disabled = false;
  document.getElementById('note-modal').classList.add('active');
  setTimeout(() => input.focus(), 50);
}

function closeNoteModal() {
  document.getElementById('note-modal').classList.remove('active');
  editingNoteId = null;
}

async function saveNote() {
  const input = document.getElementById('note-input');
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }

  const saveBtn = document.getElementById('btn-save-note');
  saveBtn.disabled = true;

  try {
    if (editingNoteId) {
      const updated = await updateNote(editingNoteId, { title });
      const note = loadedNotes.find(n => n.id === editingNoteId);
      if (note) note.title = updated.title || title;
    } else {
      const created = await addNote(title);
      loadedNotes.unshift(created);
    }
    renderNotes();
    setNotesMessage('');
    closeNoteModal();
  } catch (err) {
    console.error("Errore salvataggio appunto:", err);
    saveBtn.disabled = false;
    if (isAuthError(err)) {
      handleSessionExpired();
    } else {
      alert("Impossibile salvare l'appunto. Controlla la connessione e riprova.");
    }
  }
}

async function removeNote() {
  if (!editingNoteId) return;
  if (!confirm('Eliminare definitivamente questo appunto?')) return;

  const idToDelete = editingNoteId;
  try {
    await deleteNote(idToDelete);
    loadedNotes = loadedNotes.filter(n => n.id !== idToDelete);
    renderNotes();
    closeNoteModal();
  } catch (err) {
    console.error("Errore eliminazione appunto:", err);
    if (isAuthError(err)) {
      handleSessionExpired();
    } else {
      alert("Impossibile eliminare l'appunto. Riprova.");
    }
  }
}

/* ---------- Logica scadenze (Google Calendar) ---------- */

// Controlla se il tag [FATTO] è presente nella descrizione
function isEventCompleted(event) {
  return (event.description || '').toUpperCase().includes('[FATTO]');
}

// Calcolo Categoria Priorità
function getPriorityInfo(eventDateStr, isCompleted) {
  if (isCompleted) {
    return { label: 'FATTO', class: 'completato', badgeClass: 'badge-completato' };
  }

  const now = new Date();
  const eventDate = new Date(eventDateStr);

  if (eventDate < now) {
    return { label: 'SCADUTO', class: 'scaduto', badgeClass: 'badge-scaduto' };
  }

  const diffTime = eventDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= settings.daysUrgent) {
    return { label: 'URGENTE', class: 'urgente', badgeClass: 'badge-urgente' };
  }

  return { label: 'FUTURO', class: 'futuro', badgeClass: 'badge-futuro' };
}

// Gestore cambio spunta
async function toggleTaskCompleted(event, isChecked) {
  const previousDesc = event.description || '';
  let desc = previousDesc;

  if (isChecked) {
    if (!desc.toUpperCase().includes('[FATTO]')) {
      desc = desc ? `${desc}\n[FATTO]` : '[FATTO]';
    }
  } else {
    desc = desc.replace(/\[FATTO\]/gi, '').trim();
  }

  event.description = desc;
  renderTasks(loadedEvents);

  try {
    await updateGoogleCalendarEventDescription(event.id, desc);
  } catch (err) {
    console.error("Errore salvataggio su Google Calendar:", err);
    // Ripristina lo stato precedente se il salvataggio non è riuscito
    event.description = previousDesc;
    renderTasks(loadedEvents);

    if (isAuthError(err)) {
      handleSessionExpired();
    } else {
      showStatus("Impossibile salvare la modifica su Google Calendar.", "#f8d7da");
    }
  }
}

// Renderizzazione della tabella con ordinamento
function renderTasks(events) {
  const tbody = document.getElementById('task-list');
  tbody.innerHTML = '';

  if (!events || events.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = `Nessun impegno trovato nell'intervallo selezionato (-${settings.pastDays}gg / +${settings.futureDays}gg).`;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const activeEvents = [];
  const completedEvents = [];

  events.forEach(event => {
    if (isEventCompleted(event)) {
      completedEvents.push(event);
    } else {
      activeEvents.push(event);
    }
  });

  const sortedEvents = [...activeEvents, ...completedEvents];

  sortedEvents.forEach(event => {
    const start = event.start.dateTime || event.start.date;
    const isDone = isEventCompleted(event);

    const dateFormatted = new Date(start).toLocaleString('it-IT', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const priority = getPriorityInfo(start, isDone);

    const tr = document.createElement('tr');
    if (isDone) {
      tr.classList.add('task-completed');
    }

    // Colonna 1: spunta
    const tdCheck = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = isDone;
    checkbox.addEventListener('change', (e) => {
      toggleTaskCompleted(event, e.target.checked);
    });
    tdCheck.appendChild(checkbox);

    // Colonna 2: data
    const tdDate = document.createElement('td');
    tdDate.textContent = dateFormatted;

    // Colonna 3: titolo (textContent evita di interpretare HTML presente nei titoli)
    const tdTitle = document.createElement('td');
    const title = document.createElement('span');
    title.className = `task-title ${priority.class}`;
    title.textContent = event.summary || 'Senza Titolo';
    tdTitle.appendChild(title);

    // Colonna 4: priorità
    const tdBadge = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${priority.badgeClass}`;
    badge.textContent = priority.label;
    tdBadge.appendChild(badge);

    tr.append(tdCheck, tdDate, tdTitle, tdBadge);
    tbody.appendChild(tr);
  });
}

/* ---------- Backup CSV ---------- */

function exportSettingsToCSV() {
  const csvContent = "data:text/csv;charset=utf-8,Chiave,Valore\n"
    + `pastDays,${settings.pastDays}\n`
    + `futureDays,${settings.futureDays}\n`
    + `daysUrgent,${settings.daysUrgent}\n`;

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "impostazioni_scadenze.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function importSettingsFromCSV(e) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const lines = evt.target.result.split(/\r?\n/);
    lines.forEach(line => {
      const parts = line.split(',').map(p => p.trim());
      const value = parseInt(parts[1], 10);
      if (isNaN(value)) return;
      if (parts[0] === 'pastDays') settings.pastDays = value;
      if (parts[0] === 'futureDays') settings.futureDays = value;
      if (parts[0] === 'daysUrgent') settings.daysUrgent = value;
    });

    document.getElementById('days-past').value = settings.pastDays;
    document.getElementById('days-future').value = settings.futureDays;
    document.getElementById('days-urgent').value = settings.daysUrgent;
    saveSettings();

    // Permette di reimportare lo stesso file in futuro
    input.value = '';
  };
  reader.readAsText(file);
}

/* ---------- Event Listeners ---------- */

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.getElementById('btn-login').addEventListener('click', () => {
    if (!tokenClient) {
      alert("Le librerie Google stanno ancora caricando o le chiavi in config.js non sono valide.");
      return;
    }

    tokenClient.callback = async (resp) => {
      if (resp.error) {
        showStatus("Accesso non riuscito: " + resp.error, "#f8d7da");
        return;
      }
      saveToken(resp);
      await onLoggedIn();
    };

    tokenClient.requestAccessToken({ prompt: '' });
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    clearToken();
    onLoggedOut("Disconnesso. Clicca su 'Accedi' per riconnetterti.");
  });

  document.getElementById('btn-refresh').addEventListener('click', refreshAll);

  // Appunti
  document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal(null));
  document.getElementById('btn-save-note').addEventListener('click', saveNote);
  document.getElementById('btn-close-note').addEventListener('click', closeNoteModal);
  document.getElementById('btn-delete-note').addEventListener('click', removeNote);
  document.getElementById('note-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNote();
    }
  });

  // Modale PIN e Opzioni
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-pin').value = '';
    document.getElementById('password-modal').classList.add('active');
  });

  document.getElementById('btn-close-pin').addEventListener('click', () => {
    document.getElementById('password-modal').classList.remove('active');
  });

  document.getElementById('btn-confirm-pin').addEventListener('click', () => {
    const pin = document.getElementById('settings-pin').value;
    if (pin === PIN_PROTECTION) {
      document.getElementById('password-modal').classList.remove('active');
      document.getElementById('settings-modal').classList.add('active');
    } else {
      alert('PIN errato!');
    }
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('active');
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-export-csv').addEventListener('click', exportSettingsToCSV);
  document.getElementById('btn-import-csv').addEventListener('change', importSettingsFromCSV);
});
