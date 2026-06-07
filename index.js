require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const aiGemini = require('./bot/ai_gemini.js');
const commands = require('./bot/commands.js');
const utils = require('./bot/utils.js');
const genAI = aiGemini.initGemini();
const expressApp = express();
const port = 3000;

expressApp.use(cors());
expressApp.use(express.json());

// ─────────────────────────────────────────────────────────
// DETECTAR NAVEGADOR (Chrome o Edge)
// ─────────────────────────────────────────────────────────
let browserPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(browserPath)) {
    browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}
if (!fs.existsSync(browserPath)) {
    console.error('❌ No se encontró Chrome ni Edge. Instala uno de los dos.');
    process.exit(1);
}
console.log(`🌐 Usando navegador: ${browserPath}`);

// ─────────────────────────────────────────────────────────
// VARIABLES GLOBALES
// ─────────────────────────────────────────────────────────
let isReady1 = false;
let isReady2 = false;
let startupReady1 = false;  // true cuando el cooldown post-ready termina (línea 1)
let startupReady2 = false;  // true cuando el cooldown post-ready termina (línea 2)
let allowHumanContact = true;
let notifyAfterHours = true;
let dbOrders = [];
let userStates = {};
let humanTakenOver = {}; // Chats bajo control humano: { [clientId]: true }

// Variables faltantes que causaban errores
const palabrasProhibidas = ['puta', 'mierda', 'cabron', 'estupido', 'pendejo', 'idiota'];
const chatHistories = {};
const adminIds = ['50762460158', '50762460158@c.us']; // Añade números administradores aquí
const adminAire = [];
const adminAuto = [];

// Rate Limiting por remitente
const rateLimitMap = {};        // { senderId: [timestamp1, timestamp2, ...] }
const RATE_LIMIT_MAX = 5;       // máximo mensajes permitidos
const RATE_LIMIT_WINDOW = 60000; // en ventana de 60 segundos

// API Key para proteger el endpoint /send
const API_KEY = process.env.API_KEY || 'wft-bot-2026';

let client1 = null;
let client2 = null;
let readyTimeout1 = null;
let readyTimeout2 = null;
let reconnectTimer1 = null;
let reconnectTimer2 = null;
let startupTimeout1 = null;  // Watchdog: reinicia si initialize() se queda colgado sin respuesta
let startupTimeout2 = null;
let linea2Iniciada = false;  // Control para iniciar la Línea 2 solo tras arrancar la Línea 1

