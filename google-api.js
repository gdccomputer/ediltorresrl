let tokenClient;
let gapiInited = false;
let gsisInited = false;

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
  if (gapiInited && gsisInited) {
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

// Recupera gli eventi nell'intervallo richiesto (default: -30 giorni, +100 giorni)
async function fetchCalendarEvents(pastDays = 30, futureDays = 100) {
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - pastDays);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + futureDays);

  const response = await gapi.client.calendar.events.list({
    'calendarId': 'primary',
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
    'calendarId': 'primary',
    'eventId': eventId,
    'resource': {
      'description': newDescription
    }
  });
  return response.result;
}