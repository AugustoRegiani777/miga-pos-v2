# Comandos básicos — Miga POS

Chuleta rápida para probar la app en tu compu como si fuera la tablet/celu real.

## 1. Levantar la app en tu compu

Desde la carpeta del proyecto, en una terminal:

```
npm start
```

Abre el navegador en **http://localhost:3000**. Es la app real (mismo Supabase de producción) — cualquier venta o cambio que hagas ahí queda guardado de verdad.

Si necesitás probar "Cargar por factura" (la lectura de facturas con IA), esa función vive en un servidor de Netlify aparte y `npm start` no la levanta. Para eso:

```
npm run dev
```

Esto abre en **http://localhost:8888** (o similar, la terminal te dice el puerto) y sí corre las funciones de Netlify — pero hace falta tener configuradas las claves (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) para que funcione.

## 2. Ver el tamaño de tablet/celu (Device Toolbar)

Con la página abierta en Chrome:

1. **F12** para abrir las herramientas de desarrollador.
2. **Ctrl+Shift+M** (o el ícono de tablet/celu arriba a la izquierda de esa ventana) — activa el modo de simulación de dispositivo.
3. Arriba aparece un desplegable — elegí **iPad** / **iPad Mini**, o poné a mano **768 x 1024** (vertical, como está la tablet real).

Esto simula el *tamaño* de pantalla, no el hardware real — sirve para ver si algo se corta o queda chico para el dedo, pero no reproduce lentitud real de la tablet.

## 3. Salir del "modo consulta" (solo lectura)

La primera vez que abrís la app en un dispositivo nuevo (como tu compu) sin ninguna venta guardada, arranca en modo consulta — Caja queda de solo lectura, pensado para el celu del dueño. Para forzarlo a modo acción (como la tablet real que opera):

1. **F12** → pestaña **Console** (no "Elements", la que dice "Console").
2. Pegá y Enter:
   ```js
   localStorage.setItem("miga_modo_consulta", "0")
   ```
3. Recargá (**F5**).

Para volver a modo consulta (solo lectura): mismo paso pero con `"1"` en vez de `"0"`.

## 4. Git — lo mínimo para el día a día

```
git status              # que cambió, que falta subir
git add <archivo>       # marcar un archivo para el proximo commit
git commit -m "mensaje" # guardar un punto en el historial (local, no sube nada todavia)
git push                # subir los commits locales a GitHub (esto SI dispara el deploy real en Netlify)
git log --oneline -10   # ver los ultimos 10 commits
```

**Importante:** después de cualquier `git push` a `main`, Netlify hace deploy automático a la app real. En la tablet hay que **cerrar la app del todo y volver a abrirla** (no alcanza con cambiar de pestaña) para que cargue el código nuevo.