// ─────────────────────────────────────────────────────────
// FUNCIÓN DE CREACIÓN DEL CLIENTE (parametrizada para multilínea)
// ─────────────────────────────────────────────────────────
function crearCliente(lineaNum) {
    const clientId = `wft-line-${lineaNum}`;
    
    // Destruir instancia previa si existe
    if (lineaNum === 1) {
        if (client1) { try { client1.destroy(); } catch (e) {} }
        client1 = null;
        isReady1 = false;
    } else {
        if (client2) { try { client2.destroy(); } catch (e) {} }
        client2 = null;
        isReady2 = false;
    }

    console.log(`🔄 [LÍNEA ${lineaNum}] Iniciando cliente de WhatsApp...`);

    const clientInstance = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: path.join(__dirname, '.wwebjs_auth')
        }),
        puppeteer: {
            executablePath: browserPath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--window-size=800,600'
            ],
            timeout: 120000  // 120 segundos para abrir navegador (dos instancias necesitan más tiempo)
        }
    });

    if (lineaNum === 1) {
        client1 = clientInstance;
    } else {
        client2 = clientInstance;
    }

    // ── Eventos del ciclo de vida ──────────────────────────
    clientInstance.on('qr', (qr) => {
        // El QR llegó: Chrome y WA Web funcionan, cancelar watchdog de arranque
        if (lineaNum === 1) { clearTimeout(readyTimeout1); clearTimeout(startupTimeout1); }
        else { clearTimeout(readyTimeout2); clearTimeout(startupTimeout2); }

        console.log('\n----------------------------------------------------');
        console.log(`📱 ESCANEA EL QR PARA VINCULAR LA [LÍNEA ${lineaNum}] 📱`);
        console.log('----------------------------------------------------');
        qrcode.generate(qr, { small: true });
    });

    clientInstance.on('authenticated', () => {
        console.log(`✅ [LÍNEA ${lineaNum}] Autenticación exitosa. Cargando WhatsApp...`);
        
        if (lineaNum === 1) {
            clearTimeout(startupTimeout1);  // Cancelar watchdog de arranque
            clearTimeout(readyTimeout1);
            readyTimeout1 = setTimeout(() => {
                console.warn(`⏱️ [LÍNEA 1] Timeout: El bot tardó demasiado en conectarse. La sesión podría estar corrupta. Limpiando caché y reiniciando...`);
                limpiarCache(1);
                reiniciarCliente(1);
            }, 120000);
        } else {
            clearTimeout(startupTimeout2);  // Cancelar watchdog de arranque
            clearTimeout(readyTimeout2);
            readyTimeout2 = setTimeout(() => {
                console.warn(`⏱️ [LÍNEA 2] Timeout: El bot tardó demasiado en conectarse. La sesión podría estar corrupta. Limpiando caché y reiniciando...`);
                limpiarCache(2);
                reiniciarCliente(2);
            }, 120000);
        }
    });

    clientInstance.on('ready', () => {
        if (lineaNum === 1) {
            clearTimeout(readyTimeout1);
            isReady1 = true;
            startupReady1 = false;
            
            // Iniciar Línea 2 SOLO cuando Línea 1 esté 100% lista para evitar saturar recursos
            if (!linea2Iniciada) {
                linea2Iniciada = true;
                console.log('🔄 [LÍNEA 2] La Línea 1 está lista. Iniciando Línea 2 de forma segura...');
                setTimeout(() => crearCliente(2), 3000); // Pequeña pausa antes de abrir otro Chrome
            }
            
            setTimeout(() => {
                startupReady1 = true;
                console.log('✅ [LÍNEA 1] Periodo de gracia finalizado. Bot procesando mensajes.');
            }, 30000);
        } else {
            clearTimeout(readyTimeout2);
            isReady2 = true;
            startupReady2 = false;
            setTimeout(() => {
                startupReady2 = true;
                console.log('✅ [LÍNEA 2] Periodo de gracia finalizado. Bot procesando mensajes.');
            }, 30000);
        }
        console.log(`✅ [LÍNEA ${lineaNum}] Conectada. Esperando 30s de gracia antes de procesar mensajes...`);
    });

    clientInstance.on('auth_failure', (msg) => {
        if (lineaNum === 1) {
            clearTimeout(startupTimeout1); clearTimeout(readyTimeout1);
            isReady1 = false;
        } else {
            clearTimeout(startupTimeout2); clearTimeout(readyTimeout2);
            isReady2 = false;
        }
        console.error(`❌ [LÍNEA ${lineaNum}] Fallo de autenticación:`, msg);
        console.log(`🧹 [LÍNEA ${lineaNum}] Limpiando caché de sesión y reiniciando...`);
        limpiarCache(lineaNum);
        reiniciarCliente(lineaNum, 5000);
    });

    clientInstance.on('disconnected', (reason) => {
        if (lineaNum === 1) {
            clearTimeout(startupTimeout1); clearTimeout(readyTimeout1);
            isReady1 = false;
        } else {
            clearTimeout(startupTimeout2); clearTimeout(readyTimeout2);
            isReady2 = false;
        }
        console.log(`⚠️ [LÍNEA ${lineaNum}] Desconectado: ${reason}. Reconectando en 10 segundos...`);
        reiniciarCliente(lineaNum, 10000);
    });

    // Registrar listeners de mensajes para esta instancia
    registrarListenerMensajes(clientInstance, `Línea ${lineaNum}`);

    // ── Watchdog de arranque en frío ────────────────────────────────────────────
    // Si en 90s no llega ningún evento (qr, authenticated, auth_failure),
    // es que Chrome/WA Web se colgó silenciosamente → forzar reconexión.
    const startupWatchdog = setTimeout(() => {
        console.warn(`⏱️ [LÍNEA ${lineaNum}] Watchdog: sin respuesta de WhatsApp Web tras 90s. Reiniciando...`);
        reiniciarCliente(lineaNum, 5000);
    }, 90000);
    if (lineaNum === 1) startupTimeout1 = startupWatchdog;
    else startupTimeout2 = startupWatchdog;

    clientInstance.initialize().catch(err => {
        console.error(`❌ [LÍNEA ${lineaNum}] Error al inicializar:`, err.message);
        if (lineaNum === 1) clearTimeout(startupTimeout1);
        else clearTimeout(startupTimeout2);
        reiniciarCliente(lineaNum, 10000);
    });
}

