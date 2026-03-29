const CSV_URL_PRINCIPAL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQrEioDH380tYWFuP8n5SbwmR5Unna2_VihZoXnnGGy_EJkLqXayze7minaMa-RxsN0itoEEjuVD4eM/pub?output=csv&gid=0";
const CSV_URL_CONTINUIDAD =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQrEioDH380tYWFuP8n5SbwmR5Unna2_VihZoXnnGGy_EJkLqXayze7minaMa-RxsN0itoEEjuVD4eM/pub?output=csv&gid=246571625";

const BIBLIOTECA_NACIONAL_URL = "https://www.bn.gob.ar/";
const BIBLIOTECA_DEL_MAESTRO_URL = "https://www.argentina.gob.ar/educacion/bnm";
const DEFAULT_SECTION_VIEW = "cursos";
const INITIAL_CLASSROOM_MESSAGE =
  "Seleccioná un curso para cargar las materias con aulas virtuales.";
const INITIAL_CONTINUIDAD_MESSAGE =
  "Seleccioná un curso para cargar las carpetas de continuidad pedagógica.";

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
  linkDrive: ["link drive", "linkdrive", "drive", "carpeta drive", "link carpeta"],
};

const state = {
  classroomData: [],
  continuidadData: [],
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
  restaurarBloquesIniciales();
  inicializarDatos();
});

async function inicializarDatos() {
  setStatus("Cargando cursos y materias...", "warn");

  const [principalResult, continuidadResult] = await Promise.allSettled([
    cargarCSV(CSV_URL_PRINCIPAL),
    cargarCSV(CSV_URL_CONTINUIDAD),
  ]);

  const errores = [];

  if (principalResult.status === "fulfilled") {
    state.classroomData = normalizarColumnas(principalResult.value);
  } else {
    state.classroomData = [];
    errores.push("No se pudo cargar la hoja principal (Classroom).");
  }

  if (continuidadResult.status === "fulfilled") {
    state.continuidadData = normalizarColumnas(continuidadResult.value);
  } else {
    state.continuidadData = [];
    errores.push("No se pudo cargar la hoja de continuidad pedagógica.");
  }

  state.cursos = obtenerCursosSeccionesUnicos(state.classroomData, state.continuidadData);
  renderBotonesCursos(state.cursos);

  if (errores.length === 2) {
    mostrarErrorCarga(`${errores.join(" ")} Revisá conexión o permisos del CSV.`);
    return;
  }

  if (errores.length === 1) {
    setStatus(`${errores[0]} El sitio seguirá funcionando con la otra fuente.`, "warn");
  } else {
    setStatus(`Datos cargados correctamente. ${state.cursos.length} cursos disponibles.`, "ok");
  }
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
  // Se normalizan encabezados para tolerar tildes, mayúsculas y espacios.
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
        linkDrive: extraerCampo(filaNormalizada, ALIAS_COLUMNAS.linkDrive),
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

function obtenerCursosSeccionesUnicos(classroomData, continuidadData) {
  const mapaUnicos = new Map();
  const fusion = [...classroomData, ...continuidadData];

  for (const fila of fusion) {
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
    button.addEventListener("click", () => {
      const yaSeleccionado =
        state.selected &&
        state.selected.curso === item.curso &&
        state.selected.seccion === item.seccion;

      if (yaSeleccionado) {
        limpiarSeleccionCurso();
        return;
      }

      seleccionarCursoSeccion(item.curso, item.seccion);
    });
    fragment.append(button);
  }

  dom.coursesContainer.append(fragment);
}

function seleccionarCursoSeccion(curso, seccion) {
  state.selected = { curso, seccion };

  aplicarFiltroSeccionSeleccionada(curso, seccion);

  // Microtransición visual al refrescar resultados del curso seleccionado.
  dom.resultsSection.classList.add("is-updating");
  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
  }

  state.updateTimer = window.setTimeout(() => {
    const totalClassroom = renderBloqueClassroom(curso, seccion);
    const totalContinuidad = renderBloqueContinuidad(curso, seccion);
    const total = totalClassroom + totalContinuidad;
    actualizarVisibilidadBloques(totalClassroom, totalContinuidad);

    dom.selectedCourseTitle.textContent = `Curso seleccionado: ${curso} ${seccion}`;
    dom.selectedCourseCount.textContent = `Resultados: ${total} en total (${totalClassroom} Classroom y ${totalContinuidad} Continuidad).`;
    dom.resultsSection.classList.remove("is-updating");
  }, 120);
}

function aplicarFiltroSeccionSeleccionada(curso, seccion) {
  dom.coursesContainer.classList.add("focused");
  dom.resetSelection.hidden = false;

  document.querySelectorAll(".course-btn").forEach((button) => {
    const activo = button.dataset.curso === curso && button.dataset.seccion === seccion;
    button.classList.toggle("active", activo);
    button.hidden = !activo;
  });
}

function limpiarSeleccionCurso() {
  state.selected = null;

  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
  }

  dom.coursesContainer.classList.remove("focused");
  dom.resetSelection.hidden = true;

  document.querySelectorAll(".course-btn").forEach((button) => {
    button.classList.remove("active");
    button.hidden = false;
  });

  restaurarBloquesIniciales();
  mostrarEstadoVacio();
}

function actualizarVisibilidadBloques(totalClassroom, totalContinuidad) {
  dom.classroomBlock.hidden = totalClassroom === 0;
  dom.continuidadBlock.hidden = totalContinuidad === 0;

  if (totalClassroom === 0 && totalContinuidad === 0) {
    dom.classroomBlock.hidden = false;
    dom.classroomResults.textContent = "";
    dom.classroomResults.append(
      crearMensajeVacio("No hay recursos disponibles para la sección seleccionada."),
    );
  }
}

