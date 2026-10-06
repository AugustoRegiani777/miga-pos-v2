// Reordenar filas arrastrando, con el dedo o con el mouse.
//
// Se usa Pointer Events (no touch ni mouse por separado) porque es el unico
// que cubre los dos con el mismo codigo — y la tablet es lo primero.
//
// Como se siente: se mantiene apretada el asa, la fila se despega (sombra y
// un poco mas grande), y las demas se corren para abrir el hueco. Al soltar,
// la fila cae en su lugar y recien ahi se guarda. Si se suelta donde empezo,
// no se guarda nada.
//
// No se usa la API de drag-and-drop del navegador (draggable + dragstart):
// en tablet no dispara con el dedo, que es justo donde tiene que andar.

const UMBRAL_PX = 6; // movimiento minimo para considerar que se esta arrastrando

export function habilitarArrastre(contenedor, { selectorAsa, selectorFila, onReordenar }) {
  let estado = null;

  const filasDe = (fila) => {
    const grupo = fila.closest("tbody") || contenedor;
    return [...grupo.querySelectorAll(selectorFila)];
  };

  function limpiar() {
    if (!estado) return;
    const { fila, filas } = estado;
    filas.forEach((f) => { f.style.transform = ""; f.style.transition = ""; });
    fila.classList.remove("fila-arrastrando");
    document.body.classList.remove("arrastrando-fila");
    estado = null;
  }

  contenedor.addEventListener("pointerdown", (e) => {
    const asa = e.target.closest(selectorAsa);
    if (!asa || e.button > 0) return;
    const fila = asa.closest(selectorFila);
    if (!fila) return;

    const filas = filasDe(fila);
    const alto = fila.getBoundingClientRect().height;
    estado = {
      fila, filas, alto,
      indiceInicial: filas.indexOf(fila),
      indiceActual: filas.indexOf(fila),
      yInicial: e.clientY,
      arrastrando: false,
      pointerId: e.pointerId
    };
    asa.setPointerCapture(e.pointerId);
  });

  contenedor.addEventListener("pointermove", (e) => {
    if (!estado || e.pointerId !== estado.pointerId) return;
    const dy = e.clientY - estado.yInicial;

    if (!estado.arrastrando) {
      if (Math.abs(dy) < UMBRAL_PX) return;
      estado.arrastrando = true;
      estado.fila.classList.add("fila-arrastrando");
      document.body.classList.add("arrastrando-fila");
      // Las demas se mueven con transicion; la que se arrastra sigue al dedo
      // sin retraso, si no se siente pegajosa.
      estado.filas.forEach((f) => { if (f !== estado.fila) f.style.transition = "transform 160ms ease"; });
    }
    e.preventDefault();

    // Cuantos lugares se corrio, redondeando por el alto de una fila.
    const saltos = Math.round(dy / estado.alto);
    const destino = Math.max(0, Math.min(estado.filas.length - 1, estado.indiceInicial + saltos));
    estado.indiceActual = destino;
    estado.fila.style.transform = `translateY(${dy}px)`;

    // Las filas entre el origen y el destino se corren para abrir el hueco.
    estado.filas.forEach((f, i) => {
      if (f === estado.fila) return;
      let desplazamiento = 0;
      if (estado.indiceInicial < destino && i > estado.indiceInicial && i <= destino) desplazamiento = -estado.alto;
      if (estado.indiceInicial > destino && i >= destino && i < estado.indiceInicial) desplazamiento = estado.alto;
      f.style.transform = `translateY(${desplazamiento}px)`;
    });
  });

  const soltar = (e) => {
    if (!estado || (e.pointerId != null && e.pointerId !== estado.pointerId)) return;
    const { fila, filas, indiceInicial, indiceActual, arrastrando } = estado;
    limpiar();
    if (!arrastrando || indiceActual === indiceInicial) return;

    const orden = filas.map((f) => f.dataset.filaId);
    orden.splice(indiceInicial, 1);
    orden.splice(indiceActual, 0, fila.dataset.filaId);
    onReordenar?.(fila.dataset.categoria, orden);
  };

  contenedor.addEventListener("pointerup", soltar);
  contenedor.addEventListener("pointercancel", soltar);
}
