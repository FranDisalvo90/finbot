# Splitwise API Sync

## Context

FinBot carga gastos de dos fuentes: Splitwise (gastos del dia a dia) y VISA Galicia (tarjeta de credito). Hoy ambos se importan manualmente al principio del mes siguiente (CSV export para Splitwise, PDF para la tarjeta). Esto impide ver el avance del mes en curso y comparar contra meses anteriores a mitad de mes.

El objetivo es sincronizar los gastos de Splitwise automaticamente via API para tener visibilidad del mes en curso sin esperar al cierre.

## Alcance

- Conectar cuenta de Splitwise via OAuth 2.0
- Seleccionar un grupo de Splitwise como fuente de gastos
- Sincronizar gastos del grupo bajo demanda (boton "Sincronizar")
- Sync incremental con cursor `updated_after`
- Upsert + delete basado en `sourceRef` (ID de Splitwise)
- Reusar el pipeline existente de conversion de moneda y categorizacion

**Fuera de alcance**: cron job automatico (se puede agregar despues), sincronizar multiples grupos simultaneos, uso de `owed_share` (se usa costo total).

---

## Decisiones de diseno

### Costo total vs. parte del usuario
Se usa `expense.cost` (costo total del gasto), no `owed_share`. Esto es consistente con como el CSV de Splitwise ya se importaba.

### Un grupo a la vez
El usuario selecciona un grupo despues de conectar. Puede cambiarlo en cualquier momento. Al cambiar de grupo:
- Los gastos del grupo anterior se mantienen (son gastos reales)
- El cursor de sync se resetea
- La proxima sync trae los gastos del nuevo grupo

### Deduplicacion por sourceRef
Para gastos de la API, la dedup usa el `sourceRef` (Splitwise expense ID) en vez de `date + amount + description`. Esto permite detectar ediciones y borrados en Splitwise. El import CSV sigue usando la dedup vieja.

### Sync manual, sin cron
La sync se dispara con un boton. El cursor `updated_after` hace que cada sync sea rapida e incremental. No se necesita cron por ahora.

### No se reusa el parser CSV
El parser `parsers/splitwise.ts` queda intacto como fallback para importar CSV. El nuevo servicio produce `ParsedExpense[]` directamente desde el JSON de la API.

---

## Cambios en la DB

### Tabla `users` - columnas nuevas

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| `splitwise_access_token` | text, nullable | Token OAuth 2.0 de Splitwise |
| `splitwise_user_id` | integer, nullable | ID del usuario en Splitwise |
| `splitwise_group_id` | integer, nullable | ID del grupo seleccionado |
| `splitwise_group_name` | text, nullable | Nombre del grupo (para mostrar en UI) |

### Nueva tabla `splitwise_sync_state`

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| `id` | uuid, PK | ID unico |
| `user_id` | uuid, FK -> users, unique | Un registro por usuario |
| `last_sync_at` | timestamp, nullable | Cuando se corrio la ultima sync |
| `last_updated_at` | timestamp, nullable | Cursor `updated_at` de Splitwise |
| `created_at` | timestamp, default now | Timestamp de creacion |

---

## OAuth 2.0 Flow

### Env vars nuevas
```
SPLITWISE_CLIENT_ID=
SPLITWISE_CLIENT_SECRET=
SPLITWISE_REDIRECT_URI=http://localhost:3001/api/splitwise/callback
```

### Flujo
1. Usuario click "Conectar Splitwise"
2. Frontend redirige a `GET /api/splitwise/connect`
3. Backend genera `state` (CSRF token asociado al userId, TTL 10 min) y redirige a `https://secure.splitwise.com/oauth/authorize?response_type=code&client_id={ID}&redirect_uri={URI}&state={state}`
4. Usuario autoriza en Splitwise
5. Splitwise redirige a `/api/splitwise/callback?code={code}&state={state}`
6. Backend valida `state`, intercambia `code` por `access_token` via `POST https://secure.splitwise.com/oauth/token`
7. Backend obtiene `splitwise_user_id` via `GET /get_current_user`
8. Guarda token y user_id en tabla `users`
9. Redirige al frontend (`/import?splitwise=connected`)

