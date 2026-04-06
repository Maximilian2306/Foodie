/**
 * FOODIE — App Logic
 * ==================
 * Vanilla JS SPA für die private Rezeptsammlung.
 * Keine Abhängigkeiten, kein Framework.
 *
 * Architektur:
 *  1. Konfiguration & Konstanten
 *  2. Zustand (State)
 *  3. Hilfsfunktionen
 *  4. localStorage (Persistenz)
 *  5. Theme (Dark / Light)
 *  6. Bild-Verarbeitung (Upload & URL)
 *  7. Rendering (Grid, Detail, Formular)
 *  8. Event-Handler
 *  9. Navigation (Views wechseln)
 * 10. Import-Vorbereitung (Bonus — Struktur)
 * 11. Backup — Export & Import (JSON)
 * 12. Service Worker Registrierung
 * 13. App-Init
 */


/* ================================================
   1. KONFIGURATION & KONSTANTEN
   ================================================ */

const STORAGE_KEY   = 'foodie_recipes';    // localStorage-Schlüssel für Rezepte
const THEME_KEY     = 'foodie_theme';      // localStorage-Schlüssel für Theme
const MAX_IMG_PX    = 900;                 // Max. Bildbreite/-höhe beim Komprimieren
const IMG_QUALITY   = 0.82;               // JPEG-Qualität (0–1) für Base64-Speicherung
const TOAST_DURATION = 2800;              // Millisekunden bevor Toast verschwindet


/* ================================================
   2. APP-ZUSTAND (State)
   ================================================ */

let state = {
  recipes:         [],       // Array aller gespeicherten Rezepte
  currentRecipeId: null,     // ID des aktuell angezeigten Rezepts
  imageMode:       'upload', // 'upload' | 'url' — aktiver Bildmodus im Formular
  pendingDeleteId: null,     // ID des Rezepts, das gelöscht werden soll
};


/* ================================================
   3. HILFSFUNKTIONEN
   ================================================ */

/**
 * Generiert eine einfache eindeutige ID.
 * Kombination aus Timestamp und Zufallszahl.
 * @returns {string}
 */
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Gibt den aktuellen Zeitstempel als ISO-String zurück.
 * @returns {string}
 */
function now() {
  return new Date().toISOString();
}

/**
 * Escapet HTML-Zeichen um XSS zu vermeiden.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Zeigt eine kurze Toast-Benachrichtigung.
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Toast nach Wartezeit ausblenden und entfernen
  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, TOAST_DURATION);
}


/* ================================================
   4. LOCALSTORAGE (Persistenz)
   ================================================ */

/**
 * Lädt alle Rezepte aus dem localStorage.
 * Gibt leeres Array zurück, wenn keine vorhanden oder Fehler auftritt.
 * @returns {Array}
 */
function loadRecipes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('[Foodie] Fehler beim Laden der Rezepte:', err);
    return [];
  }
}

/**
 * Speichert das aktuelle Rezept-Array im localStorage.
 * Gibt true bei Erfolg, false bei Fehler (z.B. Speicherplatz voll) zurück.
 * @returns {boolean}
 */
function saveRecipes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.recipes));
    return true;
  } catch (err) {
    // QuotaExceededError: localStorage voll (häufig bei Base64-Bildern)
    if (err.name === 'QuotaExceededError') {
      showToast('Speicherplatz voll! Verwende eine Bild-URL statt Upload.', 'error');
    } else {
      console.error('[Foodie] Fehler beim Speichern:', err);
      showToast('Fehler beim Speichern.', 'error');
    }
    return false;
  }
}

/**
 * Gibt ein Rezept anhand seiner ID zurück.
 * @param {string} id
 * @returns {Object|undefined}
 */
function getRecipeById(id) {
  return state.recipes.find(r => r.id === id);
}

/**
 * Fügt ein neues Rezept hinzu und persistiert es.
 * @param {Object} recipe
 * @returns {boolean} Erfolg
 */
function addRecipe(recipe) {
  state.recipes = [recipe, ...state.recipes]; // Neuestes zuerst
  return saveRecipes();
}

/**
 * Löscht ein Rezept anhand der ID.
 * @param {string} id
 * @returns {boolean} Erfolg
 */
function deleteRecipe(id) {
  state.recipes = state.recipes.filter(r => r.id !== id);
  return saveRecipes();
}


