-- Migracion 020: caja por turnos (apertura -> movimientos -> relevo -> cierre)
--
-- QUE PIDIO EL DUEÑO
-- "Que sea mas temporal: el que entra abre caja, gestiona movimientos y gastos
-- durante el dia, y cuando llega el del segundo turno puede o no haber un
-- cierre parcial. Que los movimientos se vayan cargando en el momento, y que
-- al final del dia solo reste poner lo que hay y cerrar, con la trazabilidad
-- de todo lo anotado."
--
-- Mas dos decisiones ya tomadas por el:
--   * No hay un usuario por persona (hay un solo login del local): quien abre
--     y quien releva se escriben a mano, texto libre, y ese nombre es la
--     trazabilidad.
--   * El relevo CUENTA LA PLATA: quien sale cuenta el efectivo, se registra la
--     diferencia contra lo esperado, y quien entra arranca con ese fondo. Asi
--     un faltante aparece en el turno donde paso, no al dia siguiente.
--
-- ESTA MIGRACION NO TRAE CODIGO DE APLICACION, A PROPOSITO.
-- El 05/10/2026 se corrompio stock en staging porque habia codigo mandando
-- columnas de una migracion que todavia no se habia corrido: el push fallaba,
-- la operacion quedaba trabada en la cola, y una operacion trabada desactiva
-- toda la reconciliacion de stock (reconciliarStockInsumosConNube arranca con
-- un return si hay pendientes). Una calibracion termino subiendo +3520 en vez
-- de +120. Regla que sale de ahi y que gobierna este archivo: la migracion se
-- corre PRIMERO, el codigo va DESPUES.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.
-- No borra ni modifica ninguna fila existente.


-- =====================================================================
-- 0. POR QUE TRES TABLAS NUEVAS Y NO MAS COLUMNAS EN cierres_caja
-- =====================================================================
--
-- `cierres_caja` (migracion 015) ya existe y se queda EXACTAMENTE con el
-- significado que tiene hoy: la foto del DIA cerrado. No se convierte en la
-- tabla de turnos, por tres razones concretas:
--
--   1. El codigo que ya corre lee "de varios cierres del mismo dia, el vigente
--      es el mas reciente" (cierresVigentesPorFecha, en cierre-calculos.js). Si
--      los arqueos de relevo se guardaran como filas de cierres_caja, el ultimo
--      relevo del dia pasaria a ser "el cierre vigente" de ese dia, en
--      silencio. El Panel y el dashboard del dueño leerian un cierre parcial
--      como si fuera el del dia.
--   2. Los importes de cierres_caja son del dia completo
--      (ventas_total_centavos = todas las ventas no anuladas del dia). Un
--      arqueo de relevo es de una VENTANA del dia. Son dos magnitudes
--      distintas con el mismo nombre: mezclarlas es garantia de sumar mal.
--   3. El total de tarjeta de cierres_caja viene del cierre de Postnet, que se
--      hace una vez al final del dia. Un relevo no tiene ese numero y nunca lo
--      va a tener.
--
-- Entonces: `cierres_caja` NO cambia de significado, solo gana columnas
-- opcionales que lo enganchan con el turno que lo cerro (seccion 4). Lo nuevo
-- vive en tres tablas:
--
--   sesiones_caja    una fila por TURNO, y solo con los datos de la APERTURA
--   movimientos_caja el libro de la plata del cajon durante el turno
--   arqueos_caja     cada recuento de efectivo (de relevo o final)
--
-- APPEND-ONLY DE VERDAD, NO POR BUENA CONDUCTA DE LA APP.
-- Viene una conexion con Hacienda, asi que ninguna de las tres tablas tiene
-- politica de UPDATE ni de DELETE: la base no deja editar ni borrar, punto.
-- Por eso `sesiones_caja` guarda SOLO la apertura: si la fila tuviera tambien
-- "cerrada_en"/"contado", cerrar un turno seria un UPDATE y habria que abrir
-- esa puerta. El cierre del turno es otra fila, en `arqueos_caja`. Que un turno
-- este abierto no se guarda en ningun campo: se DERIVA de no tener arqueo
-- todavia (vista de la seccion 6). Es el mismo criterio que ya se usa para el
-- stock en vivo: el estado se deriva del ledger, no se escribe a mano.
--
-- COMO SE CORRIGE UN ERROR, ENTONCES:
--   * Movimiento mal cargado -> otro movimiento con el importe al reves y
--     `corrige_uuid` apuntando al original. Los dos quedan a la vista y la suma
--     da bien sola.
--   * Fondo inicial mal tipeado -> NO se toca la apertura: se carga un
--     movimiento tipo 'ajuste' con el motivo ("el fondo real era 120, no 100").
--     Asi la cuenta del cajon queda bien y se ve que alguien se equivoco.
--   * Arqueo mal contado -> otro arqueo de la misma sesion. El mas reciente es
--     el vigente, los anteriores son historial. Misma convencion que ya tiene
--     cierres_caja.
--
-- SOBRE EL uuid (seccion 8.7 de CLAUDE.md, la de las 259 ventas duplicadas):
-- las tres tablas llevan `uuid TEXT UNIQUE NOT NULL`. El NOT NULL es la mitad
-- que importa: en Postgres UNIQUE no choca entre NULLs, asi que un uuid
-- nullable deja que un reintento inserte una fila nueva sin que nada se queje.
-- Es exactamente lo que paso con las ventas de pedidos.


