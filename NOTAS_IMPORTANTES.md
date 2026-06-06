# ⚠️ NOTAS IMPORTANTES — WorkFlowTaller Bot
## Leer antes de instalar o actualizar dependencias

---

## 🔧 PARCHE MANUAL REQUERIDO TRAS CADA `npm install`

> **Problema:** La librería `whatsapp-web.js` llama internamente a una función
> (`canCheckStatusRankingPosterGating`) que WhatsApp Web eliminó en una actualización.
> Esto provoca el siguiente error al intentar enviar mensajes:
>
> ```
> TypeError: window.require(...).canCheckStatusRankingPosterGating is not a function
> ```

---

### 📁 Archivos involucrados

| Rol | Ruta |
|-----|------|
| ✅ Archivo parcheado (backup) | `patches\Utils.js.patched` |
| 🎯 Destino del parche | `node_modules\whatsapp-web.js\src\util\Injected\Utils.js` |
| ⚡ Script de reaplicación | `patches\aplicar-parches.bat` |

---

### 🚀 Procedimiento tras reinstalar dependencias (`npm install`)

**Opción A — Automática (recomendada):**
1. Ejecuta `npm install` normalmente
2. Haz doble clic en `patches\aplicar-parches.bat`
3. Inicia el bot: `node index.js`

**Opción B — Manual:**
1. Abre el archivo:
   `node_modules\whatsapp-web.js\src\util\Injected\Utils.js`
2. Busca (Ctrl+F): `canCheckStatusRankingPosterGating`
3. Localiza estas líneas (~línea 549):
   ```js
   cannotBeRanked: window
       .require('WAWebStatusGatingUtils')
       .canCheckStatusRankingPosterGating(),
   ```
4. Reemplaza con:
   ```js
   cannotBeRanked: (() => { try { const _sg = window.require('WAWebStatusGatingUtils'); return typeof _sg.canCheckStatusRankingPosterGating === 'function' ? _sg.canCheckStatusRankingPosterGating() : false; } catch(e) { return false; } })(),
   ```

---

### 📝 ¿Por qué ocurre esto?

`whatsapp-web.js` es una librería no oficial que hace ingeniería inversa sobre
WhatsApp Web. Cuando WhatsApp actualiza su aplicación web, los nombres internos
de sus funciones pueden cambiar. Hasta que el equipo de `whatsapp-web.js` 
publique una actualización compatible, este parche manual es la solución.

**Versión de la librería donde se detectó el problema:** `1.34.7`
**Fecha en que se aplicó el primer parche:** Mayo 2026

---

### ⚙️ Configuración del bot (resumen rápido)

| Archivo | Propósito |
|---------|-----------|
| `index.js` | Cerebro del bot — lógica multilínea y API |
| `instrucciones_ia.txt` | Manual de entrenamiento de la IA (editar sin reiniciar) |
| `.env` | Claves de API y configuración de entorno |
| `limpiar-cache-bot.bat` | Limpiar sesión de WhatsApp y reiniciar |
| `patches\aplicar-parches.bat` | ← **Ejecutar tras cada npm install** |

---

### 📞 Líneas de WhatsApp configuradas

El bot maneja **2 líneas independientes** en paralelo:
- **Línea 1:** sesión guardada en `.wwebjs_auth\session-wft-line-1`
- **Línea 2:** sesión guardada en `.wwebjs_auth\session-wft-line-2`

Cada línea requiere escanear su propio código QR la primera vez.

---

*Documento generado automáticamente — WorkFlowTaller Bot*
