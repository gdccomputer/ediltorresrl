let tokenClient;
let gapiInited = false;
let gsisInited = false;

// Chiave nuova: i vecchi token salvati (solo Calendar) vengono ignorati,
// così al primo accesso Google chiede anche il permesso per Google Tasks.
const TOKEN_KEY = 'gcal_token_v2';
const OLD_TOKEN_KEY = 'gcal_token';

const NOTES_LIST_KEY = 'notes_tasklist_id';
const NOTES_LIST_TITLE = 'Appunti';

const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const TASKS_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest';

// Aggiunge in automatico lo scope di Google Tasks a quelli di config.js
function getScopes() {
  const base = CONFIG.SCOPES || '';
  return base.includes(TASKS_SCOPE) ? base : (base + ' ' + TASKS_SCOPE).trim();
}

function gapiLoaded() {
  gapi.load('client', async () => {
    try {
      if (typeof CONFIG === 'undefined') throw new Error("config.js mancante");
      await gapi.client.init({
        apiKey: CONFIG.API_KEY,
        discoveryDocs: [CONFIG.DISCOVERY_DOC, TASKS_DISCOVERY_DOC],
      });
      gapiInited = true;
      checkAuthReady();
    } catch (err) {
      console.error("Errore GAPI:", err);
      showStatus("Errore nel caricamento di GAPI (verifica config.js)", "#f8d7da");
    }
  });
}

function gisLoaded() {
  try {
    if (typeof CONFIG === 'undefined') throw new Error("config.js mancante");
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: getScopes(),
      callback: '',
    });
    gsisInited = true;
    checkAuthReady();
  } catch (err) {
    console.error("Errore GIS:", err);
    showStatus("Errore nel caricamento di GIS (verifica config.js)", "#f8d7da");
  }
}

function checkAuthReady() {
  if (!(gapiInited && gsisInited)) return;

  // Se esiste un token ancora valido, entra direttamente senza chiedere l'accesso
  if (restoreToken()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => onLoggedIn());
    } else {
      onLoggedIn();
    }
  } else {
    showStatus("Pronto per la connessione. Clicca su 'Accedi'.", "#d4edda");
  }
}

function showStatus(text, color) {
  const status = document.getElementById('status-message');
  if (status) {
    status.textContent = text;
    status.style.backgroundColor = color;
  }
}

/* ---------- Gestione token (valido circa 1 ora) ---------- */

function saveToken(resp) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: resp.access_token,
      // margine di sicurezza di 60 secondi
      expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000
    }));
  } catch (e) {
    console.warn("Impossibile salvare il token:", e);
  }
}

function restoreToken() {
  localStorage.removeItem(OLD_TOKEN_KEY);
  try {
    const data = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (data && data.access_token && data.expires_at > Date.now()) {
      gapi.client.setToken({ access_token: data.access_token });
      return true;
    }
  } catch (e) {
    // dati corrotti: vengono rimossi qui sotto
  }
  localStorage.removeItem(TOKEN_KEY);
  return false;
}

function clearToken() {
  const t = gapi.client.getToken();
  if (t && t.access_token) {
    try { google.accounts.oauth2.revoke(t.access_token); } catch (e) {}
  }
  gapi.client.setToken(null);
  localStorage.removeItem(TOKEN_KEY);
}

// Token scaduto o revocato?
function isAuthError(err) {
  return !!err && (err.status === 401 || (err.result && err.result.error && err.result.error.code === 401));
}

/* ---------- Google Calendar (scadenze) ---------- */

// Recupera gli eventi nell'intervallo richiesto (default: -30 giorni, +100 giorni)
async function fetchCalendarEvents(pastDays = 30, futureDays = 100) {
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - pastDays);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + futureDays);

  const response = await gapi.client.calendar.events.list({
    'calendarId': CONFIG.CALENDAR_ID || 'primary',
    'timeMin': timeMin.toISOString(),
    'timeMax': timeMax.toISOString(),
    'showDeleted': false,
    'singleEvents': true,
    'orderBy': 'startTime'
  });
  return response.result.items;
}

// Aggiorna la descrizione dell'evento su Google Calendar
async function updateGoogleCalendarEventDescription(eventId, newDescription) {
  const response = await gapi.client.calendar.events.patch({
    'calendarId': CONFIG.CALENDAR_ID || 'primary',
    'eventId': eventId,
    'resource': {
      'description': newDescription
    }
  });
  return response.result;
}

/* ---------- Google Tasks (appunti) ---------- */

let notesListPromise = null;

// Trova (o crea al primo utilizzo) la lista "Appunti" su Google Tasks
function getNotesListId() {
  if (notesListPromise) return notesListPromise;

  notesListPromise = (async () => {
    const cached = localStorage.getItem(NOTES_LIST_KEY);
    if (cached) return cached;

    const res = await gapi.client.tasks.tasklists.list({ maxResults: 100 });
    const found = (res.result.items || []).find(l => l.title === NOTES_LIST_TITLE);
    let id;
    if (found) {
      id = found.id;
    } else {
      const created = await gapi.client.tasks.tasklists.insert({
        resource: { title: NOTES_LIST_TITLE }
      });
      id = created.result.id;
    }
    localStorage.setItem(NOTES_LIST_KEY, id);
    return id;
  })();

  // se la ricerca fallisce, la volta successiva si riprova
  notesListPromise.catch(() => { notesListPromise = null; });
  return notesListPromise;
}

// Esegue un'operazione sulla lista; se l'ID salvato non esiste più, lo ricalcola e riprova
async function withNotesList(fn) {
  try {
    return await fn(await getNotesListId());
  } catch (err) {
    if (err && err.status === 404) {
      notesListPromise = null;
      localStorage.removeItem(NOTES_LIST_KEY);
      return await fn(await getNotesListId());
    }
    throw err;
  }
}

// Recupera tutti gli appunti aperti e quelli completati negli ultimi 'completedDays' giorni
async function fetchNotes(completedDays = 30) {
  return withNotesList(async (listId) => {
    const limit = new Date();
    limit.setDate(limit.getDate() - completedDays);

    let items = [];
    let pageToken = null;

    for (let i = 0; i < 10; i++) {
      const params = {
        tasklist: listId,
        showCompleted: true,
        showHidden: true,
        maxResults: 100
      };
      if (pageToken) params.pageToken = pageToken;

      const res = await gapi.client.tasks.tasks.list(params);
      items = items.concat(res.result.items || []);
      pageToken = res.result.nextPageToken;
      if (!pageToken) break;
    }

    return items.filter(t =>
      t.status !== 'completed' || !t.completed || new Date(t.completed) >= limit
    );
  });
}

// Crea un nuovo appunto (Google lo inserisce in cima alla lista)
async function addNote(title) {
  return withNotesList(async (listId) => {
    const res = await gapi.client.tasks.tasks.insert({
      tasklist: listId,
      resource: { title: title }
    });
    return res.result;
  });
}

// Modifica campi di un appunto (es. { title } oppure { status, completed })
async function updateNote(taskId, fields) {
  return withNotesList(async (listId) => {
    const res = await gapi.client.tasks.tasks.patch({
      tasklist: listId,
      task: taskId,
      resource: fields
    });
    return res.result;
  });
}

async function deleteNote(taskId) {
  return withNotesList(async (listId) => {
    await gapi.client.tasks.tasks.delete({
      tasklist: listId,
      task: taskId
    });
  });
}