function limpiarCache(lineaNum) {
    const cachePath = path.join(__dirname, '.wwebjs_auth', `session-wft-line-${lineaNum}`);
    if (fs.existsSync(cachePath)) {
        try {
            fs.rmSync(cachePath, { recursive: true, force: true });
            console.log(`🧹 [LÍNEA ${lineaNum}] Caché de sesión eliminado.`);
        } catch (e) {
            console.warn(`[LÍNEA ${lineaNum}] No se pudo limpiar el caché automáticamente:`, e.message);
        }
    }
}

function reiniciarCliente(lineaNum, delay = 5000) {
    if (lineaNum === 1) {
        clearTimeout(reconnectTimer1);
        reconnectTimer1 = setTimeout(() => {
            crearCliente(1);
        }, delay);
    } else {
        clearTimeout(reconnectTimer2);
        reconnectTimer2 = setTimeout(() => {
            crearCliente(2);
        }, delay);
    }
}



// Endpoints Express (la API del bot — siempre activos, independientes del estado de WA)

// Endpoint para obtener la configuración del bot
expressApp.get('/config', (req, res) => {
    res.json({ success: true, config: { allowHumanContact, notifyAfterHours } });
});

// Endpoint para actualizar la configuración del bot
expressApp.post('/config', (req, res) => {
    if (req.body) {
        let updated = false;
        if (req.body.allowHumanContact !== undefined) {
            allowHumanContact = req.body.allowHumanContact === true || req.body.allowHumanContact === 'true';
            console.log(`⚙️ Configuración actualizada: Permitir hablar con humano = ${allowHumanContact}`);
            updated = true;
        }
        if (req.body.notifyAfterHours !== undefined) {
            notifyAfterHours = req.body.notifyAfterHours === true || req.body.notifyAfterHours === 'true';
            console.log(`⚙️ Configuración actualizada: Notificar fuera de horario = ${notifyAfterHours}`);
            updated = true;
        }
        
        if (updated) {
            res.json({ success: true, config: { allowHumanContact, notifyAfterHours } });
        } else {
            res.status(400).json({ success: false, error: 'Se requiere parámetro allowHumanContact o notifyAfterHours.' });
        }
    } else {
        res.status(400).json({ success: false, error: 'Cuerpo de solicitud inválido.' });
    }
});

// Endpoint para sincronizar órdenes desde la web
expressApp.post('/sync-orders', (req, res) => {
    if (req.body && Array.isArray(req.body.orders)) {
        dbOrders = req.body.orders;
        console.log(`📦 Órdenes sincronizadas: ${dbOrders.length} órdenes recibidas.`);
        res.json({ success: true, count: dbOrders.length });
    } else {
        res.status(400).json({ success: false, error: 'Formato inválido. Se espera { orders: [...] }' });
    }
});