/* ================================================
   5. THEME (Dark / Light)
   ================================================ */

/**
 * Liest das gespeicherte Theme aus dem localStorage.
 * Standard: 'dark'
 */
function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || 'dark';
  applyTheme(theme);
}

/**
 * Setzt das Theme an <html> und speichert es.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  // Meta-Theme-Color für Browser-UI anpassen
  const metaTheme = document.getElementById('meta-theme-color');
  if (metaTheme) {
    metaTheme.content = theme === 'dark' ? '#0D0D0B' : '#F5EFE6';
  }
}

/**
 * Wechselt zwischen Dark und Light Mode.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}


/* ================================================
   6. BILD-VERARBEITUNG
   ================================================ */

/**
 * Komprimiert und konvertiert eine Bilddatei zu Base64.
 * Skaliert das Bild auf MAX_IMG_PX herunter, um localStorage zu schonen.
 * @param {File} file
 * @returns {Promise<string>} Base64-Data-URL
 */
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    // Dateigröße prüfen (max. 5 MB vor Komprimierung)
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Datei zu groß (max. 5 MB)'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Ungültiges Bildformat'));
      img.onload = () => {
        // Canvas für Skalierung
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Proportional skalieren
        if (width > MAX_IMG_PX || height > MAX_IMG_PX) {
          if (width > height) {
            height = Math.round((height * MAX_IMG_PX) / width);
            width = MAX_IMG_PX;
          } else {
            width = Math.round((width * MAX_IMG_PX) / height);
            height = MAX_IMG_PX;
          }
        }

        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', IMG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}


/* ================================================
   7. RENDERING
   ================================================ */

// --- 7a. Startseite: Rezept-Grid ---

/**
 * Rendert das komplette Rezept-Grid auf der Startseite.
 */
function renderGrid() {
  const grid       = document.getElementById('recipe-grid');
  const emptyState = document.getElementById('empty-state');

  grid.innerHTML = '';

  if (state.recipes.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  state.recipes.forEach((recipe, index) => {
    const card = createRecipeCard(recipe, index);
    grid.appendChild(card);
  });
}

/**
 * Erstellt ein Rezept-Karten-Element.
 * @param {Object} recipe
 * @param {number} index — für CSS Stagger-Animation
 * @returns {HTMLElement}
 */
function createRecipeCard(recipe, index) {
  const card = document.createElement('article');
  card.className = 'recipe-card';
  card.style.setProperty('--card-index', index);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Rezept öffnen: ${recipe.name}`);
  card.dataset.id = recipe.id;

  if (recipe.image) {
    card.innerHTML = `
      <img class="card-img" src="${escHtml(recipe.image)}"
           alt="${escHtml(recipe.name)}" loading="lazy" />
      <div class="card-overlay" aria-hidden="true"></div>
      <h2 class="card-name">${escHtml(recipe.name)}</h2>
    `;
  } else {
    // Fallback ohne Bild
    card.innerHTML = `
      <div class="card-placeholder" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 32 32" fill="none" opacity="0.4">
          <path d="M9 4C9 4 9 13 13 15.5C17 18 17 13 17 9"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M13 15.5V28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M21 4V11C21 13.76 23.24 16 26 16V28"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="card-overlay" aria-hidden="true"></div>
      <h2 class="card-name">${escHtml(recipe.name)}</h2>
    `;
  }

  // Click & Keyboard-Handler
  card.addEventListener('click', () => showDetailView(recipe.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showDetailView(recipe.id);
    }
  });

  return card;
}

// --- 7b. Detailansicht ---

/**
 * Befüllt die Detailansicht mit den Daten des gegebenen Rezepts.
 * @param {string} id
 */
function renderDetail(id) {
  const recipe = getRecipeById(id);
  if (!recipe) return;

  // Bild
  const img = document.getElementById('detail-img');
  if (recipe.image) {
    img.src = recipe.image;
    img.alt = recipe.name;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }

  // Rezept-Name im Hero
  document.getElementById('detail-hero-name').textContent = recipe.name;

  // Rezept-Name im Header (gekürzt)
  document.getElementById('detail-heading').textContent = recipe.name;

  // Zutaten
  const ul = document.getElementById('detail-ingredients');
  ul.innerHTML = '';
  (recipe.ingredients || []).forEach(item => {
    if (!item.trim()) return;
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  });

  // Schritte
  const ol = document.getElementById('detail-steps');
  ol.innerHTML = '';
  (recipe.steps || []).forEach(step => {
    if (!step.trim()) return;
    const li = document.createElement('li');
    const p  = document.createElement('p');
    p.textContent = step;
    li.appendChild(p);
    ol.appendChild(li);
  });
}

// --- 7c. Formular-Hilfsfunktionen ---

/**
 * Fügt ein neues Zutaten-Eingabefeld zur dynamischen Liste hinzu.
 */
function addIngredientField() {
  const list  = document.getElementById('ingredients-list');
  const item  = document.createElement('div');
  item.className = 'list-item';
  item.innerHTML = `
    <input class="form-input list-input"
           type="text" placeholder="z.B. 1 TL Salz" />
    <button type="button" class="btn-remove" aria-label="Zutat entfernen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;
  list.appendChild(item);
  item.querySelector('input').focus();
  attachRemoveHandler(item);
}

/**
 * Fügt ein neues Schritt-Eingabefeld zur dynamischen Liste hinzu.
 */
function addStepField() {
  const list  = document.getElementById('steps-list');
  const count = list.querySelectorAll('.list-item').length + 1;
  const item  = document.createElement('div');
  item.className = 'list-item list-item--step';
  item.innerHTML = `
    <span class="step-number" aria-hidden="true">${count}</span>
    <textarea class="form-input form-textarea list-input"
              placeholder="Schritt ${count} beschreiben …"
              rows="2"></textarea>
    <button type="button" class="btn-remove" aria-label="Schritt entfernen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;
  list.appendChild(item);
  item.querySelector('textarea').focus();
  attachRemoveHandler(item);
}

/**
 * Hängt den Entfernen-Handler an ein Listen-Item.
 * @param {HTMLElement} item
 */
function attachRemoveHandler(item) {
  const btn = item.querySelector('.btn-remove');
  btn.addEventListener('click', () => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(-8px)';
    item.style.transition = 'opacity 200ms, transform 200ms';
    setTimeout(() => {
      item.remove();
      updateStepNumbers(); // Schritt-Nummern neu berechnen
    }, 200);
  });
}

/**
 * Aktualisiert die Schritt-Nummern nach dem Entfernen eines Schritts.
 */
function updateStepNumbers() {
  const steps = document.querySelectorAll('#steps-list .step-number');
  steps.forEach((el, i) => {
    el.textContent = i + 1;
  });
}

/**
 * Registriert Entfernen-Handler für alle initial gerenderten Listen-Items.
 */
function attachInitialRemoveHandlers() {
  document.querySelectorAll('#ingredients-list .list-item, #steps-list .list-item').forEach(attachRemoveHandler);
}

/**
 * Setzt das Formular auf den Ausgangszustand zurück.
 */
function resetForm() {
  document.getElementById('form-add').reset();

  // Zutaten auf 1 Feld zurücksetzen
  const ingList = document.getElementById('ingredients-list');
  ingList.innerHTML = `
    <div class="list-item">
      <input class="form-input list-input" type="text" placeholder="z.B. 200 g Spaghetti" />
      <button type="button" class="btn-remove" aria-label="Zutat entfernen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;

  // Schritte auf 1 Feld zurücksetzen
  const stpList = document.getElementById('steps-list');
  stpList.innerHTML = `
    <div class="list-item list-item--step">
      <span class="step-number" aria-hidden="true">1</span>
      <textarea class="form-input form-textarea list-input"
                placeholder="Schritt 1 beschreiben …" rows="2"></textarea>
      <button type="button" class="btn-remove" aria-label="Schritt entfernen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;

  attachInitialRemoveHandlers();

  // Bild-Vorschau zurücksetzen
  const preview = document.getElementById('drop-preview');
  const content = document.getElementById('drop-zone-content');
  preview.classList.add('hidden');
  content.style.display = '';
  preview.src = '';

  // URL-Eingabe leeren
  document.getElementById('input-image-url').value = '';

  // Upload-Modus aktivieren
  setImageMode('upload');
}


/* ================================================
   8. EVENT-HANDLER
   ================================================ */

// --- 8a. Theme-Toggle ---

document.getElementById('btn-theme').addEventListener('click', toggleTheme);

// --- 8b. "+ Neu"-Button → Modal öffnen ---

document.getElementById('btn-add').addEventListener('click', openAddModal);

// --- 8c. Modal schließen ---

document.getElementById('btn-close-modal').addEventListener('click', closeAddModal);

// Backdrop-Klick schließt Modal
document.getElementById('modal-add').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAddModal();
});

// Escape-Taste schließt Modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!document.getElementById('modal-confirm').classList.contains('hidden')) {
      closeConfirmDialog();
    } else if (!document.getElementById('modal-add').classList.contains('hidden')) {
      closeAddModal();
    }
  }
});

// --- 8d. Bild-Toggle (Upload / URL) ---

document.getElementById('toggle-upload').addEventListener('click', () => setImageMode('upload'));
document.getElementById('toggle-url').addEventListener('click', () => setImageMode('url'));

/**
 * Wechselt den aktiven Bild-Eingabemodus.
 * @param {'upload'|'url'} mode
 */
function setImageMode(mode) {
  state.imageMode = mode;
  const btnUpload = document.getElementById('toggle-upload');
  const btnUrl    = document.getElementById('toggle-url');
  const secUpload = document.getElementById('section-upload');
  const secUrl    = document.getElementById('section-url');

  if (mode === 'upload') {
    btnUpload.classList.add('active');
    btnUrl.classList.remove('active');
    secUpload.classList.remove('hidden');
    secUrl.classList.add('hidden');
  } else {
    btnUrl.classList.add('active');
    btnUpload.classList.remove('active');
    secUrl.classList.remove('hidden');
    secUpload.classList.add('hidden');
  }
}

// --- 8e. Datei-Upload (Drop-Zone) ---

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('input-image-file');

// Klick auf Drop-Zone → Datei-Dialog
dropZone.addEventListener('click', () => fileInput.click());

// Datei ausgewählt
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await handleFileSelected(file);
});

// Drag & Drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    await handleFileSelected(file);
  }
});

/**
 * Verarbeitet eine ausgewählte Bilddatei und zeigt die Vorschau.
 * @param {File} file
 */
async function handleFileSelected(file) {
  try {
    const base64 = await processImageFile(file);
    const preview = document.getElementById('drop-preview');
    const content = document.getElementById('drop-zone-content');
    preview.src = base64;
    preview.classList.remove('hidden');
    content.style.display = 'none';
  } catch (err) {
    showToast(err.message || 'Bild konnte nicht geladen werden.', 'error');
  }
}

// --- 8f. Dynamische Listen ---

document.getElementById('btn-add-ingredient').addEventListener('click', addIngredientField);
document.getElementById('btn-add-step').addEventListener('click', addStepField);

// --- 8g. Formular absenden ---

document.getElementById('form-add').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nameInput = document.getElementById('input-name');
  const name = nameInput.value.trim();

  // Validierung
  if (!name) {
    nameInput.classList.add('invalid');
    nameInput.focus();
    showToast('Bitte gib einen Namen ein.', 'error');
    return;
  }
  nameInput.classList.remove('invalid');

  // Zutaten sammeln (leere Felder überspringen)
  const ingredients = Array.from(
    document.querySelectorAll('#ingredients-list .list-input')
  ).map(el => el.value.trim()).filter(Boolean);

  // Schritte sammeln
  const steps = Array.from(
    document.querySelectorAll('#steps-list .list-input')
  ).map(el => el.value.trim()).filter(Boolean);

  // Bild bestimmen
  let image = '';
  if (state.imageMode === 'url') {
    image = document.getElementById('input-image-url').value.trim();
  } else {
    const preview = document.getElementById('drop-preview');
    image = preview.classList.contains('hidden') ? '' : preview.src;
  }

  // Speichern-Button deaktivieren während Speicherung
  const submitBtn = document.querySelector('.btn-submit');
  submitBtn.disabled = true;

  // Rezept-Objekt erstellen
  const recipe = {
    id:          generateId(),
    name,
    ingredients,
    steps,
    image,
    createdAt:   now(),
  };

  const success = addRecipe(recipe);
  submitBtn.disabled = false;

  if (success) {
    closeAddModal();
    renderGrid();
    showToast(`"${name}" gespeichert!`, 'success');
  }
});

// Ungültig-Markierung beim Tippen entfernen
document.getElementById('input-name').addEventListener('input', (e) => {
  e.target.classList.remove('invalid');
});

// --- 8h. Löschen-Button (in Detailansicht) ---

document.getElementById('btn-delete').addEventListener('click', () => {
  if (state.currentRecipeId) {
    openConfirmDialog(state.currentRecipeId);
  }
});

// Löschen bestätigen
document.getElementById('btn-confirm-delete').addEventListener('click', () => {
  const recipe = getRecipeById(state.pendingDeleteId);
  const name   = recipe ? recipe.name : 'Rezept';

  deleteRecipe(state.pendingDeleteId);
  closeConfirmDialog();
  showHomeView();
  renderGrid();
  showToast(`"${name}" gelöscht.`, 'info');
  state.pendingDeleteId = null;
});

// Löschen abbrechen
document.getElementById('btn-cancel-delete').addEventListener('click', closeConfirmDialog);
document.getElementById('modal-confirm').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeConfirmDialog();
});

// --- 8i. Zurück-Button ---

document.getElementById('btn-back').addEventListener('click', showHomeView);


/* ================================================
   9. NAVIGATION (Views wechseln)
   ================================================ */

/**
 * Zeigt die Detailansicht für ein Rezept.
 * @param {string} id
 */
function showDetailView(id) {
  state.currentRecipeId = id;
  renderDetail(id);

  // Views tauschen
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-detail').classList.remove('hidden');

  // Header-Elemente anpassen
  document.getElementById('app-logo').classList.add('hidden');
  document.getElementById('detail-heading').classList.remove('hidden');
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-delete').classList.remove('hidden');

  // Zum Seitenanfang scrollen
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Zeigt die Startseite (Übersicht).
 */
function showHomeView() {
  state.currentRecipeId = null;

  // Views tauschen
  document.getElementById('view-detail').classList.add('hidden');
  document.getElementById('view-home').classList.remove('hidden');

  // Header-Elemente zurücksetzen
  document.getElementById('app-logo').classList.remove('hidden');
  document.getElementById('detail-heading').classList.add('hidden');
  document.getElementById('btn-back').classList.add('hidden');
  document.getElementById('btn-delete').classList.add('hidden');

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Öffnet das "Neues Rezept"-Modal.
 */
function openAddModal() {
  const modal = document.getElementById('modal-add');
  modal.classList.remove('hidden');
  // Fokus auf erstes Eingabefeld setzen
  setTimeout(() => {
    document.getElementById('input-name').focus();
  }, 350);
  // Body-Scroll sperren
  document.body.style.overflow = 'hidden';
}

/**
 * Schließt das "Neues Rezept"-Modal mit Slide-Out-Animation.
 */
function closeAddModal() {
  const modal = document.getElementById('modal-add');
  modal.classList.add('closing');
  modal.addEventListener('animationend', () => {
    modal.classList.remove('closing');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    resetForm();
  }, { once: true });
}

/**
 * Öffnet den Bestätigungs-Dialog zum Löschen.
 * @param {string} id
 */
function openConfirmDialog(id) {
  state.pendingDeleteId = id;
  document.getElementById('modal-confirm').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Schließt den Bestätigungs-Dialog.
 */
function closeConfirmDialog() {
  document.getElementById('modal-confirm').classList.add('hidden');
  document.body.style.overflow = '';
}


/* ================================================
   10. IMPORT-VORBEREITUNG (Bonus — Struktur)
   ================================================ */

/**
 * [VORBEREITUNG — noch nicht implementiert]
 *
 * Importiert ein Rezept von einer externen URL.
 * Mögliche spätere Implementierung:
 *  - Fetch der HTML-Seite
 *  - Parsen von structured data (JSON-LD, schema.org/Recipe)
 *  - Fallback: Heuristisches Parsen von Zutaten/Schritten
 *
 * @param {string} url — URL der Rezept-Seite
 * @returns {Promise<Object>} Rezept-Objekt
 */
async function importFromUrl(url) {
  // TODO: Implementierung mit CORS-Proxy oder eigener Backend-API
  //
  // Beispiel-Struktur für schema.org/Recipe Parsing:
  // const response = await fetch(`/api/parse?url=${encodeURIComponent(url)}`);
  // const data     = await response.json();
  //
  // Erwartetes Format:
  // {
  //   name:        string,
  //   ingredients: string[],
  //   steps:       string[],
  //   image:       string (URL),
  // }
  //
  // return data;

  throw new Error('Import-Funktion noch nicht implementiert.');
}

// Exportiere für mögliche spätere Nutzung (kein Module-System nötig)
window.Foodie = { importFromUrl };


/* ================================================
   11. BACKUP — EXPORT & IMPORT
   ================================================ */

// Zwischengespeicherte Import-Daten (warten auf Bestätigung)
let pendingImportData = null;

// ---- 11a. Export ----

/**
 * Exportiert alle Rezepte als JSON-Datei (foodie-backup.json).
 * Verwendet Blob + temporäres <a>-Element für den Download.
 */
function exportBackup() {
  if (state.recipes.length === 0) {
    showToast('Keine Rezepte zum Exportieren.', 'error');
    return;
  }

  const payload = {
    version:   1,                         // Schema-Version für spätere Kompatibilität
    exportedAt: new Date().toISOString(),
    count:     state.recipes.length,
    recipes:   state.recipes,
  };

  const json  = JSON.stringify(payload, null, 2);
  const blob  = new Blob([json], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);

  // Temporäres Link-Element — triggert nativen Download-Dialog
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = 'foodie-backup.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Objekt-URL freigeben (Speicher)
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(`Backup mit ${state.recipes.length} Rezept(en) erstellt.`, 'success');
}

// ---- 11b. Import ----

/**
 * Liest eine JSON-Datei mit FileReader und startet den Validierungs-Flow.
 * @param {File} file
 */
function handleImportFile(file) {
  if (!file) return;

  const reader = new FileReader();

  reader.onerror = () => {
    showToast('Datei konnte nicht gelesen werden.', 'error');
  };

  reader.onload = (e) => {
    let parsed;

    // 1. JSON-Syntax prüfen
    try {
      parsed = JSON.parse(e.target.result);
    } catch {
      showToast('Ungültige JSON-Datei. Bitte prüfe die Datei.', 'error');
      return;
    }

    // 2. Inhalt validieren
    const result = validateBackupData(parsed);
    if (!result.valid) {
      showToast(`Import fehlgeschlagen: ${result.error}`, 'error');
      return;
    }

    // 3. Bestätigungs-Dialog öffnen
    pendingImportData = result.recipes;
    openImportConfirm(result.recipes.length);
  };

  reader.readAsText(file, 'utf-8');
}

/**
 * Prüft ob importierte Daten ein gültiges Foodie-Backup sind.
 * Unterstützt zwei Formate:
 *  - Altes Format: direktes Array von Rezepten []
 *  - Neues Format: { version, recipes: [] }
 *
 * @param {any} data
 * @returns {{ valid: boolean, recipes?: Array, error?: string }}
 */
function validateBackupData(data) {
  let recipes;

  // Format erkennen
  if (Array.isArray(data)) {
    // Direkt ein Array (ältere Exporte ohne Wrapper)
    recipes = data;
  } else if (data && typeof data === 'object' && Array.isArray(data.recipes)) {
    // Neues Format mit Wrapper-Objekt
    recipes = data.recipes;
  } else {
    return { valid: false, error: 'Kein gültiges Foodie-Backup-Format.' };
  }

  if (recipes.length === 0) {
    return { valid: false, error: 'Die Backup-Datei enthält keine Rezepte.' };
  }

  // Jedes Rezept muss mindestens id und name haben
  const invalid = recipes.filter(r => !r || typeof r.name !== 'string' || !r.name.trim());
  if (invalid.length > 0) {
    return {
      valid: false,
      error: `${invalid.length} Einträge ohne gültigen Namen gefunden.`,
    };
  }

  // Fehlende IDs ergänzen (Kompatibilität mit manuell erstellten Backups)
  recipes = recipes.map(r => ({
    ...r,
    id:          r.id || generateId(),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps:       Array.isArray(r.steps)       ? r.steps       : [],
    image:       typeof r.image === 'string'  ? r.image       : '',
    createdAt:   r.createdAt || now(),
  }));

  return { valid: true, recipes };
}

/**
 * Führt den Import durch: überschreibt localStorage mit den importierten Daten.
 */
function executeImport() {
  if (!pendingImportData) return;

  state.recipes   = pendingImportData;
  pendingImportData = null;

  const success = saveRecipes();
  if (success) {
    closeImportConfirm();
    closeSettingsModal();
    renderGrid();
    showToast(`${state.recipes.length} Rezept(e) erfolgreich importiert.`, 'success');
  }
}

// ---- 11c. Settings-Modal (Öffnen / Schließen) ----

/**
 * Öffnet das Settings-Modal und aktualisiert die Statistiken.
 */
function openSettingsModal() {
  // Statistiken aktualisieren
  document.getElementById('stat-recipe-count').textContent = state.recipes.length;
  document.getElementById('stat-storage-size').textContent = getStorageSize();

  const modal = document.getElementById('modal-settings');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Schließt das Settings-Modal mit Animation.
 */
function closeSettingsModal() {
  const modal = document.getElementById('modal-settings');
  modal.classList.add('closing');
  modal.addEventListener('animationend', () => {
    modal.classList.remove('closing');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }, { once: true });
}

/**
 * Öffnet den Import-Bestätigungs-Dialog.
 * @param {number} count — Anzahl der zu importierenden Rezepte
 */
function openImportConfirm(count) {
  const existing = state.recipes.length;
  const text     = existing > 0
    ? `${count} Rezept(e) werden importiert. Deine ${existing} bestehenden Gerichte werden dabei überschrieben.`
    : `${count} Rezept(e) werden importiert.`;

  document.getElementById('import-confirm-text').textContent = text;
  document.getElementById('modal-import-confirm').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Schließt den Import-Bestätigungs-Dialog.
 */
function closeImportConfirm() {
  document.getElementById('modal-import-confirm').classList.add('hidden');
  if (document.getElementById('modal-settings').classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
  pendingImportData = null;
}

/**
 * Berechnet die grobe Größe des localStorage-Eintrags für Rezepte.
 * @returns {string} Lesbare Größenangabe (z.B. "1.2 MB")
 */
function getStorageSize() {
  try {
    const raw   = localStorage.getItem(STORAGE_KEY) || '';
    const bytes = new Blob([raw]).size;
    if (bytes < 1024)       return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return '–';
  }
}

// ---- 11d. Event-Handler für Backup-UI ----

// Settings öffnen / schließen
document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-close-settings').addEventListener('click', closeSettingsModal);
document.getElementById('modal-settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettingsModal();
});

// Export
document.getElementById('btn-export').addEventListener('click', exportBackup);

// Import: Button → File-Input öffnen
document.getElementById('btn-import-trigger').addEventListener('click', () => {
  // Input zurücksetzen, damit derselbe Dateiname nochmals ausgewählt werden kann
  const input = document.getElementById('input-backup-file');
  input.value = '';
  input.click();
});

// Datei ausgewählt → verarbeiten
document.getElementById('input-backup-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
});

// Import bestätigen
document.getElementById('btn-confirm-import').addEventListener('click', executeImport);

// Import abbrechen
document.getElementById('btn-cancel-import').addEventListener('click', closeImportConfirm);
document.getElementById('modal-import-confirm').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeImportConfirm();
});


/* ================================================
   12. SERVICE WORKER REGISTRIERUNG
   ================================================ */

/**
 * Registriert den Service Worker für Offline-Unterstützung.
 * Nur in sicheren Kontexten (HTTPS oder localhost).
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    console.log('[Foodie] Service Worker registriert:', registration.scope);
  } catch (err) {
    console.warn('[Foodie] Service Worker Registrierung fehlgeschlagen:', err);
  }
}


/* ================================================
   12. APP-INIT
   ================================================ */

/**
 * Initialisiert die App:
 *  1. Theme laden
 *  2. Rezepte aus localStorage laden
 *  3. Grid rendern
 *  4. Initiale Event-Handler anknüpfen
 *  5. Service Worker registrieren
 */
function init() {
  // Theme zuerst setzen (verhindert FOUC)
  loadTheme();

  // Rezepte laden und rendern
  state.recipes = loadRecipes();
  renderGrid();

  // Entfernen-Handler für initiale Formular-Items
  attachInitialRemoveHandlers();

  // Service Worker
  registerServiceWorker();

  // URL-Parameter prüfen (z.B. Manifest-Shortcut "?action=add")
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'add') {
    setTimeout(openAddModal, 400); // kurz warten bis UI gerendert ist
  }

  console.log(`[Foodie] App gestartet. ${state.recipes.length} Rezept(e) geladen.`);
}

// App starten
init();