-- =====================================================================
-- 1. sesiones_caja -- la APERTURA de un turno (y nada mas)
-- =====================================================================

CREATE TABLE IF NOT EXISTS sesiones_caja (
  id                      BIGSERIAL PRIMARY KEY,
  uuid                    TEXT UNIQUE NOT NULL,
  fecha                   TEXT NOT NULL,              -- dia operativo, YYYY-MM-DD, igual que en todo el schema
  turno                   INTEGER NOT NULL CHECK (turno >= 1),

  -- Quien abre. Texto libre porque no hay usuarios por persona. El CHECK de
  -- "no vacio" lo pone la BASE y no la app a proposito: un turno sin nombre no
  -- sirve para la trazabilidad, que es lo unico que el dueño pidio de esto.
  abierta_por             TEXT NOT NULL CHECK (btrim(abierta_por) <> ''),

  -- Cuando dice la tablet que se abrio. Es el dato de negocio y puede venir de
  -- un rato antes (la app funciona sin internet y empuja despues). `creado_en`
  -- es otra cosa: cuando la fila llego a la nube. Los dos hacen falta y no son
  -- intercambiables para auditar.
  abierta_en              TIMESTAMPTZ NOT NULL,

  fondo_inicial_centavos  INTEGER NOT NULL CHECK (fondo_inicial_centavos >= 0),
  -- 'contado'  = se conto la plata al abrir
  -- 'arrastre' = se tomo tal cual lo que dejo el arqueo del turno anterior
  fondo_inicial_origen    TEXT NOT NULL DEFAULT 'contado'
                          CHECK (fondo_inicial_origen IN ('contado', 'arrastre')),

  -- El relevo encadenado: turno 2 apunta al turno 1. NULL en el primer turno
  -- del dia. Hace explicito "este fondo viene de aquel recuento".
  sesion_previa_uuid      TEXT,

  dispositivo             TEXT,                       -- que tablet/celu abrio, si se sabe
  nota                    TEXT,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clave natural con dientes: un dia no puede tener dos veces el turno 2. Es la
-- regla 2 de la seccion 8.7 -- el chequeo "leo si existe, despues inserto" en la
-- app tiene una carrera entre dos reintentos casi simultaneos (o entre dos
-- dispositivos abriendo caja a la vez); el indice unico es lo unico que lo hace
-- imposible de verdad. Y no estorba a las correcciones, porque una apertura
-- equivocada NO se corrige reescribiendola (se corrige con un movimiento
-- 'ajuste', ver arriba).
CREATE UNIQUE INDEX IF NOT EXISTS sesiones_caja_fecha_turno_unique
  ON sesiones_caja (fecha, turno);

CREATE INDEX IF NOT EXISTS idx_sesiones_caja_abierta_en ON sesiones_caja (abierta_en);

COMMENT ON TABLE  sesiones_caja IS 'Un turno de caja. Guarda SOLO la apertura: el cierre del turno es una fila de arqueos_caja (append-only, sin UPDATE).';
COMMENT ON COLUMN sesiones_caja.abierta_por IS 'Nombre escrito a mano. No hay usuarios por persona: este texto ES la trazabilidad.';
COMMENT ON COLUMN sesiones_caja.abierta_en IS 'Cuando ocurrio segun la tablet (puede ser muy anterior a creado_en si no habia internet).';
COMMENT ON COLUMN sesiones_caja.sesion_previa_uuid IS 'Turno que relevo este. Referencia blanda a sesiones_caja.uuid, sin FK (ver nota de la seccion 5).';


-- =====================================================================
-- 2. movimientos_caja -- el libro de la plata del cajon, en el momento
-- =====================================================================
--
-- Esto es el "cargar movimientos y gastos en real time" que pidio el dueño.
-- Importe FIRMADO, como el ledger de stock (movimientos_stock.cantidad): asi
-- "cuanto hay que tener en el cajon" es una suma y nadie tiene que acordarse de
-- restar. El CHECK ata el signo al tipo para que no se pueda cargar un gasto en
-- positivo.

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id                BIGSERIAL PRIMARY KEY,
  uuid              TEXT UNIQUE NOT NULL,
  sesion_uuid       TEXT NOT NULL,                    -- turno dentro del cual se cargo
  fecha             TEXT NOT NULL,                    -- dia operativo (repetido aca para consultar el dia sin join)

  -- Juego CERRADO de tipos, porque de cada uno depende una cuenta:
  --   ingreso = entra plata al cajon y NO es una venta (cambio que se trae,
  --             aporte del dueño, algo que se devuelve)
  --   gasto   = se paga algo del negocio (proveedor, taxi, ferreteria)
  --   retiro  = sale plata del cajon sin ser un gasto (al banco, a la caja
  --             fuerte, al dueño)
  --   ajuste  = correccion explicita (fondo mal tipeado, error de carga)
  -- Si en algun momento hace falta un tipo nuevo: PRIMERO la migracion que lo
  -- agrega al CHECK, DESPUES el codigo que lo manda. Al reves, el push falla
  -- con 23514, la operacion se traba en la cola y la reconciliacion de stock
  -- se apaga -- es literalmente lo que paso el 05/10.
  tipo              TEXT NOT NULL CHECK (tipo IN ('ingreso', 'gasto', 'retiro', 'ajuste')),

  importe_centavos  INTEGER NOT NULL,
  CONSTRAINT movimientos_caja_signo_check CHECK (
    (tipo = 'ingreso'            AND importe_centavos > 0) OR
    (tipo IN ('gasto', 'retiro') AND importe_centavos < 0) OR
    (tipo = 'ajuste'             AND importe_centavos <> 0)
  ),

  -- Un movimiento de plata sin motivo no sirve para auditar nada. Lo exige la
  -- base, no el formulario.
  motivo            TEXT NOT NULL CHECK (btrim(motivo) <> ''),

  -- Categoria de gasto (proveedor, limpieza, transporte...). SIN CHECK a
  -- proposito: este vocabulario lo inventa el dueño y va a crecer. Un CHECK
  -- aca significaria que agregar una categoria nueva rompe el push y traba la
  -- cola. La parte estructural se valida (tipo); la parte de negocio, no.
  categoria         TEXT,

  -- Un gasto pagado con tarjeta o transferencia es un gasto, pero NO mueve el
  -- cajon. Sin esta columna habria que elegir entre mentir en el arqueo o
  -- perder el gasto. Las cuentas del efectivo suman solo afecta_cajon = true.
  afecta_cajon      BOOLEAN NOT NULL DEFAULT true,

  comprobante       TEXT,                             -- nro de ticket/factura, para la futura conexion con Hacienda
  quien             TEXT,                             -- quien lo cargo, si no es el que abrio el turno

  -- La correccion append-only: para anular, se inserta el importe exacto al
  -- reves con corrige_uuid apuntando al original; para ajustar, solo la
  -- diferencia. Nunca se edita ni se borra el original.
  corrige_uuid      TEXT,
  CONSTRAINT movimientos_caja_no_se_corrige_a_si_mismo CHECK (corrige_uuid IS NULL OR corrige_uuid <> uuid),

  ocurrido_en       TIMESTAMPTZ NOT NULL,              -- cuando paso segun la tablet
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW() -- cuando llego a la nube
);

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_sesion  ON movimientos_caja (sesion_uuid);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_fecha   ON movimientos_caja (fecha, ocurrido_en);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_corrige ON movimientos_caja (corrige_uuid) WHERE corrige_uuid IS NOT NULL;

