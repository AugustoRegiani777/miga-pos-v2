// Que version de la app esta publicada ahora.
//
// El sitio se publica solo desde GitHub (Netlify) y, al publicar, genera un
// archivo version.json con el commit publicado (ver netlify.toml). Una pestana que
// ya estaba abierta no vuelve a descargar el codigo sola: sigue con el que cargo,
// por dias si hace falta. Comparar la version con la que cargo la pestana permite
// avisar "hay una version nueva" (ver iniciarAvisoDeVersion en app.js).
//
// Si no hay version.json (en tu compu, o un sitio sin publicar) devuelve null y
// simplemente no hay aviso: nada se rompe.
export async function leerVersionPublicada() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.version ? String(data.version) : null;
  } catch {
    return null;
  }
}
