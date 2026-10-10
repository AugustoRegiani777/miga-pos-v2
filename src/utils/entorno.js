// ¿Esta pagina corre contra la base de PRUEBA (staging) o contra la REAL?
//
// Se decide por la direccion desde la que se abrio la app, y la regla esta
// pensada para fallar del lado seguro. Lo que no puede pasar nunca es que la
// tablet del local termine escribiendo en staging, ni que codigo a medio probar
// escriba en la base real. Por eso:
//
//   1. La tablet real (HOSTS_DE_PRODUCCION) es SIEMPRE produccion. Va primero y
//      gana sobre cualquier otra regla.
//   2. Es staging si se corre en tu compu: localhost, o una IP de red local (abrir
//      el servidor de tu PC desde el celu). Una IP de red NO es produccion: es
//      alguien probando.
//   3. Es staging si es un sitio de pruebas de Netlify. El nombre lo dice: una de
//      sus palabras es staging, prueba(s), test, dev, demo, qa, beta o preview
//      ("miga-pos-staging.netlify.app"). Y tambien las copias que Netlify arma de
//      una rama o de un pull request (llevan "--" en el nombre:
//      "arquitectura-productos-v2--unodemigapos.netlify.app"): son codigo todavia
//      sin publicar y no tienen por que tocar la base real.
//   4. Cualquier otra direccion es produccion, como siempre.
//
// Pura y sin dependencias: se prueba sin navegador (entorno.test.mjs).

// La direccion de la tablet del local. Si algun dia hay dominio propio, se agrega
// ACA: lo que no esta en esta lista y no parece de pruebas igual es produccion,
// pero tenerlo escrito evita que una regla nueva lo toque por accidente.
export const HOSTS_DE_PRODUCCION = ["unodemigapos.netlify.app"];

const MARCAS_DE_PRUEBA = ["staging", "prueba", "pruebas", "test", "testing", "dev", "demo", "qa", "beta", "preview"];

const esIpDeRedLocal = (host) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
};

export function esEntornoDePrueba(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  if (HOSTS_DE_PRODUCCION.includes(host)) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  if (esIpDeRedLocal(host)) return true;

  const sitio = host.split(".")[0];
  if (sitio.includes("--")) return true;
  return sitio.split("-").some((palabra) => MARCAS_DE_PRUEBA.includes(palabra));
}
