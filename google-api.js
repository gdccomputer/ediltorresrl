let tokenClient;
let gapiInited = false;
let gsisInited = false;

const TOKEN_KEY = 'gcal_token';

function gapiLoaded() {
  gapi.load('client', async () => {
    try {
      if (typeof CONFIG === 'undefined') throw new Error("config.js mancante");
      await gapi.client.init({
        apiKey: CONFIG.API_KEY,
        discoveryDocs: [CONFIG.DISCOVERY_DOC],
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
      scope: CONFIG.SCOPES,
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

/* ---------- Chiamate a Google Calendar ---------- */

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