COMMENT ON TABLE  movimientos_caja IS 'Ledger de efectivo del cajon por turno. Append-only: un error se corrige con otro movimiento (corrige_uuid), nunca editando.';
COMMENT ON COLUMN movimientos_caja.importe_centavos IS 'Firmado: positivo entra al cajon, negativo sale. El esperado del cajon es una suma, no una resta condicional.';
COMMENT ON COLUMN movimientos_caja.afecta_cajon IS 'false para un gasto pagado con tarjeta/transferencia: es gasto del negocio pero no mueve el efectivo.';
COMMENT ON COLUMN movimientos_caja.categoria IS 'Texto libre a proposito (sin CHECK): el vocabulario de gastos lo define el dueño y va a crecer.';
COMMENT ON COLUMN movimientos_caja.corrige_uuid IS 'uuid del movimiento que este corrige. Referencia blanda, sin FK.';


-- =====================================================================
-- 3. arqueos_caja -- el recuento de efectivo que cierra un turno
-- =====================================================================
--
-- Un arqueo es el momento en que alguien CUENTA la plata: en el relevo
-- (tipo 'relevo') o al terminar el dia (tipo 'final'). Es lo que hace que un
-- faltante aparezca en el turno donde paso.
--
-- Los importes son una FOTO de lo que decia el sistema al momento de contar,
-- igual que en cierres_caja: si mañana se anula una venta de ayer, el arqueo de
-- ayer sigue explicando por que la diferencia era la que era.