**Nota**: el endpoint `/api/splitwise/callback` es publico (el usuario llega via redirect de Splitwise, sin JWT). La validacion del `state` garantiza que el request es legitimo.

**Token expiry**: los tokens de Splitwise OAuth 2.0 no expiran. Si la API retorna 401, se limpia el token y se pide reconexion.

---

## Endpoints nuevos

### Archivo: `packages/api/src/routes/splitwise.ts`

| Metodo | Path | Auth | Descripcion |
|--------|------|------|-------------|
| `GET` | `/api/splitwise/connect` | JWT | Redirige a Splitwise OAuth |
| `GET` | `/api/splitwise/callback` | Publico | Callback de OAuth, guarda token |
| `GET` | `/api/splitwise/status` | JWT | `{ connected, groupName, lastSyncAt }` |
| `GET` | `/api/splitwise/groups` | JWT | Lista grupos disponibles del usuario |
| `POST` | `/api/splitwise/group` | JWT | Selecciona/cambia grupo activo. Body: `{ groupId, groupName }` |
| `POST` | `/api/splitwise/sync` | JWT | Ejecuta sync incremental |
| `POST` | `/api/splitwise/disconnect` | JWT | Limpia token y desconecta |

---

## Servicio de sync

### Archivo: `packages/api/src/services/splitwise-sync.ts`

```
syncSplitwiseExpenses(userId):
  1. Leer token, splitwiseUserId, groupId de tabla users
  2. Leer cursor lastUpdatedAt de splitwise_sync_state
  3. Fetch gastos de Splitwise API:
     - GET /get_expenses?group_id={groupId}&updated_after={cursor}&limit=100
     - Paginar con offset hasta respuesta vacia
     - Si cursor es null (primera sync): dated_after = 6 meses atras
  4. Separar en:
     a. Gastos activos: payment === false AND deleted_at === null
     b. Gastos borrados: deleted_at !== null
  5. Mapear gastos activos a ParsedExpense[]:
     {
       date: expense.date (YYYY-MM-DD),
       description: expense.description,
       amount: parseFloat(expense.cost),  // costo total
       currency: expense.currency_code,
       installment: null,
       isFinancialCharge: false,
       sourceRef: String(expense.id),
       rawLine: JSON.stringify(expense)
     }
  6. Dedup contra DB via sourceRef:
     - sourceRef existe + campos cambiaron → UPDATE
     - sourceRef existe + sin cambios → skip
     - sourceRef no existe → INSERT
  7. Gastos con deleted_at → DELETE de expenses WHERE sourceRef IN (...)
  8. Fetch blue dollar rate (dolarapi.com)
  9. Aplicar conversion dual-currency (ARS/USD)
  10. Aplicar categorizacion (applyRules + categorizeBatch)
  11. Actualizar cursor en splitwise_sync_state
  12. Retornar { inserted, updated, deleted, categorized, exchangeRate }
```

### Archivo: `packages/api/src/services/splitwise-client.ts`

Wrapper HTTP con `fetch` nativo:
- `splitwiseFetch<T>(path, accessToken, params?)` - GET con auth header
- Retry con backoff para 429 (rate limit)
- Throw `SplitwiseAuthError` en 401
- Sin dependencia de SDK externo

### Archivo: `packages/api/src/services/exchange-rate.ts`

Extraer `fetchBlueRate()` de `packages/api/src/routes/import.ts` a un servicio compartido para que tanto el import CSV como la sync de Splitwise lo usen sin duplicar codigo.

---

## Frontend

### Pagina de Import (`packages/dashboard/src/pages/Import.tsx`)

Agregar seccion arriba del dropzone de archivos:

**Estado: no conectado**
```
┌──────────────────────────────────────────────────┐
│ Splitwise                                        │
│                                                  │
│ Sincroniza tus gastos de Splitwise               │
│ automaticamente.                                 │
│                                                  │
│ [Conectar Splitwise]                             │
└──────────────────────────────────────────────────┘
```

