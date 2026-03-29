const CSV_URL_PRINCIPAL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQrEioDH380tYWFuP8n5SbwmR5Unna2_VihZoXnnGGy_EJkLqXayze7minaMa-RxsN0itoEEjuVD4eM/pub?output=csv&gid=0";

const BIBLIOTECA_NACIONAL_URL = "https://www.bn.gob.ar/";
const BIBLIOTECA_DEL_MAESTRO_URL = "https://www.argentina.gob.ar/educacion/bnm";
const DEFAULT_SECTION_VIEW = "cursos";
const INITIAL_MATERIAS_MESSAGE =
  "Selecciona un curso para cargar sus materias y enlaces disponibles.";

const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "na",
  "n a",
  "n/a",
  "none",
  "null",
  "undefined",
  "empty",
  "empyty",
  "sin enlace",
  "sin enlace disponible",
  "no hay enlace",
]);

const ALIAS_COLUMNAS = {
  curso: ["curso"],
  seccion: ["seccion"],
  materia: ["materia"],
  linkClassroom: [
    "link classroom",
    "linkclassroom",
    "link de classroom",
    "classroom",
    "aula classroom",
  ],
  codigoClassroom: [
    "codigo del classroom",
    "codigodelclassroom",
    "codigo classroom",
    "codigoclassroom",
    "codigo",
  ],
  linkContinuidad: [
    "link continuidad pedagogica",
    "link continuidad",
    "continuidad pedagogica",
    "link de continuidad",
    "link drive",
    "linkdrive",
    "drive",
    "carpeta drive",
    "link carpeta",
  ],
};

const state = {
  materiasData: [],
  cursos: [],
  selected: null,
  updateTimer: null,
  catalogo: Array.isArray(window.catalogoBiblioteca) ? window.catalogoBiblioteca : [],
};

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  inicializarLayoutEstatico();
  inicializarVistaSecciones();
  inicializarBuscadorCatalogo();
  mostrarEstadoVacio();
  restaurarBloqueInicial();
  inicializarDatos();
});

async function inicializarDatos() {
  setStatus("Cargando cursos y materias...", "warn");

  try {
    const filas = await cargarCSV(CSV_URL_PRINCIPAL);
    state.materiasData = normalizarColumnas(filas);
  } catch (_error) {
    state.materiasData = [];
    renderBotonesCursos([]);
    mostrarErrorCarga("No se pudo cargar la hoja principal. Revisa conexion o permisos del CSV.");
    return;
  }

  state.cursos = obtenerCursosSeccionesUnicos(state.materiasData);
  renderBotonesCursos(state.cursos);

  if (!state.cursos.length) {
    setStatus("La hoja principal cargo, pero no hay cursos validos para mostrar.", "warn");
    return;
  }

  setStatus(`Datos cargados correctamente. ${state.cursos.length} cursos disponibles.`, "ok");
}