// Función para normalizar texto de búsqueda de órdenes (elimina prefijos comunes, guiones y espacios)
// 🤖 CEREBRO DEL BOT: función que registra el listener de mensajes (se llama cada vez que el cliente se crea)
function registrarListenerMensajes(clientInstance, nombreLinea) {
    clientInstance.on('message', async msg => {
    // ── Capa -2: Ignorar mensajes propios del bot ──────────────────────────────
    if (msg.fromMe) return;

    // ── Capa -1: Verificar que el bot completó el periodo de gracia post-arranque ──
    const lineaNumMsg = clientInstance === client1 ? 1 : 2;
    const startupOk = lineaNumMsg === 1 ? startupReady1 : startupReady2;
    if (!startupOk) {
        console.log(`[${nombreLinea}] ⏳ Ignorando mensaje (periodo de gracia activo).`);
        return;
    }

    // ── Capa -0.5: Verificar antigüedad del mensaje (máx 2 minutos) ──────────
    const ahoraUnix = Math.floor(Date.now() / 1000);
    const edadSegundos = ahoraUnix - (msg.timestamp || ahoraUnix);
    if (edadSegundos > 120) {
        console.log(`[${nombreLinea}] ⏰ Ignorando mensaje viejo (${edadSegundos}s de antigüedad) de ${msg.from}`);
        return;
    }

    // ── Capa 0: Filtro de estados, broadcasts y grupos (reforzado) ──────────────
    if (msg.isStatus || msg.from === 'status@broadcast' || msg.to === 'status@broadcast' || (msg.from && msg.from.includes('status'))) {
        console.log(`[${nombreLinea}] Ignorando actualización de estado.`);
        return;
    }
    if (msg.from.includes('@g.us')) {
        return; // Ignorar mensajes de grupos
    }

    const texto = msg.body.trim().toLowerCase();
    const sender = msg.from;

    // ── Capa 0.5: Rate Limiting por remitente (máx 5 msgs/min) ──────────────────
    const ahoraMs = Date.now();
    if (!rateLimitMap[sender]) rateLimitMap[sender] = [];
    rateLimitMap[sender] = rateLimitMap[sender].filter(t => ahoraMs - t < RATE_LIMIT_WINDOW);
    if (rateLimitMap[sender].length >= RATE_LIMIT_MAX) {
        console.warn(`[${nombreLinea}] 🚫 Rate limit alcanzado para ${sender} (${rateLimitMap[sender].length} msgs en 60s)`);
        return;
    }
    rateLimitMap[sender].push(ahoraMs);

    // ── Capa 1: Filtro Local Rápido contra Lenguaje Obsceno ──────────────────────────
    const contienePalabraProhibida = palabrasProhibidas.some(p => texto.includes(p));
    if (contienePalabraProhibida) {
        console.warn(`⚠️ Mensaje ignorado debido a lenguaje obsceno detectado localmente de ${sender}`);
        return; // Salir de inmediato sin responder
    }

    // ── Capa 2: Filtro de Imágenes / Medios (Ignorar fotos, videos, documentos) ──
    if (msg.hasMedia && msg.type !== 'audio' && msg.type !== 'ptt') {
        console.log(`[${nombreLinea}] Ignorando mensaje multimedia (tipo: ${msg.type}) de ${sender}`);
        return;
    }

    // ── Comando de depuración para reiniciar el chat en caliente ────────────────────────
    if (texto === 'reiniciar' || texto === 'limpiar' || texto === 'reset' || texto === 'limpiar chat') {
        delete chatHistories[sender];
        delete userStates[sender];
        console.log(`🔄 Historial de conversación reiniciado para el número: ${sender}`);
        return msg.reply('🔄 Historial de conversación reiniciado. ¡Podemos comenzar desde cero!');
    }

    // ── Comando de depuración profunda de WhatsApp ────────────────────────────────────
    if (texto === 'debug-wa') {
        let contactNum = 'Desconocido';
        try {
            const contact = await msg.getContact();
            contactNum = contact ? contact.number : 'Sin número';
        } catch(e) {}
        
        return msg.reply(`*⚠️ DEBUG DE WHATSAPP SERVER ⚠️*\n\nWhatsApp me dice que tú eres:\n- *msg.from:* ${msg.from}\n- *msg.author:* ${msg.author || 'N/A'}\n- *contact.number:* ${contactNum}\n- *ID de Dispositivo:* ${msg.deviceType}\n\nSi ves un número extraño (como 227...), es porque WhatsApp (Meta) me está entregando ese ID oculto o tu cuenta tiene ese identificador interno en lugar de tu número telefónico normal.`);
    }

    // ── Resolver número de teléfono real del remitente (priorizando contact.number) ───
    // Helper: formatea un número como +507XXXXXXXX (autocompletar números panameños)
    let contactNum = '';
    try {
        const contactRaw = await msg.getContact();
        if (contactRaw && contactRaw.number) {
            contactNum = contactRaw.number.replace(/\D/g, '');
        }
    } catch(e) {}
    // Fallback: si contact.number no está disponible, usar el sender (puede ser LID)
    if (!contactNum || contactNum.length < 7) {
        contactNum = sender.split('@')[0].replace(/\D/g, '');
    }

    const isFromAdmin = adminIds.includes(sender) || adminIds.includes(contactNum) || adminIds.includes(msg.author || '');

    if (isFromAdmin) {
        const handled = await commands.handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto);
        if (handled !== false) return;
    }
    // ── Verificar si el chat está bajo control humano (bot pausado) ────────────────
    if (humanTakenOver[sender]) {
        console.log(`[${nombreLinea}] Chat en modo humano, ignorando mensaje de ${sender}`);
        return; // El técnico humano está atendiendo, el bot no interviene
    }

    // ── Opcional: Si Gemini está activo y configurado, procesar con IA ─────────────────
    // ── Opcional: Si Gemini está activo y configurado, procesar con IA ─────────────────
    const iaHandled = await aiGemini.procesarMensaje(msg, clientInstance, texto, sender, contactNum, dbOrders, chatHistories, allowHumanContact, notifyAfterHours, adminIds, adminAire, adminAuto);
    if (iaHandled) return;
    // ── FALLBACK TRADICIONAL: Menú interactivo estructurado (si la IA no está configurada o falló) ──
    if (userStates[sender] && userStates[sender].state === 'WAITING_SELECTION') {
        const selectedIndex = parseInt(texto) - 1;
        if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < userStates[sender].orders.length) {
            const orderEncontrada = userStates[sender].orders[selectedIndex];
            delete userStates[sender]; // Limpiar el estado

            const formatearMoneda = (monto) => {
                return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto || 0);
            };
            const saldo = (Number(orderEncontrada.budget) || 0) - (Number(orderEncontrada.downPayment) || 0);
            const equipo = utils.obtenerDescripcionEquipo(orderEncontrada);

            let respuesta = `📄 *Orden:* ${orderEncontrada.id} - ${equipo}\n` +
                            `👤 *Cliente:* ${orderEncontrada.clientName}\n` +
                            `📌 *Estado Actual:* ${orderEncontrada.status}\n`;
                            
            if (saldo > 0) {
                respuesta += `💰 *Saldo Pendiente:* ${formatearMoneda(saldo)}\n`;
            } else if (orderEncontrada.budget > 0) {
                respuesta += `✅ *Esta orden ya está pagada.*\n`;
            }

            return msg.reply(respuesta.trim());
        } else {
            return msg.reply('❌ Opción inválida. Por favor responde únicamente con el número de la lista que deseas consultar (Ej: 1).');
        }
    }

    if (userStates[sender] === 'WAITING_ORDER_ID') {
        // Eliminar el estado para que el próximo mensaje sea normal
        delete userStates[sender];

        const busquedaRaw = msg.body.trim().toLowerCase();
        if (busquedaRaw.length < 3) {
            return msg.reply('Por favor ingresa al menos 3 letras o números para realizar la búsqueda.');
        }

        const orderIdBuscado = utils.normalizarTextoBusqueda(msg.body);
        
        // Buscar la orden en la base de datos sincronizada comparando ID, cliente o equipo
        const ordenesEncontradas = dbOrders.filter(o => {
            const matchId = utils.normalizarTextoBusqueda(o.id) === orderIdBuscado;
            
            // Para búsquedas por nombre, exigimos que escriba nombre y apellido (que haya al menos un espacio en su texto),
            // a menos que escriba exactamente el nombre completo como está en la base de datos.
            const matchName = o.clientName && (
                o.clientName.toLowerCase() === busquedaRaw || 
                (o.clientName.toLowerCase().includes(busquedaRaw) && busquedaRaw.includes(' '))
            );

            const matchDevice = (o.deviceType && o.deviceType.toLowerCase().includes(busquedaRaw)) || 
                                (o.deviceDesc && o.deviceDesc.toLowerCase().includes(busquedaRaw)) ||
                                (o.vehicleData && o.vehicleData.brand && o.vehicleData.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.vehicleData && o.vehicleData.model && o.vehicleData.model.toLowerCase().includes(busquedaRaw)) ||
                                (o.acData && o.acData.brand && o.acData.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.acData && o.acData.model && o.acData.model.toLowerCase().includes(busquedaRaw)) ||
                                (o.brand && o.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.model && o.model.toLowerCase().includes(busquedaRaw));
            return matchId || matchName || matchDevice;
        });

        if (ordenesEncontradas.length > 1) {
            userStates[sender] = { state: 'WAITING_SELECTION', orders: ordenesEncontradas };
            let respuesta = 'Hemos encontrado varios equipos asociados a tu búsqueda. Por favor, responde con el *número* del equipo que deseas consultar:\n\n';
            ordenesEncontradas.forEach((order, index) => {
                const equipo = utils.obtenerDescripcionEquipo(order);
                respuesta += `${index + 1}️⃣ *Orden:* ${order.id} - ${equipo}\n`;
            });
            return msg.reply(respuesta.trim());
        } else if (ordenesEncontradas.length === 1) {
            const orderEncontrada = ordenesEncontradas[0];
            const formatearMoneda = (monto) => {
                return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto || 0);
            };
            const saldo = (Number(orderEncontrada.budget) || 0) - (Number(orderEncontrada.downPayment) || 0);
            const equipo = utils.obtenerDescripcionEquipo(orderEncontrada);

            let respuesta = `📄 *Orden:* ${orderEncontrada.id} - ${equipo}\n` +
                            `👤 *Cliente:* ${orderEncontrada.clientName}\n` +
                            `📌 *Estado Actual:* ${orderEncontrada.status}\n`;
                            
            if (saldo > 0) {
                respuesta += `💰 *Saldo Pendiente:* ${formatearMoneda(saldo)}\n`;
            } else if (orderEncontrada.budget > 0) {
                respuesta += `✅ *Esta orden ya está pagada.*\n`;
            }

            return msg.reply(respuesta.trim());
        } else {
            return msg.reply(`No hemos podido encontrar una orden coincidente con *${msg.body}*. Por favor verifica los datos o intenta buscar por número de orden.`);
        }
    }

    // Detección de saludos (hola, buenas, menu, info)
    const saludos = ['hola', 'buenas', 'buenos', 'menu', 'menú', 'info', 'ayuda'];
    let esSaludo = false;
    for (const saludo of saludos) {
        if (texto.includes(saludo) && texto.length < 20) {
            esSaludo = true;
            break;
        }
    }

    if (esSaludo) {
        let menuMsg = "¡Hola! Bienvenido a nuestro taller. ¿En qué podemos ayudarte?\n\n" +
                      "1️⃣ Consultar estado de reparación\n" +
                      "2️⃣ Horarios y ubicación\n";
        
        if (allowHumanContact) {
            menuMsg += "3️⃣ Hablar con un humano\n";
        }
        
        menuMsg += "\n*(Por favor, responde solo con el número de tu opción)*";
        return msg.reply(menuMsg);
    }

    // Detección de opciones del menú
    if (texto === '1') {
        userStates[sender] = 'WAITING_ORDER_ID'; // Ponemos al usuario en modo de espera
        return msg.reply('Por favor, escribe el *número de tu orden* (Ej: ORDEN-123), tu *nombre y apellido completo* o la *marca/tipo de equipo*. En breve verificaremos su estado.');
    }
    
    if (texto === '2') {
        return msg.reply('🕒 Trabajamos de Lunes a Viernes de 9:00 AM a 6:00 PM y Sábados de 9:00 AM a 2:00 PM.\n📍 Estamos ubicados en [Tu Dirección].');
    }

    if (texto === '3') {
        if (allowHumanContact) {
            return msg.reply('En un momento uno de nuestros técnicos te atenderá personalmente. ¡Gracias por tu paciencia!');
        } else {
            return msg.reply('Opción no válida. Por favor responde con 1 o 2.');
        }
    }
    }); // fin client.on('message')
} // fin registrarListenerMensajes

