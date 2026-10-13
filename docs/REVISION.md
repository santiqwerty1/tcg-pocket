# Revisión de un PR

Lo que revisa el Coordinador y lo que cada sesión revisa sola antes de abrir el PR. Sale de lo que encontraron las revisiones
del 11 al 13/10/2026: casi todos los PR necesitaron dos o tres rondas por los mismos tipos de hallazgo.

## Antes de abrir el PR: la autorrevisión

1. Lanzá un agente que revise tu diff contra `origin/main` de forma adversarial, con esta lista. Tiene que correr y no
   solo leer: armar los escenarios en un test suelto y revertir cada arreglo para ver que el test falla.
2. Arreglá lo que encuentre, o anotá por qué no.
3. En la descripción del PR va una sección **«Autorrevisión»**: qué revisó el agente, qué encontró y qué quedó.

## La lista

**Concurrencia y estados**
- Dos pedidos a la vez, un lease que vence, un worker que vuelve tarde con un resultado viejo, un reinicio a mitad de camino.
- Lo que se lee y después se escribe se escribe con condición (`UPDATE … WHERE estado = …`, o `updateMany` con lo leído), y
  una escritura que no encuentra la fila no deja nada a medio hacer.
- Cada estado del objeto: en cola, corriendo, terminado, fallado, cancelado, archivado, reemplazado. Qué pasa en cada uno.

**Compatibilidad**
- Los workers y clientes que hoy corren en producción, con su versión. Lo nuevo es opcional en el contrato.
- Las sesiones abiertas ven las tools MCP con las que arrancaron: un parámetro nuevo no les llega.
- Las migraciones sobre los datos que hay en producción: defaults constantes, sin reescribir tablas grandes, rellenos
  probados en una transacción que se deshace.

**Tests**
- Cada arreglo con un test que falla sin el arreglo. Probalo revirtiéndolo.
- Sin tests circulares, que eligen sus datos con la misma función que prueban.
- Casos negativos: lo que no tiene que pasar.

**Números y textos**
- Todo porcentaje con su n y su intervalo, y «orientativo» con n < 30. Mis partidas, los torneos y las simulaciones nunca
  se combinan en un número.
- Textos en español, a 375 px sin cortarse ni salirse del borde, con singular y plural.

**Producción**
- La máquina tiene 512 MB: nada de cachés que retengan objetos grandes viejos, ni cálculos pesados en cada pedido.
- Lo que manda el navegador o un worker no se da por bueno sin chequearlo, un GET no cambia nada, y los tokens nunca van
  a un log.

**Repo público**
- Autor y committer con el noreply (`git log --format='%h %ae %ce' origin/main..HEAD`).
- Nada de mails, del usuario de Windows en rutas (`C:/Users/<usuario>/…`), de tokens, de refs de Supabase ni de nombres
  reales de jugadores de Limitless.

**Lo que acompaña al PR**
- Las decisiones nuevas, en `docs/decisiones/pendientes/<rama>.md`, sin número. Ver abajo.
- «Para la bóveda» en la descripción.

## Decisiones sin conflictos

Un PR no toca `docs/DECISIONES.md`. Sus decisiones van en `docs/decisiones/pendientes/<rama>.md` (la rama con `/`
cambiado por `-`), con este formato:

```markdown
---
seccion: Fase 42, laboratorio (9/10/2026)
---
| **Lo que se decidió**, en una oración, y el detalle. | El motivo. |
```

`seccion:` es el título exacto de una sección de `docs/DECISIONES.md`, sin el `## `. Para una sección nueva, se agrega
`nueva: true` al frontmatter. Cada fila tiene dos celdas, decisión y motivo, y un `|` dentro del texto va como `\|`.
La CI corre `pnpm decisiones --check` en cada PR, así que un pendiente mal armado falla ahí.

Las filas van sin número. Al integrar, el Coordinador las numera y las pasa a `docs/DECISIONES.md`, en su sección o en una
nueva, con el script `scripts/decisiones.mjs`, y borra el archivo pendiente. Para citar una decisión antes de que tenga
número, se cita el archivo pendiente.

## Cuánta revisión lleva cada PR

| Riesgo | Qué toca | Revisión |
|---|---|---|
| Bajo | Solo documentación, bóveda o textos, sin lógica | El Coordinador lo lee y lo integra con la CI verde |
| Medio | Código común | Una revisión independiente |
| Alto | Migraciones, cola, workers o motor, concurrencia, seguridad o sesiones, lo que borra datos, despliegue o CI | Revisión independiente y, después de los arreglos, verificación con los mismos escenarios |

Si dudás del riesgo, decilo en el PR y lo decide el Coordinador.