async function cargarCSV(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`);
  }

  const csvRaw = await response.text();
  if (!csvRaw.trim()) {
    return [];
  }

  return new Promise((resolve, reject) => {
    Papa.parse(csvRaw, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        const filas = Array.isArray(result.data) ? result.data : [];
        if (result.errors?.length && filas.length === 0) {
          reject(new Error("No se pudo parsear el CSV."));
          return;
        }
        resolve(filas);
      },
      error: (error) => reject(error),
    });
  });
}

function normalizarColumnas(filas) {
  // Se normalizan encabezados para tolerar tildes, mayusculas y espacios.
  return filas
    .map((fila) => {
      const filaNormalizada = {};
      for (const [clave, valor] of Object.entries(fila || {})) {
        const claveNormalizada = normalizarClave(clave);
        if (!claveNormalizada) {
          continue;
        }
        filaNormalizada[claveNormalizada] = limpiarTexto(valor);
      }

      return {
        curso: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.curso),
        seccion: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.seccion),
        materia: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.materia),
        linkClassroom: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.linkClassroom),
        codigoClassroom: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.codigoClassroom),
        linkContinuidad: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.linkContinuidad),
      };
    })
    .filter((fila) =>
      Object.values(fila).some((valor) => typeof valor === "string" && valor.length > 0),
    );
}

function extraerCampo(filaNormalizada, alias) {
  for (const clave of alias) {
    const claveNormalizada = normalizarClave(clave);
    const valor = filaNormalizada[claveNormalizada];
    if (valor) {
      return valor;
    }
  }
  return "";
}

function obtenerCursosSeccionesUnicos(data) {
  const mapaUnicos = new Map();

  for (const fila of data) {
    const curso = limpiarTexto(fila.curso);
    const seccion = limpiarTexto(fila.seccion);
    if (!curso || !seccion) {
      continue;
    }
    const key = `${curso}||${seccion}`;
    if (!mapaUnicos.has(key)) {
      mapaUnicos.set(key, { curso, seccion });
    }
  }

  return [...mapaUnicos.values()].sort(compararCursoSeccion);
}

function compararCursoSeccion(a, b) {
  const numeroCursoA = extraerPrimerNumero(a.curso);
  const numeroCursoB = extraerPrimerNumero(b.curso);
  if (numeroCursoA !== numeroCursoB) {
    return numeroCursoA - numeroCursoB;
  }

  const numeroSeccionA = extraerPrimerNumero(a.seccion);
  const numeroSeccionB = extraerPrimerNumero(b.seccion);
  if (numeroSeccionA !== numeroSeccionB) {
    return numeroSeccionA - numeroSeccionB;
  }

  return `${a.curso} ${a.seccion}`.localeCompare(`${b.curso} ${b.seccion}`, "es", {
    sensitivity: "base",
  });
}

function extraerPrimerNumero(texto) {
  const match = String(texto || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function renderBotonesCursos(cursos) {
  dom.coursesContainer.textContent = "";

  if (!cursos.length) {
    const vacio = document.createElement("p");
    vacio.className = "empty-message";
    vacio.textContent = "No hay cursos disponibles para mostrar por el momento.";
    dom.coursesContainer.append(vacio);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of cursos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "course-btn";
    button.dataset.curso = item.curso;
    button.dataset.seccion = item.seccion;
    button.setAttribute("aria-label", `Seleccionar ${item.curso} ${item.seccion}`);

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-layer-group";
    const texto = document.createElement("span");
    texto.textContent = `${item.curso} ${item.seccion}`;

    button.append(icon, texto);
    button.addEventListener("click", () => seleccionarCursoSeccion(item.curso, item.seccion));
    fragment.append(button);
  }

  dom.coursesContainer.append(fragment);
}

function seleccionarCursoSeccion(curso, seccion) {
  state.selected = { curso, seccion };
  aplicarFiltroSeccionSeleccionada(curso, seccion);

  dom.resultsSection.classList.add("is-updating");
  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
  }

  state.updateTimer = window.setTimeout(() => {
    const totalMaterias = renderMateriasCurso(curso, seccion);
    dom.selectedCourseTitle.textContent = `Curso seleccionado: ${curso} ${seccion}`;
    dom.selectedCourseCount.textContent = `Resultados: ${totalMaterias} materias para este curso.`;
    dom.resultsSection.classList.remove("is-updating");
    dom.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

function aplicarFiltroSeccionSeleccionada(curso, seccion) {
  document.querySelectorAll(".course-btn").forEach((button) => {
    const activo = button.dataset.curso === curso && button.dataset.seccion === seccion;
    button.classList.toggle("active", activo);
  });
}

function renderMateriasCurso(curso, seccion) {
  const coincidencias = state.materiasData.filter((fila) => coincideCursoSeccion(fila, curso, seccion));
  dom.materiasResults.textContent = "";

  if (!coincidencias.length) {
    dom.materiasResults.append(crearMensajeVacio("No hay materias disponibles para este curso."));
    return 0;
  }

  const fragment = document.createDocumentFragment();

  for (const fila of coincidencias) {
    const urlClassroom = construirUrlClassroom(fila.linkClassroom, fila.codigoClassroom);
    const urlContinuidad = construirEnlaceSeguro(fila.linkContinuidad);
    const card = crearCardMateria({
      materia: fila.materia,
      curso: fila.curso,
      seccion: fila.seccion,
      urlClassroom,
      urlContinuidad,
    });
    fragment.append(card);
  }

  dom.materiasResults.append(fragment);
  return coincidencias.length;
}

function crearCardMateria({ materia, curso, seccion, urlClassroom, urlContinuidad }) {
  const card = document.createElement("article");
  card.className = "card-item";

  const title = document.createElement("h5");
  title.textContent = capitalizarPrimeraLetra(materia) || "Materia sin nombre";

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${curso || "Curso no indicado"} · ${seccion || "Seccion no indicada"}`;

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    crearAccionMateria({
      url: urlClassroom,
      label: "Abrir Classroom",
      emptyLabel: "Sin Classroom",
      iconClass: "fa-solid fa-chalkboard-user",
    }),
  );
  actions.append(
    crearAccionMateria({
      url: urlContinuidad,
      label: "Abrir continuidad",
      emptyLabel: "Sin continuidad",
      iconClass: "fa-solid fa-folder-open",
      tone: "secondary",
    }),
  );

  card.append(title, meta, actions);
  return card;
}