// ─────────────────────────────────────────────────────────
// ENDPOINTS PARA CHATS ACTIVOS Y MEDIA
// ─────────────────────────────────────────────────────────

expressApp.get('/api/chats/active', async (req, res) => {
    // Validar API Key antes de procesar
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== API_KEY) {
        return res.status(401).json({ success: false, error: 'API key inválida o no proporcionada.' });
    }

    try {
        const results = {};

        // Función helper para procesar una línea
        const procesarLinea = async (client, lineaNum, isReadyFlag) => {
            if (!isReadyFlag || !client) return null;
            try {
                const allChats = await client.getChats();
                const personalChats = allChats.filter(c => !c.isGroup);
                personalChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                
                const topChats = personalChats.slice(0, 10);
                const chatsData = [];

                for (let chat of topChats) {
                    const messages = await chat.fetchMessages({ limit: 15 });
                    const messagesData = messages.map(msg => ({
                        id: msg.id._serialized,
                        body: msg.body,
                        fromMe: msg.fromMe,
                        timestamp: msg.timestamp,
                        hasMedia: msg.hasMedia,
                        type: msg.type
                    }));

                    let profilePicUrl = null;
                    try {
                        const contact = await chat.getContact();
                        profilePicUrl = await contact.getProfilePicUrl();
                    } catch (e) {}

                    chatsData.push({
                        id: chat.id._serialized,
                        name: chat.name || chat.id.user,
                        timestamp: chat.timestamp,
                        profilePicUrl: profilePicUrl,
                        messages: messagesData
                    });
                }
                return chatsData;
            } catch (err) {
                console.error(`Error obteniendo chats línea ${lineaNum}:`, err);
                return null;
            }
        };

        results.line1 = await procesarLinea(client1, 1, isReady1);
        results.line2 = await procesarLinea(client2, 2, isReady2);

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('Error en /api/chats/active:', error);
        res.status(500).json({ success: false, error: error.toString() });
    }
});