function renderBloqueClassroom(curso, seccion) {
  const coincidencias = state.classroomData.filter((fila) => coincideCursoSeccion(fila, curso, seccion));
  dom.classroomResults.textContent = "";

  if (!coincidencias.length) {
    dom.classroomResults.append(
      crearMensajeVacio("No hay aulas disponibles para este curso."),
    );
    return 0;
  }

  const fragment = document.createDocumentFragment();
  for (const fila of coincidencias) {
    const url = construirUrlClassroom(fila.linkClassroom, fila.codigoClassroom);
    const card = crearCardMateria({
      materia: fila.materia,
      curso: fila.curso,
      seccion: fila.seccion,
      url,
      actionLabel: "Abrir Classroom",
      emptyActionLabel: "Sin enlace disponible",
      iconClass: "fa-solid fa-chalkboard-user",
    });
    fragment.append(card);
  }

  dom.classroomResults.append(fragment);
  return coincidencias.length;
}

function renderBloqueContinuidad(curso, seccion) {
  const coincidencias = state.continuidadData.filter((fila) => coincideCursoSeccion(fila, curso, seccion));
  dom.continuidadResults.textContent = "";

  if (!coincidencias.length) {
    dom.continuidadResults.append(
      crearMensajeVacio("No hay carpetas de continuidad disponibles para este curso."),
    );
    return 0;
  }

  const fragment = document.createDocumentFragment();
  for (const fila of coincidencias) {
    const url = construirEnlaceSeguro(fila.linkDrive);
    const card = crearCardMateria({
      materia: fila.materia,
      curso: fila.curso,
      seccion: fila.seccion,
      url,
      actionLabel: "Abrir carpeta",
      emptyActionLabel: "Sin enlace disponible",
      iconClass: "fa-solid fa-folder-open",
    });
    fragment.append(card);
  }

  dom.continuidadResults.append(fragment);
  return coincidencias.length;
}

function crearCardMateria({
  materia,
  curso,
  seccion,
  url,
  actionLabel,
  emptyActionLabel,
  iconClass,
}) {
  const card = document.createElement("article");
  card.className = "card-item";

  const title = document.createElement("h5");
  title.textContent = materia || "Materia sin nombre";

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${curso || "Curso no indicado"} · ${seccion || "Sección no indicada"}`;

  const action = document.createElement(url ? "a" : "span");
  action.className = `card-action${url ? "" : " disabled"}`;
  if (url) {
    action.href = url;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
  }

  const icon = document.createElement("i");
  icon.className = iconClass;
  const text = document.createTextNode(url ? actionLabel : emptyActionLabel);
  action.append(icon, text);

  card.append(title, meta, action);
  return card;
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

  // Fallback solicitado: si falta enlace directo, construir URL con código.
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
      dom.catalogSearchHint.textContent = "Escribí una palabra clave para explorar el catálogo.";
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
  dom.catalogSearchHint.textContent = `Búsqueda: "${termino}" (${resultados.length} resultados)`;

  if (!resultados.length) {
    dom.catalogResults.append(
      crearMensajeVacio("No encontramos coincidencias. Probá con otro término."),
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of resultados) {
    const card = document.createElement("article");
    card.className = "card-item";

    const title = document.createElement("h5");
    title.textContent = item.titulo || "Título sin definir";

    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = `${item.autor || "Autor no informado"} · ${item.categoria || "Categoría general"}`;

    const description = document.createElement("p");
    description.className = "card-meta";
    description.textContent = item.descripcion || "Sin descripción disponible.";

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
  dom.selectedCourseTitle.textContent = "Seleccioná un curso para ver sus aulas y materiales";
  dom.selectedCourseCount.textContent =
    "Cuando elijas una combinación de curso y sección, aparecerán los resultados aquí.";
}

function restaurarBloquesIniciales() {
  dom.classroomBlock.hidden = false;
  dom.continuidadBlock.hidden = false;

  dom.classroomResults.textContent = "";
  dom.classroomResults.append(crearMensajeVacio(INITIAL_CLASSROOM_MESSAGE));

  dom.continuidadResults.textContent = "";
  dom.continuidadResults.append(crearMensajeVacio(INITIAL_CONTINUIDAD_MESSAGE));
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

  dom.resetSelection.addEventListener("click", limpiarSeleccionCurso);
}

function cacheDom() {
  dom.menuToggle = document.getElementById("menu-toggle");
  dom.mainNav = document.getElementById("main-nav");

  dom.catalogSearchInput = document.getElementById("catalog-search-input");
  dom.catalogSearchButton = document.getElementById("catalog-search-button");
  dom.catalogSearchHint = document.getElementById("catalog-search-hint");
  dom.catalogResults = document.getElementById("catalog-results");

  dom.dataStatus = document.getElementById("data-status");
  dom.resetSelection = document.getElementById("reset-selection");
  dom.coursesContainer = document.getElementById("courses-container");

  dom.resultsSection = document.getElementById("resultados-curso");
  dom.selectedCourseTitle = document.getElementById("selected-course-title");
  dom.selectedCourseCount = document.getElementById("selected-course-count");
  dom.classroomBlock = document.getElementById("classroom-block");
  dom.continuidadBlock = document.getElementById("continuidad-block");
  dom.classroomResults = document.getElementById("classroom-results");
  dom.continuidadResults = document.getElementById("continuidad-results");

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