function crearAccionMateria({ url, label, emptyLabel, iconClass, tone = "" }) {
  const action = document.createElement(url ? "a" : "span");
  action.className = `card-action${tone ? ` ${tone}` : ""}${url ? "" : " disabled"}`;

  if (url) {
    action.href = url;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
  }

  const icon = document.createElement("i");
  icon.className = iconClass;
  action.append(icon, document.createTextNode(url ? label : emptyLabel));
  return action;
}

function crearMensajeVacio(mensaje) {
  const text = document.createElement("p");
  text.className = "empty-message";
  text.textContent = mensaje;
  return text;
}

function coincideCursoSeccion(fila, curso, seccion) {
  return (
    normalizarBusqueda(fila.curso) === normalizarBusqueda(curso) &&
    normalizarBusqueda(fila.seccion) === normalizarBusqueda(seccion)
  );
}

function construirUrlClassroom(linkClassroom, codigoClassroom) {
  const linkDirecto = construirEnlaceSeguro(linkClassroom);
  if (linkDirecto) {
    return linkDirecto;
  }

  const codigo = limpiarTexto(codigoClassroom);
  if (!codigo) {
    return "";
  }

  return construirEnlaceSeguro(`https://classroom.google.com/c/${encodeURIComponent(codigo)}`);
}

function construirEnlaceSeguro(rawUrl) {
  const url = limpiarTexto(rawUrl);
  if (!url) {
    return "";
  }

  const normalizada = normalizarBusqueda(url);
  if (PLACEHOLDER_VALUES.has(normalizada)) {
    return "";
  }

  if (!/^https?:\/\//i.test(url)) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch (_error) {
    return "";
  }
}

function inicializarBuscadorCatalogo() {
  const ejecutarBusqueda = () => {
    const termino = dom.catalogSearchInput.value.trim();
    if (!termino) {
      dom.catalogSearchHint.textContent = "Escribi una palabra clave para explorar el catalogo.";
      dom.catalogResults.textContent = "";
      return;
    }

    const resultados = buscarEnCatalogo(termino);
    renderResultadosCatalogo(resultados, termino);
  };

  dom.catalogSearchButton.addEventListener("click", ejecutarBusqueda);
  dom.catalogSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      ejecutarBusqueda();
    }
  });
}

function buscarEnCatalogo(termino) {
  const needle = normalizarBusqueda(termino);
  if (!needle) {
    return [];
  }

  return state.catalogo.filter((item) => {
    const campos = [item.titulo, item.autor, item.categoria, item.descripcion];
    return campos.some((campo) => normalizarBusqueda(campo).includes(needle));
  });
}

function renderResultadosCatalogo(resultados, termino) {
  dom.catalogResults.textContent = "";
  dom.catalogSearchHint.textContent = `Busqueda: "${termino}" (${resultados.length} resultados)`;

  if (!resultados.length) {
    dom.catalogResults.append(crearMensajeVacio("No encontramos coincidencias. Proba con otro termino."));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of resultados) {
    const card = document.createElement("article");
    card.className = "card-item";

    const title = document.createElement("h5");
    title.textContent = item.titulo || "Titulo sin definir";

    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = `${item.autor || "Autor no informado"} · ${item.categoria || "Categoria general"}`;

    const description = document.createElement("p");
    description.className = "card-meta";
    description.textContent = item.descripcion || "Sin descripcion disponible.";

    card.append(title, meta, description);

    const enlace = construirEnlaceSeguro(item.enlace);
    if (enlace) {
      const action = document.createElement("a");
      action.className = "card-action";
      action.href = enlace;
      action.target = "_blank";
      action.rel = "noopener noreferrer";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-arrow-up-right-from-square";
      action.append(icon, document.createTextNode("Ver recurso"));

      card.append(action);
    }

    fragment.append(card);
  }

  dom.catalogResults.append(fragment);
}