**Estado: conectado, sin grupo**
```
┌──────────────────────────────────────────────────┐
│ Splitwise  ✓ Conectado                           │
│                                                  │
│ Selecciona un grupo:                             │
│ [Dropdown con grupos]                            │
│                                                  │
│ [Confirmar]          [Desconectar]               │
└──────────────────────────────────────────────────┘
```

**Estado: conectado, grupo seleccionado**
```
┌──────────────────────────────────────────────────┐
│ Splitwise  ✓ Conectado                           │
│                                                  │
│ Grupo: Casa con Ana         [Cambiar grupo]      │
│ Ultima sync: 18/04/2026 14:30                    │
│                                                  │
│ [Sincronizar]               [Desconectar]        │
└──────────────────────────────────────────────────┘
```

**Despues de sync**: mostrar resumen (N insertados, N actualizados, N borrados, N categorizados).

### API client (`packages/dashboard/src/lib/api.ts`)

Agregar funciones:
- `getSplitwiseStatus()` → GET /api/splitwise/status
- `getSplitwiseGroups()` → GET /api/splitwise/groups
- `selectSplitwiseGroup(groupId, groupName)` → POST /api/splitwise/group
- `syncSplitwise()` → POST /api/splitwise/sync
- `disconnectSplitwise()` → POST /api/splitwise/disconnect
- `connectSplitwise()` → redirect a /api/splitwise/connect

---

## Manejo de errores

| Escenario | Comportamiento |
|-----------|---------------|
| Token revocado (401 de Splitwise) | Limpiar token, retornar `splitwise_auth_expired`, frontend pide reconexion |
| Rate limit (429) | Retry con backoff exponencial (1s, 2s, 4s). Despues de 3 intentos, error |
| Red / timeout | Try/catch, retornar error al frontend |
| Sync parcial (falla a mitad de paginacion) | No actualizar cursor. Proxima sync retoma desde el mismo punto |
| dolarapi.com no disponible | Usar ultima tasa conocida o pedir al usuario |

---

## Archivos a crear/modificar

| Archivo | Accion |
|---------|--------|
| `packages/api/src/db/schema.ts` | Modificar: agregar columnas a users + nueva tabla splitwise_sync_state |
| `packages/api/src/services/splitwise-client.ts` | Crear: wrapper HTTP para Splitwise API |
| `packages/api/src/services/splitwise-sync.ts` | Crear: logica de sync |
| `packages/api/src/services/exchange-rate.ts` | Crear: extraer fetchBlueRate de import.ts |
| `packages/api/src/routes/splitwise.ts` | Crear: endpoints OAuth + sync + status |
| `packages/api/src/routes/import.ts` | Modificar: usar exchange-rate.ts compartido |
| `packages/api/src/app.ts` | Modificar: registrar rutas de splitwise |
| `packages/dashboard/src/pages/Import.tsx` | Modificar: seccion de conexion Splitwise |
| `packages/dashboard/src/lib/api.ts` | Modificar: agregar funciones de API |
| `packages/api/src/routes/__tests__/splitwise.test.ts` | Crear: tests de sync |

---

## Verificacion

1. **Unit tests**: testear sync con respuestas mockeadas de Splitwise API (insert, update, delete, skip payments, paginacion)
2. **Integracion manual**:
   - Registrar app en Splitwise, obtener client_id/secret
   - Conectar cuenta via OAuth en la UI
   - Seleccionar grupo
   - Crear gasto en Splitwise, sincronizar, verificar que aparece en el dashboard
   - Editar gasto en Splitwise, sincronizar, verificar que se actualiza
   - Borrar gasto en Splitwise, sincronizar, verificar que desaparece
   - Cambiar grupo, sincronizar, verificar que trae gastos del nuevo grupo y mantiene los anteriores
3. **Lint + tests**: `pnpm lint && pnpm test:api`
