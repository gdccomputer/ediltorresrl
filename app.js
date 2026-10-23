const PIN_PROTECTION = "78246";

// Impostazioni predefinite: 30gg passati, 100gg futuri, 10gg urgenti
let settings = {
  pastDays: 30,
  futureDays: 100,
  daysUrgent: 10
};

let loadedEvents = [];

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

  refreshTasksSilent();
}

/* ---------- Stato di accesso ---------- */

// Mostra l'interfaccia da utente connesso e carica i task
async function onLoggedIn() {
  document.getElementById('btn-login').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'inline-block';
  document.getElementById('btn-refresh').style.display = 'inline-block';
  document.getElementById('btn-settings').style.display = 'inline-block';
  await refreshTasksSilent();
}

// Torna alla schermata iniziale (non connesso)
function onLoggedOut(message) {
  document.getElementById('btn-login').style.display = 'inline-block';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('btn-refresh').style.display = 'none';
  document.getElementById('btn-settings').style.display = 'none';
  document.getElementById('task-list').innerHTML = '';
  loadedEvents = [];
  showStatus(message || "Disconnesso. Clicca su 'Accedi'.", "#e3f2fd");
}

// Sessione scaduta: elimina il token e chiede di nuovo l'accesso
function handleSessionExpired() {
  clearToken();
  onLoggedOut("Sessione scaduta. Clicca su 'Accedi' per continuare.");
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

/* ---------- Logica task ---------- */

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

  document.getElementById('btn-refresh').addEventListener('click', refreshTasksSilent);

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