CREATE TABLE IF NOT EXISTS arqueos_caja (
  id                        BIGSERIAL PRIMARY KEY,
  uuid                      TEXT UNIQUE NOT NULL,
  sesion_uuid               TEXT NOT NULL,            -- turno que se esta cerrando
  fecha                     TEXT NOT NULL,
  tipo                      TEXT NOT NULL CHECK (tipo IN ('relevo', 'final')),

  -- Los dos nombres del relevo: el que cuenta y entrega, y el que recibe.
  -- recibido_por queda NULL en el arqueo final (no hay quien entre despues).
  contado_por               TEXT NOT NULL CHECK (btrim(contado_por) <> ''),
  recibido_por              TEXT,
  contado_en                TIMESTAMPTZ NOT NULL,     -- cuando se conto, segun la tablet

  -- Lo que hay
  contado_centavos          INTEGER NOT NULL CHECK (contado_centavos >= 0),
  -- Cuanto queda en el cajon para el que sigue (o para mañana, en el final).
  -- Lo retirado es contado - deja. La app deberia abrir el turno siguiente con
  -- fondo_inicial = este deja_centavos; no se fuerza con un trigger a
  -- proposito (ver nota al final de esta seccion).
  deja_centavos             INTEGER CHECK (deja_centavos >= 0),

  -- Foto de lo que decia el sistema PARA ESTE TURNO (no para el dia)
  fondo_inicial_centavos    INTEGER NOT NULL,            -- con el que arranco el turno
  ventas_total_centavos     INTEGER NOT NULL DEFAULT 0,
  ventas_efectivo_centavos  INTEGER NOT NULL DEFAULT 0,  -- la parte que, segun la app, entro al cajon
  ventas_tarjeta_centavos   INTEGER NOT NULL DEFAULT 0,  -- segun ventas.forma_pago (mig. 016): cruce de control
  tickets                   INTEGER NOT NULL DEFAULT 0,
  movimientos_centavos      INTEGER NOT NULL DEFAULT 0,  -- neto firmado del ledger del turno (solo afecta_cajon)

  -- Resultado (lo calcula la app, se guarda para auditar)
  --   esperado = fondo_inicial + ventas_efectivo + movimientos
  esperado_centavos         INTEGER NOT NULL,
  diferencia_centavos       INTEGER NOT NULL,         -- contado - esperado (negativo = falta plata)

  nota                      TEXT,
  creado_en                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A PROPOSITO NO HAY UNIQUE (sesion_uuid):
-- un arqueo mal contado se corrige appendeando otro arqueo de la misma sesion,
-- y el mas reciente por creado_en es el vigente (identica convencion a la de
-- cierres_caja, que el codigo ya resuelve con cierresVigentesPorFecha). Un
-- UNIQUE aca bloquearia justamente la unica forma de corregir que permite el
-- modelo append-only. La garantia contra duplicados por reintento es el `uuid`
-- + upsert on conflict uuid, que es la que corresponde a ese problema.
CREATE INDEX IF NOT EXISTS idx_arqueos_caja_sesion ON arqueos_caja (sesion_uuid, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_arqueos_caja_fecha  ON arqueos_caja (fecha, creado_en DESC);

COMMENT ON TABLE  arqueos_caja IS 'Recuento de efectivo que cierra un turno (relevo o final). Varios por sesion = historial; el mas reciente por creado_en es el vigente.';
COMMENT ON COLUMN arqueos_caja.deja_centavos IS 'Efectivo que queda en el cajon para el turno siguiente (o para mañana). Lo retirado es contado - deja.';
COMMENT ON COLUMN arqueos_caja.ventas_tarjeta_centavos IS 'Tarjeta segun el sistema (ventas.forma_pago). En el relevo no hay cierre de Postnet: es cruce de control, no la verdad del total de tarjeta.';
COMMENT ON COLUMN arqueos_caja.movimientos_centavos IS 'Neto firmado de movimientos_caja del turno, solo los que afectan el cajon.';


-- =====================================================================
-- 4. cierres_caja -- se queda igual, solo se engancha con el turno
-- =====================================================================
--
-- Las columnas nuevas son TODAS nullable o con default, y ninguna cambia el
-- significado de las que ya estan. Motivo practico, no estetico: puede haber
-- una pestaña vieja en la tablet reintentando un cierre con el payload de
-- ANTES de esta migracion (paso en agosto y duro dias). Si cualquiera de estas
-- fuera NOT NULL sin default, ese reintento fallaria para siempre y trabaria la
-- cola.

ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS sesion_uuid          TEXT;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS arqueo_uuid          TEXT;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS cerrado_por          TEXT;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS turnos               INTEGER;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS movimientos_centavos INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN cierres_caja.sesion_uuid IS 'Ultimo turno del dia, el que cerro. NULL en los cierres anteriores a la mig. 020.';
COMMENT ON COLUMN cierres_caja.arqueo_uuid IS 'Arqueo final que conto este cajon (arqueos_caja.uuid). NULL si el cierre se hizo sin turnos.';
COMMENT ON COLUMN cierres_caja.cerrado_por IS 'Nombre de quien cerro el dia, escrito a mano.';
COMMENT ON COLUMN cierres_caja.turnos IS 'Cuantos turnos tuvo el dia. Informativo (se puede contar en sesiones_caja), guardado como parte de la foto.';
COMMENT ON COLUMN cierres_caja.movimientos_centavos IS
  'Neto firmado del ledger de caja del dia (solo afecta_cajon). OJO: se superpone con retiros_centavos, que es el numero tipeado a mano del modelo viejo. Con el ledger en uso, retiros_centavos va en 0 y los retiros son movimientos. NO cargar las dos cosas: se cuentan dos veces. No hay CHECK que lo impida porque un CHECK ahi haria fallar el push de una pestaña vieja y trabaria la cola.';

CREATE INDEX IF NOT EXISTS idx_cierres_caja_sesion ON cierres_caja (sesion_uuid) WHERE sesion_uuid IS NOT NULL;


-- =====================================================================
-- 5. ventas -- a que turno pertenece cada venta
-- =====================================================================
--
-- Sin esto, "las ventas del turno 1" habria que deducirlas por ventana de
-- tiempo (apertura -> recuento), y eso depende de ventas.hora, que es TEXT y lo
-- escribe el reloj de cada dispositivo. Para un arqueo donde un euro de
-- diferencia importa, deducir no alcanza: la venta tiene que decir a que turno
-- entro. Nullable porque las ventas viejas no lo tienen y porque una venta
-- cobrada sin caja abierta tiene que poder existir igual (la caja nunca se
-- bloquea); para esas, la app cae a la ventana de tiempo.
--
-- Nota: esto NO contradice la regla del uuid NOT NULL. Esa regla es sobre el
-- uuid que IDENTIFICA a la fila (la clave de deduplicacion del upsert).
-- sesion_caja_uuid es una referencia a otra fila, como venta_uuid en la mig. 014.

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS sesion_caja_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_ventas_sesion_caja
  ON ventas (sesion_caja_uuid) WHERE sesion_caja_uuid IS NOT NULL;

COMMENT ON COLUMN ventas.sesion_caja_uuid IS 'Turno de caja en el que se cobro (sesiones_caja.uuid). NULL = venta sin turno; se atribuye por ventana de tiempo.';

-- POR QUE NINGUNA DE ESTAS REFERENCIAS TIENE FOREIGN KEY
-- Las referencias por uuid (sesion_uuid, sesion_previa_uuid, arqueo_uuid,
-- corrige_uuid, sesion_caja_uuid) son BLANDAS: columna + indice, sin FK. Mismo
-- criterio que movimientos_stock.venta_uuid en la migracion 014, y por un
-- motivo medido en este proyecto: la app es offline-first y sube con una cola
-- que reintenta. Si un movimiento llegara antes que su sesion, con FK el push
-- falla con 23503, la operacion se traba, y una sola operacion trabada apaga la
-- reconciliacion de stock entera. Un movimiento huerfano es un problema visible
-- y reparable (dice a que sesion pertenece); una cola trabada corrompe stock en
-- silencio. La integridad que SI se defiende en la base es la que no se puede
-- reconstruir despues: append-only, nombres no vacios, signos coherentes, uuid
-- unico, un solo turno N por dia.
--
-- (Las tablas nuevas usan uuid como punto de enganche y no el BIGSERIAL id a
-- proposito: la tablet conoce el uuid que genero antes de que el servidor
-- asigne un id, asi que no hace falta resolver ids como tiene que hacer
-- pushVenta con detalle_venta.)


-- =====================================================================
-- 6. Vista de estado: que turno esta abierto (derivado, no guardado)
-- =====================================================================
--
-- "La caja esta abierta" no es un campo, es la ausencia de arqueo. La vista
-- responde eso y el neto del ledger del turno, y nada mas: la cuenta del
-- esperado (ventas en efectivo, TGTG, plataformas) NO se replica aca porque ya
-- vive en cierre-calculos.js y dos implementaciones de la misma cuenta siempre
-- terminan discrepando. Esto solo ahorra el join.
--
-- security_invoker = true: la vista se evalua con los permisos de quien
-- consulta, asi sigue respetando el RLS de las tablas de abajo en vez de
-- saltearselo por ser propiedad de postgres. Requiere Postgres 15+ (staging
-- corre una version mas nueva).

DROP VIEW IF EXISTS caja_sesiones_estado;
CREATE VIEW caja_sesiones_estado WITH (security_invoker = true) AS
SELECT
  s.uuid                       AS sesion_uuid,
  s.fecha,
  s.turno,
  s.abierta_por,
  s.abierta_en,
  s.fondo_inicial_centavos,
  COALESCE(m.neto_centavos, 0) AS movimientos_centavos,
  COALESCE(m.cantidad, 0)      AS movimientos_cantidad,
  a.uuid                       AS arqueo_uuid,
  a.tipo                       AS arqueo_tipo,
  a.contado_en,
  a.deja_centavos,
  (a.uuid IS NULL)             AS abierta
FROM sesiones_caja s
LEFT JOIN (
  SELECT sesion_uuid, SUM(importe_centavos) AS neto_centavos, COUNT(*) AS cantidad
  FROM movimientos_caja
  WHERE afecta_cajon
  GROUP BY sesion_uuid
) m ON m.sesion_uuid = s.uuid
LEFT JOIN (
  -- el arqueo vigente de cada sesion: el mas reciente
  SELECT DISTINCT ON (sesion_uuid) sesion_uuid, uuid, tipo, contado_en, deja_centavos
  FROM arqueos_caja
  ORDER BY sesion_uuid, creado_en DESC
) a ON a.sesion_uuid = s.uuid;

COMMENT ON VIEW caja_sesiones_estado IS 'Estado derivado de cada turno: neto del ledger y si sigue abierto (abierta = todavia no tiene arqueo). No calcula el esperado: eso vive en cierre-calculos.js.';


-- =====================================================================
-- 7. RLS -- append-only a nivel de base, sin UPDATE ni DELETE
-- =====================================================================
--
-- Igual que cierres_caja en la 015: solo SELECT e INSERT para los usuarios de
-- la app. No es una preferencia de estilo, es el requisito de que los registros
-- financieros sean auditables para la futura facturacion fiscal. Que no haya
-- politica de UPDATE significa que ni un bug, ni un agente, ni una consulta a
-- mano desde la app pueden reescribir un movimiento ya cargado.
--
-- OJO, PROBADO EN UN POSTGRES 17 LOCAL: sin politica de UPDATE/DELETE, esos
-- comandos NO devuelven error — devuelven "0 filas afectadas". Las filas
-- quedan intactas (es lo que importa), pero un PATCH o un DELETE desde la app
-- va a parecer exitoso y no va a cambiar nada. Es el mismo comportamiento que
-- ya tiene cierres_caja desde la 015. Para el codigo que venga: no escribir
-- nada que intente editar estas tablas, porque va a fallar en silencio.

ALTER TABLE sesiones_caja    ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqueos_caja     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sesiones_caja_select ON sesiones_caja;
DROP POLICY IF EXISTS sesiones_caja_insert ON sesiones_caja;
CREATE POLICY sesiones_caja_select ON sesiones_caja FOR SELECT TO authenticated USING (true);
CREATE POLICY sesiones_caja_insert ON sesiones_caja FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS movimientos_caja_select ON movimientos_caja;
DROP POLICY IF EXISTS movimientos_caja_insert ON movimientos_caja;
CREATE POLICY movimientos_caja_select ON movimientos_caja FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_caja_insert ON movimientos_caja FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS arqueos_caja_select ON arqueos_caja;
DROP POLICY IF EXISTS arqueos_caja_insert ON arqueos_caja;
CREATE POLICY arqueos_caja_select ON arqueos_caja FOR SELECT TO authenticated USING (true);
CREATE POLICY arqueos_caja_insert ON arqueos_caja FOR INSERT TO authenticated WITH CHECK (true);
-- sin politicas de UPDATE ni DELETE en las tres: append-only


-- Recarga el cache de esquema de PostgREST para que la API vea lo nuevo ya.
NOTIFY pgrst, 'reload schema';
