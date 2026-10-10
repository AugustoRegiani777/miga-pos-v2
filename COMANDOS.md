# Comandos básicos — Miga POS

Chuleta rápida para probar la app en tu compu como si fuera la tablet/celu real.

## 1. Levantar la app en tu compu

Desde la carpeta del proyecto, en una terminal:

```
npm start
```

Abre el navegador en **http://localhost:3000**.

**Ojo con esto:** desde que existe la rama `arquitectura-productos-v2`, correr en `localhost` (cualquier puerto) apunta solo a la base de **staging** — nunca a producción — sin importar qué rama tengas activa en Git en ese momento (la rama solo define qué *código* corrés; la base a la que apunta depende de si el navegador dice `localhost`/`127.0.0.1` o no). Ver la sección "Staging" más abajo. Netlify (`unodemigapos.netlify.app`, la tablet real) siempre usa producción, sin excepción — no hay forma de que se mezclen.

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

**Regla del proyecto ahora mismo:** todo lo nuevo (Panel, Cierre de caja, sync, etc.) se sube SOLO a `arquitectura-productos-v2`. `main` no se toca hasta que se decida explícitamente pasar algo a producción.

## 5. Staging — cómo levantarlo, y qué usuario usar

Staging es una base de Supabase de prueba, separada de la real, con datos simulados (15 días de ventas). Sirve para probar sin riesgo de romper nada de la tablet.

**Para levantarlo:**

1. Asegurate de estar parado en la rama `arquitectura-productos-v2` (`git branch --show-current`).
2. `npm start` como siempre.
3. Abrí **http://localhost:3000** — no hace falta nada más: como se explica arriba, correr en `localhost` ya apunta solo a staging.
4. Vas a ver arriba de todo un cartel naranja: **"🧪 STAGING — hoy: ..."**. Si NO aparece ese cartel, no estás en staging: revisá que la URL sea `localhost`, una IP de tu red o un sitio de pruebas (ver "Un sitio de pruebas en Netlify" abajo). La dirección de la tablet real (`unodemigapos.netlify.app`) es siempre producción.

**¿Usuario y contraseña específicos? Sí, es obligatorio.** Staging es un proyecto de Supabase totalmente aparte — tu usuario y contraseña reales (los que usás en la tablet) **no existen ahí** y el login va a fallar si los probás. Hay un único usuario de prueba ya creado:

- **Usuario:** `qa-demo`
- **Contraseña:** no se escribe acá porque este repositorio es público. Pedísela a Augusto, o creá otra desde Supabase (proyecto de staging) → Authentication → Users.

Ese usuario y esta base de staging son solo para probar — no tienen nada que ver con el negocio real. Se puede borrar en cualquier momento sin que afecte nada de producción.

**El reloj simulado:** el cartel naranja tiene un botón **"+1 día"** — sirve para "avanzar el día" dentro de staging sin esperar al reloj real, útil para probar cosas que dependen de la fecha (cierres, producción). Solo aparece en staging, nunca en producción.

---

## Un sitio de pruebas en Netlify (para probar en varios dispositivos)

Sirve para abrir la app de pruebas desde el celu, la tablet o la compu de otra persona, sin correr nada en tu PC. **Es un sitio aparte del real**: se conecta a la misma rama (`arquitectura-productos-v2`) y a la base de **staging**, nunca a la de producción.

**Cómo sabe la app que es de pruebas.** Lo decide el nombre de la dirección (`src/utils/entorno.js`): es de pruebas si es `localhost`, una IP de tu red, o si el nombre del sitio tiene alguna de estas palabras: `staging`, `prueba`, `pruebas`, `test`, `dev`, `demo`, `qa`, `beta`, `preview`. Por eso **el sitio nuevo tiene que llamarse, por ejemplo, `miga-pos-staging`** (queda `miga-pos-staging.netlify.app`). Las copias que Netlify arma de una rama o de un pull request (llevan `--` en el nombre) también cuentan como de pruebas.

**Primer chequeo, siempre:** al abrir el sitio tiene que verse el cartel naranja **"🧪 STAGING"**. Si no se ve, ese sitio está apuntando a la base real: no lo uses. (Una segunda red de seguridad: el usuario `qa-demo` existe solo en staging; si en un sitio no deja entrar, mala señal.)

### Pasos en Netlify
1. **Add new site → Import an existing project → GitHub** y elegí este repositorio.
2. **Branch to deploy:** `arquitectura-productos-v2` (no `main`).
3. **Build command:** vacío. **Publish directory:** `.` (ya lo dice `netlify.toml`).
4. **Site name:** uno que lleve `staging`, por ejemplo `miga-pos-staging`.
5. *(Solo si querés probar la lectura de facturas con IA)* **Site settings → Environment variables:** `ANTHROPIC_API_KEY`, `SUPABASE_URL` = la de staging (`https://yfveeikzckvqlndmhwut.supabase.co`) y `SUPABASE_SERVICE_ROLE_KEY` = la clave **service_role de staging** (Supabase staging → Project Settings → API). Sin estas, todo anda igual menos "Cargar factura" con foto.

Cada `git push` a `arquitectura-productos-v2` redespliega solo ese sitio. El sitio real (`unodemigapos`) sigue desplegando `main` y no se entera.

Cada dispositivo guarda sus propios datos locales: para empezar de cero en uno, vaciá los datos del sitio (F12 → Application → Storage → Clear site data).