function mostrarEstadoVacio() {
  dom.selectedCourseTitle.textContent = "Selecciona un curso para ver sus aulas y materiales";
  dom.selectedCourseCount.textContent =
    "Cuando elijas una combinacion de curso y seccion, apareceran los resultados aqui.";
}

function restaurarBloqueInicial() {
  dom.materiasResults.textContent = "";
  dom.materiasResults.append(crearMensajeVacio(INITIAL_MATERIAS_MESSAGE));
}

function mostrarErrorCarga(mensaje) {
  setStatus(mensaje, "error");
}

function inicializarVistaSecciones() {
  dom.viewTriggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      const view = trigger.dataset.view;
      if (!view) {
        return;
      }

      event.preventDefault();
      mostrarVistaSeccion(view, true);
    });
  });

  mostrarVistaSeccion(DEFAULT_SECTION_VIEW, false);
}

function mostrarVistaSeccion(view, smoothScroll) {
  let primerPanelVisible = null;

  dom.viewPanels.forEach((panel) => {
    const visible = panel.dataset.viewPanel === view;
    panel.hidden = !visible;
    if (visible && !primerPanelVisible) {
      primerPanelVisible = panel;
    }
  });

  if (smoothScroll && primerPanelVisible) {
    primerPanelVisible.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setStatus(texto, tipo) {
  dom.dataStatus.textContent = texto || "";
  dom.dataStatus.classList.remove("error", "warn", "ok");
  if (tipo) {
    dom.dataStatus.classList.add(tipo);
  }
}

function inicializarLayoutEstatico() {
  dom.year.textContent = new Date().getFullYear();

  dom.linkBibliotecaNacional.href = BIBLIOTECA_NACIONAL_URL;
  dom.linkBibliotecaMaestro.href = BIBLIOTECA_DEL_MAESTRO_URL;
  dom.footerBnLink.href = BIBLIOTECA_NACIONAL_URL;
  dom.footerBnmLink.href = BIBLIOTECA_DEL_MAESTRO_URL;

  dom.menuToggle.addEventListener("click", () => {
    const abierto = dom.mainNav.classList.toggle("open");
    dom.menuToggle.setAttribute("aria-expanded", String(abierto));
  });

  dom.mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      dom.mainNav.classList.remove("open");
      dom.menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

function cacheDom() {
  dom.menuToggle = document.getElementById("menu-toggle");
  dom.mainNav = document.getElementById("main-nav");

  dom.catalogSearchInput = document.getElementById("catalog-search-input");
  dom.catalogSearchButton = document.getElementById("catalog-search-button");
  dom.catalogSearchHint = document.getElementById("catalog-search-hint");
  dom.catalogResults = document.getElementById("catalog-results");

  dom.dataStatus = document.getElementById("data-status");
  dom.coursesContainer = document.getElementById("courses-container");

  dom.resultsSection = document.getElementById("resultados-curso");
  dom.selectedCourseTitle = document.getElementById("selected-course-title");
  dom.selectedCourseCount = document.getElementById("selected-course-count");
  dom.materiasResults = document.getElementById("materias-results");

  dom.linkBibliotecaNacional = document.getElementById("link-biblioteca-nacional");
  dom.linkBibliotecaMaestro = document.getElementById("link-biblioteca-maestro");
  dom.footerBnLink = document.getElementById("footer-bn-link");
  dom.footerBnmLink = document.getElementById("footer-bnm-link");
  dom.year = document.getElementById("year");

  dom.viewTriggers = document.querySelectorAll(".view-trigger[data-view]");
  dom.viewPanels = document.querySelectorAll("[data-view-panel]");
}

function limpiarTexto(valor) {
  const limpio = String(valor ?? "").replace(/\uFEFF/g, "").trim();
  if (!limpio) {
    return "";
  }

  const normalizado = normalizarBusqueda(limpio);
  return PLACEHOLDER_VALUES.has(normalizado) ? "" : limpio;
}

function normalizarClave(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizarBusqueda(texto) {
  return normalizarClave(texto).replace(/\s+/g, " ");
}

function capitalizarPrimeraLetra(texto) {
  const limpio = limpiarTexto(texto);
  if (!limpio) {
    return "";
  }
  return limpio.charAt(0).toLocaleUpperCase("es-AR") + limpio.slice(1);
}