expressApp.get('/api/chats/media/:line/:messageId', async (req, res) => {
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== API_KEY) {
        return res.status(401).json({ success: false, error: 'API key inválida o no proporcionada.' });
    }

    const line = parseInt(req.params.line);
    const messageId = req.params.messageId;
    const targetClient = line === 2 ? client2 : client1;
    const isReady = line === 2 ? isReady2 : isReady1;

    if (!isReady || !targetClient) {
        return res.status(503).json({ success: false, error: 'El cliente no está listo.' });
    }

    try {
        const msg = await targetClient.getMessageById(messageId);
        if (!msg) {
            return res.status(404).json({ success: false, error: 'Mensaje no encontrado.' });
        }

        if (!msg.hasMedia) {
            return res.status(400).json({ success: false, error: 'El mensaje no tiene media.' });
        }

        const media = await msg.downloadMedia();
        if (!media) {
            return res.status(500).json({ success: false, error: 'No se pudo descargar la media.' });
        }

        res.json({ success: true, mimetype: media.mimetype, data: media.data });
    } catch (error) {
        console.error('Error obteniendo media:', error);
        res.status(500).json({ success: false, error: error.toString() });
    }
});

// Endpoint de la API para recibir los mensajes desde app.js (soporta parámetro opcional "line" 1 o 2)
expressApp.post('/send', async (req, res) => {
    // Validar API Key antes de procesar
    const providedKey = req.headers['x-api-key'] || req.body.apiKey;
    if (providedKey !== API_KEY) {
        console.warn(`🔒 [API] Intento de envío rechazado: API key inválida.`);
        return res.status(401).json({ success: false, error: 'API key inválida o no proporcionada.' });
    }

    const { phone, message, line } = req.body;
    
    // Determinar qué cliente y estado de preparación usar
    const selectedLine = Number(line) === 2 ? 2 : 1;
    const isReady = selectedLine === 1 ? isReady1 : isReady2;
    const targetClient = selectedLine === 1 ? client1 : client2;

    if (!isReady || !targetClient) {
        return res.status(503).json({ success: false, error: `El cliente de WhatsApp para la [LÍNEA ${selectedLine}] aún no está listo. Escanea el código QR primero.` });
    }

    try {
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Se requiere el número de teléfono (phone) y el mensaje (message).' });
        }

        // Formatear el número o ID
        let validPhone = null;

        if (phone.includes('@')) {
            // Es un ID directo (ej. @c.us, @g.us, @lid). Intentamos usarlo directamente.
            validPhone = phone;
        } else {
            // Formatear el número (remover espacios, símbolos, etc.)
            let formattedPhone = phone.replace(/\D/g, ''); 
            let tryPhones = [];

            // Si es un número de 10 dígitos (formato estándar sin código de país)
            if (formattedPhone.length === 10) {
                // En México, WA a veces requiere '521' y otras veces '52'. En Panamá sería '507' pero son 8 dígitos.
                tryPhones.push(`521${formattedPhone}@c.us`);
                tryPhones.push(`52${formattedPhone}@c.us`);
            } else {
                tryPhones.push(`${formattedPhone}@c.us`);
            }

            // Buscar el número válido entre las opciones en el cliente
            for (let p of tryPhones) {
                if (await targetClient.isRegisteredUser(p)) {
                    validPhone = p;
                    break;
                }
            }
        }

        if (!validPhone) {
            console.log(`❌ [LÍNEA ${selectedLine}] Número no registrado en WA o ID inválido: ${phone}`);
            return res.status(400).json({ success: false, error: 'El número de teléfono no parece estar registrado en WhatsApp.' });
        }

        let formattedPhone = validPhone;

        // Enviar el mensaje por el cliente correspondiente
        const response = await targetClient.sendMessage(formattedPhone, message);
        console.log(`📩 [LÍNEA ${selectedLine}] Mensaje enviado correctamente a ${phone}`);
        return res.json({ success: true, response, lineUsed: selectedLine });

    } catch (error) {
        console.error(`❌ [LÍNEA ${selectedLine}] Error enviando mensaje:`, error);
        return res.status(500).json({ success: false, error: error.toString() });
    }
});

// ─────────────────────────────────────────────────────────
// ARRANCAR EL SERVIDOR HTTP Y EL CLIENTE DE WHATSAPP MULTILÍNEA
// ─────────────────────────────────────────────────────────
expressApp.listen(port, () => {
    console.log(`🚀 Servidor API del Bot escuchando en http://localhost:${port}`);
});

// Iniciar el sistema: la Línea 2 se iniciará automáticamente mediante eventos 
// cuando la Línea 1 haya terminado de cargar completamente.
crearCliente(1);
